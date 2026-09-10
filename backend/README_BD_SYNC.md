# Live BD Accountability Tracker sync — one-time setup

The backend now pulls the BD Accountability Tracker straight from Google
Sheets on every `/api/data` request (throttled to once per
`BD_SYNC_MIN_INTERVAL` seconds, default 300), instead of requiring a manual
`.xlsx` upload after every refresh. The sheet stays **private** — the
backend authenticates as a Google Cloud service account that's been granted
Viewer access to just this one file, rather than the sheet being shared
"anyone with the link."

Do the following once. None of it touches this repo — it's all in the
Google Cloud Console and the PythonAnywhere Web tab.

## 1. Create a Google Cloud service account

1. Go to https://console.cloud.google.com/ and create a project (or reuse an
   existing one) for Fincart.
2. Enable the **Google Drive API** for that project (APIs & Services →
   Library → search "Google Drive API" → Enable). The Drive API's `files.export`
   endpoint is what fetches the whole workbook as `.xlsx` — the Sheets API
   itself has no equivalent export-as-xlsx call.
3. APIs & Services → Credentials → Create Credentials → Service account.
   Name it something like `marketing-mis-bd-sync`. No project role/IAM
   permissions are needed — it only ever touches the one file it's shared
   with.
4. Open the new service account → Keys → Add key → Create new key → JSON.
   This downloads a `.json` file — treat it like a password, it's a
   permanent credential.

## 2. Share the BD Accountability Tracker sheet with it

1. Open the service account JSON file and copy its `client_email` value
   (looks like `marketing-mis-bd-sync@your-project.iam.gserviceaccount.com`).
2. Open the BD Accountability Tracker sheet in Google Sheets → Share →
   paste that email → set role to **Viewer** → Send (no notification email
   needed, it's a service account).
3. The sheet's ID is the long string in its URL between `/d/` and `/edit`
   — for the current tracker that's `18HToa0HDn6Ev6FY88CcOa-arBTrZR7nw`,
   which is already the default in `app.py` (`BD_SHEET_ID`). Only set the
   `BD_SHEET_ID` environment variable if the tracker ever moves to a
   different spreadsheet.

## 3. Configure the PythonAnywhere backend

1. On the PythonAnywhere **Web** tab, scroll to **Environment variables**
   and add:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — paste the *entire contents* of the
     downloaded JSON key file as one value (it's fine that it contains
     newlines inside the private key field; paste it as-is).
   - (optional) `BD_SHEET_ID` — only if the sheet ID isn't the current
     default.
   - (optional) `BD_SYNC_MIN_INTERVAL` — seconds between auto-syncs,
     default `300`.
2. In a PythonAnywhere **Bash console**, install the two new dependencies
   into your virtualenv: `pip install -r requirements.txt` (adds
   `google-auth` and `requests`).
3. Reload the web app (Web tab → Reload button).

## 4. Verify

1. Visit `/upload` on the backend — you should see a new **"BD
   Accountability Tracker — live Google Sheets sync"** section at the
   bottom. Enter the upload password and click **Sync now** to trigger an
   immediate pull and confirm it succeeds (or see the exact error if not —
   most likely causes are the sheet not being shared with the service
   account's email, or the Drive API not being enabled).
2. Once a sync has succeeded, refresh the dashboard
   (https://fincartoptima.github.io/MarketingMISDashboard/) — the BD
   Performance tab now reflects whatever is currently in the Google Sheet,
   no manual upload needed. Any further edits in the sheet show up the next
   time someone loads the dashboard, at most `BD_SYNC_MIN_INTERVAL` seconds
   stale.

The manual "BD Accountability Tracker" file upload on `/upload` still works
as an emergency fallback (e.g. if the service account credentials ever
break), but note it'll be overwritten by the next successful automatic sync.
