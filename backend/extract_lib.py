# -*- coding: utf-8 -*-
# Shared xlsx-parsing logic used by both the local extract.py CLI and the
# Fly.io upload endpoint (app.py). Kept dependency-free (just openpyxl) so it
# can run in either place unchanged.
from datetime import datetime
import openpyxl

# B2C/FIN23 exports often carry 40+ columns (call logs, UTM tags, health scores, etc.)
# but app.js's buildRawData() only ever reads these. Dropping the rest keeps the
# payload small.
FIN23_COLUMNS = {
    'currentrmname', 'current rm name', 'rm', 'curren rm',
    'createddate', 'created date',
    'laststatusdate', 'last status date',
    'leadinprocessdate', 'leadprocessdate', 'lead in process date',
    'converteddate', 'converted date',
    'ctm', 'created month',
    'lpm', 'leadprocessmonth',
    'cm', 'converted month', 'convertedmonth',
    'fmonth',
    'team',
    'clientname', 'client name',
    'landingpage', 'landing page',
    'platformname', 'platform name',
    'campaign name', 'categoryname', 'campaignname', 'category name',
    'userid', 'user id',
    'leadhead', 'lead head',
    'leadstatus', 'lead status',
    'firstrmname', 'first rm name',
    'convertedbyname', 'converted by name',
    'annualincome', 'annual income',
    'clientcategory', 'client category',
}


def cell_value(v):
    """Mirror what SheetJS (raw:true, no cellDates) hands to app.js:
    strings/numbers pass through, datetimes become ISO strings, blanks become ''."""
    if v is None:
        return ''
    if isinstance(v, datetime):
        return v.strftime('%Y-%m-%d %H:%M:%S')
    return v


def header_text(h):
    return '' if h is None else str(h).strip()


def rows_from_header_row(all_rows, header_idx, column_allowlist=None):
    headers = [header_text(h) for h in all_rows[header_idx]]
    if column_allowlist is not None:
        headers = [h if h.lower() in column_allowlist else '' for h in headers]
    out = []
    for row in all_rows[header_idx + 1:]:
        obj = {}
        any_val = False
        for c, h in enumerate(headers):
            if not h:
                continue
            v = row[c] if c < len(row) else None
            v = cell_value(v)
            obj[h] = v
            if v != '':
                any_val = True
        if any_val:
            out.append(obj)
    return out


def find_sheet(wb, *names):
    lower_targets = [n.lower() for n in names]
    for name in wb.sheetnames:
        if name.lower() in lower_targets:
            return name
    return wb.sheetnames[0]


def load_sheet_rows(file_like, sheet_names=None, column_allowlist=None):
    """file_like: a path string OR a file-like object (e.g. an uploaded file stream)."""
    wb = openpyxl.load_workbook(file_like, read_only=True, data_only=True)
    sheet_name = find_sheet(wb, *sheet_names) if sheet_names else wb.sheetnames[0]
    ws = wb[sheet_name]
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not all_rows:
        return []
    return rows_from_header_row(all_rows, 0, column_allowlist=column_allowlist)


def load_revenue_input_rows(file_like):
    """Scan the first 5 rows for a header row containing 'clientname', 'rm',
    and 'total' (lowercased exact match) — same detection the old in-browser
    parseRevenueInput() used."""
    wb = openpyxl.load_workbook(file_like, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not all_rows:
        return []
    header_idx = 0
    for i in range(min(len(all_rows), 5)):
        lowered = [header_text(c).lower() for c in all_rows[i]]
        if 'clientname' in lowered and 'rm' in lowered and 'total' in lowered:
            header_idx = i
            break
    return rows_from_header_row(all_rows, header_idx)
