# -*- coding: utf-8 -*-
# Shared xlsx-parsing logic used by both the local extract.py CLI and the
# Fly.io upload endpoint (app.py). Kept dependency-free (just openpyxl) so it
# can run in either place unchanged.
from datetime import datetime
import datetime as _dt
import re
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
    # Not JSON-serialisable as-is.
    if isinstance(v, _dt.date):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, _dt.time):
        return v.strftime('%H:%M:%S')
    if isinstance(v, _dt.timedelta):
        return str(v)
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


def read_all_rows(ws):
    """Every row of a read-only worksheet (its declared <dimension> can be stale and truncate the read)."""
    if hasattr(ws, 'reset_dimensions'):
        ws.reset_dimensions()
    return list(ws.iter_rows(values_only=True))


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
    all_rows = read_all_rows(ws)
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
    all_rows = read_all_rows(ws)
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


# ---------- FIN23 integrity checks ----------
# Columns the dashboard cannot work without, with the header spellings the
# FIN23 export is known to use. A file missing one of these would load "fine"
# and then silently blank or zero an entire dashboard section, so it is
# rejected up front instead of replacing the last good dataset.
FIN23_REQUIRED = {
    'Current RM':          ('currentrmname', 'current rm name', 'rm', 'curren rm'),
    'First RM':            ('firstrmname', 'first rm name'),
    'Created Date':        ('createddate', 'created date'),
    'Lead Status':         ('leadstatus', 'lead status'),
    'Converted Date':      ('converteddate', 'converted date'),
    'Lead In Process Date': ('leadinprocessdate', 'leadprocessdate', 'lead in process date'),
    'Lead Head':           ('leadhead', 'lead head'),
    'User ID':             ('userid', 'user id'),
    'Category / Campaign': ('campaign name', 'categoryname', 'campaignname', 'category name'),
}
FIN23_KNOWN_STATUSES = {'CONVERTED', 'IN PROCESS', 'ASSIGNED', 'RE-ASSIGNED', 'FOLLOW UP', 'ON HOLD', 'DEAD'}


def _field(row, aliases):
    lowered = {str(k).strip().lower(): v for k, v in row.items()}
    for a in aliases:
        v = lowered.get(a)
        if v not in (None, ''):
            return v
    return ''


def fin23_missing_columns(rows):
    """Labels of required FIN23 columns that no row carries a header for."""
    if not rows:
        return list(FIN23_REQUIRED)
    present = {str(k).strip().lower() for k in rows[0].keys()}
    return [label for label, aliases in FIN23_REQUIRED.items() if not present.intersection(aliases)]


def fin23_quality_warnings(rows):
    """Non-blocking data-quality findings, as human-readable sentences."""
    out = []
    if not rows:
        return out
    unknown = {}
    ip_no_date = cv_no_date = no_created = dup = 0
    seen = set()
    for r in rows:
        status = ' '.join(str(_field(r, FIN23_REQUIRED['Lead Status'])).upper().split())
        if status not in FIN23_KNOWN_STATUSES:
            unknown[status or '(blank)'] = unknown.get(status or '(blank)', 0) + 1
        ip = str(_field(r, FIN23_REQUIRED['Lead In Process Date'])).strip().upper()
        cv = str(_field(r, FIN23_REQUIRED['Converted Date'])).strip().upper()
        if status == 'IN PROCESS' and ip in ('', 'N/A'):
            ip_no_date += 1
        if status == 'CONVERTED' and cv in ('', 'N/A'):
            cv_no_date += 1
        if not _field(r, FIN23_REQUIRED['Created Date']):
            no_created += 1
        uid = str(_field(r, FIN23_REQUIRED['User ID'])).strip().lower()
        key = (uid, str(_field(r, FIN23_REQUIRED['Lead Head'])).strip().lower())
        if uid:
            if key in seen:
                dup += 1
            seen.add(key)
    if unknown:
        top = ', '.join(f'"{k}" ({v})' for k, v in sorted(unknown.items(), key=lambda kv: -kv[1])[:5])
        out.append(f'{sum(unknown.values())} lead(s) have a status the dashboard does not recognise: {top}.')
    if ip_no_date:
        out.append(f'{ip_no_date} IN PROCESS lead(s) have no in-process date.')
    if cv_no_date:
        out.append(f'{cv_no_date} CONVERTED lead(s) have no converted date.')
    if no_created:
        out.append(f'{no_created} lead(s) have no created date.')
    if dup:
        out.append(f'{dup} row(s) repeat a client (same email and Lead Head) already in the file.')
    return out


# ---------- BD Accountability Tracker ----------
# Each BD rep's leads live in a sheet literally named "<Person> Q<N>" (e.g.
# "Himani Q1"). New quarters/reps are picked up automatically by this naming
# pattern alone — no code change needed when "Himani Q3" is added later.
# Every other sheet in the workbook (dashboards, logs, pivot tables) is
# ignored since it won't match.
BD_SHEET_PATTERN = re.compile(r'^(.+?)\s+Q(\d+)$', re.IGNORECASE)

# dateAssigned/email/gmeetJoined/currentStage are read from the tracker.
# RM/Team come from the matching B2C record instead (see
# annotateBDWithB2CMatch in app-state.js) since that's the CRM's live
# ownership, not what the tracker originally logged; Financial Plan Created
# isn't tracked at all. dateAssigned is also the Month fallback for leads
# that don't match a B2C record. currentStage is kept as the BD Team's own
# self-reported progress — shown separately from the B2C-derived Stage (see
# the Workpoint Status / BD Team Status toggle on the dashboard) since the
# two can disagree once a lead is reassigned after the BD rep logged it.
# assignedRm / teamLeader are who the BD rep handed the lead to. They don't
# drive the RM/Team breakdown (CRM ownership does); they feed the "Assigned by
# BD" and "Mapped to CRM" columns.
# Source headers are inconsistent across sheets (trailing spaces, casing) —
# matched case/space-insensitively.
BD_TRACKER_COLUMNS = {
    'dateAssigned': {'date assigned'},
    'email':        {'email'},
    'gmeetJoined':  {'gmeet joined?'},
    'currentStage': {'current stage'},
    'assignedRm':   {'assigned rm'},
    'teamLeader':   {'team leader'},
}
# Only these decide whether a row is a real lead: Assigned RM / Team Leader can
# be pre-filled on otherwise empty rows.
BD_ROW_DEFINING = {'dateAssigned', 'email', 'gmeetJoined', 'currentStage'}

# "Current Stage" free-text values seen in the wild, collapsed onto one
# canonical label per real-world stage. Unrecognized non-blank values pass
# through upper-cased rather than being silently dropped.
BD_STAGE_MAP = {
    'lead assigned': 'LEAD ASSIGNED', 'assign': 'LEAD ASSIGNED',
    'in follow-up': 'IN FOLLOW-UP', 'follow up': 'IN FOLLOW-UP',
    'in process': 'IN PROCESS',
    'dropped': 'DROPPED',
    'onhold/dead': 'ON HOLD/DEAD',
    'converted': 'CONVERTED',
    'tax filling done': 'TAX FILING DONE',
}

def normalize_bd_stage(v):
    s = header_text(v).strip().lower()
    if not s:
        return ''
    return BD_STAGE_MAP.get(s, header_text(v).strip().upper())

# GMeet Joined? collapses onto a 3-state Yes/No/Pending.
BD_YNP_MAP = {
    'yes': 'Yes', 'joined': 'Yes',
    'no': 'No', 'not joined': 'No',
    'pending': 'Pending',
}

def normalize_bd_ynp(v):
    s = header_text(v).strip().lower()
    return BD_YNP_MAP.get(s, '')


def load_bd_tracker_rows(file_like):
    wb = openpyxl.load_workbook(file_like, read_only=True, data_only=True)
    out = []
    for sheet_name in wb.sheetnames:
        m = BD_SHEET_PATTERN.match(sheet_name.strip())
        if not m:
            continue
        person, quarter_num = m.group(1).strip(), m.group(2)
        ws = wb[sheet_name]
        all_rows = read_all_rows(ws)
        if not all_rows:
            continue
        headers = [header_text(h) for h in all_rows[0]]
        col_for_idx = {}
        for i, h in enumerate(headers):
            key = h.strip().lower()
            for canon, variants in BD_TRACKER_COLUMNS.items():
                if key in variants:
                    col_for_idx[i] = canon
                    break
        for row_no, row in enumerate(all_rows[1:], start=2):
            obj = {}
            any_val = False
            for i, canon in col_for_idx.items():
                v = row[i] if i < len(row) else None
                if canon == 'gmeetJoined':
                    v = normalize_bd_ynp(v)
                elif canon == 'currentStage':
                    v = normalize_bd_stage(v)
                else:
                    v = cell_value(v)
                obj[canon] = v
                if canon in BD_ROW_DEFINING and v not in ('', None):
                    any_val = True
            if not any_val:
                continue
            obj['person'] = person
            obj['quarter'] = 'Q' + quarter_num
            obj['sourceSheet'] = sheet_name
            obj['sourceRow'] = row_no   # row number in that tab (header = 1), for the dashboard's data-health warnings
            out.append(obj)
    wb.close()
    return out


# ---------- BD Daily Log ----------
# A single sheet (literally named "BD Daily Log") in the same workbook as the
# per-person-per-quarter tabs above: one row per BD rep per day of call
# activity. Shares the same uploaded file as the 'bd' source (see SOURCE_CONFIGS
# in app.py) rather than needing its own upload field.
BD_DAILY_LOG_COLUMNS = {
    'date':           {'date'},
    'bdName':         {'bd name'},
    'totalCalls':     {'total calls made'},
    'callsConnected': {'calls connected'},
    'cnp':            {'cnp'},
}

# Stand-in name for a Daily Log row that has a date and calls but no BD Name.
# Mirrors BD2_NO_BD_NAME in app-bd2.js exactly -- keep both in sync.
BD_NO_BD_NAME = '(no BD Name)'

# "Appointments Booked" is split across one column per quarter (Q1..Q4), but
# only the column matching that row's own Quarter is ever populated -- verified
# across the real file: every row has its appointment count in exactly its own
# quarter's column and zero/blank in the other three. So the row's total
# appointments booked is simply the sum of all four, no quarter logic needed.
BD_APPOINTMENT_HEADER = re.compile(r'^appointments?\s+booked', re.IGNORECASE)

def load_bd_daily_log_rows(file_like):
    """The real header isn't reliably row 1 -- the source sheet has a stray
    near-blank row above it -- so it's located by content (must contain both
    'date' and 'bd name'), same approach as load_revenue_input_rows. Rows
    with no Date are skipped: the sheet also has scratch rows further down
    (an unlabelled future-quarter placeholder, a hidden grand-total row)
    that carry numbers but no date, which would otherwise be mistaken for
    real daily entries.

    A row WITH a date and call numbers but no BD Name is a real day of calls
    that someone forgot to label. Skipping it silently dropped its calls from
    every total (6-Oct-2026 lost 233 calls, so the dashboard read 233 below
    the sheet), so it is kept under BD_NO_BD_NAME and the dashboard's
    data-health warnings list it for fixing at the source.

    Every row carries `sourceRow`, its row number in the sheet as Google
    Sheets numbers it (the header here is not row 1), so those warnings can
    say where to look."""
    wb = openpyxl.load_workbook(file_like, read_only=True, data_only=True)
    if 'BD Daily Log' not in wb.sheetnames:
        wb.close()
        return []
    ws = wb['BD Daily Log']
    all_rows = read_all_rows(ws)
    wb.close()
    if not all_rows:
        return []

    header_idx = None
    col_for_idx = {}
    appt_idx = []
    for i in range(min(len(all_rows), 5)):
        lowered = [header_text(c).strip().lower() for c in all_rows[i]]
        candidate = {}
        appts = []
        for j, h in enumerate(lowered):
            for canon, variants in BD_DAILY_LOG_COLUMNS.items():
                if h in variants:
                    candidate[j] = canon
            if BD_APPOINTMENT_HEADER.match(h):
                appts.append(j)
        if 'date' in candidate.values() and 'bdName' in candidate.values():
            header_idx = i
            col_for_idx = candidate
            appt_idx = appts
            break
    if header_idx is None:
        return []

    out = []
    for sheet_row, row in enumerate(all_rows[header_idx + 1:], start=header_idx + 2):
        obj = {}
        for i, canon in col_for_idx.items():
            v = row[i] if i < len(row) else None
            obj[canon] = cell_value(v)
        if not obj.get('date'):
            continue
        if not obj.get('bdName'):
            has_calls = any(isinstance(obj.get(k), (int, float)) and obj[k]
                            for k in ('totalCalls', 'callsConnected', 'cnp'))
            if not has_calls:
                continue    # a pre-filled date with nothing against it is not an entry
            obj['bdName'] = BD_NO_BD_NAME
        appts = 0
        for i in appt_idx:
            v = row[i] if i < len(row) else None
            if isinstance(v, (int, float)):
                appts += v
        obj['appointments'] = appts
        obj['sourceRow'] = sheet_row
        out.append(obj)
    return out
