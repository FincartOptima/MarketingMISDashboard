// app-dateutils.js — Date parsing and month-key helpers.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// Every date in this dashboard belongs to a lead created in the business's
// operating lifetime, so anything outside this window is a parse artifact
// (a stray Excel serial, a misread two-digit year) rather than real data.
const DATE_MIN_YEAR = 2000;
const DATE_MAX_YEAR = 2099;

const FULL_MONTHS = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Values that legitimately mean "no date" rather than "bad date" — the
// source systems use all three interchangeably for an empty cell.
const BLANK_DATE_VALUES = new Set(['', 'N/A']);
const isBlankDate = v => v == null || BLANK_DATE_VALUES.has(String(v).trim().toUpperCase());

/** A Date is only trusted if it parsed AND lands in the plausible window. */
function validDateOrNull(d){
  if(!(d instanceof Date) || isNaN(d)) return null;
  const yr = d.getFullYear();
  return (yr >= DATE_MIN_YEAR && yr <= DATE_MAX_YEAR) ? d : null;
}

// ---- guard: unparseable dates ----
// A date that fails to parse becomes 'N/A' and silently drops the lead out
// of every month-based aggregation — quiet wrongness that's hard to notice
// and expensive to chase.
//
// Two things keep this guard from crying wolf, which would be worse than
// having no guard at all:
//
// 1. Blank/'N/A' inputs are never recorded. They legitimately mean "no
//    date" (a lead that never went in-process has no leadInProcessDate).
// 2. Failures are split by whether the value even *looked* like a date.
//    Some callers deliberately probe non-date columns — detectMonths()
//    runs the revenue file's "OLD CHECK" column through here and filters
//    the misses with isValidMonth(). That produces ~1,300 benign misses
//    ("FY2025-2026", "NEW") which would bury the handful that matter.
//    Only `malformed` — date-shaped but unparseable — warrants review.
const _dateParseFailures = { malformed: new Map(), notADate: new Map() };

// A day/month/year triple with separators, or a month name followed by
// digits. Deliberately loose: the job is only to tell "meant to be a date"
// from "never was one".
const DATE_SHAPED = /\d{1,4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,4}/;
const MONTH_NAME_SHAPED = new RegExp(`^(${FULL_MONTHS.join('|')}|${MONTHS_3.join('|')})\\b.*\\d`, 'i');

function recordDateParseFailure(value){
  const text = String(value).trim();
  const bucket = (DATE_SHAPED.test(text) || MONTH_NAME_SHAPED.test(text))
    ? _dateParseFailures.malformed
    : _dateParseFailures.notADate;
  const key = text.slice(0, 120);
  bucket.set(key, (bucket.get(key) || 0) + 1);
}

const summarizeFailures = bucket => {
  const entries = [...bucket.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: entries.reduce((sum, [, count]) => sum + count, 0),
    distinct: entries.length,
    samples: entries.slice(0, 10).map(([value, count]) => ({ value, count })),
  };
};

/**
 * Date values that failed to parse, split by whether they looked like dates.
 *
 * `malformed` is the actionable half — values that were meant to be dates
 * and weren't understood, meaning those rows silently vanished from
 * month-based aggregations. `notADate` is informational only.
 *
 * @returns {{malformed:Object, notADate:Object, needsReview:boolean}}
 */
function dateParseIssues(){
  const malformed = summarizeFailures(_dateParseFailures.malformed);
  return {
    malformed,
    notADate: summarizeFailures(_dateParseFailures.notADate),
    needsReview: malformed.total > 0,
  };
}

/**
 * Plain-language description of any date problems found, for display.
 * @returns {{headline:string, detail:string, fix:string}|null} null when clean.
 */
function dateParseIssueReport(){
  const { malformed } = dateParseIssues();
  if(!malformed.total) return null;
  const worst = malformed.samples.map(s => `"${s.value}" (${s.count}x)`).join(', ');
  return {
    headline: `${malformed.total} date value(s) could not be read`,
    detail: `${malformed.distinct} distinct value(s) look like dates but could not be parsed, ` +
            `so those rows are missing from every month-based total. Most common: ${worst}.`,
    fix: 'Open the source export and correct these cells to a real date ' +
         '(YYYY-MM-DD or DD-MM-YYYY), then re-sync. Years outside 2000–2099 are rejected on purpose.',
  };
}

// ---- date parsing ----

/**
 * Parse the several date shapes the upstream exports emit into a Date.
 * @param {string|number|Date|null} v Raw cell value.
 * @returns {Date|null} null for blanks, out-of-range years, and unparseable input.
 */
function parseDateAny(v){
  if(v == null || v === '' || v === 'N/A') return null;
  if(v instanceof Date) return validDateOrNull(v);

  // Excel serial date — days since the 1900 epoch (with Excel's leap-year bug
  // baked into the 1899-12-30 offset).
  if(typeof v === 'number') return validDateOrNull(new Date(Date.UTC(1899, 11, 30) + v * 86400000));

  if(typeof v !== 'string') return null;
  const s = v.trim();
  if(!s || s.toUpperCase() === 'N/A') return null;

  // Explicit patterns first: both are ambiguous to Date's own parser, which
  // would read DD-MM-YYYY as a US month-first date and silently shift it.
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if(dmy) return validDateOrNull(new Date(+dmy[3], +dmy[2] - 1, +dmy[1]));

  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(ymd) return validDateOrNull(new Date(+ymd[1], +ymd[2] - 1, +ymd[3]));

  // Fall back to native parsing. Only the first space becomes 'T' so
  // "2026-08-14 10:00:00" is read as local time, not UTC.
  return validDateOrNull(new Date(s.replace(' ', 'T')));
}

/**
 * Canonical "Mmm-YYYY" month label for any date-ish value.
 * @returns {string} 'N/A' when the value is blank or unparseable.
 */
const toMmmYyyy = v => {
  const normalized = normalizeMonthLabel(v);
  if(normalized) return normalized;
  const d = parseDateAny(v);
  if(d) return `${MONTHS_3[d.getMonth()]}-${d.getFullYear()}`;
  if(!isBlankDate(v)) recordDateParseFailure(v);
  return 'N/A';
};

/** @returns {string} 'YYYY-MM-DD', or '' when unparseable. */
const toIsoDate = v => {
  const d = parseDateAny(v);
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '';
};

/**
 * Sortable integer for a month label: YYYY*100 + month index.
 * @returns {number} -1 when the label is unparseable, which sorts it first.
 */
const monthKey = mmm => {
  const normalized = normalizeMonthLabel(mmm);
  if(!normalized) return -1;
  const [mon, yr] = normalized.split('-');
  return +yr * 100 + MONTHS_3.indexOf(mon);
};

const sortMonths = arr => arr.filter(m => m && m !== 'N/A').sort((a, b) => monthKey(a) - monthKey(b));

/** First of `names` present and non-empty on `row`, else ''. */
const pickField = (row, ...names) => {
  for(const name of names){
    if(row[name] != null && row[name] !== '') return row[name];
  }
  return '';
};

/**
 * Normalize the month spellings the exports use ("Aug-26", "August 2026",
 * "2026-08-01", a Date) to canonical "Mmm-YYYY".
 * @returns {string} '' when the value isn't a recognizable month.
 */
function normalizeMonthLabel(v){
  if(v == null || v === '' || v === 'N/A') return '';
  if(v instanceof Date){
    const d = validDateOrNull(v);
    return d ? `${MONTHS_3[d.getMonth()]}-${d.getFullYear()}` : '';
  }
  const s = String(v).trim();

  // "Aug-2026" / "Aug-26"
  const abbr = s.match(/^([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if(abbr){
    const mon = abbr[1][0].toUpperCase() + abbr[1].slice(1, 3).toLowerCase();
    const yr = abbr[2].length === 2 ? `20${abbr[2]}` : abbr[2];
    if(+yr < DATE_MIN_YEAR || +yr > DATE_MAX_YEAR) return '';
    return MONTHS_3.includes(mon) ? `${mon}-${yr}` : '';
  }

  // "April 2026" / "April-2026"
  const full = s.match(/^([A-Za-z]+)[- ,]+(\d{4})$/);
  if(full){
    const idx = FULL_MONTHS.findIndex(n => n.toLowerCase() === full[1].toLowerCase());
    if(idx >= 0 && +full[2] >= DATE_MIN_YEAR && +full[2] <= DATE_MAX_YEAR) return `${MONTHS_3[idx]}-${full[2]}`;
  }

  const d = parseDateAny(v);
  return d ? `${MONTHS_3[d.getMonth()]}-${d.getFullYear()}` : '';
}

// ---- which month column a status is measured by ----
// Three callers want the same CONVERTED→CM / IN PROCESS→LPM rule but
// disagree on the fallback for every other status, so the rule lives once
// and each caller supplies its own default.
const statusMonthColumn = (status, fallback) =>
  status === 'CONVERTED' ? 'CM' : status === 'IN PROCESS' ? 'LPM' : fallback;

const statusMonthCol = status => statusMonthColumn(status, 'CTM');
const dashboardStatusMonthCol = status => statusMonthColumn(status, 'FMONTH');
const anyMonthCol = status => statusMonthColumn(status, 'CTM');

// Whether a lead should be counted as CONVERTED. Per business rule (2026-07-29),
// presence of a Converted Month (CM) is definitive — leadStatus is ignored. A
// lead with CM='May-2026' but leadStatus='FOLLOW UP' still counts as converted
// for May-2026. `monthMatchFn` is the caller's month predicate (monthFilter,
// rmPerfMonthMatch, etc.); omit to count all CM-present leads regardless of month.
function isConvertedLead(row, monthMatchFn){
  const cm = row.CM;
  if(!cm || cm === 'N/A') return false;
  return monthMatchFn ? monthMatchFn(cm) : true;
}
