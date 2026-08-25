/**
 * Aonic — Purchase Order → Slack automation (Google Apps Script)
 *
 * When a new PO lands in the Drive folder, ping Slack tagging Alex Dyckerhoff
 * to get a physical sample before the PO is sent out.
 *
 * Runs on a time-based trigger in Google's cloud — no server to maintain.
 * All config lives in Script Properties (Project Settings → Script Properties),
 * never in this file. Run setUp() once to seed them. See README.md.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG KEYS (values live in Script Properties)
// ─────────────────────────────────────────────────────────────────────────────
const PROP = {
  FOLDER_ID: 'PO_FOLDER_ID',              // Drive folder to watch
  SLACK_WEBHOOK: 'SLACK_WEBHOOK_URL',     // Slack Incoming Webhook URL
  SLACK_MENTION: 'SLACK_MENTION_USER_ID', // Alex's Slack member ID, e.g. U01ABCDEF
  TRACKING_SHEET: 'TRACKING_SHEET_ID',    // PO QA Tracking spreadsheet
  REQUEST_SECRET: 'SLACK_REQUEST_SECRET', // shared secret guarding the web app (button clicks)
  SEEN_IDS: 'SEEN_FILE_IDS',              // internal: JSON array of processed file IDs
};

/**
 * One-time setup helper. Fill in the three values below, run this once
 * (Run ▸ setUp), and authorize the scopes when prompted.
 */
function setUp() {
  PropertiesService.getScriptProperties().setProperties({
    [PROP.FOLDER_ID]:      '1AE3MOYzictk13yx6Wjm4lbvb63fbCpq7',   // your PO folder
    [PROP.SLACK_WEBHOOK]:  'PASTE_SLACK_WEBHOOK_URL_HERE',
    [PROP.SLACK_MENTION]:  'PASTE_ALEX_SLACK_MEMBER_ID_HERE',      // e.g. U01ABCDEF
    [PROP.TRACKING_SHEET]: '1hqkIdUmQTNni0ezL6AoC8I4Fa3imWgW5s2En_cDoeOg', // PO QA Tracking
    [PROP.REQUEST_SECRET]: 'CHOOSE_A_RANDOM_STRING',   // any long random string; reuse it in the Slack Request URL
  }, false);
  Logger.log('Script Properties saved. Now run createTriggers().');
}

/**
 * Installs the folder-watch trigger. Run once (Run ▸ createTriggers).
 * Safe to re-run: clears our old trigger first so duplicates don't stack.
 */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'watchPOFolder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('watchPOFolder').timeBased().everyMinutes(5).create();
  Logger.log('Trigger created: watchPOFolder (every 5 min).');
}

// ─────────────────────────────────────────────────────────────────────────────
// Watch the Drive folder, ping Slack on new files
// ─────────────────────────────────────────────────────────────────────────────
function watchPOFolder() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP.FOLDER_ID);
  if (!folderId) throw new Error('Missing ' + PROP.FOLDER_ID + ' — run setUp() first.');

  const seen = new Set(JSON.parse(props.getProperty(PROP.SEEN_IDS) || '[]'));
  const firstRun = !props.getProperty(PROP.SEEN_IDS);

  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFiles();
  const newFiles = [];
  const allIds = [];

  while (files.hasNext()) {
    const file = files.next();
    const id = file.getId();
    allIds.push(id);
    if (!seen.has(id)) newFiles.push(file);
  }

  // On the very first run, adopt everything already in the folder as "seen"
  // so we don't spam Slack with a backlog of existing POs.
  if (firstRun) {
    saveSeen(props, allIds);
    Logger.log('First run — baselined ' + allIds.length + ' existing files, no pings sent.');
    return;
  }

  newFiles
    .sort((a, b) => a.getDateCreated() - b.getDateCreated())
    .forEach(file => {
      logToSheet(props, file);
      notifySlack(props, file);
    });

  saveSeen(props, allIds);
  Logger.log('watchPOFolder: ' + newFiles.length + ' new file(s) pinged.');
}

function saveSeen(props, ids) {
  // Cap the stored list so the property never grows unbounded.
  props.setProperty(PROP.SEEN_IDS, JSON.stringify(ids.slice(-1000)));
}

/**
 * Appends a tracking row for a new PO. Columns:
 * Date Added | PO / File Name | File Link | Supplier | Invoice Amount |
 * Sample Received? | QA Status | 50% Paid Up Front? | Final 50% Released? | Notes
 */
function logToSheet(props, file) {
  const sheetId = props.getProperty(PROP.TRACKING_SHEET);
  if (!sheetId) return; // tracking optional — skip silently if not configured
  try {
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    sheet.appendRow([
      new Date(),                                            // Date Added
      file.getName(),                                        // PO / File Name
      '=HYPERLINK("' + file.getUrl() + '","Open")',          // File Link
      '',                                                    // Supplier
      '',                                                    // Invoice Amount
      'No',                                                  // Sample Received?
      'Pending',                                             // QA Status
      'No',                                                  // 50% Paid Up Front?
      'No',                                                  // Final 50% Released?
      '',                                                    // Notes
      file.getId(),                                          // File ID (used by Slack buttons)
    ]);
  } catch (e) {
    Logger.log('logToSheet failed: ' + e);
  }
}

function notifySlack(props, file) {
  const webhook = props.getProperty(PROP.SLACK_WEBHOOK);
  const mentionId = props.getProperty(PROP.SLACK_MENTION);
  if (!webhook) throw new Error('Missing ' + PROP.SLACK_WEBHOOK);

  const mention = mentionId ? '<@' + mentionId + '>' : '';
  const url = file.getUrl();
  const name = file.getName();
  const sheetId = props.getProperty(PROP.TRACKING_SHEET);
  const trackerUrl = sheetId
    ? 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit'
    : null;

  const fileId = file.getId();
  const actionButtons = [
    { type: 'button', text: { type: 'plain_text', text: 'Open PO' }, url: url },
  ];
  if (trackerUrl) {
    actionButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: 'QA Tracker' },
      url: trackerUrl,
    });
  }
  // Interactive buttons — clicking these writes back to the tracker row.
  // They only work once the web app + Slack Interactivity are set up (see README).
  actionButtons.push(
    { type: 'button', style: 'primary',
      text: { type: 'plain_text', text: 'Sample Received' },
      action_id: 'sample_received', value: fileId },
    { type: 'button',
      text: { type: 'plain_text', text: 'QA Passed' },
      action_id: 'qa_passed', value: fileId },
    { type: 'button', style: 'danger',
      text: { type: 'plain_text', text: 'QA Failed' },
      action_id: 'qa_failed', value: fileId }
  );

  const payload = {
    text: 'New purchase order uploaded: ' + name, // fallback / notification text
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':page_facing_up: *New purchase order uploaded*\n<' + url + '|' + name + '>',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: (mention ? mention + ' — ' : '') + 'QA gate before this PO is completed:\n' +
                '• :package: Confirm we receive a *physical sample* before the PO is sent out.\n' +
                '• :heavy_dollar_sign: *Hold back 50% of the invoice* — pay at most 50% up front and ' +
                'release the final 50% *only after* the product/ingredient *passes QA*.',
        },
      },
      {
        type: 'actions',
        elements: actionButtons,
      },
    ],
  };

  const res = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Slack error ' + res.getResponseCode() + ': ' + res.getContentText());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack interactivity — buttons write back to the tracker
// Deployed as a Web App; Slack posts button clicks here (see README).
// ─────────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();

    // Basic shared-secret check: Slack's Request URL carries ?secret=… which
    // must match the stored value. (Apps Script can't read request headers, so
    // full signature verification isn't available — this guards the endpoint.)
    const expected = props.getProperty(PROP.REQUEST_SECRET);
    if (expected && (!e || !e.parameter || e.parameter.secret !== expected)) {
      return ContentService.createTextOutput('unauthorized');
    }

    const payload = JSON.parse(e.parameter.payload);
    const action = payload.actions && payload.actions[0];
    if (!action) return ContentService.createTextOutput('');

    const fileId = action.value;
    const clicker = payload.user ? payload.user.id : 'someone';

    let col, val, label;
    switch (action.action_id) {
      case 'sample_received': col = 6; val = 'Yes';    label = 'Sample received'; break;
      case 'qa_passed':       col = 7; val = 'Passed';  label = 'QA passed';       break;
      case 'qa_failed':       col = 7; val = 'Failed';  label = 'QA failed';       break;
      default: return ContentService.createTextOutput('');
    }

    const ok = updateRowByFileId(props, fileId, col, val, '<@' + clicker + '>', label);

    // Confirm back in the channel thread via Slack's response_url.
    if (payload.response_url) {
      const msg = ok
        ? ':white_check_mark: *' + label + '* by <@' + clicker + '> — tracker updated.'
        : ':warning: Could not find this PO in the tracker (was the row deleted?).';
      UrlFetchApp.fetch(payload.response_url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ response_type: 'in_channel', replace_original: false, text: msg }),
        muteHttpExceptions: true,
      });
    }
    return ContentService.createTextOutput(''); // 200 ack
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService.createTextOutput('error');
  }
}

/** Finds the tracker row by File ID (column K) and sets one cell, stamping the Notes column. */
function updateRowByFileId(props, fileId, col, val, who, label) {
  const sheetId = props.getProperty(PROP.TRACKING_SHEET);
  if (!sheetId) return false;
  const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const ids = sheet.getRange(2, 11, lastRow - 1, 1).getValues(); // column K
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === fileId) {
      const row = i + 2;
      sheet.getRange(row, col).setValue(val);
      const notes = sheet.getRange(row, 10); // column J
      const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      const prev = notes.getValue();
      notes.setValue((prev ? prev + ' | ' : '') + label + ' by ' + who + ' ' + stamp);
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Handy for testing: posts a sample message so you can confirm Slack wiring.
// ─────────────────────────────────────────────────────────────────────────────
function testSlackMessage() {
  const props = PropertiesService.getScriptProperties();
  const webhook = props.getProperty(PROP.SLACK_WEBHOOK);
  const mentionId = props.getProperty(PROP.SLACK_MENTION);
  const mention = mentionId ? '<@' + mentionId + '>' : '(no mention configured)';
  const res = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      text: 'Test: PO automation is wired up. ' + mention +
            ' — this is where the physical-sample reminder will appear.',
    }),
    muteHttpExceptions: true,
  });
  Logger.log('Slack test response: ' + res.getResponseCode() + ' ' + res.getContentText());
}
