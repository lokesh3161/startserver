const express  = require('express')
const cors     = require('cors')
const fs       = require('fs')
const path     = require('path')
const logger   = require('../utils/logger')

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

// GET /status — health check
app.get('/status', (req, res) => {
  res.json({ success: true, message: 'Print agent local server is running' })
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
