/*
 * SigmaChat -> Google Sheets message archive
 *
 * Deploy this script as a Web app:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Put the same value in GOOGLE_SHEETS_WEBHOOK_TOKEN in Replit.
 */
const SHEET_NAME = 'Messages';
// Copy the ID from the target Google Sheet URL:
// https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
const SPREADSHEET_ID = 'REPLACE_WITH_TARGET_SPREADSHEET_ID';
const TOKEN = 'REPLACE_WITH_A_LONG_RANDOM_TOKEN';
const HEADERS = [
  'eventId', 'eventType', 'recordedAt', 'messageId', 'messageDate', 'messageTime',
  'conversationType', 'serverId', 'channelId', 'room', 'sender', 'recipient',
  'message', 'edited', 'deleted'
];

function doGet() {
  return jsonResponse({ ok: true, service: 'SigmaChat Google Sheets archive' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (body.token !== TOKEN) return jsonResponse({ ok: false, error: 'Unauthorized' });
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return jsonResponse({ ok: false, error: 'events must be a non-empty array' });
    }

    const sheet = getMessagesSheet();
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const existingIds = getExistingEventIds(sheet);
      const rows = body.events
        .filter(event => event && event.eventId && !existingIds.has(String(event.eventId)))
        .map(event => HEADERS.map(header => cellValue(
          header === 'messageDate' ? event.date :
          header === 'messageTime' ? event.time : event[header]
        )));

      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      }
      return jsonResponse({ ok: true, saved: rows.length, skipped: body.events.length - rows.length });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error.message || error) });
  }
}

function getMessagesSheet() {
  if (SPREADSHEET_ID === 'REPLACE_WITH_TARGET_SPREADSHEET_ID') {
    throw new Error('Set SPREADSHEET_ID in Code.gs before deploying');
  }
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1f2937')
      .setFontColor('#ffffff');
    sheet.autoResizeColumns(1, HEADERS.length);
  }
  return sheet;
}

function getExistingEventIds(sheet) {
  const ids = new Set();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .forEach(row => ids.add(String(row[0])));
  }
  return ids;
}

// Prevent messages beginning with =, +, -, or @ from becoming formulas.
function cellValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}