const fs     = require('fs')
const path   = require('path')
const logger = require('../utils/logger')

const TUNNEL_LOG  = path.join(__dirname, '..', 'tunnel.log')
const TUNNEL_CACHE = path.join(__dirname, '..', 'tunnel-url.txt')
const GAS_URL     = 'https://script.google.com/macros/s/AKfycby8ykWErzVD79TrafdArCmA6i9YipHVZOjw7zFWDjpL1e44HlKORx-GAnCuGGYgcmyB/exec'

let currentTunnelUrl = null

// Extract trycloudflare URL from log content
function extractUrl(content) {
  const match = content.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  return match ? match[0] : null
}

// Read cached URL from last session
function loadCachedUrl() {
  try {
    if (fs.existsSync(TUNNEL_CACHE)) {
      const url = fs.readFileSync(TUNNEL_CACHE, 'utf8').trim()
      if (url.startsWith('https://')) return url
    }
  } catch {}
  return null
}

// Save URL to cache file
function saveUrlToCache(url) {
  try { fs.writeFileSync(TUNNEL_CACHE, url, 'utf8') } catch {}
}

// Push tunnel URL to GAS so frontend can fetch it
async function publishToGas(url) {
  try {
    const axios = require('axios')
    await axios.get(`${GAS_URL}?action=setTunnelUrl&url=${encodeURIComponent(url)}`)
    logger.success(`Tunnel URL published to GAS: ${url}`)
  } catch (err) {
    logger.warn(`Could not publish tunnel URL to GAS: ${err.message}`)
  }
}

// Watch tunnel.log until URL appears, then publish it
async function watchForTunnelUrl(maxWaitMs = 30000) {
  const start = Date.now()

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      try {
        if (!fs.existsSync(TUNNEL_LOG)) return
        const content = fs.readFileSync(TUNNEL_LOG, 'utf8')
        const url = extractUrl(content)
        if (url) {
          clearInterval(interval)
          currentTunnelUrl = url
          saveUrlToCache(url)
          publishToGas(url)
          logger.success(`Cloudflare tunnel active: ${url}`)
          resolve(url)
        }
      } catch {}

      if (Date.now() - start > maxWaitMs) {
        clearInterval(interval)
        // Fall back to cached URL
        const cached = loadCachedUrl()
        if (cached) {
          currentTunnelUrl = cached
          logger.warn(`Tunnel URL not found in log — using cached: ${cached}`)
          resolve(cached)
        } else {
          logger.warn('No tunnel URL found — mobile orders will not save PDF locally')
          resolve(null)
        }
      }
    }, 1000)
  })
}

function getTunnelUrl() {
  return currentTunnelUrl || loadCachedUrl()
}

module.exports = { watchForTunnelUrl, getTunnelUrl }
