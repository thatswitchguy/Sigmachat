# Sigmachat v1.3.6

This is a small chatting app I made with Node.js and Socket.io. 

It works (looks best) on PC/laptop, or a suitably sized IPad.

Link: ➤ <kbd>[**Sigmachat**](https://sigmachat2.onrender.com/)</kbd>

Replit fork link: ➤ <kbd>[**Replit fork link**](https://replit.com/@thatswitchguy/Sigmachat)</kbd>

## Features

- DM (Direct messaging)
- Servers with channels
- Profiles and users
- Image/Video upload
- Fast message updating

## Archive messages in Google Sheets

SigmaChat can archive channel messages and direct messages to a Google Sheet through
Google Apps Script. Local JSON files remain the live chat store and fallback, so a
temporary Google outage does not prevent sending messages.

### 1. Create the Google Sheet and Apps Script

1. Create a new Google Sheet.
2. Open **Extensions → Apps Script**.
3. Replace the editor contents with the code in `google-apps-script/Code.gs`.
4. Change `REPLACE_WITH_TARGET_SPREADSHEET_ID` to the ID of the spreadsheet that
   should receive the messages. It is the part between `/d/` and `/edit` in the
   Google Sheet URL.
5. Change `REPLACE_WITH_A_LONG_RANDOM_TOKEN` to a long random value. Do not
   commit or share this value.
6. Click **Deploy → New deployment**.
7. Choose **Web app**, set **Execute as** to **Me**, set **Who has access** to
   **Anyone**, then deploy and copy the Web app URL.
8. Approve Google's authorization prompt. The script creates a frozen, formatted
   `Messages` tab automatically on its first request.

### 2. Configure Replit

Add these environment variables to the **shared** environment (use the Secrets/
Environment Variables panel; do not put the token in source code):

```text
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SHEETS_WEBHOOK_TOKEN=the_same_random_value_used_in_Code.gs
```

Restart the Chat Server workflow after saving the variables. The server batches up
to 20 events and retries temporary failures. If the webhook is not configured,
the app continues to use its existing local JSON storage.

### 3. Sheet layout

Each row is one immutable event. `eventType` is `created`, `edited`, or `deleted`;
`conversationType` is `channel` or `direct`. Filter by `serverId`, `channelId`,
`room`, `sender`, or `recipient` to organize conversations. The `eventId` column
prevents webhook retries from creating duplicate rows.

To test the deployment, open the Web app URL in a browser. It should return a
small JSON response with `"ok":true`. Never test by putting the token in the URL.
- Dark UI (similar to discord)
- Incognito mode

