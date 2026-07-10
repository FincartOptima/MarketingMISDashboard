# -*- coding: utf-8 -*-
# Marketing MIS backend: accepts the 5 source xlsx files over a password-protected
# upload form, parses them with extract_lib (same logic as the local extract.py),
# and stores the result in SQLite on disk. The dashboard (hosted separately on
# GitHub Pages) reads GET /api/data instead of a static data.js file — same
# JSON shape, so app.js's calculation logic is untouched.
import io
import json
import os
import sqlite3
import time
from datetime import datetime

from flask import Flask, g, jsonify, render_template, request, Response

import extract_lib

app = Flask(__name__)

DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'marketing.db')
DB_PATH = os.environ.get('DB_PATH', DEFAULT_DB_PATH)
UPLOAD_PASSWORD = os.environ.get('UPLOAD_PASSWORD', '')
MAX_CONTENT_LENGTH = 200 * 1024 * 1024  # 200MB combined upload cap
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

SOURCES = ['fin23', 'rev', 'b2b', 'fy', 'pa']


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


# ---------- Public read API (used by the GitHub Pages dashboard) ----------

@app.route('/api/data', methods=['GET', 'OPTIONS'])
def api_data():
    if request.method == 'OPTIONS':
        return cors(Response(status=204))
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
    db = get_db()
    rows = db.execute('SELECT key, row_count, updated_at FROM datasets').fetchall()
    status = {r[0]: {'rows': r[1], 'updated_at': r[2]} for r in rows}
    return render_template('upload.html', status=status, sources=SOURCES)


def _bytes(file_storage):
    # werkzeug wraps uploads in a SpooledTemporaryFile, which on Python < 3.11
    # lacks .seekable() that openpyxl/zipfile requires. Read into BytesIO instead.
    return io.BytesIO(file_storage.read())


@app.route('/upload', methods=['POST'])
def upload_submit():
    password = request.form.get('password', '')
    if not UPLOAD_PASSWORD or password != UPLOAD_PASSWORD:
        return render_template('upload.html', error='Incorrect password.',
                                status={}, sources=SOURCES), 403

    t0 = time.time()
    results = {}
    errors = []

    fin23_file = request.files.get('fin23')
    if not fin23_file or not fin23_file.filename:
        return render_template('upload.html', error='B2C (FIN23) file is required.',
                                status={}, sources=SOURCES), 400

    try:
        results['fin23'] = extract_lib.load_sheet_rows(
            _bytes(fin23_file), sheet_names=['RAW_DATA', 'RawData'],
            column_allowlist=extract_lib.FIN23_COLUMNS)
    except Exception as e:
        errors.append(f'B2C (FIN23): {e}')

    rev_file = request.files.get('rev')
    if rev_file and rev_file.filename:
        try:
            results['rev'] = extract_lib.load_revenue_input_rows(_bytes(rev_file))
        except Exception as e:
            errors.append(f'Revenue Input: {e}')

    b2b_file = request.files.get('b2b')
    if b2b_file and b2b_file.filename:
        try:
            results['b2b'] = extract_lib.load_sheet_rows(_bytes(b2b_file))
        except Exception as e:
            errors.append(f'B2B: {e}')

    fy_file = request.files.get('fy')
    if fy_file and fy_file.filename:
        try:
            results['fy'] = extract_lib.load_sheet_rows(_bytes(fy_file))
        except Exception as e:
            errors.append(f'FY2026: {e}')

    pa_file = request.files.get('pa')
    if pa_file and pa_file.filename:
        try:
            results['pa'] = extract_lib.load_sheet_rows(_bytes(pa_file))
        except Exception as e:
            errors.append(f'Plan Approval: {e}')

    if errors:
        return render_template('upload.html', error='; '.join(errors),
                                status={}, sources=SOURCES), 400

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
    summary = ', '.join(f'{k}: {len(v)} rows' for k, v in results.items())
    rows = db.execute('SELECT key, row_count, updated_at FROM datasets').fetchall()
    status = {r[0]: {'rows': r[1], 'updated_at': r[2]} for r in rows}
    return render_template('upload.html', success=f'Processed in {elapsed:.1f}s — {summary}',
                            status=status, sources=SOURCES)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
