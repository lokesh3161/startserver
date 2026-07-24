const SPREADSHEET_ID  = "16R6KiGoNgH31qEJxCiKrNTD2u99TKHJfDlzgb6iH_nw";
const SHEET_NAME      = "Sheet1";
const DRIVE_FOLDER_ID = "13aksBYQ3sRnMh_oFKTAXagUr4h7xMD9E";
const PDF_FOLDER_ID   = "1QRJ-c9wDYJJoDpflTdhkZ91rcjVBgswF";

function doGet(e) {
  try {
    const action = e.parameter.action
    if (action === 'saveOrder')      return saveOrder(e.parameter)
    if (action === 'saveChunk')      return saveChunk(e.parameter)
    if (action === 'assembleFile')   return assembleFile(e.parameter)
    if (action === 'assemblePdf')    return assembleFile(e.parameter)
    if (action === 'getOrderStatus') return getOrderStatus(e.parameter)
    if (action === 'getOrderForRelease') return getOrderForRelease(e.parameter)
    if (action === 'listOrders')     return listOrders()

    // ── Tunnel URL storage (for mobile print agent connection) ──
    if (action === 'setTunnelUrl') {
      PropertiesService.getScriptProperties().setProperty('TUNNEL_URL', e.parameter.url || '')
      return jsonResponse({ success: true })
    }
    if (action === 'getTunnelUrl') {
      const url = PropertiesService.getScriptProperties().getProperty('TUNNEL_URL') || ''
      return jsonResponse({ success: true, url })
    }

    return jsonResponse({ success: true, message: 'X Buddy API is live!' })
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() })
  }
}


function doPost(e) {
  return jsonResponse({ success: true, message: 'Use GET' })
}

function saveOrder(p) {
  const sheet = SpreadsheetApp
    .openById(SPREADSHEET_ID)
    .getSheetByName(SHEET_NAME)

  const orderId = p.orderId || ('XB' + String(Math.floor(1000 + Math.random() * 9000)))

  sheet.appendRow([
    orderId,
    p.name          || '',
    p.fileName      || '',
    p.totalPages    || '',
    p.copies        || '',
    p.printType     || 'B&W',
    p.amount        || '',
    p.transactionId || '',
    '',
    'Pending Verification',
    'Waiting',
    new Date(),
    '',
    '',
    p.printSide     || 'Single',
    p.pageSize      || 'A4',
    p.orientation   || 'portrait',
  ])

  return jsonResponse({ success: true, orderId })
}

function saveChunk(p) {
  const store = PropertiesService.getScriptProperties()
  const key   = p.fileId + '_' + p.fileType + '_' + p.index
  store.setProperty(key, p.chunk)
  store.setProperty(p.fileId + '_' + p.fileType + '_total', String(p.total))
  return jsonResponse({ success: true })
}

function assembleFile(p) {
  const store = PropertiesService.getScriptProperties()
  const total = parseInt(store.getProperty(p.fileId + '_' + p.fileType + '_total') || '0')

  if (total === 0) return jsonResponse({ success: false, error: 'No chunks found' })

  let base64 = ''
  for (let i = 0; i < total; i++) {
    const key = p.fileId + '_' + p.fileType + '_' + i
    base64 += store.getProperty(key) || ''
    store.deleteProperty(key)
  }
  store.deleteProperty(p.fileId + '_' + p.fileType + '_total')

  const folderId = p.fileType === 'pdf' ? PDF_FOLDER_ID : DRIVE_FOLDER_ID
  const fileUrl  = uploadFile(base64, p.fileName, p.mimeType, folderId)

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME)
  const rows  = sheet.getDataRange().getValues()
  const col   = p.fileType === 'pdf' ? 13 : 9

  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === p.fileId) {
      sheet.getRange(i + 1, col).setValue(fileUrl)
      break
    }
  }

  return jsonResponse({ success: true, fileUrl })
}

function getOrderForRelease(p) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME)
  const data  = sheet.getDataRange().getValues()
  for (let i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toString().trim() === (p.orderId || '').trim()) {
      return jsonResponse({
        success:       true,
        rowIndex:      i + 1,
        orderId:       data[i][0]  || '',
        name:          data[i][1]  || '',
        fileName:      data[i][2]  || '',
        copies:        parseInt(data[i][4] || '1'),
        printType:     data[i][5]  || 'B&W',
        printStatus:   data[i][10] || '',
        releaseStatus: data[i][13] || 'Waiting For Release',
      })
    }
  }
  return jsonResponse({ success: false, message: 'Order not found' })
}

function listOrders() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME)
  const data  = sheet.getDataRange().getValues()
  const orders = data.slice(1).map((row, idx) => ({
    rowIndex:      idx + 2,
    orderId:       row[0]  || '',
    name:          row[1]  || '',
    fileName:      row[2]  || '',
    totalPages:    parseInt(row[3] || '1') || 1,
    copies:        parseInt(row[4] || '1') || 1,
    printType:     row[5]  || 'B&W',
    amount:        parseFloat((row[6] || '0').toString().replace(/[^0-9.-]+/g, '')) || 0,
    transactionId: row[7]  || '',
    paymentStatus: row[9]  || '',
    printStatus:   row[10] || 'Waiting',
    timestamp:     row[11] ? row[11].toString() : '',
    pdfUrl:        row[12] || '',
    releaseStatus: row[13] || 'Waiting',
  }))
  return jsonResponse({ success: true, orders })
}

function getOrderStatus(p) {
  const sheet = SpreadsheetApp
    .openById(SPREADSHEET_ID)
    .getSheetByName(SHEET_NAME)

  const data = sheet.getDataRange().getValues()
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.orderId) {
      return jsonResponse({
        success:       true,
        orderId:       p.orderId,
        printStatus:   data[i][10] || 'Waiting',
        paymentStatus: data[i][9]  || 'Pending',
        pdfUrl:        data[i][12] || '',
      })
    }
  }
  return jsonResponse({ success: false, message: 'Order not found' })
}

function uploadFile(base64Data, fileName, mimeType, folderId) {
  const parts  = base64Data.split(',')
  const clean  = parts.length > 1 ? parts[1] : parts[0]
  const bytes  = Utilities.base64Decode(clean)
  const blob   = Utilities.newBlob(bytes, mimeType, fileName)
  const folder = DriveApp.getFolderById(folderId)
  const file   = folder.createFile(blob)
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW)
  return file.getUrl()
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
