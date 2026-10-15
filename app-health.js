// app-health.js — one consolidated data-health panel for the Dashboard tab.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// The guards elsewhere report into their own tab or only the console. This
// gathers them, plus the integrity checks that were missing, into one place.
//   error = a figure on the page is wrong now
//   warn  = figures rest on a fallback, or are at risk
//   info  = worth knowing
// Every check is a read of STATE; nothing here changes a figure.

const HEALTH_LEVEL_RANK = { error: 0, warn: 1, info: 2 };
const HEALTH_STALE_DATA_DAYS = 3;
const HEALTH_SAMPLE = 6;
const DAY_MS = 86400000;

const sampleList = (pairs, fmt) => {
  const shown = pairs.slice(0, HEALTH_SAMPLE).map(fmt).join(', ');
  return pairs.length > HEALTH_SAMPLE ? `${shown}, and ${pairs.length - HEALTH_SAMPLE} more` : shown;
};

/** [[key, count], ...] for `rows`, most frequent first. */
function tallyBy(rows, keyOf){
  const m = new Map();
  for(const r of rows){
    const k = keyOf(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Leads the matrix should show for the current filters, counted status by status. */
function expectedBucketedLeads(){
  const rows = applyRefColdFilter(STATE.raw);
  let n = 0;
  for(const st of STATUSES){
    n += st === 'CONVERTED'
      ? rows.filter(r => isConvertedLead(r, monthFilter)).length
      : rows.filter(r => r.leadStatus === st && !isConvertedLead(r) && monthFilter(r[statusMonthCol(st)])).length;
  }
  return n;
}

function newestLeadDate(){
  let max = 0;
  const now = Date.now();
  for(const r of STATE.raw){
    const d = parseDateAny(r.createdDate);
    if(d && d.getTime() > max && d.getTime() <= now + DAY_MS) max = d.getTime();
  }
  return max ? new Date(max) : null;
}

/** FY months that have leads but no cost against any campaign. */
function monthsWithoutCost(){
  const header = (STATE.cost[0] || []).slice(1).map(toMmmYyyy);
  return filteredMonths().filter(m => {
    const idx = header.indexOf(m);
    const cost = idx < 0 ? 0 : STATE.cost.slice(1).reduce((s, row) => s + (Number(row[idx + 1]) || 0), 0);
    return cost === 0 && STATE.raw.some(r => r.CTM === m);
  });
}

function dataHealthChecks(){
  const checks = [];
  const add = (level, id, title, detail, fix) => checks.push({ level, id, title, detail, fix: fix || '' });
  const raw = STATE.raw;

  if(!STATE.filesLoaded.fin23 || !raw.length){
    add('error', 'no-b2c', 'No B2C lead data loaded',
      'The lead file is empty or could not be read, so every lead table is blank.',
      'Re-upload the FIN23 export on the backend /upload page, then reload.');
    return checks;
  }

  // ---- source ----
  const src = STATE.dataSource || {};
  if(src.fallback){
    add('error', 'stale-fallback', 'Showing bundled data.js, not live data',
      `The data API could not be reached (${src.error || 'unknown error'}), so the page uses the data.js snapshot` +
      (src.generated ? ` generated ${src.generated}` : '') + '.',
      'Check the backend /health endpoint, then reload.');
  }
  const newest = newestLeadDate();
  if(newest){
    const ageDays = Math.floor((Date.now() - newest.getTime()) / DAY_MS);
    if(ageDays > HEALTH_STALE_DATA_DAYS){
      add('warn', 'stale-data', `Newest lead is ${ageDays} days old`,
        `The latest lead was created ${newest.toISOString().slice(0, 10)}.`,
        'Upload a fresh FIN23 export on the backend /upload page.');
    }
  }

  // ---- reconciliation ----
  const gt = teamPerformance().find(r => r._tot);
  const expected = expectedBucketedLeads();
  if(gt && gt['Total Leads'] !== expected){
    add('error', 'matrix-recon', 'Team Performance Matrix does not reconcile',
      `The matrix totals ${fmtIN(gt['Total Leads'])} leads but counting the filtered rows status by status gives ${fmtIN(expected)}.`,
      'Check statusBucketOf() and teamPerformance() in app-aggregators.js.');
  }
  const unknownStatus = applyRefColdFilter(raw).filter(r => !STATUSES.includes(isConvertedLead(r) ? 'CONVERTED' : r.leadStatus));
  if(unknownStatus.length){
    const by = tallyBy(unknownStatus, r => r.leadStatus || '(blank)');
    add('error', 'unknown-status', `${fmtIN(unknownStatus.length)} lead(s) have a status the dashboard doesn't know`,
      `They are in no status column: ${sampleList(by, ([s, n]) => `"${s}" (${fmtIN(n)})`)}.`,
      'Add the status to CONFIG.STATUSES (app-config.js).');
  }

  // ---- dates ----
  const noCreated = raw.filter(r => r.CTM === 'N/A').length;
  if(noCreated){
    add('error', 'no-created', `${fmtIN(noCreated)} lead(s) have no readable Created date`,
      'They are missing from Generated Leads and every created-month table.',
      'Correct the Created Date cells in the source export (rows are in MISSING_LEADS).');
  }
  const ipInferred = raw.filter(r => r._ipInferred).length, cvInferred = raw.filter(r => r._cvInferred).length;
  if(ipInferred || cvInferred){
    const parts = [];
    if(ipInferred) parts.push(`${fmtIN(ipInferred)} IN PROCESS lead(s) with no in-process date`);
    if(cvInferred) parts.push(`${fmtIN(cvInferred)} CONVERTED lead(s) with no converted date`);
    add('warn', 'inferred-dates', 'Some status months were inferred',
      `${parts.join(' and ')}; the last-status month was used. Listed in MISSING_LEADS.`,
      'Set the date in the CRM.');
  }
  const future = raw.filter(r => { const d = parseDateAny(r.createdDate); return d && d.getTime() > Date.now() + DAY_MS; });
  if(future.length){
    add('warn', 'future-dated', `${fmtIN(future.length)} lead(s) are dated in the future`,
      `Latest is ${future.map(r => r.createdDate).sort().pop()}; usually a day/month swap.`,
      'Check the Created Date cells in the source export.');
  }
  const dateIssue = dateParseIssueReport();
  if(dateIssue) add('warn', 'unparseable-dates', dateIssue.headline, dateIssue.detail, dateIssue.fix);

  // ---- mapping ----
  for(const field of ['currentRmName', 'firstRmName']){
    const rep = unmappedRmIssueReport(field);
    if(rep) add('warn', 'unmapped-' + field, rep.headline, rep.detail, rep.fix);
  }
  const empTeams = new Map();
  for(const r of STATE.empref.slice(1)){
    const k = r && normalizeNameKey(r[2]);
    if(!k) continue;
    if(!empTeams.has(k)) empTeams.set(k, new Set());
    empTeams.get(k).add((r[1] || '').toString().trim());
  }
  const conflicts = [...empTeams].filter(([, t]) => t.size > 1);
  if(conflicts.length){
    add('error', 'emp-conflict', `${conflicts.length} RM(s) appear under more than one team in EMPLOYEE_REF`,
      `${sampleList(conflicts, ([k, t]) => `${k} → ${[...t].join(' / ')}`)}; the last row wins.`,
      'Keep one row per person in EMPLOYEE_REF.');
  }
  const ambiguous = Object.keys(STATE.rmMasterAmbiguous);
  if(ambiguous.length){
    add('warn', 'ambiguous-alias', `${ambiguous.length} RM Master alias(es) point at more than one person`,
      `${ambiguous.join(', ')}; no team is guessed for these names.`,
      'Give each alias one canonical RM in RM MASTER MAPPING.');
  }
  const teamNames = new Set(raw.map(r => r.Team || 'SV'));
  for(const r of STATE.empref.slice(1)) if(r && r[1]) teamNames.add(r[1].toString().trim());
  const extraTeams = [...teamNames].filter(t => t && !FIXED_TEAMS.includes(t));
  if(extraTeams.length){
    add('warn', 'extra-teams', `${extraTeams.length} team(s) are not in FIXED_TEAMS`,
      `${extraTeams.join(', ')} appear as extra rows but not in team filters.`,
      'Add the team to CONFIG.FIXED_TEAMS (app-config.js) or fix its spelling in EMPLOYEE_REF.');
  }

  // ---- duplicates / blanks ----
  const seen = new Set();
  let dupRows = 0;
  for(const r of raw){
    if(!r.userId) continue;
    const k = r.userId.toLowerCase() + '|' + r.leadHead;
    if(seen.has(k)) dupRows++; else seen.add(k);
  }
  if(dupRows){
    add('warn', 'duplicate-leads', `${fmtIN(dupRows)} lead row(s) repeat a client already listed`,
      'Same email and Lead Head more than once, so those clients are double-counted.',
      'De-duplicate in the source export.');
  }
  const noCampaign = raw.filter(r => !r['Campaign Name']).length;
  if(noCampaign){
    add('warn', 'no-campaign', `${fmtIN(noCampaign)} lead(s) have no Category name`,
      'They are in team and status totals but have no cost attributed and no Cost table row.',
      'Fill the category in the CRM.');
  }

  // ---- cost ----
  const costIssue = costSyncIssueReport();
  if(costIssue) add('warn', 'cost-sync', costIssue.headline, costIssue.detail, costIssue.fix);
  const cpcNames = new Set(STATE.cost.slice(1).map(r => String(r[0] || '').trim().toLowerCase()));
  const noCost = tallyBy(raw.filter(r => r['Campaign Name'] && !cpcNames.has(r['Campaign Name'].toLowerCase())),
    r => r['Campaign Name']);
  if(noCost.length){
    add('warn', 'no-cost-row', `${noCost.length} campaign(s) have leads but no Cost Per Campaign row`,
      `${sampleList(noCost, ([c, n]) => `${c} (${fmtIN(n)})`)}; they show ₹0 cost.`,
      'Add a row per campaign, spelled as the CRM Category.');
  }
  const noCostMonths = monthsWithoutCost();
  if(noCostMonths.length){
    add('warn', 'no-cost-month', `No cost entered for ${noCostMonths.join(', ')}`,
      'CPL, CPQL and CAC read ₹0 for these months.',
      'Enter the month\'s spend in the Cost Per Campaign sheet.');
  }

  // ---- FY window ----
  const lateMonths = STATE.months.filter(m => monthKey(m) >= FY_CUTOFF + 100);
  if(lateMonths.length){
    add('warn', 'fy-cutoff', 'The FY window looks out of date',
      `Data runs to ${lateMonths[lateMonths.length - 1]} but CONFIG.FY_CUTOFF_MONTH is ${CONFIG.FY_CUTOFF_MONTH}.`,
      'Set CONFIG.FY_CUTOFF_MONTH (app-config.js) to the first month of the current financial year.');
  }

  // ---- guards reported elsewhere ----
  const shape = tableShapeIssueReport();
  if(shape) add('warn', 'table-shape', shape.headline, shape.detail, shape.fix);
  const bind = bindingIssueReport();
  if(bind) add('warn', 'bindings', bind.headline, bind.detail, bind.fix);
  const rev = rmRevenueIssueReport();
  if(rev) add('warn', 'revenue', rev.headline, rev.detail, rev.fix);
  if(STATE.filesLoaded.bd){
    const bd = bdTrackerIssueReport();
    if(bd) add('info', 'bd-tracker', bd.headline, bd.detail, bd.fix);
  }

  return checks.sort((a, b) => HEALTH_LEVEL_RANK[a.level] - HEALTH_LEVEL_RANK[b.level]);
}

// ---- rendering ----
const HEALTH_ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
let _healthOpen = null;
let _healthTimer = null;

// Coalesced to the next tick: bulk operations fire renderDashboard repeatedly
// and the checks are the heaviest single step.
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
    // A failing check must not read as "healthy".
    console.error('[MIS] data-health check failed', e);
    host.innerHTML = '<div class="health-panel health-error"><strong>Data-health checks could not run.</strong> ' +
      escHtml(e.message || String(e)) + '</div>';
    return;
  }
  const count = lvl => checks.filter(c => c.level === lvl).length;
  const errors = count('error'), warns = count('warn'), infos = count('info');
  const worst = errors ? 'error' : warns ? 'warn' : 'ok';
  if(_healthOpen === null) _healthOpen = errors > 0;

  const noteText = infos ? ` · ${infos} note${infos > 1 ? 's' : ''}` : '';
  const summary = worst === 'ok'
    ? '✅ Data health: all checks passed' + noteText
    : `${errors ? HEALTH_ICON.error : HEALTH_ICON.warn} Data health: ` +
      [errors && `${errors} error${errors > 1 ? 's' : ''}`, warns && `${warns} warning${warns > 1 ? 's' : ''}`]
        .filter(Boolean).join(' · ') + noteText;

  const items = checks.map(c => `
    <li class="health-item health-${c.level}">
      <div class="health-title">${HEALTH_ICON[c.level]} ${escHtml(c.title)}</div>
      <div>${escHtml(c.detail)}</div>
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
}
