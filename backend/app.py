# -*- coding: utf-8 -*-
# Marketing MIS backend: accepts the source xlsx files over a password-protected
# upload form (every file is optional — submit any subset), parses them with
# extract_lib (same logic as the local extract.py),
# and stores the result in SQLite on disk. The dashboard (hosted separately on
# GitHub Pages) reads GET /api/data instead of a static data.js file — same
# JSON shape, so app.js's calculation logic is untouched.
import io
import json
import os
import sqlite3
import time
import urllib.request
from datetime import datetime

from flask import Flask, g, jsonify, render_template, request, Response

import extract_lib

app = Flask(__name__)

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'marketing.db')
DB_PATH = os.environ.get('DB_PATH', DEFAULT_DB_PATH)
UPLOAD_PASSWORD = os.environ.get('UPLOAD_PASSWORD', '')
MAX_CONTENT_LENGTH = 200 * 1024 * 1024  # 200MB combined upload cap
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

# Single source of truth for the uploadable files: which form field carries
# it, whether it's required (all False — every file is optional), the label
# used in error messages, and which extract_lib loader (with what extra args)
# parses it. upload_submit() below loops over this instead of repeating one
# block per file.
SOURCE_CONFIGS = [
    {
        'key': 'fin23',
        'form_field': 'fin23',
        'required': False,
        'human_label': 'B2C (FIN23)',
        'loader': extract_lib.load_sheet_rows,
        'loader_kwargs': {'sheet_names': ['RAW_DATA', 'RawData', 'Data'], 'column_allowlist': extract_lib.FIN23_COLUMNS},
    },
    {
        'key': 'rev',
        'form_field': 'rev',
        'required': False,
        'human_label': 'Revenue Input',
        'loader': extract_lib.load_revenue_input_rows,
        'loader_kwargs': {},
    },
    {
        'key': 'b2b',
        'form_field': 'b2b',
        'required': False,
        'human_label': 'B2B',
        'loader': extract_lib.load_sheet_rows,
        'loader_kwargs': {},
    },
    {
        'key': 'fy',
        'form_field': 'fy',
        'required': False,
        'human_label': 'FY2026',
        'loader': extract_lib.load_sheet_rows,
        'loader_kwargs': {},
    },
    {
        'key': 'pa',
        'form_field': 'pa',
        'required': False,
        'human_label': 'Plan Approval',
        'loader': extract_lib.load_sheet_rows,
        'loader_kwargs': {},
    },
    {
        'key': 'bd',
        'form_field': 'bd',
        'required': False,
        'human_label': 'BD Accountability Tracker',
        'loader': extract_lib.load_bd_tracker_rows,
        'loader_kwargs': {},
    },
    {
        # Same uploaded file as 'bd' above (form_field: 'bd'), different sheet
        # within it ("BD Daily Log") -- no separate upload field needed.
        'key': 'bdcalls',
        'form_field': 'bd',
        'required': False,
        'human_label': 'BD Daily Log',
        'loader': extract_lib.load_bd_daily_log_rows,
        'loader_kwargs': {},
    },
]
SOURCES = [cfg['key'] for cfg in SOURCE_CONFIGS]

# Sanity-check thresholds on raw upload size (MB), surfaced as a non-blocking
# warning in the /upload response -- catches an incomplete export or a
# wrong-file mix-up without stopping the file from being processed normally.
# B2C exports run well over 2MB; B2B exports run well under it, so a file on
# the wrong side of that line for either source is worth a human glancing at.
FILE_SIZE_CHECKS = {
    'fin23': {'min_mb': 2, 'max_mb': None},
    'b2b':   {'min_mb': None, 'max_mb': 2},
}


def get_db():
    if 'db' not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS datasets (
            key TEXT PRIMARY KEY,
            json_data TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()


init_db()


def cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return resp


@app.after_request
def apply_cors(resp):
    return cors(resp)


# ---------- Live BD Accountability Tracker sync (private Google Sheet) ----------
# The tracker stays private (it carries lead emails) rather than being shared
# "anyone with the link" -- a Google Cloud service account is granted Viewer
# access on just this one file, and the backend authenticates as that service
# account to pull the whole workbook (all per-rep tabs + "BD Daily Log") via
# the Drive API's export endpoint. Same bytes shape as a manually uploaded
# .xlsx, so they go through the exact same extract_lib loaders as 'bd'/'bdcalls'
# in SOURCE_CONFIGS below. See backend/README_BD_SYNC.md for one-time setup.
BD_SHEET_ID = os.environ.get('BD_SHEET_ID', '18HToa0HDn6Ev6FY88CcOa-arBTrZR7nw')
BD_SYNC_MIN_INTERVAL = int(os.environ.get('BD_SYNC_MIN_INTERVAL', '300'))  # seconds

# In-memory throttle/status state. Per-worker-process (not shared across
# gunicorn workers), which is fine here -- it only needs to keep any single
# process from hitting Google on every request, not provide an exact global
# rate limit.
_bd_sync_state = {'last_attempt': 0.0, 'last_success': None, 'last_error': None}


def _google_credentials():
    from google.oauth2 import service_account
    # Prefer a file path when available -- pasting the key's JSON into an env
    # var (or into the WSGI file as a string literal) is fragile: editors and
    # copy-paste commonly turn the private_key field's escaped \n sequences
    # into real line breaks, which breaks JSON parsing. Reading the raw file
    # never has that problem.
    path = os.environ.get('GOOGLE_SERVICE_ACCOUNT_FILE')
    if path:
        return service_account.Credentials.from_service_account_file(
            path, scopes=['https://www.googleapis.com/auth/drive.readonly'])
    raw = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if not raw:
        raise RuntimeError(
            'Set GOOGLE_SERVICE_ACCOUNT_FILE (path to the downloaded .json key file, '
            'recommended) or GOOGLE_SERVICE_ACCOUNT_JSON (the key contents as a string) '
            'as an environment variable'
        )
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON ({e}). This almost always means the '
            "private_key field's escaped \\n sequences got converted into real line breaks during "
            'copy-paste -- switch to GOOGLE_SERVICE_ACCOUNT_FILE pointing at the raw .json key file '
            'instead, which avoids this entirely.'
        ) from e
    return service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/drive.readonly'])


def _fetch_bd_workbook_bytes():
    from google.auth.transport.requests import Request as GoogleAuthRequest
    creds = _google_credentials()
    creds.refresh(GoogleAuthRequest())

    def _get(url):
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {creds.token}'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()

    # The tracker may be a native Google Sheet (needs /export to convert to
    # .xlsx) or an .xlsx file just stored in Drive as-is (needs a plain
    # ?alt=media download -- /export only works on native Docs Editors
    # formats and 403s on anything else). Check which one it currently is
    # rather than assuming, since that can change if someone opens the
    # uploaded file with Sheets and lets Drive convert it in place.
    meta = json.loads(_get(f'https://www.googleapis.com/drive/v3/files/{BD_SHEET_ID}?fields=mimeType'))
    if meta.get('mimeType') == 'application/vnd.google-apps.spreadsheet':
        url = (f'https://www.googleapis.com/drive/v3/files/{BD_SHEET_ID}/export'
               '?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    else:
        url = f'https://www.googleapis.com/drive/v3/files/{BD_SHEET_ID}?alt=media'
    return _get(url)


def sync_bd_from_google(force=False):
    """Pull the tracker from Google Sheets and store it exactly like a manual
    'bd' upload would. Throttled to at most once every BD_SYNC_MIN_INTERVAL
    seconds since api_data() calls this on every request. Failures are
    swallowed -- the dashboard keeps serving the last good data -- but
    recorded in _bd_sync_state so /upload can surface them."""
    now = time.time()
    if not force and (now - _bd_sync_state['last_attempt']) < BD_SYNC_MIN_INTERVAL:
        return
    _bd_sync_state['last_attempt'] = now
    try:
        raw = _fetch_bd_workbook_bytes()
        bd_rows = extract_lib.load_bd_tracker_rows(io.BytesIO(raw))
        bdcalls_rows = extract_lib.load_bd_daily_log_rows(io.BytesIO(raw))
    except Exception as e:
        _bd_sync_state['last_error'] = str(e)
        return
    updated_at = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
    db = get_db()
    for key, rows in (('bd', bd_rows), ('bdcalls', bdcalls_rows)):
        db.execute(
            'INSERT INTO datasets (key, json_data, row_count, updated_at) VALUES (?, ?, ?, ?) '
            'ON CONFLICT(key) DO UPDATE SET json_data=excluded.json_data, '
            'row_count=excluded.row_count, updated_at=excluded.updated_at',
            (key, json.dumps(rows, ensure_ascii=False), len(rows), updated_at)
        )
    db.commit()
    _bd_sync_state['last_success'] = updated_at
    _bd_sync_state['last_error'] = None


def _status():
    db = get_db()
    rows = db.execute('SELECT key, row_count, updated_at FROM datasets').fetchall()
    return {r[0]: {'rows': r[1], 'updated_at': r[2]} for r in rows}


# ---------- Public read API (used by the GitHub Pages dashboard) ----------

@app.route('/api/data', methods=['GET', 'OPTIONS'])
def api_data():
    if request.method == 'OPTIONS':
        return cors(Response(status=204))
    sync_bd_from_google()
    db = get_db()
    rows = db.execute('SELECT key, json_data, row_count, updated_at FROM datasets').fetchall()
    by_key = {r[0]: r for r in rows}
    out = {'meta': {}}
    for key in SOURCES:
        if key in by_key:
            _, json_data, row_count, updated_at = by_key[key]
            out[key] = json.loads(json_data)
            out['meta'][f'{key}Rows'] = row_count
            out['meta']['generated'] = updated_at
        else:
            out[key] = []
            out['meta'][f'{key}Rows'] = 0
    return jsonify(out)


@app.route('/api/meta', methods=['GET'])
def api_meta():
    db = get_db()
    rows = db.execute('SELECT key, row_count, updated_at FROM datasets').fetchall()
    return jsonify({r[0]: {'rows': r[1], 'updated_at': r[2]} for r in rows})


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


# ---------- Upload (password-protected) ----------

@app.route('/upload', methods=['GET'])
def upload_form():
    return render_template('upload.html', status=_status(), sources=SOURCES, bd_sync=_bd_sync_state)


def _bytes(file_storage):
    # werkzeug wraps uploads in a SpooledTemporaryFile, which on Python < 3.11
    # lacks .seekable() that openpyxl/zipfile requires. Read into BytesIO instead.
    # seek(0) first since 'bdcalls' shares its form field with 'bd' (both read
    # the same uploaded BD Accountability Tracker file) -- without it, the
    # second SOURCE_CONFIGS entry to read this field would get an
    # already-exhausted stream and silently extract nothing.
    file_storage.stream.seek(0)
    return io.BytesIO(file_storage.read())


@app.route('/upload', methods=['POST'])
def upload_submit():
    password = request.form.get('password', '')
    if not UPLOAD_PASSWORD or password != UPLOAD_PASSWORD:
        return render_template('upload.html', error='Incorrect password.',
                                status={}, sources=SOURCES, bd_sync=_bd_sync_state), 403

    t0 = time.time()
    results = {}
    errors = []
    warnings = []

    for cfg in SOURCE_CONFIGS:
        file = request.files.get(cfg['form_field'])
        if not file or not file.filename:
            if cfg['required']:
                errors.append(f"{cfg['human_label']} file is required.")
            continue
        try:
            buf = _bytes(file)
            check = FILE_SIZE_CHECKS.get(cfg['key'])
            if check:
                size_mb = buf.getbuffer().nbytes / (1024 * 1024)
                if check['min_mb'] is not None and size_mb < check['min_mb']:
                    warnings.append(
                        f"{cfg['human_label']} file is {size_mb:.1f}MB — smaller than the usual "
                        f"{check['min_mb']}MB+, please double-check it's the complete export."
                    )
                if check['max_mb'] is not None and size_mb > check['max_mb']:
                    warnings.append(
                        f"{cfg['human_label']} file is {size_mb:.1f}MB — larger than the usual "
                        f"{check['max_mb']}MB, please double-check it's the right file."
                    )
            results[cfg['key']] = cfg['loader'](buf, **cfg['loader_kwargs'])
        except Exception as e:
            errors.append(f"{cfg['human_label']}: {e}")

    # Store every source that parsed successfully even if a different source
    # in the same submission failed or was missing -- one bad/missing file
    # must never discard data for a file that parsed fine. Each source fully
    # replaces its own previous row (INSERT ... ON CONFLICT DO UPDATE keyed
    # on `key`), so re-uploading the same source always overwrites in full,
    # never appends alongside stale rows.
    now = datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')
    db = get_db()
    for key, rows in results.items():
        db.execute(
            'INSERT INTO datasets (key, json_data, row_count, updated_at) VALUES (?, ?, ?, ?) '
            'ON CONFLICT(key) DO UPDATE SET json_data=excluded.json_data, '
            'row_count=excluded.row_count, updated_at=excluded.updated_at',
            (key, json.dumps(rows, ensure_ascii=False), len(rows), now)
        )
    db.commit()

    elapsed = time.time() - t0
    summary = ', '.join(f'{k}: {len(v)} rows' for k, v in results.items()) or 'nothing to store'
    status = _status()
    warning = ' '.join(warnings) or None

    if errors and results:
        msg = f'Processed in {elapsed:.1f}s — {summary}. Some files failed: ' + '; '.join(errors)
        return render_template('upload.html', success=msg, warning=warning, status=status, sources=SOURCES, bd_sync=_bd_sync_state)
    if errors:
        return render_template('upload.html', error='; '.join(errors), warning=warning, status=status, sources=SOURCES, bd_sync=_bd_sync_state), 400
    return render_template('upload.html', success=f'Processed in {elapsed:.1f}s — {summary}', warning=warning,
                            status=status, sources=SOURCES, bd_sync=_bd_sync_state)


@app.route('/sync-bd', methods=['POST'])
def sync_bd_now():
    # Manual/on-demand trigger for the live Google Sheets pull above --
    # bypasses the throttle (force=True) so an admin gets an immediate result
    # after e.g. fixing the service account credentials.
    password = request.form.get('password', '')
    if not UPLOAD_PASSWORD or password != UPLOAD_PASSWORD:
        return render_template('upload.html', error='Incorrect password.',
                                status=_status(), sources=SOURCES, bd_sync=_bd_sync_state), 403

    sync_bd_from_google(force=True)
    status = _status()
    if _bd_sync_state['last_error']:
        return render_template('upload.html', error=f"BD Google Sheet sync failed: {_bd_sync_state['last_error']}",
                                status=status, sources=SOURCES, bd_sync=_bd_sync_state)
    return render_template('upload.html', success='BD Accountability Tracker synced from Google Sheets.',
                            status=status, sources=SOURCES, bd_sync=_bd_sync_state)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
