const ptp    = require('pdf-to-printer')
const logger = require('../utils/logger')

/**
 * Get the default printer name on this Windows machine
 */
let printerCache = null
let lastPrinterCheck = 0
const PRINTER_CACHE_TTL = 15000

async function getDefaultPrinter(verbose = true) {
  try {
    const now = Date.now()
    if (printerCache && now - lastPrinterCheck < PRINTER_CACHE_TTL) {
      return printerCache.name
    }

    const printers = await ptp.getPrinters()
    if (printers.length === 0) {
      throw new Error('No printers found on this machine')
    }

    if (verbose) {
      logger.info(`Available printers (${printers.length}):`)
      printers.forEach((p, i) => {
        logger.dim(`  ${i + 1}. ${p.name}`)
      })
    }

    // Return the default printer — prefer real printers over virtual ones
    const realPrinter = printers.find(p => {
      const name = p.name.toLowerCase()
      return !name.includes('onenote') &&
             !name.includes('fax') &&
             !name.includes('xps') &&
             !name.includes('pdf')
    })

    const defaultPrinter = realPrinter || printers[0]
    printerCache = defaultPrinter
    lastPrinterCheck = Date.now()
    return defaultPrinter.name
  } catch (err) {
    logger.error(`Could not get printers: ${err.message}`)
    return null
  }
}

/**
 * Print a PDF file
 * @param {string} filePath
 * @param {object} options
 * @param {number} options.copies
 * @param {string} options.printSide   - 'Single' | 'Double'
 * @param {string} options.colorMode   - 'B&W' | 'Color'
 * @param {string} options.pageSize    - 'A4' | 'Letter' | ...
 * @param {string} options.orientation - 'portrait' | 'landscape'
 * @param {string} options.pageRange   - 'all' | '1-3,5' | ...
 * @param {string} options.orderId
 */
async function printPdf(filePath, options = {}) {
  const {
    copies      = 1,
    printSide   = 'Single',
    colorMode   = 'B&W',
    pageSize    = 'A4',
    orientation = 'portrait',
    pageRange   = 'all',
    orderId     = '',
  } = options

  try {
    const printerName = await getDefaultPrinter()
    if (!printerName) throw new Error('No printer available')

    logger.info(`Printing order ${orderId} → ${printerName}`)
    logger.info(`  Copies: ${copies} | Side: ${printSide} | Color: ${colorMode} | Size: ${pageSize} | Orient: ${orientation}`)

    const printOptions = {
      printer:   printerName,
      copies:    Number(copies),
      silent:    true,
      paperSize: pageSize.toUpperCase(),   // 'A4', 'LETTER', etc.
      scale:     'fit',                    // fit-to-page — prevents shrink-scaling on size mismatch
    }

    // Duplex / double-sided
    if (printSide === 'Double') {
      printOptions.side = 'duplexlong'    // long-edge equivalent in pdf-to-printer
    }

    // Grayscale for B&W
    if (colorMode === 'B&W' || colorMode === 'Black & White') {
      printOptions.monochrome = true
    }

    // Landscape orientation
    if (orientation === 'landscape') {
      printOptions.orientation = 'landscape'
    }

    // Page range (skip if 'all')
    if (pageRange && pageRange !== 'all') {
      printOptions.pages = pageRange       // e.g. '1-3,5'
    }

    await ptp.print(filePath, printOptions)

    logger.success(`Print job sent for order ${orderId}`)
    return true
  } catch (err) {
    logger.error(`Print failed for order ${orderId}: ${err.message}`)
    return false
  }
}

module.exports = { printPdf, getDefaultPrinter }
