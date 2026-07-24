const fs     = require('fs')
const path   = require('path')
const logger = require('../utils/logger')

const AGENT_DIR   = path.join(__dirname, '..')
const TUNNEL_LOG  = path.join(AGENT_DIR, 'tunnel.log')
const TUNNEL_ERR  = path.join(AGENT_DIR, 'tunnel_err.log')
const TUNNEL_CACHE = path.join(AGENT_DIR, 'tunnel-url.txt')
const GAS_URL     = 'https://script.google.com/macros/s/AKfycbyWiu74FuFA-m-uord17vVKSN67y3_Hr7gH1u-mZ6SHafeD818LvRaA194C517_HinS/exec'

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

// Watch both tunnel.log and tunnel_err.log until URL appears, then publish it
async function watchForTunnelUrl(maxWaitMs = 30000) {
  const start = Date.now()

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      try {
        let content = ''
        if (fs.existsSync(TUNNEL_LOG))  content += fs.readFileSync(TUNNEL_LOG,  'utf8')
        if (fs.existsSync(TUNNEL_ERR))  content += fs.readFileSync(TUNNEL_ERR,  'utf8')
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
        logger.warn('Tunnel URL not found in log after timeout — mobile orders may not reach agent')
        resolve(null)
      }
    }, 1000)
  })
}

function getTunnelUrl() {
  return currentTunnelUrl || null
}

module.exports = { watchForTunnelUrl, getTunnelUrl }
