// app-config.js — Central CONFIG object, backward-compat aliases, DOM/format helpers.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

/* Marketing MIS Web Dashboard
   Uploads:  FIN23 raw + Revenue Input
   Team map: EMPLOYEE_REF (bundled snapshot, editable, persisted in localStorage)
   Months:   detected dynamically from RAW_DATA — Dashboard/MTD/Processed/Cost auto-extend.
*/

// Centralized configuration: business-rule constants, external endpoints, and
// reference data used across the file. A few large/positional entries
// (CONFIG.TABLE_INFO) are filled in further down, right where the rest of
// their section lives, but always onto this same object.
const CONFIG = {
  MONTHS_3: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  STATUSES: ['CONVERTED','IN PROCESS','ASSIGNED','RE-ASSIGNED','FOLLOW UP','ON HOLD','DEAD'],
  FIXED_TEAMS: ['Akanksha','Ankit S','Anmol G','Ratan P','Ravi S','Vidhi','Vivek S','Yash T','Ambika','DIY Team','SV'],
  RAW_COLUMNS: ['currentRmName','Team','clientName','landingPage','platformName','Campaign Name','userId','createdDate','CTM','lastStatusDate','LSM','leadInProcessDate','LPM','leadHead','leadStatus','convertedDate','CM','firstRmName','Team of FirstRM','convertedByName','annualIncome','clientCategory','FMONTH'],
  B2B_RAW_COLUMNS: ['name','email','phone','companyName','companyEmail','leadHead','currentRmName','firstRmName','createdDate','CreateMonth','brokerName','brokerEmail','leadStatus','platformName','categoryName','landingPage','enquiryType'],
  // Canonical "Current Stage" set the backend's load_bd_tracker_rows() normalizes
  // onto — see BD_STAGE_MAP in backend/extract_lib.py for the raw-value mapping.
  BD_STAGES: ['LEAD ASSIGNED','IN FOLLOW-UP','IN PROCESS','CONVERTED','ON HOLD/DEAD','DROPPED','TAX FILING DONE'],
  // Google Form (Name + Suggestion) linked to a Google Sheet.
  FEEDBACK_FORM_URL: 'https://docs.google.com/forms/d/e/1FAIpQLSeee0xpyNQvoG2ULnAR0xPbG23wwcmhERKCMwKT6dw8dWp4eA/viewform?usp=publish-editor',
  DATA_API_URL: 'https://fincart.pythonanywhere.com/api/data',
  PREMIUM_TABS: ['rmperf', 'rmrev'],
  PREMIUM_PASSWORD: 'Password',
  FILE_LABELS: {
    fin23: 'FIN23 Lead Management file (B2C.xlsx)',
    rev:   'Revenue Input file (Revenue Input.xlsx)',
    b2b:   'B2B Corporate Lead file (B2B.xlsx)',
    fy:    'FY2026 file (FY2026.xlsx)',
    pa:    'Plan Approval file (Plan Approval.xlsx)',
    bd:    'BD Accountability Tracker file (BD Accountability Tracker.xlsx)',
  },
  // The FY start month business rule — the one genuinely "hardcoded" value
  // in this block, kept most discoverable since it changes once a year.
  FY_CUTOFF_MONTH: 'Apr-2026',
  // Default Google Sheets CSV export URL for Cost Per Campaign — used so that
  // *every* visitor gets live cost data, not just the person who set gsUrl in
  // their own Settings. Overridden by per-user gsUrl in localStorage settings
  // when present. Requires the sheet to be shared as "Anyone with the link
  // → Viewer" (this is how the /export?format=csv endpoint stays fetchable
  // without auth). Regenerate this URL from any sheet by replacing the
  // spreadsheet ID between /d/ and /edit.
  DEFAULT_GS_URL: 'https://docs.google.com/spreadsheets/d/1thf21bXFL6I3iNyQElwycHg6uzFGUMAXaYbqcjD57Lg/export?format=csv&gid=0',
  STORAGE_KEYS: {
    EMPREF: 'empref_override',
    RM_MASTER: 'rmmaster_override',
    COST: 'cpc_override',
    SETTINGS: 'mis_settings_v1',
  },
};

const MONTHS_3 = CONFIG.MONTHS_3;
const STATUSES = CONFIG.STATUSES;
const FIXED_TEAMS = CONFIG.FIXED_TEAMS;
const RAW_COLUMNS = CONFIG.RAW_COLUMNS;
const B2B_RAW_COLUMNS = CONFIG.B2B_RAW_COLUMNS;
const BD_STAGES = CONFIG.BD_STAGES;
const FEEDBACK_FORM_URL = CONFIG.FEEDBACK_FORM_URL;
const DATA_API_URL = CONFIG.DATA_API_URL;
const PREMIUM_TABS = CONFIG.PREMIUM_TABS;
const PREMIUM_PASSWORD = CONFIG.PREMIUM_PASSWORD;
const FILE_LABELS = CONFIG.FILE_LABELS;

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const pad2  = n => String(n).padStart(2,'0');
const fmtIN = n => (n==null||isNaN(n))?'':Number(n).toLocaleString('en-IN');
const fmtINR= n => (n==null||isNaN(n))?'₹0':'₹'+Math.round(n).toLocaleString('en-IN');
const fmtPct= n => (n==null||isNaN(n))?'0%':(n*100).toFixed(2)+'%';
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

