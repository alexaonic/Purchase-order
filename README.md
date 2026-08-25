# Purchase Order → Slack automation

When a new purchase order lands in the Aonic PO Google Drive folder, this posts a
Slack message tagging **Alex Dyckerhoff** with the PO **QA gate** reminder.

## QA gate (the rule this enforces)
Every PO must clear two checks before it's completed:
1. **Physical sample** — we must receive a physical sample before the PO is sent out.
2. **50% invoice holdback** — pay at most 50% up front; release the final 50%
   **only after** the product/ingredient **passes QA**. If it fails, the holdback
   is withheld until the issue is resolved or the order is rejected.

The Slack ping restates both checks on every new PO.

It runs entirely on **Google Apps Script** (Google's cloud) via a scheduled
trigger — there is no server to run or maintain.

**Watched folder:** https://drive.google.com/drive/u/0/folders/1AE3MOYzictk13yx6Wjm4lbvb63fbCpq7

---

## What it does

| Function | Schedule | Effect |
|----------|----------|--------|
| `watchPOFolder` | every 5 min | New file in the folder → logs a row in the **PO QA Tracking** sheet **and** posts a Slack ping tagging Alex with the QA-gate reminder + "Open PO" / "QA Tracker" buttons |

No duplicate pings: processed file IDs are remembered. The first run baselines
whatever is already in the folder, so you won't get spammed with the backlog.

### PO QA Tracking sheet
Lives in the PO Drive folder. Every new PO auto-adds a row; the team fills in the
status columns as the PO moves through QA:

`Date Added | PO / File Name | File Link | Supplier | Invoice Amount | Sample Received? | QA Status | 50% Paid Up Front? | Final 50% Released? | Notes`

- **Sample Received?** / **50% Paid Up Front?** / **Final 50% Released?** — Yes / No dropdowns
- **QA Status** — Pending / Passed / Failed dropdown
- Release the final 50% only once **QA Status = Passed**.

Sheet: https://docs.google.com/spreadsheets/d/1hqkIdUmQTNni0ezL6AoC8I4Fa3imWgW5s2En_cDoeOg/edit

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

## Slack buttons that update the tracker (optional)

Each PO ping carries **Sample Received / QA Passed / QA Failed** buttons. Clicking
one writes straight back to that PO's row (and stamps who clicked, in Notes). This
needs a one-time web-app deploy + Slack Interactivity setup:

1. **Pick a secret.** In `setUp()`, set `SLACK_REQUEST_SECRET` to any long random
   string (e.g. from a password generator). Run `setUp` again to save it.
2. **Deploy the script as a Web App.** In the Apps Script editor:
   **Deploy ▸ New deployment ▸ Type: Web app**. Set **Execute as: Me** and
   **Who has access: Anyone**. Click **Deploy**, authorize, and copy the
   **Web app URL** (ends in `/exec`).
3. **Build the Request URL** by appending your secret:
   `https://script.google.com/…/exec?secret=YOUR_SECRET`
4. **Turn on Interactivity in Slack.** api.slack.com/apps → your `PO Alerts` app
   → **Interactivity & Shortcuts** → toggle **On** → paste the Request URL from
   step 3 into **Request URL** → **Save Changes**.
5. Done. Click a button on a PO ping — the sheet updates and a confirmation posts
   in the channel.

> Re-deploy note: after any later code change, use **Deploy ▸ Manage deployments ▸
> edit ▸ New version** so the live URL runs the new code.

## Update the tracker by @mentioning the PO Bot (optional)

Instead of (or as well as) the buttons, you can update a PO by @mentioning a bot
in the channel:

> **@PO Bot PO-1023 passed**

The bot understands these status words: **sample**, **passed**, **failed**,
**paid** (50% deposit), **released** (final 50%). The rest of your message is
matched against the **PO / File Name** column to find the right row, then it
replies in-thread to confirm. If it's ambiguous, it asks you to be more specific.

> Note: the bot is your own app (e.g. named "PO Bot") — not the literal `@claude`,
> which is Anthropic's Slack app. Same experience, your own handle.

**Setup (builds on the web-app + secret from the buttons section above):**

1. **Add a bot user + scopes.** api.slack.com/apps → your `PO Alerts` app →
   **OAuth & Permissions** → under **Bot Token Scopes** add `app_mentions:read`
   and `chat:write`.
2. **Install the app** to the workspace (same page → **Install to Workspace** /
   **Reinstall**). Copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Store the token.** In `setUp()`, set `SLACK_BOT_TOKEN` to that `xoxb-…`
   value, and run `setUp`.
4. **Subscribe to mentions.** App → **Event Subscriptions** → toggle **On** →
   **Request URL:** paste the same web-app URL with the secret
   (`https://script.google.com/…/exec?secret=YOUR_SECRET`). Slack will verify it
   (the script echoes the challenge automatically). Under **Subscribe to bot
   events** add **`app_mention`** → **Save Changes**.
5. **Invite the bot** to the channel: open the channel and type
   `/invite @PO Bot`.
6. Test it: `@PO Bot <part of a PO file name> passed`. The sheet updates and the
   bot replies. ✅

Both the buttons and the @mention use the **same** web-app URL — set it as the
Request URL in *both* Interactivity and Event Subscriptions.

## Notes & limits
- **Latency:** up to ~5 min, since the trigger is polled. Lower the interval in
  `createTriggers()` if you want faster.
- **Who it runs as:** the automation acts as the Google account that authorized
  it. Use an account that will stick around and keeps folder access.
- **Cost:** free within normal Google Workspace quotas.

## Not built yet (easy to add later)
- **Email → Drive import:** auto-save PO PDF attachments from a labeled Gmail
  inbox into the folder (which would then trigger the ping). Ask when you want it.
