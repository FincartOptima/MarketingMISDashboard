// app-bd2-health.js — data-health warnings and flow checks for the BD Performance tab.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// Two kinds of finding, each saying what is wrong and how to fix it (the {title, detail, fix}
// shape app-health.js uses):
//   data issues  a problem in the Google Sheet, the BD Daily Log or the B2C file. They describe
//                the whole sheet, so no filter hides them.
//   flow checks  the arithmetic of the flow: every split adds up and every table ties back to the
//                flow. Run on the current selection and on the whole sheet. A failed check means
//                the tab is calculating wrongly, not that a sheet needs fixing.
//   error = figures on the tab are missing or wrong now · warn = rows that need fixing · info = worth knowing
// Nothing here changes a figure; every check only reads STATE.

const BD2_LEVEL_RANK = { error: 0, warn: 1, info: 2 };
const BD2_ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
const BD2_NO_FILTERS = { month: 'All', team: 'All', rm: 'All', person: 'All', platform: 'All' };
const BD2_GMEET_VALUES = ['Yes', 'No', 'Pending'];
const BD2_OLD_ENTRY_DAYS = 7;
const BD2_ISSUE_HEADERS = ['Issue', 'BD Rep', 'Google Sheet tab', 'Sheet row', 'Email', 'Date', 'Details', 'What to do'];
const BD2_COUNT_KEYS = ['meetings', 'joined', 'notJoined', 'pending', 'notLogged', 'inProcess', 'converted', 'other', 'unmatched'];
const BD2_COUNT_NAMES = { meetings: 'Meetings Scheduled', joined: 'Meetings Joined', notJoined: 'Not Joined', pending: 'Pending',
  notLogged: 'Not Logged', inProcess: 'In Process', converted: 'Converted', other: 'Other States', unmatched: 'Unmatched' };

// The tracker columns the backend looks for (BD_TRACKER_COLUMNS). A tab where no row carries the
// field is a tab whose column header was not recognised.
const BD2_COLUMNS = [
  ['dateAssigned', 'Date Assigned', n => `None of its ${fmtIN(n)} meetings has a date, so their Month is N/A: no Month filter can select them and they are counted only when Month is All.`],
  ['email', 'Email', n => `None of its ${fmtIN(n)} meetings has an email, so none can be matched to Workpoint: all are Unmatched, with no team, RM, platform or status.`],
  ['gmeetJoined', 'GMeet Joined?', n => `None of its ${fmtIN(n)} meetings has a GMeet status, so all are Not Logged and none counts as joined.`],
];

const bd2Plural = (n, one, many) => n === 1 ? one : (many || one + 's');
const bd2Num = (n, one, many) => `${fmtIN(n)} ${bd2Plural(n, one, many)}`;
const bd2Is = n => n === 1 ? 'is' : 'are';
const bd2Has = n => n === 1 ? 'has' : 'have';
const bd2Day = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const bd2SheetOf = r => r.sourceSheet || r.person || '(unknown sheet)';
const bd2HasField = (r, field) => Object.prototype.hasOwnProperty.call(r, field);
const bd2Sum = (list, key) => list.reduce((a, r) => a + r[key], 0);
const bd2ByRepText = rows => tallyBy(rows, r => r.person || '(no rep)').map(([p, c]) => `${p} ${fmtIN(c)}`).join(' · ');
const bd2Where = rows => rows.some(r => r.sourceRow) ? 'the tab and row number are given' : 'the tab, rep and email are given';
const bd2AnyFilter = () => ['month', 'team', 'rm', 'person', 'platform'].some(k => bd2Sel(STATE.bd2[k]));

// ---- one line per affected row, for the downloads ----
function bd2Line(issue, r, details, todo){
  const raw = r.dateAssigned;
  return { Issue: issue, 'BD Rep': r.person || '', 'Google Sheet tab': r.sourceSheet || '', 'Sheet row': r.sourceRow || '',
    Email: String(r.email == null ? '' : r.email), Date: toIsoDate(raw) || (raw == null ? '' : String(raw)),
    Details: details || '', 'What to do': todo };
}
function bd2LogLine(issue, r, details, todo){
  return { Issue: issue, 'BD Rep': r.bdName || '', 'Google Sheet tab': 'BD Daily Log', 'Sheet row': r.sourceRow || '',
    Email: '', Date: toIsoDate(r.date) || String(r.date == null ? '' : r.date), Details: details || '', 'What to do': todo };
}

// Edit distance between a and b when it is at most `max`, else max + 1. Gives up as soon as a whole
// row of the table is above `max`, which keeps comparing against ~16k emails cheap.
const _bd2EdPrev = new Int32Array(128), _bd2EdCur = new Int32Array(128);
function bd2EditDistance(a, b, max){
  const la = a.length, lb = b.length;
  if(Math.abs(la - lb) > max || lb > 126) return max + 1;
  let prev = _bd2EdPrev, cur = _bd2EdCur;
  for(let j = 0; j <= lb; j++) prev[j] = j;
  for(let i = 1; i <= la; i++){
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for(let j = 1; j <= lb; j++){
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b.charCodeAt(j - 1) ? 0 : 1));
      cur[j] = v;
      if(v < rowMin) rowMin = v;
    }
    if(rowMin > max) return max + 1;
    const t = prev; prev = cur; cur = t;
  }
  return Math.min(prev[lb], max + 1);
}

// For each email not found in B2C: the one B2C email within two edits of it, when there is exactly one.
function bd2NearEmails(emails){
  const byLength = new Map();
  for(const e of Object.keys(buildB2CEmailIndex())){
    if(!byLength.has(e.length)) byLength.set(e.length, []);
    byLength.get(e.length).push(e);
  }
  const found = new Map();
  for(const e of emails){
    if(!e.includes('@')) continue;
    let best = null, bestD = 3, tied = false;
    for(let len = e.length - 2; len <= e.length + 2; len++){
      for(const c of byLength.get(len) || []){
        const d = bd2EditDistance(e, c, 2);
        if(d < bestD){ best = c; bestD = d; tied = false; }
        else if(d === bestD && d < 3) tied = true;
      }
    }
    if(best && !tied) found.set(e, best);
  }
  return found;
}

// ---- data issues ----
function bd2BuildDataIssues(){
  const out = [];
  if(!STATE.filesLoaded.bd) return out;
  const add = (level, id, title, detail, fix, rows) => out.push({ level, id, title, detail, fix, rows: rows || [] });
  const n = fmtIN;
  const rows = STATE.bd;

  // ---- the data behind it ----
  const src = STATE.dataSource || {};
  if(src.fallback){
    add('error', 'fallback', 'Showing the bundled data.js snapshot, not live data',
      `The data API could not be reached (${src.error || 'unknown error'}), so every figure on this tab comes from a snapshot` +
      (src.generated ? ` generated ${src.generated}` : '') + '.',
      'Check the backend /health endpoint, then reload.');
  }
  const haveB2c = STATE.filesLoaded.fin23 && STATE.raw.length > 0;
  if(!haveB2c){
    add('error', 'no-b2c', 'No Workpoint B2C data is loaded',
      'Without it no meeting can be matched, so every meeting shows as Unmatched and no team, RM, platform or status can be shown.',
      'Re-upload the FIN23 export on the backend /upload page, then reload.');
  }else{
    const newest = newestLeadDate();
    const age = newest ? Math.floor((Date.now() - newest.getTime()) / DAY_MS) : 0;
    if(age > HEALTH_STALE_DATA_DAYS){
      add('warn', 'b2c-stale', `The Workpoint B2C data is ${age} days old`,
        `The newest lead in the B2C file was created on ${bd2Day(newest)}. Tracker leads added since then cannot be matched, so they show as Unmatched.`,
        'Upload a fresh FIN23 export on the backend /upload page, then reload.');
    }
  }

  // ---- a column header the loader did not recognise, per tracker tab ----
  const bySheet = new Map();
  for(const r of rows){
    const k = bd2SheetOf(r);
    if(!bySheet.has(k)) bySheet.set(k, []);
    bySheet.get(k).push(r);
  }
  const noColumn = { dateAssigned: new Set(), email: new Set(), gmeetJoined: new Set() };
  for(const [sheet, rs] of bySheet){
    for(const [field, header, effect] of BD2_COLUMNS){
      if(rs.some(r => bd2HasField(r, field))) continue;
      noColumn[field].add(sheet);
      add('error', `column:${field}:${sheet}`, `"${sheet}": the ${header} column was not found`,
        `The dashboard looks for a column headed "${header}" in each rep's tab and found none in "${sheet}". ${effect(rs.length)}`,
        `In the Google Sheet tab "${sheet}", make the header of that column read exactly "${header}" (capitals and extra spaces are ignored, other words are not). ` +
        'Then reload this page; the sheet is re-read at most every 5 minutes, so reload again after a few minutes if nothing changes.',
        rs.map(r => bd2Line(`${header} column not found`, r, '', `Rename the ${header} column header in this tab to exactly "${header}".`)));
    }
  }

  // ---- dates ----
  const fyStart = new Date(Math.floor(FY_CUTOFF / 100), FY_CUTOFF % 100, 1);
  const unreadable = [], outOfRange = [];
  for(const r of rows){
    if(noColumn.dateAssigned.has(bd2SheetOf(r))) continue;
    const d = parseDateAny(r.dateAssigned);
    if(!d && !normalizeMonthLabel(r.dateAssigned)) unreadable.push(r);
    else if(d && (d < fyStart || d.getTime() > Date.now() + DAY_MS)) outOfRange.push(r);
  }
  if(unreadable.length){
    const typed = tallyBy(unreadable.filter(r => !isBlankDate(r.dateAssigned)), r => String(r.dateAssigned).trim().slice(0, 40));
    add('warn', 'date-unreadable', `${bd2Num(unreadable.length, 'meeting')} ${bd2Has(unreadable.length)} a blank or unreadable Date Assigned`,
      'Their Month is N/A, which no Month filter can select, so they are left out of every month\'s figures and appear only when Month is All. ' +
      `By tab: ${sampleList(tallyBy(unreadable, bd2SheetOf), ([s, c]) => `${s} (${n(c)})`)}.` +
      (typed.length ? ` Values that could not be read: ${sampleList(typed, ([v, c]) => `"${v}" (${n(c)})`)}.` : ''),
      `Enter a real date (for example 15-10-2026) in the Date Assigned cell of each row in the download (${bd2Where(unreadable)}).`,
      unreadable.map(r => bd2Line('Date Assigned blank or unreadable', r, isBlankDate(r.dateAssigned) ? 'Blank' : 'Cannot be read', 'Enter a real date in Date Assigned.')));
  }
  if(outOfRange.length){
    const dates = outOfRange.map(r => parseDateAny(r.dateAssigned)).sort((a, b) => a - b);
    add('warn', 'date-range', `${bd2Num(outOfRange.length, 'meeting')} ${bd2Is(outOfRange.length)} dated in the future or before ${bd2Day(fyStart)}`,
      `The dates can be read but look wrong: earliest ${bd2Day(dates[0])}, latest ${bd2Day(dates[dates.length - 1])}. ` +
      'This is usually a day/month swap or a wrong year, and it puts the meeting in a month it did not happen in.',
      `Correct the Date Assigned of the rows in the download (${bd2Where(outOfRange)}).`,
      outOfRange.map(r => bd2Line('Date Assigned in the future or before the financial year', r, '', 'Check the day, month and year.')));
  }

  // ---- emails ----
  const noEmail = rows.filter(r => !bdClientKey(r) && !noColumn.email.has(bd2SheetOf(r)));
  if(noEmail.length){
    add('warn', 'no-email', `${bd2Num(noEmail.length, 'meeting')} ${bd2Has(noEmail.length)} no email`,
      `Without an email they cannot be matched to Workpoint, so each is counted as Unmatched and as its own unmapped client. By BD rep: ${bd2ByRepText(noEmail)}.`,
      `Fill in the Email cell of each row in the download (${bd2Where(noEmail)}).`,
      noEmail.map(r => bd2Line('No email', r, '', 'Fill in the client\'s email.')));
  }
  if(haveB2c){
    const unmapped = rows.filter(r => bdClientKey(r) && !r.crmMatched && !noColumn.email.has(bd2SheetOf(r)));
    if(unmapped.length){
      const emails = [...new Set(unmapped.map(bdClientKey))];
      const near = bd2NearEmails(emails);
      const notAddress = emails.filter(e => !e.includes('@'));
      add('warn', 'unmapped', `${bd2Num(emails.length, 'email')} in the sheet ${bd2Is(emails.length)} not found in Workpoint B2C`,
        `Their ${bd2Num(unmapped.length, 'meeting')} ${bd2Is(unmapped.length)} counted as Unmatched: no team, RM, platform or status. ` +
        (noEmail.length ? `With the ${bd2Num(noEmail.length, 'meeting')} that have no email, these make up the ${n(bd2Mapping(rows).unmapped)} unmapped clients on the RM BD Performance tab. ` : '') +
        `By BD rep: ${bd2ByRepText(unmapped)}.` +
        (near.size ? ` ${n(near.size)} look like a typo of an email that is in B2C.` : '') +
        (notAddress.length ? ` ${n(notAddress.length)} ${bd2Is(notAddress.length)} not an email address at all (no @).` : ''),
        'Search each email in Workpoint. If the sheet has it misspelt, correct it in the sheet' +
        (near.size ? ' (the download names the likely match; confirm it is the same client first)' : '') +
        '. If the client is not in Workpoint, create the lead there. A client created before the period the uploaded B2C file covers also appears here and needs no change in the sheet.',
        unmapped.map(r => {
          const e = bdClientKey(r);
          return bd2Line('Email not found in Workpoint B2C', r,
            near.has(e) ? `Possible match in B2C: ${near.get(e)}` : (e.includes('@') ? '' : 'Not an email address'),
            'Check the email against Workpoint; correct it in the sheet or create the lead.');
        }));
    }
  }

  // ---- GMeet Joined? ----
  const unlogged = rows.filter(r => !noColumn.gmeetJoined.has(bd2SheetOf(r)) && !BD2_GMEET_VALUES.includes(r.gmeetJoined))
    .sort((a, b) => toIsoDate(a.dateAssigned).localeCompare(toIsoDate(b.dateAssigned)));
  if(unlogged.length){
    const old = unlogged.filter(r => { const d = parseDateAny(r.dateAssigned); return d && Date.now() - d.getTime() > BD2_OLD_ENTRY_DAYS * DAY_MS; }).length;
    add('warn', 'gmeet-not-logged', `${bd2Num(unlogged.length, 'meeting')} ${bd2Has(unlogged.length)} no GMeet Joined? status`,
      'The cell is blank or holds something other than Yes, No, Pending, Joined or Not joined, so these sit under Not Logged: they count in Meetings Scheduled ' +
      `but not as joined, not joined or pending. ${n(old)} ${bd2Is(old)} more than ${BD2_OLD_ENTRY_DAYS} days old. By BD rep: ${bd2ByRepText(unlogged)}.`,
      `Ask the BD rep to set GMeet Joined? to Yes, No or Pending on the rows in the download, oldest first (${bd2Where(unlogged)}).`,
      unlogged.map(r => bd2Line('GMeet Joined? not logged', r, '', 'Set GMeet Joined? to Yes, No or Pending.')));
  }

  // ---- the same client logged more than once ----
  const byEmail = new Map();
  for(const r of rows){
    const k = bdClientKey(r);
    if(!k) continue;
    if(!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k).push(r);
  }
  const repeated = [...byEmail.values()].filter(g => g.length > 1);
  if(repeated.length){
    const extra = repeated.reduce((a, g) => a + g.length - 1, 0);
    const sameRep = repeated.filter(g => new Set(g.map(r => r.person)).size === 1).length;
    add('info', 'repeat-entries', `${bd2Num(extra, 'repeat entry', 'repeat entries')}: ${bd2Num(repeated.length, 'client')} ${bd2Is(repeated.length)} logged more than once`,
      `Each entry counts as its own meeting, so Meetings Scheduled is ${n(extra)} higher than the number of distinct clients. ` +
      `${n(sameRep)} ${bd2Plural(sameRep, 'client was', 'clients were')} logged more than once by the same rep and ${n(repeated.length - sameRep)} by two different reps.`,
      'If an entry is a mistake, delete the extra row in the sheet. If the client really met the team again, leave it.',
      repeated.flatMap(g => g.slice().sort((a, b) => toIsoDate(a.dateAssigned).localeCompare(toIsoDate(b.dateAssigned)))
        .map((r, i) => bd2Line('Client logged more than once', r, `Entry ${i + 1} of ${g.length}`, 'Delete the row if it is a mistake.'))));
  }

  // ---- a first RM the team lookup cannot place ----
  const unplaced = rows.filter(r => r.crmMatched && !bd2Info(r).firstRmKnown);
  const named = unplaced.filter(r => bd2Info(r).firstRm);
  if(named.length){
    const names = tallyBy(named, r => bd2Info(r).firstRm);
    const blank = unplaced.length - named.length;
    add('warn', 'first-rm', `${bd2Num(names.length, 'first RM name')} missing from EMPLOYEE_REF: ${bd2Num(named.length, 'meeting')} counted under team SV`,
      'A lead\'s team comes from its first RM\'s row in EMPLOYEE_REF. ' +
      `${names.length === 1 ? 'This name has' : 'These names have'} no row, and no RM Master alias that leads to one, so the meetings land on SV instead of the team they belong to: ` +
      `${sampleList(names, ([nm, c]) => `${nm} (${n(c)})`)}.` +
      (blank ? ` Separately, ${bd2Num(blank, 'meeting')} ${bd2Has(blank)} no first RM at all in B2C (a CRM gap) and also sit on SV.` : ''),
      'Add a row in the EMPLOYEE_REF tab for each name (the Team, and the Name spelled exactly as the CRM writes it) and press "Calculate". ' +
      'Add the same name to RM MASTER MAPPING so spelling variants fold onto it, and use "Export snapshot.js" to make the fix permanent for everyone.',
      named.map(r => bd2Line('First RM missing from EMPLOYEE_REF', r, `First RM: ${bd2Info(r).firstRm}`, 'Add the RM to EMPLOYEE_REF.')));
  }

  // ---- BD Daily Log ----
  if(!STATE.filesLoaded.bdcalls){
    add('warn', 'log-missing', 'The BD Daily Log has no rows', 'Calls Made, Connected and CNP show 0 for every rep.',
      'Check that the Google Sheet has a tab named exactly "BD Daily Log" with Date and BD Name columns, then reload.');
  }else{
    const logs = STATE.bdCalls;
    const num = v => v || 0;
    const callsText = r => `Total ${n(num(r.totalCalls))} · Connected ${n(num(r.callsConnected))} · CNP ${n(num(r.cnp))}`;
    // Calls on a row with no BD Name are in every total, under BD2_NO_BD_NAME. That is not a rep typed
    // wrongly or a day entered twice, so the two name checks below leave it out.
    const unnamed = logs.filter(r => r.bdName === BD2_NO_BD_NAME);
    const named = logs.filter(r => r.bdName !== BD2_NO_BD_NAME);
    if(unnamed.length){
      const calls = unnamed.reduce((a, r) => a + num(r.totalCalls), 0);
      add('warn', 'log-no-name', `${bd2Num(unnamed.length, 'BD Daily Log row')} ${bd2Has(unnamed.length)} no BD Name: ${bd2Num(calls, 'call')} ${bd2Is(calls)} not credited to any rep`,
        `The calls are in the totals, so Total Calls Made matches the sheet, but they show on a "${BD2_NO_BD_NAME}" rep row instead of the rep who made them. ` +
        'That rep\'s own Calls Made reads too low, and picking the rep in the Person filter misses these calls.',
        'Write the rep\'s name in the BD Name column of each row in the download, exactly as the tracker tab is named: the part before " Q1", " Q2" and so on.',
        unnamed.map(r => bd2LogLine('BD Daily Log row has no BD Name', r, callsText(r), 'Write the rep\'s name in the BD Name column.')));
    }
    const off = logs.filter(r => num(r.callsConnected) + num(r.cnp) !== num(r.totalCalls));
    if(off.length){
      const impossible = off.filter(r => num(r.callsConnected) > num(r.totalCalls) || num(r.cnp) > num(r.totalCalls)).length;
      add('warn', 'log-arithmetic', `${bd2Num(off.length, 'BD Daily Log row')} ${off.length === 1 ? 'does' : 'do'} not add up`,
        'Calls Connected + CNP should equal Total Calls Made. ' +
        (impossible ? `On ${n(impossible)} of them Connected or CNP is larger than Total Calls itself. ` : '') +
        'The tab shows the numbers as typed, so the Calls cards and the Connected % and CNP % carry these errors.',
        'Correct those days in the BD Daily Log sheet; the rep, date and numbers are in the download.',
        off.map(r => bd2LogLine('BD Daily Log row does not add up', r,
          callsText(r), 'Correct the call numbers for this day.')));
    }
    const days = new Map();
    for(const r of named){
      const k = `${toIsoDate(r.date)}|${String(r.bdName || '').toLowerCase()}`;
      if(!days.has(k)) days.set(k, []);
      days.get(k).push(r);
    }
    const twice = [...days.values()].filter(g => g.length > 1);
    if(twice.length){
      add('info', 'log-duplicate-day', `${bd2Num(twice.length, 'day')} in the BD Daily Log ${bd2Has(twice.length)} two rows for the same rep`,
        'Both rows are added together, so that day\'s calls may be counted twice.',
        'If it is a duplicate, delete one of the rows; if it is a second session, leave it.',
        twice.flatMap(g => g.map(r => bd2LogLine('Two BD Daily Log rows for one rep and day', r,
          callsText(r), 'Delete the row if it is a duplicate.'))));
    }
    const reps = new Set(rows.map(r => r.person));
    const strangers = [...new Set(named.map(r => r.bdName).filter(nm => nm && !reps.has(nm)))];
    if(strangers.length){
      add('warn', 'log-names', `${bd2Num(strangers.length, 'BD Daily Log name')} ${strangers.length === 1 ? 'matches' : 'match'} no tracker tab: ${strangers.join(', ')}`,
        'Their calls show on a rep row of their own with no meetings, and picking the tracker rep in the Person filter misses them.',
        'Write the name in the BD Daily Log exactly as the tracker tab is named: the part before " Q1", " Q2" and so on.',
        logs.filter(r => strangers.includes(r.bdName)).map(r => bd2LogLine('BD Daily Log name matches no tracker tab', r, '', 'Use the tracker tab\'s name.')));
    }
    const last = logs.map(r => parseDateAny(r.date)).filter(Boolean).sort((a, b) => b - a)[0];
    const logAge = last ? Math.floor((Date.now() - last.getTime()) / DAY_MS) : 0;
    if(logAge > HEALTH_STALE_DATA_DAYS){
      add('warn', 'log-stale', `The BD Daily Log ends ${logAge} days ago`,
        `The latest entry is ${bd2Day(last)}, so calls after that date are not in the figures.`,
        'Ask the BD team to fill in the BD Daily Log up to yesterday, then reload.');
    }
  }

  return out.sort((a, b) => BD2_LEVEL_RANK[a.level] - BD2_LEVEL_RANK[b.level]);
}

// The checks above read the whole sheet and never depend on the filters, so they are kept until the
// data they read is replaced (or the day changes, which the "N days old" wording depends on).
let _bd2IssueKey = null, _bd2IssueCache = null;
function bd2DataIssues(){
  const key = [STATE.bd, STATE.bdCalls, STATE.raw, STATE.teamMap, STATE.rmMasterLookup, STATE.dataSource, new Date().toDateString()];
  if(!_bd2IssueCache || !key.every((k, i) => k === _bd2IssueKey[i])){
    _bd2IssueCache = bd2BuildDataIssues();
    _bd2IssueKey = key;
  }
  return _bd2IssueCache;
}

// ---- flow checks ----
// Runs fn with the BD filters replaced; STATE.bd2 itself is put back, so the page's filter widgets keep
// pointing at the same object.
function bd2WithFilters(filters, fn){
  const saved = STATE.bd2;
  STATE.bd2 = { ...saved, ...filters };
  try{ return fn(); }
  finally{ STATE.bd2 = saved; }
}

// Every check is read from the same functions that draw the tab, for whatever filters are set.
function bd2RunChecks(idx, wholeSheet){
  const rows = bd2Meetings();
  const f = bd2Flow();
  const m = bd2Mapping(rows);
  const checks = [];
  const add = (id, label, problems, okText) =>
    checks.push({ id, label, ok: !problems.length, text: problems.length ? problems.join('; ') : okText });
  const total = parts => parts.reduce((a, b) => a + b, 0);
  const eq = (sum, parts) => `${fmtIN(sum)} = ${parts.map(fmtIN).join(' + ')}`;

  const meetingParts = [f.joined, f.notJoined, f.pending, f.notLogged];
  const p1 = [];
  if(f.meetings !== total(meetingParts)) p1.push(`${fmtIN(f.meetings)} meetings but the parts add to ${fmtIN(total(meetingParts))}`);
  if(f.meetings !== rows.length) p1.push(`the flow shows ${fmtIN(f.meetings)} but ${fmtIN(rows.length)} meetings are selected`);
  add('split-meetings', 'Meetings Scheduled = Joined + Not Joined + Pending + Not Logged', p1, eq(f.meetings, meetingParts));

  const joinedParts = [f.inProcess, f.converted, f.other, f.unmatched];
  add('split-joined', 'Meetings Joined = In Process + Converted + Other States + Unmatched',
    f.joined === total(joinedParts) ? [] : [`${fmtIN(f.joined)} joined but the parts add to ${fmtIN(total(joinedParts))}`], eq(f.joined, joinedParts));

  // A table is right when its rows add to its Grand Total and the Grand Total is the flow.
  const tie = (id, label, name, table, withCalls) => {
    const body = table.filter(r => !r._tot), gt = table.find(r => r._tot), p = [];
    const compare = (what, rowsSum, grand, flowValue) => {
      if(rowsSum !== grand) p.push(`${what}: ${name} rows add to ${fmtIN(rowsSum)}, Grand Total ${fmtIN(grand)}`);
      else if(grand !== flowValue) p.push(`${what}: Grand Total ${fmtIN(grand)}, flow ${fmtIN(flowValue)}`);
    };
    for(const k of BD2_COUNT_KEYS) compare(BD2_COUNT_NAMES[k], bd2Sum(body, k), gt[k], f[k]);
    if(withCalls && !f.noCalls){
      compare('Calls Made', bd2Sum(body, 'calls'), gt.calls, f.totalCalls);
      compare('Calls Connected', bd2Sum(body, 'connected'), gt.connected, f.connected);
    }
    add(id, label, p, `${fmtIN(body.length)} ${name} ${bd2Plural(body.length, 'row adds', 'rows add')} to the Grand Total (${fmtIN(gt.meetings)} meetings) and to the flow`);
  };
  tie('rep-table', 'BD Employee-wise table adds up to the flow', 'rep', bd2ByRep(), true);
  tie('team-table', 'Team table adds up to the flow', 'team', bd2ByTeam(), false);
  tie('rm-table', 'RM table adds up to the flow', 'RM', bd2ByRm(), false);

  const p3 = [];
  if(m.mapped + m.unmapped !== m.clients) p3.push(`${fmtIN(m.mapped)} mapped + ${fmtIN(m.unmapped)} unmapped is not ${fmtIN(m.clients)} clients`);
  if(m.clients + m.repeats !== m.meetings) p3.push(`${fmtIN(m.clients)} clients + ${fmtIN(m.repeats)} repeat entries is not ${fmtIN(m.meetings)} meetings`);
  if(m.meetings !== f.meetings) p3.push(`the mapping counts ${fmtIN(m.meetings)} meetings, the flow ${fmtIN(f.meetings)}`);
  add('mapping', 'Mapped + Unmapped = Clients; Clients + repeat entries = Meetings', p3,
    `${fmtIN(m.mapped)} + ${fmtIN(m.unmapped)} = ${fmtIN(m.clients)} clients; ${fmtIN(m.clients)} + ${fmtIN(m.repeats)} = ${fmtIN(m.meetings)} meetings`);

  // The one check that does not just compare the tab with itself: the joined meetings are counted
  // again here straight from the B2C file, without the status worked out at load.
  const direct = { inProcess: 0, converted: 0, other: 0, unmatched: 0 };
  for(const r of rows){
    if(r.gmeetJoined !== 'Yes') continue;
    const b = idx[bdClientKey(r)];
    if(!b) direct.unmatched++;
    else if(isConvertedLead(b)) direct.converted++;
    else if(b.leadStatus === 'IN PROCESS') direct.inProcess++;
    else direct.other++;
  }
  add('b2c-recount', 'Status of the joined meetings, re-counted straight from the B2C file',
    Object.keys(direct).filter(k => direct[k] !== f[k]).map(k => `${BD2_COUNT_NAMES[k]}: the tab shows ${fmtIN(f[k])}, B2C gives ${fmtIN(direct[k])}`),
    `In Process ${fmtIN(direct.inProcess)} · Converted ${fmtIN(direct.converted)} · Other States ${fmtIN(direct.other)} · Unmatched ${fmtIN(direct.unmatched)}`);

  if(wholeSheet){
    const o = bd2Options(), all = STATE.bd;
    const reach = (list, fn) => all.filter(r => { const v = fn(r); return v && list.includes(v); }).length;
    const reached = { Team: reach(o.teams, bd2Team), Platform: reach(o.platforms, bd2Platform), Person: reach(o.persons, r => r.person) };
    add('filter-reach', 'Every meeting has a Team, Platform and Person that the filters can select',
      Object.entries(reached).filter(([, c]) => c !== all.length).map(([k, c]) => `the ${k} filter reaches ${fmtIN(c)} of ${fmtIN(all.length)} meetings`),
      `${fmtIN(all.length)} of ${fmtIN(all.length)} meetings, for each of the three filters`);
  }
  return checks;
}

let _bd2SheetKey = null, _bd2SheetCache = null;
function bd2SheetChecks(){
  const key = [STATE.bd, STATE.bdCalls, STATE.raw, STATE.teamMap, STATE.rmMasterLookup];
  if(!_bd2SheetCache || !key.every((k, i) => k === _bd2SheetKey[i])){
    _bd2SheetCache = bd2WithFilters(BD2_NO_FILTERS, () => bd2RunChecks(buildB2CEmailIndex(), true));
    _bd2SheetKey = key;
  }
  return _bd2SheetCache;
}

const bd2Integrity = () => ({ selection: bd2RunChecks(buildB2CEmailIndex(), false), sheet: bd2SheetChecks() });

// A failed check, as a finding. `integrity` holds the scopes to report on (a null scope is skipped).
function bd2CheckFailures(integrity){
  const out = [];
  for(const [scope, where] of [['selection', 'the current selection'], ['sheet', 'the whole sheet']]){
    for(const c of integrity[scope] || []){
      if(c.ok) continue;
      out.push({ level: 'error', id: `check:${scope}:${c.id}`, title: `Flow check failed: ${c.label}`, detail: `On ${where}: ${c.text}.`,
        fix: 'This is a calculation fault in the tab, not a problem in the sheets. Reload with Ctrl+F5; if it still fails, send this message and the filters you had set to the dashboard owner.',
        rows: [] });
    }
  }
  return out;
}

// One line for the Dashboard tab's data-health panel; null when the BD data has no errors or warnings.
function bd2HealthSummary(){
  const found = [...bd2CheckFailures({ sheet: bd2SheetChecks() }), ...bd2DataIssues()];
  const errors = found.filter(i => i.level === 'error'), warns = found.filter(i => i.level === 'warn');
  if(!errors.length && !warns.length) return null;
  const shown = [...errors, ...warns];
  return {
    level: errors.length ? 'warn' : 'info',
    title: 'BD Performance: ' + [errors.length && bd2Num(errors.length, 'error'), warns.length && bd2Num(warns.length, 'warning')].filter(Boolean).join(' and '),
    detail: shown.slice(0, 3).map(i => i.title).join('; ') + (shown.length > 3 ? `; and ${shown.length - 3} more` : '') + '.',
    fix: 'Open the BD Performance tab: each item there says how to fix it.',
  };
}

// ---- download ----
function bd2DownloadIssues(issues, tag){
  const lines = issues.flatMap(i => i.rows);
  const headers = BD2_ISSUE_HEADERS.filter(h => h !== 'Sheet row' || lines.some(l => l[h] !== ''));
  const wsRows = XLSX.utils.aoa_to_sheet([headers, ...lines.map(l => headers.map(h => l[h] ?? ''))]);
  const width = { 'What to do': 52, Details: 42, Email: 34, Issue: 40 };
  wsRows['!cols'] = headers.map(h => ({ wch: width[h] || 16 }));
  const wsFix = XLSX.utils.aoa_to_sheet([['Level', 'Issue', 'What it means', 'How to fix', 'Rows listed'],
    ...issues.map(i => [i.level, i.title, i.detail, i.fix, i.rows.length])]);
  wsFix['!cols'] = [{ wch: 8 }, { wch: 60 }, { wch: 90 }, { wch: 90 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsFix, 'How to fix');
  XLSX.utils.book_append_sheet(wb, wsRows, 'Rows to fix');
  XLSX.writeFile(wb, `BD_Data_Issues${tag ? '_' + tag : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---- rendering ----
let _bd2HealthOpen = null;

// Errors and warnings as a count on the tab button, so a problem shows from any tab.
function bd2TabBadge(errors, warns){
  const tab = $('.tab[data-tab="bdperf"]');
  if(!tab) return;
  let badge = tab.querySelector('.tab-badge');
  if(!errors && !warns){ if(badge) badge.remove(); return; }
  if(!badge){
    badge = document.createElement('span');
    badge.className = 'tab-badge';
    tab.appendChild(badge);
  }
  badge.textContent = errors + warns;
  badge.classList.toggle('err', errors > 0);
  badge.title = `${bd2Num(errors, 'error')}, ${bd2Num(warns, 'warning')} in the BD data: open the tab to see how to fix them`;
}

function renderBD2Health(){
  const host = $('#bd2-health');
  if(!host) return;
  if(!STATE.filesLoaded.bd){ host.innerHTML = ''; bd2TabBadge(0, 0); return; }
  let issues, integrity;
  try{
    integrity = bd2Integrity();
    issues = [...bd2CheckFailures({ selection: bd2AnyFilter() ? integrity.selection : null, sheet: integrity.sheet }), ...bd2DataIssues()]
      .sort((a, b) => BD2_LEVEL_RANK[a.level] - BD2_LEVEL_RANK[b.level]);
  }catch(e){
    // A failing check must not read as "healthy".
    console.error('[MIS] BD data-health checks failed', e);
    host.innerHTML = '<div class="health-panel health-error"><strong>BD data-health checks could not run.</strong> ' + escHtml(e.message || String(e)) + '</div>';
    return;
  }
  const count = lvl => issues.filter(i => i.level === lvl).length;
  const errors = count('error'), warns = count('warn'), notes = count('info');
  const worst = errors ? 'error' : warns ? 'warn' : 'ok';
  const open = _bd2HealthOpen === null ? errors > 0 : _bd2HealthOpen;
  const checks = [...integrity.selection, ...integrity.sheet];
  const failed = checks.filter(c => !c.ok).length;
  bd2TabBadge(errors, warns);

  const parts = [errors && bd2Num(errors, 'error'), warns && bd2Num(warns, 'warning'), notes && bd2Num(notes, 'note')].filter(Boolean);
  const summary = `${worst === 'ok' ? '✅' : BD2_ICON[errors ? 'error' : 'warn']} BD data health: ${parts.length ? parts.join(' · ') : 'no data issues'}` +
    ` — ${failed ? `${fmtIN(failed)} of ${fmtIN(checks.length)} flow checks FAILED` : `all ${fmtIN(checks.length)} flow checks passed`}`;

  const withRows = issues.filter(i => i.rows.length);
  const item = i => `
    <li class="health-item health-${i.level}">
      <div class="health-title">${BD2_ICON[i.level]} ${escHtml(i.title)}</div>
      <div>${escHtml(i.detail)}</div>
      <div class="health-fix"><em>To fix:</em> ${escHtml(i.fix)}</div>
      ${i.rows.length ? `<a href="#" class="bd2h-dl" data-issue="${escHtml(i.id)}">↓ Download the ${bd2Num(i.rows.length, 'row')}</a>` : ''}
    </li>`;

  const sel = new Map(integrity.selection.map(c => [c.id, c]));
  const cell = c => c
    ? `<span class="${c.ok ? 'bd2h-pass' : 'bd2h-fail'}">${c.ok ? '✓' : '✗'}</span> ${escHtml(c.text)}`
    : '<span class="bd2h-na">whole sheet only</span>';
  const checkRows = integrity.sheet.map(c => `<tr><td>${escHtml(c.label)}</td><td>${cell(sel.get(c.id))}</td><td>${cell(c)}</td></tr>`).join('');

  host.innerHTML = `
    <div class="health-panel health-${worst}">
      <button type="button" class="health-toggle" aria-expanded="${open}">${summary}
        <span class="health-caret">${open ? '▲ hide' : '▼ show what to fix'}</span></button>
      ${open ? `
        <div class="bd2h-bar">
          <span>Each item says what is wrong, what it does to the figures and how to fix it. The sheet is re-read at most every 5 minutes.</span>
          <span>${withRows.length ? '<a href="#" id="bd2-health-dl">↓ Download every row to fix (Excel)</a> ' : ''}<button class="info-btn" data-info="bd2-health" title="How these checks work">i</button></span>
        </div>
        ${issues.length ? `<ul class="health-list">${issues.map(item).join('')}</ul>` : '<div class="bd2h-bar">No data issues found in the sheets.</div>'}
        <div class="bd2h-checks">
          <div class="health-title">Flow checks: ${failed ? `${fmtIN(failed)} of ${fmtIN(checks.length)} failed` : `all ${fmtIN(checks.length)} passed`}</div>
          <table class="bd2h-table">
            <thead><tr><th>Check</th><th>This selection${bd2AnyFilter() ? '' : ' (no filters set)'}</th><th>Whole sheet</th></tr></thead>
            <tbody>${checkRows}</tbody>
          </table>
        </div>` : ''}
    </div>`;

  host.querySelector('.health-toggle').onclick = () => { _bd2HealthOpen = !open; renderBD2Health(); };
  host.querySelectorAll('.bd2h-dl').forEach(a => {
    a.onclick = e => {
      e.preventDefault();
      const it = issues.find(i => i.id === a.dataset.issue);
      if(it) bd2DownloadIssues([it], it.id.replace(/[^A-Za-z0-9]+/g, '-'));
    };
  });
  const all = host.querySelector('#bd2-health-dl');
  if(all) all.onclick = e => { e.preventDefault(); bd2DownloadIssues(issues, ''); };
}
