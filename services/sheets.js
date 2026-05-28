const { google } = require('googleapis')
const logger = require('../utils/logger')

const SPREADSHEET_ID = '16R6KiGoNgH31qEJxCiKrNTD2u99TKHJfDlzgb6iH_nw'
const SHEET_NAME     = 'Sheet1'
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyj8UTgncnMmmz4ERZIN49PiHqPOS2GnBABOKgQ9WEirPh8aHSt0tdCcKkv2nUqeKt9/exec'

const COL = {
  ORDER_ID:       0,
  NAME:           1,
  FILE_NAME:      2,
  TOTAL_PAGES:    3,
  COPIES:         4,
  PRINT_TYPE:     5,
  AMOUNT:         6,
  TRANSACTION_ID: 7,
  SCREENSHOT_URL: 8,
  PAYMENT_STATUS: 9,
  PRINT_STATUS:   10,
  TIMESTAMP:      11,
  PDF_URL:        12,
  RELEASE_STATUS: 13,
}

function getAuth() {
  return new google.auth.GoogleAuth({
    keyFile: './credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

async function getWaitingOrders() {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:M`,
    })

    const rows = response.data.values || []
    const waitingOrders = []

    for (let i = 1; i < rows.length; i++) {
      const row         = rows[i]
      const printStatus = row[COL.PRINT_STATUS] || ''
      const pdfUrl      = row[COL.PDF_URL]      || ''

      if (printStatus === 'Waiting') {
        waitingOrders.push({
          rowIndex:  i + 1,
          orderId:   row[COL.ORDER_ID]    || '',
          name:      row[COL.NAME]        || '',
          fileName:  row[COL.FILE_NAME]   || '',
          totalPages:row[COL.TOTAL_PAGES] || '1',
          copies:    parseInt(row[COL.COPIES] || '1'),
          printType: row[COL.PRINT_TYPE]  || 'B&W',
          amount:    row[COL.AMOUNT]      || '0',
          pdfUrl,   // may be empty — print agent will get it from GAS
        })
      }
    }

    return waitingOrders
  } catch (err) {
    logger.error(`Failed to read Sheets: ${err.message}`)
    return []
  }
}

/**
 * Get PDF download URL from GAS for orders that don't have it in Sheets yet
 * GAS assembleFile saves the PDF to Drive and returns the URL
 */
async function getPdfUrlFromGas(orderId, fileName) {
  try {
    const axios  = require('axios')
    const params = new URLSearchParams({
      action:   'assemblePdf',
      fileId:   orderId,
      fileName: orderId + '_' + fileName,
      mimeType: 'application/pdf',
    })
    const res  = await axios.get(`${GAS_URL}?${params.toString()}`)
    const data = res.data
    if (data.success && data.fileUrl) {
      logger.success(`Got PDF URL from GAS: ${data.fileUrl}`)
      return data.fileUrl
    }
  } catch (err) {
    logger.error(`Could not get PDF URL from GAS: ${err.message}`)
  }
  return null
}

async function getOrderByIdForRelease(orderId) {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:N`,
    })
    const rows = response.data.values || []
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if ((row[COL.ORDER_ID] || '').trim() === orderId.trim()) {
        return {
          rowIndex:      i + 1,
          orderId:       row[COL.ORDER_ID]    || '',
          name:          row[COL.NAME]        || '',
          fileName:      row[COL.FILE_NAME]   || '',
          copies:        parseInt(row[COL.COPIES] || '1'),
          printType:     row[COL.PRINT_TYPE]  || 'B&W',
          printStatus:   row[COL.PRINT_STATUS]  || '',
          releaseStatus: row[COL.RELEASE_STATUS] || 'Waiting For Release',
        }
      }
    }
    return null
  } catch (err) {
    logger.error(`getOrderByIdForRelease error: ${err.message}`)
    return null
  }
}

function normalizeOrderStatus(status, releaseStatus) {
  const raw = (status || releaseStatus || 'Waiting').toString().trim().toLowerCase()
  if (raw.includes('failed')) return 'Failed'
  if (raw.includes('printing')) return 'Printing'
  if (raw.includes('printed')) return 'Printed'
  if (raw.includes('released')) return 'Released'
  if (raw.includes('waiting')) return 'Waiting'
  return 'Waiting'
}

function detectDocumentType(fileName) {
  const name = (fileName || '').toLowerCase()
  if (name.includes('resume')) return 'Resume'
  if (name.includes('leave')) return 'Leave Letter'
  if (name.includes('bonafide')) return 'Bonafide'
  if (name.includes('assignment')) return 'Assignment'
  return 'Manual PDF'
}

function parseAmount(value) {
  const numeric = String(value || '').replace(/[^0-9.-]+/g, '')
  return parseFloat(numeric) || 0
}

async function getAllOrders() {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:N`,
    })
    const rows = response.data.values || []

    return rows.slice(1).map((row, index) => {
      const fileName = row[COL.FILE_NAME] || ''
      const status = normalizeOrderStatus(row[COL.PRINT_STATUS], row[COL.RELEASE_STATUS])
      return {
        rowIndex:      index + 2,
        orderId:       row[COL.ORDER_ID]      || '',
        name:          row[COL.NAME]          || '',
        fileName,
        type:          detectDocumentType(fileName),
        totalPages:    parseInt(row[COL.TOTAL_PAGES] || '1') || 1,
        copies:        parseInt(row[COL.COPIES] || '1') || 1,
        printType:     row[COL.PRINT_TYPE]    || 'B&W',
        amount:        parseAmount(row[COL.AMOUNT]),
        transactionId: row[COL.TRANSACTION_ID] || '',
        screenshotUrl: row[COL.SCREENSHOT_URL] || '',
        paymentStatus: row[COL.PAYMENT_STATUS] || '',
        printStatus:   status,
        timestamp:     row[COL.TIMESTAMP]     || '',
        pdfUrl:        row[COL.PDF_URL]       || '',
        releaseStatus: row[COL.RELEASE_STATUS] || 'Waiting',
      }
    })
  } catch (err) {
    logger.error(`Failed to read all orders from Sheets: ${err.message}`)
    return []
  }
}

module.exports = { getWaitingOrders, getPdfUrlFromGas, getOrderByIdForRelease, getAllOrders }
