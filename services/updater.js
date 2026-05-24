const { google } = require('googleapis')
const logger = require('../utils/logger')

const SPREADSHEET_ID = '16R6KiGoNgH31qEJxCiKrNTD2u99TKHJfDlzgb6iH_nw'
const SHEET_NAME     = 'Sheet1'

function getAuth() {
  return new google.auth.GoogleAuth({
    keyFile: './credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

// Update Print Status column K
async function updatePrintStatus(rowIndex, status) {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!K${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    })

    logger.success(`Row ${rowIndex} → Print Status: "${status}"`)
  } catch (err) {
    logger.error(`Failed to update status row ${rowIndex}: ${err.message}`)
  }
}

// Update PDF URL column M
async function updatePdfUrl(rowIndex, pdfUrl) {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!M${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[pdfUrl]] },
    })

    logger.success(`Row ${rowIndex} → PDF URL saved to column M`)
  } catch (err) {
    logger.error(`Failed to update PDF URL row ${rowIndex}: ${err.message}`)
  }
}

// Update Screenshot URL column I
async function updateScreenshotUrl(rowIndex, url) {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!I${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[url]] },
    })
    logger.success(`Row ${rowIndex} → Screenshot URL saved to column I`)
  } catch (err) {
    logger.error(`Failed to update screenshot URL: ${err.message}`)
  }
}

// Update Release Status column N
async function updateReleaseStatus(rowIndex, status) {
  try {
    const auth   = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!N${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[status]] },
    })
    logger.success(`Row ${rowIndex} → Release Status: "${status}"`)
  } catch (err) {
    logger.error(`Failed to update release status row ${rowIndex}: ${err.message}`)
  }
}

module.exports = { updatePrintStatus, updatePdfUrl, updateScreenshotUrl, updateReleaseStatus }
