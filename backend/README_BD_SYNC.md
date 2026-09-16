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

**Recommended: upload the key file itself, don't paste its contents.**
Pasting JSON into an environment variable (or into the WSGI file as a string)
is fragile — editors and copy-paste routinely turn the `private_key` field's
escaped `\n` sequences into real line breaks, which breaks JSON parsing
(`Invalid control character` errors). Uploading the raw file avoids that
class of bug entirely.

1. On PythonAnywhere, go to the **Files** tab and upload the downloaded
   `.json` key file into `/home/Fincart/marketing-mis/backend/` (e.g. as
   `service-account.json` — this filename pattern is already covered by
   `.gitignore`, so it can never accidentally get committed).
2. On the **Web** tab, scroll to **Environment variables** (or, if that
   section isn't available on your plan, add these as
   `os.environ.setdefault('NAME', 'value')` lines directly in the WSGI
   configuration file instead) and set:
   - `GOOGLE_SERVICE_ACCOUNT_FILE` = `/home/Fincart/marketing-mis/backend/service-account.json`
   - (optional) `BD_SHEET_ID` — only if the sheet ID isn't the current
     default.
   - (optional) `BD_SYNC_MIN_INTERVAL` — seconds between auto-syncs,
     default `300`.
3. In a PythonAnywhere **Bash console**, install the two new dependencies
   into your virtualenv: `pip install -r requirements.txt` (adds
   `google-auth` and `requests`).
4. Reload the web app (Web tab → Reload button).

<details>
<summary>Alternative: paste the JSON contents into GOOGLE_SERVICE_ACCOUNT_JSON instead</summary>

Only do this if uploading a file isn't an option. Set `GOOGLE_SERVICE_ACCOUNT_JSON`
to the entire contents of the key file as one value. Paste it from the raw
file itself (e.g. `cat service-account.json` in a terminal, then copy that
output) — never from a "pretty" or reformatted view, and never through an
editor that might auto-format JSON, since either can silently convert the
`private_key` field's `\n` escapes into real line breaks.
</details>

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
