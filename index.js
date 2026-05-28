const { updatePrintStatus }              = require('./services/updater')
const { deletePdf }                      = require('./services/downloader')
const { printPdf, getDefaultPrinter }    = require('./services/printer')
const { startLocalServer, decodePendingPdf } = require('./services/localServer')
const { watchForTunnelUrl }              = require('./services/tunnel')
const logger = require('./utils/logger')

async function start() {
  console.log('\n  X Buddy Print Agent\n')
  logger.info('Starting in Secure Release Mode...')

  // Start local server first
  startLocalServer()

  // Watch for Cloudflare tunnel URL (runs in background)
  watchForTunnelUrl(30000)

  const printer = await getDefaultPrinter()
  if (printer) {
    logger.success(`Printer ready: ${printer}`)
  } else {
    logger.warn('No printer detected — orders will be marked Printed without printing')
  }

  logger.success('Waiting for booth release triggers on /release-print\n')
}

process.on('SIGINT', () => { logger.warn('Stopped.'); process.exit(0) })
start()
