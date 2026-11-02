# Updating the Marketing MIS Dashboard

Two things can be updated, and they are completely independent:

| What changed | Where it goes | Who sees it |
|---|---|---|
| **The data** (a new month of leads, revenue, plans) | Upload at `fincart.pythonanywhere.com/upload` | Everyone, on their next page refresh |
| **The code** (a new table, a fix, a new column) | `git push` to `main` → GitHub Pages | Everyone, on their next page refresh |

The dashboard is a static page on GitHub Pages (`fincartoptima.github.io/MarketingMISDashboard/`) that fetches its data from a Flask app on PythonAnywhere. **There is no local copy of the data.** If the API cannot be reached, the page shows an error screen naming what to check — it never falls back to stale figures.

---

## Part 1 — Refreshing the data (the routine monthly job)

### 1. Download the B2C export from Workpoint

Download the **FIN23 Lead Management** export as `.xlsx`. The file arrives named like `FIN29102026325_2026-11-02 11_57_40.xlsx`; the name does not matter.

The sheet inside may be called `Data`, `RAW_DATA` or `RawData` — all three are accepted.

### 2. Upload it

1. Open **<https://fincart.pythonanywhere.com/upload>**
2. Put the file in the **B2C (FIN23)** field.
3. Add any other file that has also changed — Revenue Input, B2B, FY2026, Plan Approval. **Leave a field empty and that dataset is left exactly as it is**, so a B2C-only refresh needs only the one file.
4. Enter the upload password.
5. Press Upload and **read the result page**. It reports the row count stored per file, plus any warnings (see below).

The BD Accountability Tracker is the exception: it syncs itself from Google Sheets on every API call, so it normally needs no upload. See `backend/README_BD_SYNC.md`.

### 3. Check the result page before you walk away

Each file **replaces its own stored dataset in full** — it never appends — so a bad file replaces a good one. Files are handled independently: one failing does not discard another that parsed fine in the same submission. The page flags:

- **A missing required column** — *that file* is **rejected** and its previous data is kept untouched. The message names the column. Cause is almost always a renamed column in the export.
- **A file much smaller than the one it replaced** (under half the rows) — usually a truncated or partial export. Re-download before trusting it.
- **A B2C file under 2 MB, or a B2B file over 2 MB** — probably the wrong file in the wrong field.
- **Quality warnings** — unknown lead statuses, IN PROCESS rows with no in-process date, duplicate clients, and **"this export has no `leadOnHoldDate` / `leadFollowUpDate` / `leadDeadDate` columns"**, which means an older export format and an empty Activity Change Days section.

### 4. Confirm it landed

- **<https://fincart.pythonanywhere.com/api/meta>** — row count and last-updated time per file.
- Reload the dashboard. The header subtitle reads **"Data till <date>"** and the **Data health** panel on the Dashboard tab lists anything it does not trust.

---

## Part 2 — Shipping a code change

The frontend is plain files served by GitHub Pages; there is no build step.

```bash
git status                      # never commit *.xlsx, *.csv, .env or anything with client PII
git add <the files you changed>
git commit -m "..."
git push origin main
```

GitHub Pages redeploys within a minute or two.

The `app-*.js` files are loaded with a `?t=<timestamp>` cache-buster, so **script changes land on a plain refresh**. `index.html` itself has no such protection and Pages serves it with a short cache lifetime, so after changing **markup or CSS** do a hard reload (`Ctrl`+`Shift`+`R`) — or just wait a few minutes — before concluding the change did not deploy.

### If the change touches the backend

Changing `backend/extract_lib.py` or `backend/app.py` — **adding a column to `FIN23_COLUMNS` counts** — needs a redeploy, because the pushed code is not what PythonAnywhere runs:

1. Upload the changed files to `/home/Fincart/marketing-mis/backend` (Files tab, or `git pull` in a PythonAnywhere Bash console).
2. **Web tab → Reload**. Wait ~20 seconds.
3. **Re-upload the B2C export.** This is the step that is easy to miss: the stored payload was parsed by the *old* code, so a newly allowed column is absent until something re-parses the file.
4. Confirm at `/api/meta`, then reload the dashboard.

### Adding a new column from the export

A column has to be allowed through in three places or it silently disappears:

1. `FIN23_COLUMNS` in **`backend/extract_lib.py`** — anything not listed is dropped at parse time. Add every header spelling, lower-cased.
2. The same set in **`extract.py`** — only used by the local CLI, kept in sync so the two agree.
3. **`buildRawData()` in `app-dataload.js`** — maps the raw cell onto each lead row.

Then, to show it in the Raw Data tab, add it to `CONFIG.RAW_COLUMNS` in `app-config.js`. Finish with the backend redeploy and re-upload above.

---

## Part 3 — Things that live outside both paths

| Thing | Where it actually lives | How to change it |
|---|---|---|
| **Cost Per Campaign** | A Google Sheet, published as CSV (`CONFIG.DEFAULT_GS_URL`) | Edit the sheet; the dashboard re-reads it on every load. The sheet must stay shared as "Anyone with the link → Viewer". |
| **EMPLOYEE_REF** (RM → Team) | `snapshot.js`, with per-browser overrides in `localStorage` | Edit in the Employee tab for yourself; commit `snapshot.js` to change it for everyone. Editing `snapshot.js` auto-expires everyone's stale override. |
| **RM Master Mapping** (name aliases) | `snapshot.js`, same override mechanism | Same as above. |
| **Categorized On-Hold leads** | `categorized_leads_data.js`, generated offline | Re-run `scratch_mfsa/run_classification.py` against a fresh export and commit the result. That script is **not in this repo** — it lives in a local scratch folder. |
| **Financial-year window** | `CONFIG.FY_CUTOFF_MONTH` in `app-config.js` | Set to the first month of the current FY, once a year. The Data health panel warns when data runs past it. |
| **BD Accountability Tracker** | Google Sheets, synced live by the backend | Edit the sheet. See `backend/README_BD_SYNC.md`. |

---

## Part 4 — When the dashboard shows the error screen

The screen itself names the specific checks for the specific failure. In summary:

| Symptom | Most likely cause | Fix |
|---|---|---|
| "could not reach the data API at all" | Offline, or an ad-blocker / proxy / VPN blocking the request; or the PythonAnywhere app has stopped | Open `/api/data` directly. If it answers, the browser is blocking it — check **F12 → Console** for a CORS error. If it does not, reload the app on PythonAnywhere. |
| Same, and `/api/data` is dead in a fresh tab too | **Free PythonAnywhere accounts stop serving every 3 months** | Sign in → **Web** tab → **Run until 3 months from today** |
| "answered, but with an error: HTTP 500" | Backend crashed building the response | **Web tab → Log files → Error log** for the traceback |
| "HTTP 404" | `CONFIG.DATA_API_URL` does not match the deployed app, or an old build is running | Check `app-config.js`, redeploy, Reload |
| "the reply was not readable JSON" | Backend failed or timed out mid-response | Reload the web app, then re-upload the B2C export |
| "holds no B2C lead rows" | Nothing uploaded since the database was last reset (`marketing.db` is **not** in git, so a fresh deploy starts empty) | Upload the B2C export |

`/health` answers whenever the app is alive and tells a hosting problem from a data one. `/api/meta` says what data is stored.

---

## Part 5 — Verifying a release

Open the dashboard and check, in this order:

1. **The page loads at all** — if the error screen appears, the data never arrived; nothing below applies.
2. **Header subtitle** — "Data till <date>" should match the newest lead in the file you uploaded.
3. **Data health panel** (Dashboard tab, top) — expand it. It checks the lead data, the team map, the cost sheet, table shape, the FY window and the Activity Change Days columns, and says how to fix each thing it finds. Errors mean a figure on screen is wrong *now*; warnings mean something rests on a fallback.
4. **Overview KPIs** — compare YTD Leads against last month's number; a large unexplained jump or drop usually means the wrong file was uploaded.
5. **Any tab you changed** — and the `i` button beside each table, which states the exact columns and rules behind it.
