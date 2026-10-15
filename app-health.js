// app-health.js — one consolidated data-health report for the whole dashboard.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// Every guard elsewhere in the app (unparseable dates, blank table columns,
// cost-sheet sync, unmapped RMs, revenue tie-out, BD tracker quality…) reports
// into its own corner of its own tab, or only into the console. That is how a
// number ends up quietly wrong with nobody looking at the right tab. This file
// gathers them — plus the integrity checks that were missing — into a single
// panel at the top of the Dashboard, so "is this page trustworthy right now?"
// has one answer and one place to read it.
//
// Levels:  error = a number on the page is wrong right now
//          warn  = numbers are right but built on a fallback / guess, or at risk
//          info  = worth knowing, no action needed
//
// Every check is a pure read of STATE; nothing here changes a figure.

const HEALTH_LEVEL_RANK = { error: 0, warn: 1, info: 2 };
const HEALTH_FUTURE_GRACE_DAYS = 1;     // clock skew between CRM and browser
const HEALTH_STALE_DATA_DAYS = 3;       // newest lead older than this => data is stale

// How many example names / values a check prints before saying "and N more".
const HEALTH_SAMPLE = 6;

const sampleList = (pairs, fmt) => {
  const shown = pairs.slice(0, HEALTH_SAMPLE).map(fmt).join(', ');
  return pairs.length > HEALTH_SAMPLE ? `${shown}, and ${pairs.length - HEALTH_SAMPLE} more` : shown;
};

function tallyBy(rows, keyOf){
  const m = new Map();
  for(const r of rows){
    const k = keyOf(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** How many leads the Team Performance Matrix SHOULD show for the current filters, counted the long way round. */
function expectedBucketedLeads(){
  // Deliberately re-derived status by status from the raw predicates rather
  // than through statusBucketOf(), so a bug in that helper can't hide itself.
  const rows = applyRefColdFilter(STATE.raw);
  let n = 0;
  for(const st of STATUSES){
    if(st === 'CONVERTED'){ n += rows.filter(r => isConvertedLead(r, monthFilter)).length; continue; }
    n += rows.filter(r => r.leadStatus === st && !isConvertedLead(r) && monthFilter(r[statusMonthCol(st)])).length;
  }
  return n;
}

function dataHealthChecks(){
  const checks = [];
  const add = (level, id, title, detail, fix, extra) =>
    checks.push(Object.assign({ level, id, title, detail, fix: fix || '' }, extra || {}));
  const raw = STATE.raw || [];

  if(!STATE.filesLoaded.fin23 || !raw.length){
    add('error', 'no-b2c', 'No B2C lead data loaded',
      'The lead file is empty or could not be read, so every lead table on this page is blank.',
      'Re-upload the FIN23 export on the backend /upload page, then reload.');
    return checks;
  }

  // ---- 1. where the numbers came from ----
  const src = STATE.dataSource || {};
  if(src.fallback){
    add('error', 'stale-fallback', 'Showing bundled data.js, not the live data',
      `The data API could not be reached (${src.error || 'unknown error'}), so the page is built from the data.js snapshot` +
      (src.generated ? ` generated ${src.generated}` : '') + ' — it may be months out of date.',
      'Check the backend is up (the /health endpoint), then reload. Do not circulate numbers from this view.');
  }
  const newest = newestLeadDate();
  if(newest){
    const ageDays = Math.floor((Date.now() - newest.getTime()) / 86400000);
    if(ageDays > HEALTH_STALE_DATA_DAYS){
      add('warn', 'stale-data', `Newest lead is ${ageDays} days old`,
        `The most recent lead created is ${newest.toISOString().slice(0, 10)}, so the dashboard has not had a fresh export recently.`,
        'Download a fresh FIN23 export and upload it on the backend /upload page.');
    }
  }

  // ---- 2. reconciliation: do the matrix and the raw rows agree? ----
  const matrix = teamPerformance();
  const gt = matrix.find(r => r._tot);
  const expected = expectedBucketedLeads();
  if(gt && gt['Total Leads'] !== expected){
    add('error', 'matrix-recon', 'Team Performance Matrix does not reconcile',
      `The matrix totals ${fmtIN(gt['Total Leads'])} leads but counting the filtered rows status-by-status gives ${fmtIN(expected)} ` +
      `(${fmtIN(Math.abs(expected - gt['Total Leads']))} apart). A lead is being dropped or double-counted between the source rows and the table.`,
      'This is a code-level fault, not a data one — check statusBucketOf() / teamPerformance() in app-aggregators.js.');
  }

  // Rows the filters keep but no status column can hold: they exist in the
  // file yet appear in NO table. (Rows merely outside the selected months are
  // excluded by design and are not this.)
  const scoped = applyRefColdFilter(raw);
  const unknownStatus = scoped.filter(r => !STATUSES.includes(isConvertedLead(r) ? 'CONVERTED' : r.leadStatus));
  if(unknownStatus.length){
    const byStatus = tallyBy(unknownStatus, r => r.leadStatus || '(blank)');
    add('error', 'unknown-status', `${fmtIN(unknownStatus.length)} lead(s) have a status the dashboard doesn't know`,
      `They are in the file but in no status column, so every status table undercounts: ${sampleList(byStatus, ([s, n]) => `"${s}" (${fmtIN(n)})`)}.`,
      'Add the new status to CONFIG.STATUSES (app-config.js) — and to LEAD_STATUS_ALIASES (app-dataload.js) if it is just another spelling of an existing one.');
  }

  // ---- 3. dates ----
  const noCreated = raw.filter(r => r.CTM === 'N/A');
  if(noCreated.length){
    add('error', 'no-created', `${fmtIN(noCreated.length)} lead(s) have no readable Created date`,
      'Without a created month they are missing from Generated Leads, Platform × Month and every created-month table.',
      'Open the source export and correct the Created Date cells (see MISSING_LEADS tab for the rows).');
  }
  const ipInferred = raw.filter(r => r._ipInferred), cvInferred = raw.filter(r => r._cvInferred);
  if(ipInferred.length || cvInferred.length){
    const parts = [];
    if(ipInferred.length) parts.push(`${fmtIN(ipInferred.length)} IN PROCESS lead(s) with no in-process date`);
    if(cvInferred.length) parts.push(`${fmtIN(cvInferred.length)} CONVERTED lead(s) with no converted date`);
    add('warn', 'inferred-dates', 'Some status months were inferred',
      `${parts.join(' and ')}. The CRM gave no date, so the month of the last status change was used — without that these leads fell out of every status table.`,
      'Fix in the CRM (set the in-process / converted date); the dashboard then uses the real month. Listed in the MISSING_LEADS tab.');
  }
  const today = Date.now();
  const future = raw.filter(r => { const d = parseDateAny(r.createdDate); return d && d.getTime() > today + HEALTH_FUTURE_GRACE_DAYS * 86400000; });
  if(future.length){
    add('warn', 'future-dated', `${fmtIN(future.length)} lead(s) are dated in the future`,
      `Latest is ${future.map(r => r.createdDate).sort().pop()}. Usually a day/month swap or a wrong system clock at the source.`,
      'Check the Created Date cells for these rows in the source export.');
  }
  const backwards = raw.filter(r => {
    const c = parseDateAny(r.createdDate), v = parseDateAny(r.convertedDate);
    return c && v && v.getTime() < c.getTime() - 86400000;
  });
  if(backwards.length){
    add('info', 'convert-before-create', `${fmtIN(backwards.length)} lead(s) converted before they were created`,
      'A converted date earlier than the created date. Usually an old client re-registered; counted by converted month as normal.');
  }
  const dateIssue = dateParseIssueReport();
  if(dateIssue) add('warn', 'unparseable-dates', dateIssue.headline, dateIssue.detail, dateIssue.fix);

  // ---- 4. status vs. date rules ----
  const cmWrongStatus = raw.filter(r => isConvertedLead(r) && r.leadStatus !== 'CONVERTED');
  if(cmWrongStatus.length){
    const by = tallyBy(cmWrongStatus, r => r.leadStatus || '(blank)');
    add('info', 'cm-rule', `${fmtIN(cmWrongStatus.length)} lead(s) count as CONVERTED despite another status`,
      `They carry a converted date, which is definitive by the 2026-07-29 rule: ${sampleList(by, ([s, n]) => `${s} (${fmtIN(n)})`)}.`);
  }

  // ---- 5. mapping ----
  for(const field of ['currentRmName', 'firstRmName']){
    const rep = unmappedRmIssueReport(field);
    if(rep) add('warn', 'unmapped-' + field, rep.headline, rep.detail, rep.fix);
  }
  const testRms = tallyBy(raw.filter(r => /\btest/i.test(r.currentRmName) || /\btest/i.test(r.firstRmName)),
    r => /\btest/i.test(r.currentRmName) ? r.currentRmName : r.firstRmName);
  if(testRms.length){
    add('info', 'test-rms', `${fmtIN(testRms.reduce((a, [, n]) => a + n, 0))} lead(s) belong to test RM accounts`,
      `${sampleList(testRms, ([s, n]) => `${s} (${fmtIN(n)})`)} — they count in totals like any other lead.`,
      'Remove test records at the source if they should not be reported.');
  }
  const blankRm = raw.filter(r => !r.currentRmName).length;
  if(blankRm){
    add('warn', 'blank-rm', `${fmtIN(blankRm)} lead(s) have no current RM`,
      'They are counted under team SV with RM "(unassigned)".', 'Assign an RM in the CRM.');
  }
  const teamsInData = new Set(raw.map(r => r.Team || 'SV'));
  const extraTeams = [...teamsInData].filter(t => !FIXED_TEAMS.includes(t));
  const empTeams = new Set(STATE.empref.slice(1).map(r => (r && r[1] || '').toString().trim()).filter(Boolean));
  for(const t of empTeams) if(!FIXED_TEAMS.includes(t) && !extraTeams.includes(t)) extraTeams.push(t);
  if(extraTeams.length){
    add('warn', 'extra-teams', `${extraTeams.length} team name(s) are not in FIXED_TEAMS`,
      `${extraTeams.join(', ')} — shown as extra rows at the bottom of the team tables, but missing from team filters and the fixed ordering.`,
      'Add the team to CONFIG.FIXED_TEAMS in app-config.js, or correct the spelling in EMPLOYEE_REF.');
  }
  const empByName = new Map();
  for(const r of STATE.empref.slice(1)){
    if(!r) continue;
    const k = normalizeNameKey(r[2]); if(!k) continue;
    if(!empByName.has(k)) empByName.set(k, new Set());
    empByName.get(k).add((r[1] || '').toString().trim());
  }
  const empConflicts = [...empByName.entries()].filter(([, t]) => t.size > 1);
  if(empConflicts.length){
    add('error', 'emp-conflict', `${empConflicts.length} RM(s) appear under more than one team in EMPLOYEE_REF`,
      `${sampleList(empConflicts, ([k, t]) => `${k} → ${[...t].join(' / ')}`)}. Only the last row wins, so that RM's leads go to one team arbitrarily.`,
      'Keep one row per person in EMPLOYEE_REF.');
  }
  const ambiguous = Object.keys(STATE.rmMasterAmbiguous || {});
  if(ambiguous.length){
    add('warn', 'ambiguous-alias', `${ambiguous.length} RM Master alias(es) point at more than one person`,
      `${ambiguous.join(', ')} — the dashboard will not guess a team for these names; the last mapping wins for revenue and plan matching.`,
      'Give each alias exactly one canonical RM in RM MASTER MAPPING (use the full name in the source system).');
  }

  // ---- 6. duplicates ----
  const seen = new Map();
  let dupRows = 0;
  for(const r of raw){
    const k = (r.userId || '').toString().trim().toLowerCase() + '|' + r.leadHead;
    if(!r.userId) continue;
    if(seen.has(k)) dupRows++; else seen.set(k, 1);
  }
  if(dupRows){
    add('warn', 'duplicate-leads', `${fmtIN(dupRows)} lead row(s) repeat a client already listed`,
      'Same email (userId) and Lead Head more than once, so those clients are double-counted in every total.',
      'De-duplicate in the source export, or confirm they are genuinely separate enquiries.');
  }

  // ---- 7. blanks that hide leads inside "(Blank)" rows ----
  const noCampaign = raw.filter(r => !r['Campaign Name']).length;
  if(noCampaign){
    add('warn', 'no-campaign', `${fmtIN(noCampaign)} lead(s) have no Category / Campaign name`,
      'They are in the team and status totals but show in no row of the Category and Cost tables, and have no cost attributed.',
      'Fill the category in the CRM.');
  }

  // ---- 8. cost sheet ----
  const costIssue = costSyncIssueReport();
  if(costIssue) add('warn', 'cost-sync', costIssue.headline, costIssue.detail, costIssue.fix);
  const cpcNames = new Set(STATE.cost.slice(1).map(r => String(r[0] || '').trim().toLowerCase()).filter(Boolean));
  const noCost = tallyBy(raw.filter(r => r['Campaign Name'] && !cpcNames.has(r['Campaign Name'].toLowerCase())),
    r => r['Campaign Name']);
  if(noCost.length){
    add('warn', 'no-cost-row', `${noCost.length} campaign(s) have leads but no row in Cost Per Campaign`,
      `${sampleList(noCost, ([c, n]) => `${c} (${fmtIN(n)} leads)`)} — they show ₹0 cost and are missing from the Cost tables.`,
      'Add a row for each in the Cost Per Campaign sheet (name spelled exactly as the CRM Category).');
  }
  const costMonths = costMonthsWithoutCost();
  if(costMonths.length){
    add('warn', 'no-cost-month', `No cost entered for ${costMonths.join(', ')}`,
      'Leads exist for these months but every campaign has ₹0 cost, so CPL, CPQL and CAC read as ₹0 rather than "unknown".',
      'Enter the month\'s spend in the Cost Per Campaign sheet.');
  }

  // ---- 9. financial-year window ----
  const cutoff = FY_CUTOFF;
  const lateMonths = STATE.months.filter(m => monthKey(m) >= cutoff + 100);
  if(lateMonths.length){
    add('warn', 'fy-cutoff', 'The FY window looks out of date',
      `Data runs to ${lateMonths[lateMonths.length - 1]} but CONFIG.FY_CUTOFF_MONTH is ${CONFIG.FY_CUTOFF_MONTH}, ` +
      'so month filters and totals still start from the old financial year.',
      'Set CONFIG.FY_CUTOFF_MONTH (app-config.js) to the first month of the current financial year.');
  }
  const outside = raw.filter(r => {
    const b = statusBucketOf(r);
    return b && isValidMonth(b.month) && !filteredMonths().includes(b.month);
  }).length;
  if(outside){
    add('info', 'outside-fy', `${fmtIN(outside)} lead(s) fall before the ${CONFIG.FY_CUTOFF_MONTH} cutoff`,
      'They are in the file but sit before the financial-year window, so every table excludes them by design (the "All months" Team Transfers blocks are the one exception).');
  }

  // ---- 10. the other guards, gathered ----
  const shape = tableShapeIssueReport();
  if(shape) add('warn', 'table-shape', shape.headline, shape.detail, shape.fix);
  const bind = bindingIssueReport();
  if(bind) add('warn', 'bindings', bind.headline, bind.detail, bind.fix);
  const rev = (typeof rmRevenueIssueReport === 'function') ? rmRevenueIssueReport() : null;
  if(rev) add('warn', 'revenue', rev.headline, rev.detail, rev.fix);
  if(STATE.filesLoaded.bd){
    const bd = bdTrackerIssueReport();
    if(bd) add('info', 'bd-tracker', bd.headline, bd.detail, bd.fix);
  }

  checks.sort((a, b) => HEALTH_LEVEL_RANK[a.level] - HEALTH_LEVEL_RANK[b.level]);
  return checks;
}

function newestLeadDate(){
  let max = 0;
  for(const r of STATE.raw){
    const d = parseDateAny(r.createdDate);
    if(d && d.getTime() > max && d.getTime() <= Date.now() + HEALTH_FUTURE_GRACE_DAYS * 86400000) max = d.getTime();
  }
  return max ? new Date(max) : null;
}

/** Months (within the FY window) that have leads but zero total cost across every campaign. */
function costMonthsWithoutCost(){
  if(!STATE.cost.length) return [];
  const header = STATE.cost[0] || [];
  const out = [];
  for(const m of filteredMonths()){
    const idx = header.slice(1).map(toMmmYyyy).indexOf(m);
    const cost = idx < 0 ? 0 : STATE.cost.slice(1).reduce((s, row) => s + (Number(row[idx + 1]) || 0), 0);
    if(cost === 0 && STATE.raw.some(r => r.CTM === m)) out.push(m);
  }
  return out;
}

// ---- rendering ----
const HEALTH_ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
let _healthOpen = null;

// Coalesced onto the next tick: a filter change fires renderDashboard once but
// bulk operations (recalcAll, load) can fire it several times, and the checks
// are the heaviest single step. The panel is a summary — it can trail the
// tables by a frame.
let _healthTimer = null;
function renderDataHealth(){
  if(_healthTimer) return;
  _healthTimer = setTimeout(() => { _healthTimer = null; renderDataHealthNow(); }, 0);
}

function renderDataHealthNow(){
  const host = $('#data-health');
  if(!host) return;
  let checks;
  try{ checks = dataHealthChecks(); }
  catch(e){
    // A broken check must never take the dashboard down with it — but it must
    // not pass silently either: a health panel that dies quietly reads as "healthy".
    console.error('[MIS] data-health check failed', e);
    host.innerHTML = '<div class="health-panel health-error"><strong>Data-health checks could not run.</strong> ' +
      escHtml(e.message || String(e)) + '</div>';
    return;
  }
  window.__MIS_HEALTH = checks;
  const n = lvl => checks.filter(c => c.level === lvl).length;
  const errors = n('error'), warns = n('warn'), infos = n('info');
  const worst = errors ? 'error' : warns ? 'warn' : 'ok';
  if(_healthOpen === null) _healthOpen = errors > 0;

  const summary = worst === 'ok'
    ? '✅ Data health: all checks passed' + (infos ? ` · ${infos} note${infos > 1 ? 's' : ''}` : '')
    : `${errors ? HEALTH_ICON.error : HEALTH_ICON.warn} Data health: ` +
      [errors && `${errors} error${errors > 1 ? 's' : ''}`, warns && `${warns} warning${warns > 1 ? 's' : ''}`,
       infos && `${infos} note${infos > 1 ? 's' : ''}`].filter(Boolean).join(' · ');

  const items = checks.map(c => `
    <li class="health-item health-${c.level}">
      <div class="health-title">${HEALTH_ICON[c.level]} ${escHtml(c.title)}</div>
      <div class="health-detail">${escHtml(c.detail)}</div>
      ${c.fix ? `<div class="health-fix"><em>To fix:</em> ${escHtml(c.fix)}</div>` : ''}
    </li>`).join('');

  host.innerHTML = `
    <div class="health-panel health-${worst}">
      <button type="button" class="health-toggle" aria-expanded="${_healthOpen}">${summary}
        ${checks.length ? `<span class="health-caret">${_healthOpen ? '▲' : '▼'}</span>` : ''}</button>
      ${checks.length && _healthOpen ? `<ul class="health-list">${items}</ul>` : ''}
    </div>`;
  const btn = host.querySelector('.health-toggle');
  if(btn && checks.length) btn.onclick = () => { _healthOpen = !_healthOpen; renderDataHealthNow(); };

  if(checks.some(c => c.level !== 'info')){
    const sig = checks.map(c => c.id).join(',');
    if(renderDataHealth._warned !== sig){
      renderDataHealth._warned = sig;
      console.warn('[MIS] data health:\n' + checks.filter(c => c.level !== 'info')
        .map(c => `  [${c.level}] ${c.title} — ${c.detail}`).join('\n'));
    }
  }
}
