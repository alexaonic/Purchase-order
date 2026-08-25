# Purchase Order → Slack automation

When a new purchase order lands in the Aonic PO Google Drive folder, this posts a
Slack message tagging **Alex Dyckerhoff** with a reminder to secure a **physical
sample before the PO is sent out**.

It runs entirely on **Google Apps Script** (Google's cloud) via a scheduled
trigger — there is no server to run or maintain.

**Watched folder:** https://drive.google.com/drive/u/0/folders/1AE3MOYzictk13yx6Wjm4lbvb63fbCpq7

---

## What it does

| Function | Schedule | Effect |
|----------|----------|--------|
| `watchPOFolder` | every 5 min | New file in the folder → Slack ping tagging Alex with the physical-sample reminder + an "Open PO" button |

No duplicate pings: processed file IDs are remembered. The first run baselines
whatever is already in the folder, so you won't get spammed with the backlog.

---

## One-time setup (~10 minutes)

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
3. **Project Settings** (gear) → check **Show "appsscript.json" manifest file in
   editor**, then paste this repo's [`appsscript.json`](appsscript.json) over the
   manifest.
4. Log in as an account that has access to the PO Drive folder.

### 4. Add your config and go live
Open `Code.gs`, edit the values inside `setUp()`:
- `SLACK_WEBHOOK_URL` → the webhook from step 1
- `SLACK_MENTION_USER_ID` → Alex's member ID from step 2
- `PO_FOLDER_ID` → already set to the folder above; change only if it moves

Then, from the function dropdown at the top of the editor:
1. Run **`setUp`** → authorize the requested permissions when prompted.
2. Run **`createTriggers`** → installs the 5-minute schedule.
3. Run **`testSlackMessage`** → confirm a message appears in Slack.

Done. Drop a file in the folder and within 5 minutes you'll get a ping.

---

## Notes & limits
- **Latency:** up to ~5 min, since the trigger is polled. Lower the interval in
  `createTriggers()` if you want faster.
- **Who it runs as:** the automation acts as the Google account that authorized
  it. Use an account that will stick around and keeps folder access.
- **Cost:** free within normal Google Workspace quotas.

## Not built yet (easy to add later)
- **Email → Drive import:** auto-save PO PDF attachments from a labeled Gmail
  inbox into the folder (which would then trigger the ping). Ask when you want it.
