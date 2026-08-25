/**
 * Aonic — Purchase Order automation (Google Apps Script)
 *
 * Two jobs, both driven by time-based triggers so they run in Google's cloud
 * with no server to maintain:
 *
 *   1) watchPOFolder()        — pings Slack when a new PO lands in the Drive
 *                               folder, tagging Alex Dyckerhoff to get a
 *                               physical sample before the PO is sent out.
 *   2) importPOEmailsToDrive() — saves PDF attachments from PO emails (matched
 *                               by a Gmail label) into that same Drive folder,
 *                               which then feeds job #1.
 *
 * All secrets/config live in Script Properties (Project Settings → Script
 * Properties), never in this file. Run setUp() once to seed them, or set them
 * by hand. See README.md for the full walkthrough.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG KEYS (values live in Script Properties)
// ─────────────────────────────────────────────────────────────────────────────
const PROP = {
  FOLDER_ID: 'PO_FOLDER_ID',            // Drive folder to watch
  SLACK_WEBHOOK: 'SLACK_WEBHOOK_URL',   // Slack Incoming Webhook URL
  SLACK_MENTION: 'SLACK_MENTION_USER_ID', // Alex's Slack member ID, e.g. U01ABCDEF
  GMAIL_QUERY: 'GMAIL_PO_QUERY',        // Gmail search for PO emails
  IMPORTED_LABEL: 'GMAIL_IMPORTED_LABEL', // label applied after import
  SEEN_IDS: 'SEEN_FILE_IDS',            // internal: JSON array of processed file IDs
};

/**
 * One-time setup helper. Fill in the four values below, run this function once
 * (Run ▸ setUp), authorize the scopes, then delete your values or leave them —
 * they're only read on this single run and copied into Script Properties.
 */
function setUp() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    [PROP.FOLDER_ID]:      '1AE3MOYzictk13yx6Wjm4lbvb63fbCpq7',   // your PO folder
    [PROP.SLACK_WEBHOOK]:  'PASTE_SLACK_WEBHOOK_URL_HERE',
    [PROP.SLACK_MENTION]:  'PASTE_ALEX_SLACK_MEMBER_ID_HERE',      // e.g. U01ABCDEF
    [PROP.GMAIL_QUERY]:    'label:purchase-orders has:attachment filename:pdf',
    [PROP.IMPORTED_LABEL]: 'PO Imported',
  }, false);
  Logger.log('Script Properties saved. Now run createTriggers().');
}

/**
 * Installs the two time-based triggers. Run once (Run ▸ createTriggers).
 * Safe to re-run: it clears our old triggers first so you don't stack duplicates.
 */
function createTriggers() {
  const keep = ['watchPOFolder', 'importPOEmailsToDrive'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (keep.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('watchPOFolder').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('importPOEmailsToDrive').timeBased().everyMinutes(15).create();
  Logger.log('Triggers created: watchPOFolder (5 min), importPOEmailsToDrive (15 min).');
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1 — Watch the Drive folder, ping Slack on new files
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
    .forEach(file => notifySlack(props, file));

  saveSeen(props, allIds);
  Logger.log('watchPOFolder: ' + newFiles.length + ' new file(s) pinged.');
}

function saveSeen(props, ids) {
  // Cap the stored list so the property never grows unbounded.
  const capped = ids.slice(-1000);
  props.setProperty(PROP.SEEN_IDS, JSON.stringify(capped));
}

function notifySlack(props, file) {
  const webhook = props.getProperty(PROP.SLACK_WEBHOOK);
  const mentionId = props.getProperty(PROP.SLACK_MENTION);
  if (!webhook) throw new Error('Missing ' + PROP.SLACK_WEBHOOK);

  const mention = mentionId ? '<@' + mentionId + '>' : '';
  const url = file.getUrl();
  const name = file.getName();

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
          text: (mention ? mention + ' — ' : '') +
                'please make sure we receive a *physical sample* before this PO is sent out.',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Open PO' },
            url: url,
          },
        ],
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
// JOB 2 — Import PO email attachments into the Drive folder
// ─────────────────────────────────────────────────────────────────────────────
function importPOEmailsToDrive() {
  const props = PropertiesService.getScriptProperties();
  const folderId = props.getProperty(PROP.FOLDER_ID);
  const query = props.getProperty(PROP.GMAIL_QUERY);
  const importedLabelName = props.getProperty(PROP.IMPORTED_LABEL) || 'PO Imported';
  if (!folderId || !query) {
    Logger.log('Email import skipped — set ' + PROP.FOLDER_ID + ' and ' + PROP.GMAIL_QUERY + '.');
    return;
  }

  const folder = DriveApp.getFolderById(folderId);
  const importedLabel = getOrCreateLabel(importedLabelName);

  // Only touch threads not yet imported.
  const threads = GmailApp.search(query + ' -label:"' + importedLabelName + '"', 0, 25);
  let saved = 0;

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      msg.getAttachments().forEach(att => {
        if (att.getContentType() === 'application/pdf' ||
            /\.pdf$/i.test(att.getName())) {
          folder.createFile(att.copyBlob()).setName(att.getName());
          saved++;
        }
      });
    });
    thread.addLabel(importedLabel);
  });

  Logger.log('importPOEmailsToDrive: ' + saved + ' attachment(s) saved from ' +
             threads.length + ' thread(s).');
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
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
