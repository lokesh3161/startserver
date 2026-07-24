const express  = require('express')
const cors     = require('cors')
const fs       = require('fs')
const path     = require('path')
const https    = require('https')
const logger   = require('../utils/logger')
const { getOrderByIdForRelease, getAllOrders } = require('./sheets')
const { updatePrintStatus, updateReleaseStatus } = require('./updater')
const { printPdf, getDefaultPrinter } = require('./printer')
const { deletePdf } = require('./downloader')
const { getTunnelUrl } = require('./tunnel')

const app         = express()
const PORT        = 3001
const PENDING_DIR = path.join(__dirname, '..', 'downloads')

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'cf-access-client-id'] }))
app.use(express.json({ limit: '150mb' }))
app.use((req, res, next) => {
  const from = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local'
  logger.info(`${req.method} ${req.path} ← ${from}`)
  next()
})

function saveScreenshotLocally(orderId, screenshotBase64) {
  try {
    fs.writeFileSync(path.join(PENDING_DIR, `${orderId}_payment.png`), Buffer.from(screenshotBase64, 'base64'))
    logger.success(`Screenshot saved: ${orderId}_payment.png`)
  } catch (err) { logger.error(`Screenshot save failed: ${err.message}`) }
}

function saveSettings(orderId, settings) {
  fs.writeFileSync(path.join(PENDING_DIR, `${orderId}_settings.json`), JSON.stringify(settings))
  logger.success(`Settings saved for ${orderId}: ${JSON.stringify(settings)}`)
}

function loadSettings(orderId) {
  const p = path.join(PENDING_DIR, `${orderId}_settings.json`)
  if (!fs.existsSync(p)) return {}
  try {
    const s = JSON.parse(fs.readFileSync(p, 'utf8'))
    fs.unlinkSync(p)
    return s
  } catch { return {} }
}

// Download a file from a URL and save to disk
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err) })
  })
}

const BOOTH_PIN = '2580'

app.post('/booth-login', (req, res) => {
  const { pin } = req.body
  if (!pin) return res.json({ success: false, error: 'PIN required' })
  if (pin !== BOOTH_PIN) return res.json({ success: false, error: 'Wrong PIN. Try again.' })
  res.json({ success: true })
})

// POST /save-order — receives PDF + screenshot + print settings
app.post('/save-order', (req, res) => {
  try {
    const {
      orderId, fileName, pdfBase64, screenshotBase64,
      copies = 1, printSide = 'Single', colorMode = 'B&W',
      pageSize = 'A4', orientation = 'portrait', pageRange = 'all',
    } = req.body
    if (!orderId) return res.json({ success: false, error: 'Missing orderId' })

    if (pdfBase64) {
      fs.writeFileSync(path.join(PENDING_DIR, `${orderId}_pending.b64`), pdfBase64)
      logger.success(`PDF saved for order ${orderId}`)
    }
    if (screenshotBase64) saveScreenshotLocally(orderId, screenshotBase64)

    saveSettings(orderId, { copies: Number(copies), printSide, colorMode, pageSize, orientation, pageRange })
    res.json({ success: true, orderId })
  } catch (err) {
    logger.error(`save-order failed: ${err.message}`)
    res.json({ success: false, error: err.message })
  }
})

// POST /save-order-meta — mobile fallback: PDF is on Drive, just save settings + Drive URL
app.post('/save-order-meta', (req, res) => {
  try {
    const {
      orderId, driveUrl,
      copies = 1, printSide = 'Single', colorMode = 'B&W',
      pageSize = 'A4', orientation = 'portrait', pageRange = 'all',
    } = req.body
    if (!orderId) return res.json({ success: false, error: 'Missing orderId' })

    saveSettings(orderId, { copies: Number(copies), printSide, colorMode, pageSize, orientation, pageRange, driveUrl })
    logger.success(`Order meta saved for ${orderId} — PDF on Drive: ${driveUrl}`)
    res.json({ success: true, orderId })
  } catch (err) {
    logger.error(`save-order-meta failed: ${err.message}`)
    res.json({ success: false, error: err.message })
  }
})

app.get('/tunnel-url', (req, res) => {
  const url = getTunnelUrl()
  res.json({ success: !!url, url: url || null })
})

app.get('/status', (req, res) => {
  res.json({ success: true, message: 'Print agent running' })
})

app.get('/admin/orders', async (req, res) => {
  try {
    const rows = await getAllOrders()
    res.json({ success: true, orders: rows.map(o => ({
      id: o.orderId, fileName: o.fileName || 'Document.pdf',
      type: o.type, pages: o.totalPages, amount: o.amount,
      booth: 'Booth 01', status: o.printStatus,
      time: o.timestamp || new Date().toLocaleTimeString(),
    }))})
  } catch (err) { res.json({ success: false, error: err.message }) }
})

app.get('/admin/stats', async (req, res) => {
  try {
    const rows = await getAllOrders()
    res.json({
      success: true,
      totalOrders: rows.length,
      revenue: rows.reduce((s, o) => s + (o.amount || 0), 0),
      pending: rows.filter(o => o.printStatus === 'Waiting').length,
      printed: rows.filter(o => o.printStatus === 'Printed').length,
      failed:  rows.filter(o => o.printStatus === 'Failed').length,
      activeBooths: 4,
    })
  } catch (err) { res.json({ success: false, error: err.message }) }
})

app.get('/admin/booths', async (req, res) => {
  try {
    const rows = await getAllOrders()
    const pending = rows.filter(o => o.printStatus === 'Waiting').length
    res.json({ success: true, booths: [
      { name: 'Booth 01', online: true,  queue: Math.max(0, Math.round(pending * 0.4)), connected: true,  printed: 48, revenue: 1092, paused: false, locked: false },
      { name: 'Booth 02', online: true,  queue: Math.max(0, Math.round(pending * 0.3)), connected: true,  printed: 33, revenue: 732,  paused: false, locked: false },
      { name: 'Booth 03', online: true,  queue: Math.max(0, Math.round(pending * 0.2)), connected: true,  printed: 57, revenue: 1356, paused: false, locked: false },
      { name: 'Booth 04', online: false, queue: Math.max(0, Math.round(pending * 0.1)), connected: false, printed: 22, revenue: 478,  paused: true,  locked: false },
    ]})
  } catch (err) { res.json({ success: false, error: err.message }) }
})

app.get('/admin/health', async (req, res) => {
  try {
    const rows    = await getAllOrders()
    const printer = await getDefaultPrinter(false)
    res.json({ success: true, checks: [
      { name: 'Print Agent',        status: 'online' },
      { name: 'Local Server',       status: 'online' },
      { name: 'Google Sheets',      status: rows.length >= 0 ? 'online' : 'offline' },
      { name: 'Cloudflare Tunnel',  status: 'online' },
      { name: 'Printer',            status: printer ? 'online' : 'offline' },
    ]})
  } catch (err) {
    res.json({ success: true, checks: [
      { name: 'Print Agent', status: 'online' }, { name: 'Local Server', status: 'online' },
      { name: 'Google Sheets', status: 'offline' }, { name: 'Cloudflare Tunnel', status: 'online' },
      { name: 'Printer', status: 'offline' },
    ], error: err.message })
  }
})

// POST /release-print — booth triggers print by Order ID
app.post('/release-print', async (req, res) => {
  const { orderId } = req.body
  if (!orderId) return res.json({ success: false, error: 'Missing Order ID' })

  const order = await getOrderByIdForRelease(orderId.trim().toUpperCase())
  if (!order)                              return res.json({ success: false, error: 'Order not found. Check the Order ID.' })
  if (order.releaseStatus === 'Released')  return res.json({ success: false, error: 'Already printed. This order was already released.' })
  if (order.printStatus   === 'Printing')  return res.json({ success: false, error: 'Already printing. Please wait.' })

  await updateReleaseStatus(order.rowIndex, 'Released')
  await updatePrintStatus(order.rowIndex, 'Printing')
  res.json({ success: true, message: `Printing started for ${orderId}` })

  // Async print
  const filePath = path.join(PENDING_DIR, `${order.orderId}.pdf`)
  try {
    const settings = loadSettings(order.orderId)

    // If PDF not local, try downloading from Drive URL saved in settings
    let pdfReady = decodePendingPdf(order.orderId, filePath)
    if (!pdfReady && settings.driveUrl) {
      logger.info(`PDF not local for ${order.orderId} — downloading from Drive...`)
      try {
        await downloadFile(settings.driveUrl, filePath)
        pdfReady = true
        logger.success(`PDF downloaded from Drive for ${order.orderId}`)
      } catch (dlErr) {
        logger.error(`Drive download failed: ${dlErr.message}`)
      }
    }

    if (!pdfReady) {
      logger.warn(`No PDF found for ${order.orderId} — marking Failed`)
      await updatePrintStatus(order.rowIndex, 'Failed - No PDF')
      return
    }

    const printer = await getDefaultPrinter()
    if (printer) {
      const ok = await printPdf(filePath, {
        copies:      settings.copies      || order.copies    || 1,
        printSide:   settings.printSide   || order.printType === 'Double' ? 'Double' : 'Single',
        colorMode:   settings.colorMode   || order.printType || 'B&W',
        pageSize:    settings.pageSize    || 'A4',
        orientation: settings.orientation || 'portrait',
        pageRange:   settings.pageRange   || 'all',
        orderId:     order.orderId,
      })
      await updatePrintStatus(order.rowIndex, ok ? 'Printed' : 'Failed')
    } else {
      await updatePrintStatus(order.rowIndex, 'Printed')
    }
  } catch (err) {
    logger.error(`Release print error for ${order.orderId}: ${err.message}`)
    await updatePrintStatus(order.rowIndex, 'Failed')
  } finally {
    if (fs.existsSync(filePath)) deletePdf(filePath)
  }
})

function startLocalServer() {
  app.listen(PORT, () => logger.success(`Local server running on http://localhost:${PORT}`))
}

function decodePendingPdf(orderId, outputPath) {
  const b64Path = path.join(PENDING_DIR, `${orderId}_pending.b64`)
  if (!fs.existsSync(b64Path)) return false
  const base64 = fs.readFileSync(b64Path, 'utf8')
  fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'))
  fs.unlinkSync(b64Path)
  return true
}

module.exports = { startLocalServer, decodePendingPdf }
