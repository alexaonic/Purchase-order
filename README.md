# Purchase Order → Slack automation

When a new purchase order lands in the Aonic PO Google Drive folder, this posts a
Slack message tagging **Alex Dyckerhoff** with a reminder to secure a **physical
sample before the PO is sent out**. It can also pull POs in from email
automatically.

It runs entirely on **Google Apps Script** (Google's cloud) via scheduled
triggers — there is no server to run or maintain.

**Watched folder:** https://drive.google.com/drive/u/0/folders/1AE3MOYzictk13yx6Wjm4lbvb63fbCpq7

---

## What it does

| Job | Function | Schedule | Effect |
|-----|----------|----------|--------|
| Watch Drive folder | `watchPOFolder` | every 5 min | New file in the folder → Slack ping tagging Alex |
| Import PO emails | `importPOEmailsToDrive` | every 15 min | PDF attachments on labeled PO emails → saved to the folder (which then triggers the ping) |

---

## One-time setup (~15 minutes)

### 1. Create a Slack Incoming Webhook
1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name it e.g. `PO Alerts`, pick the Aonic workspace.
3. **Incoming Webhooks** → toggle **On** → **Add New Webhook to Workspace**.
4. Choose the channel the pings should go to → **Allow**.
5. Copy the **Webhook URL** (starts with `https://hooks.slack.com/services/…`).

### 2. Get Alex's Slack member ID
So the `@mention` actually notifies him:
- In Slack, click Alex Dyckerhoff's profile → **⋮ (More)** → **Copy member ID**.
- It looks like `U01ABCDEF`.

### 3. Create the Apps Script project
1. Go to https://script.google.com → **New project**.
2. Replace the default `Code.gs` contents with this repo's [`Code.gs`](Code.gs).
3. **Project Settings** (gear icon) → check **Show "appsscript.json" manifest file
   in editor**, then paste this repo's [`appsscript.json`](appsscript.json) over
   the manifest.
4. Log in as an account that has access to the PO Drive folder (and, for the
   email import, the inbox the POs arrive in).

### 4. Add your config
Open `Code.gs`, edit the values inside `setUp()`:
- `SLACK_WEBHOOK_URL` → the webhook from step 1
- `SLACK_MENTION_USER_ID` → Alex's member ID from step 2
- `PO_FOLDER_ID` → already set to the folder above; change if it moves
- `GMAIL_PO_QUERY` → the Gmail search that matches PO emails (see below)

Then in the editor's function dropdown:
1. Run **`setUp`** → authorize the requested permissions when prompted.
2. Run **`createTriggers`** → installs both schedules.
3. Run **`testSlackMessage`** → confirm a message appears in Slack.

Done. Drop a file in the folder and within 5 minutes you'll get a ping.

---

## Email → Drive forwarding

Yes — this is the `importPOEmailsToDrive` job. Rather than blindly forwarding
every email, it works off a **Gmail label** so only real POs get imported:

1. In Gmail, create a **filter** that matches your PO emails — e.g.
   *from a specific supplier*, or *subject contains "Purchase Order"*, or
   *has attachment* — and have it **apply a label** like `purchase-orders`.
   (Gmail → Search → ⋯ → Create filter → Apply label.)
2. The default `GMAIL_PO_QUERY` is `label:purchase-orders has:attachment filename:pdf`.
   Adjust it in `setUp()` to match your label / criteria.
3. Every 15 minutes the script saves new PDF attachments from those emails into
   the Drive folder and marks the thread with a **`PO Imported`** label so it's
   never imported twice. Once the file lands in Drive, the Slack ping fires
   automatically.

If POs instead arrive as links or non-PDF files, tell me and I'll adjust the
matching.

### Auto-forwarding from another mailbox
If POs currently arrive in someone else's inbox and need to reach the account
running this script, set up a Gmail forwarding rule in *that* mailbox
(Settings → Forwarding → add the destination address, then a filter to forward
PO emails). The label filter above then catches them on arrival.

---

## Notes & limits
- **No duplicate pings:** processed file IDs are remembered in Script Properties.
  The first run baselines whatever is already in the folder (no backlog spam).
- **Latency:** up to ~5 min, since triggers are polled (Apps Script has no
  instant Drive push for folders without extra infrastructure). Lower the
  interval in `createTriggers()` if you want faster.
- **Who it runs as:** the automation acts as the Google account that authorized
  it. Use an account (or shared/service mailbox) that will stick around.
- **Cost:** free within normal Google Workspace quotas.
