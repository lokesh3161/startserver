const { getWaitingOrders }               = require('./services/sheets')
const { updatePrintStatus }              = require('./services/updater')
const { deletePdf }                      = require('./services/downloader')
const { printPdf, getDefaultPrinter }    = require('./services/printer')
const { startLocalServer, decodePendingPdf } = require('./services/localServer')
const logger = require('./utils/logger')
const path   = require('path')
const fs     = require('fs')

const POLL_INTERVAL_MS = 5000
const DOWNLOADS_DIR    = path.join(__dirname, 'downloads')
const processingOrders = new Set()

async function processOrder(order) {
  const { orderId, rowIndex, copies, printType, name } = order
  processingOrders.add(orderId)
  logger.info(`━━━ New Order: ${orderId} (${name}) ━━━`)

  let filePath = null

  try {
    // Step 1: Mark as Printing
    await updatePrintStatus(rowIndex, 'Printing')

    // Step 2: Decode PDF from locally saved base64
    filePath = path.join(DOWNLOADS_DIR, `${orderId}.pdf`)
    const decoded = decodePendingPdf(orderId, filePath)

    if (!decoded) {
      // Wait up to 30 seconds for browser to send PDF
      logger.info(`Waiting for PDF to arrive for order ${orderId}...`)
      let waited = 0
      while (waited < 30000) {
        await new Promise(r => setTimeout(r, 2000))
        waited += 2000
        if (decodePendingPdf(orderId, filePath)) {
          logger.success(`PDF arrived for order ${orderId}`)
          break
        }
        if (waited >= 30000) {
          logger.warn(`PDF never arrived for order ${orderId} after 30s — marking Failed`)
          await updatePrintStatus(rowIndex, 'Failed - No PDF')
          processingOrders.delete(orderId)
          return
        }
      }
    }

    const stats = fs.statSync(filePath)
    logger.success(`PDF ready: ${orderId}.pdf (${(stats.size / 1024).toFixed(1)} KB)`)

    // Step 3: Print if printer available
    const printer = await getDefaultPrinter()
    if (printer) {
      const success = await printPdf(filePath, { copies, printType, orderId })
      await updatePrintStatus(rowIndex, success ? 'Printed' : 'Failed')
    } else {
      logger.warn('No printer — marking as Printed')
      await updatePrintStatus(rowIndex, 'Printed')
    }

    logger.success(`Order ${orderId} completed ✓`)

  } catch (err) {
    logger.error(`Error processing ${orderId}: ${err.message}`)
    await updatePrintStatus(rowIndex, 'Failed')
  } finally {
    if (filePath && fs.existsSync(filePath)) deletePdf(filePath)
    processingOrders.delete(orderId)
  }
}

async function poll() {
  try {
    const waitingOrders = await getWaitingOrders()
    if (waitingOrders.length === 0) {
      logger.dim('No waiting orders...')
      return
    }
    logger.info(`Found ${waitingOrders.length} waiting order(s)`)
    for (const order of waitingOrders) {
      if (!processingOrders.has(order.orderId)) {
        processOrder(order)
      }
    }
  } catch (err) {
    logger.error(`Poll error: ${err.message}`)
  }
}

async function start() {
  console.log('\n  X Buddy Print Agent\n')
  logger.info('Starting...')

  startLocalServer()

  const printer = await getDefaultPrinter()
  if (printer) {
    logger.success(`Printer ready: ${printer}`)
  } else {
    logger.warn('No printer — orders will be marked Printed without printing')
  }

  logger.info(`Polling every ${POLL_INTERVAL_MS / 1000}s\n`)
  poll()
  setInterval(poll, POLL_INTERVAL_MS)
}

process.on('SIGINT', () => { logger.warn('Stopped.'); process.exit(0) })
start()
