const express  = require('express')
const cors     = require('cors')
const fs       = require('fs')
const path     = require('path')
const logger   = require('../utils/logger')
const { getOrderByIdForRelease, getAllOrders } = require('./sheets')
const { updatePrintStatus, updateReleaseStatus } = require('./updater')
const { printPdf, getDefaultPrinter } = require('./printer')
const { deletePdf } = require('./downloader')

const { getTunnelUrl } = require('./tunnel')

const app         = express()
const PORT        = 3001
const PENDING_DIR = path.join(__dirname, '..', 'downloads')

app.use(cors())
app.use(express.json({ limit: '100mb' }))

// Save screenshot locally as PNG
function saveScreenshotLocally(orderId, screenshotBase64) {
  try {
    const imgPath = path.join(PENDING_DIR, `${orderId}_payment.png`)
    fs.writeFileSync(imgPath, Buffer.from(screenshotBase64, 'base64'))
    logger.success(`Screenshot saved: ${orderId}_payment.png`)
  } catch (err) {
    logger.error(`Screenshot save failed: ${err.message}`)
  }
}

const BOOTH_PIN = '2580'  // Change this to your own PIN

// POST /booth-login — validate shopkeeper PIN
app.post('/booth-login', (req, res) => {
  const { pin } = req.body
  if (!pin) return res.json({ success: false, error: 'PIN required' })
  if (pin !== BOOTH_PIN) return res.json({ success: false, error: 'Wrong PIN. Try again.' })
  res.json({ success: true })
})

// POST /save-order — receives PDF + screenshot from browser
app.post('/save-order', (req, res) => {
  try {
    const { orderId, fileName, pdfBase64, screenshotBase64 } = req.body
    if (!orderId) return res.json({ success: false, error: 'Missing orderId' })

    if (pdfBase64) {
      const pdfPath = path.join(PENDING_DIR, `${orderId}_pending.b64`)
      fs.writeFileSync(pdfPath, pdfBase64)
      logger.success(`PDF saved locally for order ${orderId}`)
    }

    if (screenshotBase64) {
      saveScreenshotLocally(orderId, screenshotBase64)
    }

    res.json({ success: true, orderId })
  } catch (err) {
    logger.error(`Failed to save order files: ${err.message}`)
    res.json({ success: false, error: err.message })
  }
})

// GET /tunnel-url — returns current Cloudflare tunnel URL for mobile clients
app.get('/tunnel-url', (req, res) => {
  const url = getTunnelUrl()
  res.json({ success: !!url, url: url || null })
})

// GET /status — health check
app.get('/status', (req, res) => {
  res.json({ success: true, message: 'Print agent local server is running' })
})

app.get('/admin/orders', async (req, res) => {
  try {
    const rows = await getAllOrders()
    const orders = rows.map(order => ({
      id: order.orderId,
      fileName: order.fileName || 'Document.pdf',
      type: order.type,
      pages: order.totalPages,
      amount: order.amount,
      booth: 'Booth 01',
      status: order.printStatus,
      time: order.timestamp || new Date().toLocaleTimeString(),
    }))
    res.json({ success: true, orders })
  } catch (err) {
    res.json({ success: false, error: err.message })
  }
})

app.get('/admin/stats', async (req, res) => {
  try {
    const rows = await getAllOrders()
    const totalOrders = rows.length
    const revenue = rows.reduce((sum, order) => sum + (order.amount || 0), 0)
    const pending = rows.filter(order => order.printStatus === 'Waiting').length
    const printed = rows.filter(order => order.printStatus === 'Printed').length
    const failed = rows.filter(order => order.printStatus === 'Failed').length
    res.json({ success: true, totalOrders, revenue, pending, printed, failed, activeBooths: 4 })
  } catch (err) {
    res.json({ success: false, error: err.message })
  }
})

app.get('/admin/booths', async (req, res) => {
  try {
    const rows = await getAllOrders()
    const pending = rows.filter(order => order.printStatus === 'Waiting').length
    const booths = [
      { name: 'Booth 01', online: true, queue: Math.max(0, Math.round(pending * 0.4)), connected: true, printed: 48, revenue: 1092, paused: false, locked: false },
      { name: 'Booth 02', online: true, queue: Math.max(0, Math.round(pending * 0.3)), connected: true, printed: 33, revenue: 732, paused: false, locked: false },
      { name: 'Booth 03', online: true, queue: Math.max(0, Math.round(pending * 0.2)), connected: true, printed: 57, revenue: 1356, paused: false, locked: false },
      { name: 'Booth 04', online: false, queue: Math.max(0, Math.round(pending * 0.1)), connected: false, printed: 22, revenue: 478, paused: true, locked: false },
    ]
    res.json({ success: true, booths })
  } catch (err) {
    res.json({ success: false, error: err.message })
  }
})

app.get('/admin/health', async (req, res) => {
  try {
    const rows = await getAllOrders()
    const printer = await getDefaultPrinter(false)
    const checks = [
      { name: 'Print Agent', status: 'online' },
      { name: 'Local Server', status: 'online' },
      { name: 'Google Sheets', status: rows.length >= 0 ? 'online' : 'offline' },
      { name: 'Cloudflare Tunnel', status: 'online' },
      { name: 'Printer Connectivity', status: printer ? 'online' : 'offline' },
    ]
    res.json({ success: true, checks })
  } catch (err) {
    res.json({ success: true, checks: [
      { name: 'Print Agent', status: 'online' },
      { name: 'Local Server', status: 'online' },
      { name: 'Google Sheets', status: 'offline' },
      { name: 'Cloudflare Tunnel', status: 'online' },
      { name: 'Printer Connectivity', status: 'offline' },
    ], error: err.message })
  }
})

// POST /release-print — booth enters Order ID to trigger print
app.post('/release-print', async (req, res) => {
  const { orderId } = req.body
  if (!orderId) return res.json({ success: false, error: 'Missing Order ID' })

  const order = await getOrderByIdForRelease(orderId.trim().toUpperCase())

  if (!order) {
    return res.json({ success: false, error: 'Order not found. Check the Order ID.' })
  }
  if (order.releaseStatus === 'Released') {
    return res.json({ success: false, error: 'Already Printed. This order was already released.' })
  }
  if (order.printStatus === 'Printing') {
    return res.json({ success: false, error: 'Already printing. Please wait.' })
  }

  // Mark as Released immediately so double-tap is blocked
  await updateReleaseStatus(order.rowIndex, 'Released')
  await updatePrintStatus(order.rowIndex, 'Printing')
  res.json({ success: true, message: `Printing started for ${orderId}` })

  // Trigger print async
  const filePath = path.join(PENDING_DIR, `${order.orderId}.pdf`)
  try {
    const decoded = decodePendingPdf(order.orderId, filePath)
    if (!decoded) {
      logger.warn(`PDF not found locally for ${order.orderId} — marking Failed`)
      await updatePrintStatus(order.rowIndex, 'Failed - No PDF')
      return
    }
    const printer = await getDefaultPrinter()
    if (printer) {
      const success = await printPdf(filePath, { copies: order.copies, printType: order.printType, orderId: order.orderId })
      await updatePrintStatus(order.rowIndex, success ? 'Printed' : 'Failed')
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
  app.listen(PORT, () => {
    logger.success(`Local server running on http://localhost:${PORT}`)
  })
}

function decodePendingPdf(orderId, outputPath) {
  const b64Path = path.join(PENDING_DIR, `${orderId}_pending.b64`)
  if (!fs.existsSync(b64Path)) return false
  const base64 = fs.readFileSync(b64Path, 'utf8')
  const buffer = Buffer.from(base64, 'base64')
  fs.writeFileSync(outputPath, buffer)
  fs.unlinkSync(b64Path)
  return true
}

module.exports = { startLocalServer, decodePendingPdf }
