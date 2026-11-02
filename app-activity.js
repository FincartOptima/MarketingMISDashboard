// app-activity.js — "Activity Change Days" (Dashboard subsection).
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// Answers one question: of the leads that entered activity A in a given month,
// how many went on to activity B, and how long did it take?
//
// WHAT THE SOURCE ACTUALLY GIVES US, and why that shapes everything here:
// the FIN23 export carries ONE timestamp per activity (createdDate,
// leadFollowUpDate, leadOnHoldDate, leadInProcessDate, convertedDate,
// leadDeadDate) and the CRM overwrites each with the LAST time the lead
// entered that activity. There is no per-event history, so we cannot see a
// lead that went On Hold → In Process → On Hold again; we only see its final
// On Hold stamp and its final In Process stamp.
//
// So "A → B" is defined here as: the lead has an A stamp in the selected
// month(s), AND a B stamp dated on or after it. A lead whose B stamp predates
// its A stamp did NOT make this move as far as the file can tell — it is
// counted in the cohort (it genuinely entered A) but not as moved, and the
// number of such rows is reported on the page rather than quietly dropped.
// Everything downstream (tiles, charts, tables, Excel) uses that one rule.

// ---- availability ----------------------------------------------------------

// The three lead*Date columns arrived in the 2026-11-02 export format. An
// older file loads fine everywhere else but has nothing for this section to
// measure, so say so instead of rendering an empty page. Checked on the data
// actually loaded, not on the file name.
function activityDatesAvailable(){
  return STATE.raw.some(r => CONFIG.ACTIVITY_DATE_FIELDS.some(f => r[f]));
}
function activityMissingFields(){
  return CONFIG.ACTIVITY_DATE_FIELDS.filter(f => !STATE.raw.some(r => r[f]));
}

const activityByKey = key => ACTIVITIES.find(a => a.key === key) || ACTIVITIES[0];
const activityLabel = key => activityByKey(key).label;
/** Activities a lead can move INTO — everything but the origin (see CONFIG.ACTIVITIES). */
const activityToOptions = () => ACTIVITIES.filter(a => !a.origin);

/** Multi-select value → array of choices, or null for "All". */
function activitySel(v){
  if(!v || v === 'All' || (Array.isArray(v) && v.length === 0)) return null;
  return Array.isArray(v) ? v : [v];
}
function activitySelText(v){
  const sel = activitySel(v);
  return sel ? sel.join(', ') : 'All';
}

const ACTIVITY_DAY_MS = 86400000;
const activityMonthOf = d => `${MONTHS_3[d.getMonth()]}-${d.getFullYear()}`;

// ---- cohort ----------------------------------------------------------------

// Team and RM are the lead's CURRENT owner (row.Team is already resolved from
// currentRmName in rebuildTeamMap) — the activity stamps say when the lead
// last entered each state, not who moved it, so the person holding it now is
// the only attribution the file supports. Same basis as Stagnant In-Process.
const activityTeamOf = r => r.Team || 'SV';

/**
 * Rows in scope for the Team / RM filters, plus the Dashboard-wide Lead Head
 * filter (the one header filter that applies: it is the de-duplication rule
 * for secondary-applicant rows, not a view choice). The header's Month,
 * Ref+Cold and Status filters are deliberately NOT applied — this section's
 * own Month and From/To Activity supersede them.
 */
function activityPool(){
  const f = STATE.activity;
  const teams = activitySel(f.team), rms = activitySel(f.rm);
  const lh = STATE.filterLeadHead;
  return STATE.raw.filter(r => {
    if(lh && lh !== 'All' && r.leadHead !== lh) return false;
    if(teams && !teams.includes(activityTeamOf(r))) return false;
    if(rms && !rms.includes(r.currentRmName)) return false;
    return true;
  });
}

/**
 * The current From → To analysis.
 * @returns {{from:Object, to:Object, same:boolean, cohort:Array, moved:Array, reversed:number}}
 *   cohort: one record per lead with a From stamp in the selected month(s).
 *   moved:  the subset whose To stamp is on/after the From stamp (days set).
 *   reversed: cohort leads whose To stamp predates the From stamp.
 */
function activityChange(){
  const f = STATE.activity;
  const from = activityByKey(f.from), to = activityByKey(f.to);
  const months = activitySel(f.month);
  const out = { from, to, same: from.key === to.key, cohort: [], moved: [], reversed: 0 };
  if(out.same) return out;
  for(const r of activityPool()){
    const fd = parseDateAny(r[from.field]);
    if(!fd) continue;
    const fromMonth = activityMonthOf(fd);
    if(months && !months.includes(fromMonth)) continue;
    const td = parseDateAny(r[to.field]);
    const rec = { row: r, fromDate: fd, toDate: null, fromMonth, days: null, reversed: false };
    if(td){
      const days = Math.round((td.getTime() - fd.getTime()) / ACTIVITY_DAY_MS);
      if(days >= 0){ rec.toDate = td; rec.days = days; out.moved.push(rec); }
      else { rec.reversed = true; out.reversed++; }
    }
    out.cohort.push(rec);
  }
  return out;
}

// ---- stats -----------------------------------------------------------------

/** avg / median / p90 / fastest / slowest over a day-count array. */
function activityStats(days){
  if(!days.length) return { n: 0, avg: null, median: null, p90: null, min: null, max: null };
  const s = [...days].sort((a, b) => a - b);
  const at = q => s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  const mid = s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return {
    n: s.length,
    avg: s.reduce((a, b) => a + b, 0) / s.length,
    median: mid,
    p90: at(0.9),
    min: s[0],
    max: s[s.length - 1],
  };
}

const ACTIVITY_BUCKETS = [
  { label: 'Same day',   hit: d => d === 0 },
  { label: '1–7 days',   hit: d => d >= 1  && d <= 7 },
  { label: '8–15 days',  hit: d => d >= 8  && d <= 15 },
  { label: '16–30 days', hit: d => d >= 16 && d <= 30 },
  { label: '31–60 days', hit: d => d >= 31 && d <= 60 },
  { label: '61–90 days', hit: d => d >= 61 && d <= 90 },
  { label: '90+ days',   hit: d => d >  90 },
];

function activityBucketCounts(moved){
  return ACTIVITY_BUCKETS.map(b => ({ label: b.label, count: moved.filter(m => b.hit(m.days)).length }));
}

/**
 * Group the cohort by any key and summarise each group the same way.
 * Shared by the By Team / By RM / By Month tables so the three can never
 * disagree about what "Moved" or "Avg Days" means.
 */
function activityGroup(ch, keyOf, extraOf){
  const m = new Map();
  for(const rec of ch.cohort){
    const k = keyOf(rec) || '—';
    if(!m.has(k)) m.set(k, { label: k, cohort: 0, days: [], reversed: 0, extra: extraOf ? extraOf(rec) : null });
    const g = m.get(k);
    g.cohort++;
    if(rec.days != null) g.days.push(rec.days);
    else if(rec.reversed) g.reversed++;
  }
  const rows = [...m.values()].map(g => ({
    label: g.label, extra: g.extra, cohort: g.cohort, moved: g.days.length,
    pct: g.cohort ? g.days.length / g.cohort : 0, reversed: g.reversed,
    ...activityStats(g.days),
  }));
  return rows;
}

function activityTotalRow(ch){
  const st = activityStats(ch.moved.map(m => m.days));
  return {
    label: 'Grand Total', extra: '', cohort: ch.cohort.length, moved: ch.moved.length,
    pct: ch.cohort.length ? ch.moved.length / ch.cohort.length : 0, reversed: ch.reversed,
    ...st, _tot: true,
  };
}

// ---- all-transitions matrix ------------------------------------------------

// Every From × To pair at once for the current Team / RM / Month selection,
// so the one pair chosen above can be read in context. The Month filter still
// applies to each row's OWN From activity, exactly as it does for the chosen
// pair — so a matrix row is always "leads that entered this activity in the
// selected month(s)". Columns skip the origin activity, since nothing moves
// INTO Created / Assigned.
function activityMatrix(){
  const months = activitySel(STATE.activity.month);
  const cols = activityToOptions();
  const cells = ACTIVITIES.map(() => cols.map(() => ({ moved: 0, days: [] })));
  const cohorts = ACTIVITIES.map(() => 0);
  for(const r of activityPool()){
    const fromDates = ACTIVITIES.map(a => parseDateAny(r[a.field]));
    const toDates = cols.map(a => parseDateAny(r[a.field]));
    for(let i = 0; i < ACTIVITIES.length; i++){
      const fd = fromDates[i];
      if(!fd || (months && !months.includes(activityMonthOf(fd)))) continue;
      cohorts[i]++;
      for(let j = 0; j < cols.length; j++){
        if(cols[j].key === ACTIVITIES[i].key || !toDates[j]) continue;
        const days = Math.round((toDates[j].getTime() - fd.getTime()) / ACTIVITY_DAY_MS);
        if(days >= 0){ cells[i][j].moved++; cells[i][j].days.push(days); }
      }
    }
  }
  return ACTIVITIES.map((from, i) => ({
    from, cohort: cohorts[i],
    to: cols.map((to, j) => ({ to, moved: cells[i][j].moved, ...activityStats(cells[i][j].days) })),
  }));
}

// ---- filter options -------------------------------------------------------

// Option lists are built from the Lead-Head-filtered rows but NOT from this
// section's own Team / RM / Month choices (beyond RM following Team), so a
// dropdown never offers a value that yields an empty cohort, and changing one
// filter never silently empties another's list.
function activityOptionRows(){
  const lh = STATE.filterLeadHead;
  return (lh && lh !== 'All') ? STATE.raw.filter(r => r.leadHead === lh) : STATE.raw;
}
function activityTeamOptions(){
  const present = new Set(activityOptionRows().map(activityTeamOf));
  return [...FIXED_TEAMS.filter(t => present.has(t)), ...[...present].filter(t => !FIXED_TEAMS.includes(t)).sort()];
}
function activityRmOptions(){
  const teams = activitySel(STATE.activity.team);
  const rows = activityOptionRows().filter(r => !teams || teams.includes(activityTeamOf(r)));
  return [...new Set(rows.map(r => r.currentRmName).filter(Boolean))].sort();
}
/** Months in which any lead entered the selected From activity — newest first. */
function activityMonthOptions(){
  const field = activityByKey(STATE.activity.from).field;
  const set = new Set();
  for(const r of activityOptionRows()){
    const d = parseDateAny(r[field]);
    if(d) set.add(activityMonthOf(d));
  }
  return sortMonths([...set]).reverse();
}

// Drop selections the current Team / From choice no longer offers, so
// switching one filter can never leave the page showing an empty result for a
// selection the user can no longer see in the dropdown.
function activityPruneRm(){
  const sel = activitySel(STATE.activity.rm);
  if(!sel) return;
  const ok = new Set(activityRmOptions());
  const kept = sel.filter(v => ok.has(v));
  STATE.activity.rm = kept.length ? (kept.length === 1 ? kept[0] : kept) : 'All';
}
function activityPruneMonth(){
  const sel = activitySel(STATE.activity.month);
  if(!sel) return;
  const ok = new Set(activityMonthOptions());
  const kept = sel.filter(v => ok.has(v));
  STATE.activity.month = kept.length ? (kept.length === 1 ? kept[0] : kept) : 'All';
}

// The option lists depend on things outside this section — the header's Lead
// Head filter, the loaded dataset, and the EMPLOYEE_REF team map (editable in
// its own tab) — so the widgets are rebuilt when any of those change, and
// only then. Rebuilding on every render would tear down a multi-select the
// user is part-way through ticking, since each tick re-renders the section.
let _activityFiltersFor = null;
const activityFilterSignature = () =>
  [STATE.filterLeadHead, STATE.raw.length, Object.keys(STATE.teamMap).length].join('|');
function buildActivityFilters(){
  const f = STATE.activity;
  activityPruneRm();
  activityPruneMonth();
  buildMultiSelect('#act-team-wrap', ['All', ...activityTeamOptions()], f.team,
    val => { f.team = val; f.page = 1; activityPruneRm(); buildActivityRmFilter(); renderActivityChange(); }, { multi: true });
  buildActivityRmFilter();
  buildActivityMonthFilter();
  buildActivityFromFilter();
  buildActivityToFilter();
  _activityFiltersFor = activityFilterSignature();
}

// From and To are single-pick, but buildMultiSelect always offers an "All"
// item (it is shared with the multi-select filters and prepends one unless the
// caller's own first option is 'All'). "All" means nothing for a transition
// endpoint, so picking it snaps the widget back to the activity already
// selected rather than leaving the button labelled "All" over unchanged data.
function buildActivityFromFilter(){
  const f = STATE.activity;
  buildMultiSelect('#act-from-wrap', ACTIVITIES.map(a => a.label), activityLabel(f.from),
    val => {
      const a = ACTIVITIES.find(x => x.label === val);
      if(!a){ buildActivityFromFilter(); return; }
      f.from = a.key;
      f.page = 1;
      activityPruneMonth(); buildActivityMonthFilter(); renderActivityChange();
    }, { multi: false });
}
function buildActivityToFilter(){
  const f = STATE.activity;
  // Nothing moves INTO Created / Assigned, so the origin is a From only.
  if(activityByKey(f.to).origin) f.to = activityToOptions()[0].key;
  buildMultiSelect('#act-to-wrap', activityToOptions().map(a => a.label), activityLabel(f.to),
    val => {
      const a = activityToOptions().find(x => x.label === val);
      if(!a){ buildActivityToFilter(); return; }
      f.to = a.key;
      f.page = 1;
      renderActivityChange();
    }, { multi: false });
}
function buildActivityRmFilter(){
  buildMultiSelect('#act-rm-wrap', ['All', ...activityRmOptions()], STATE.activity.rm,
    val => { STATE.activity.rm = val; STATE.activity.page = 1; renderActivityChange(); }, { multi: true, search: true });
}
function buildActivityMonthFilter(){
  buildMultiSelect('#act-month-wrap', ['All', ...activityMonthOptions()], STATE.activity.month,
    val => { STATE.activity.month = val; STATE.activity.page = 1; renderActivityChange(); }, { multi: true, search: true });
}

// ---- formatting helpers ---------------------------------------------------

const actDays = v => (v == null ? '—' : fmtIN(Math.round(v)) + 'd');
const actDaysExact = v => (v == null ? '' : Math.round(v * 10) / 10);
const actPct = v => (v == null ? '—' : fmtPct(v));

// ---- charts ---------------------------------------------------------------

// Sequential single-hue ramp, light → dark, over the ordered day buckets:
// the bars are one series (lead counts) and the colour reinforces "longer" —
// it is not a second variable. Validated for lightness monotonicity.
const ACTIVITY_RAMP = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'];
// Two series, same unit (leads), one axis. Checked with the dataviz validator:
// adjacent ΔE 21.5 deutan / 22.8 normal against the light surface.
const ACTIVITY_COHORT_COLOR = '#0284c7';
const ACTIVITY_MOVED_COLOR  = '#16a34a';
const ACTIVITY_AVG_COLOR    = '#8b5cf6';

const ACTIVITY_AXIS = {
  x: { ticks: { color: '#475569', font: { size: 11, weight: '600' }, maxRotation: 0, minRotation: 0 },
       grid: { display: false }, border: { color: '#cbd5e1' } },
  y: { beginAtZero: true, ticks: { color: '#64748b', callback: v => fmtIN(v) },
       grid: { color: 'rgba(148,163,184,.25)' }, border: { color: '#cbd5e1' } },
};

function activityChart(key, canvasSel, config){
  if(!window.Chart) return;
  const canvas = $(canvasSel);
  if(!canvas) return;
  if(STATE[key]) STATE[key].destroy();
  STATE[key] = new Chart(canvas.getContext('2d'), config);
}

function renderActivityBucketChart(ch){
  const data = activityBucketCounts(ch.moved);
  activityChart('activityBucketChart', '#act-bucket-chart', {
    type: 'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: 'Leads',
        data: data.map(d => d.count),
        backgroundColor: ACTIVITY_RAMP,
        borderColor: '#1e3a8a',
        borderWidth: 1,
        borderRadius: 4,
        maxBarThickness: 64,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 8, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${fmtIN(c.raw)} lead(s) · ${fmtPct(ch.moved.length ? c.raw / ch.moved.length : 0)} of those that moved` } },
        datalabels: {
          anchor: 'end', align: 'top', offset: 2, color: '#1f2937',
          font: { size: 11, weight: 'bold' },
          formatter: v => (v ? fmtIN(v) : ''),
        },
      },
      scales: ACTIVITY_AXIS,
    },
  });
}

// The cohort can reach back years (the oldest On Hold stamp in the 2026-11-02
// export is from 2018), and a chart of 50-odd months — several of them a
// single lead that moved after 2,400 days — is unreadable and drowns out the
// recent ones. The two month charts therefore show a trailing window; the By
// Month table below them keeps every month, and the hint says what was cut.
const ACTIVITY_CHART_MONTHS = 13;
function activityChartMonths(byMonth){
  const sorted = [...byMonth].sort((a, b) => monthKey(a.label) - monthKey(b.label));
  const shown = sorted.length > ACTIVITY_CHART_MONTHS ? sorted.slice(-ACTIVITY_CHART_MONTHS) : sorted;
  return { shown, total: sorted.length, hidden: sorted.length - shown.length };
}
function activityChartHint(sel, win, what){
  const el = $(sel);
  if(!el) return;
  el.textContent = win.hidden
    ? `${what} Showing the most recent ${win.shown.length} of ${win.total} months — the By Month table below has every one.`
    : what;
}

function renderActivityVolumeChart(ch, win){
  const rows = win.shown;
  activityChart('activityVolumeChart', '#act-volume-chart', {
    type: 'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: rows.map(r => r.label),
      datasets: [
        { label: `In ${ch.from.label}`, data: rows.map(r => r.cohort),
          backgroundColor: ACTIVITY_COHORT_COLOR, borderRadius: 4, maxBarThickness: 34 },
        { label: `Moved to ${ch.to.label}`, data: rows.map(r => r.moved),
          backgroundColor: ACTIVITY_MOVED_COLOR, borderRadius: 4, maxBarThickness: 34 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 20, right: 8, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#475569', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtIN(c.raw)}` } },
        datalabels: { display: false },
      },
      scales: {
        x: { ...ACTIVITY_AXIS.x, ticks: { ...ACTIVITY_AXIS.x.ticks, maxRotation: 60, minRotation: 0 } },
        y: ACTIVITY_AXIS.y,
      },
    },
  });
}

function renderActivityTrendChart(win){
  const rows = win.shown;
  activityChart('activityTrendChart', '#act-trend-chart', {
    type: 'line',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: rows.map(r => r.label),
      datasets: [{
        label: 'Average days to move',
        data: rows.map(r => (r.moved ? Math.round(r.avg * 10) / 10 : null)),
        borderColor: ACTIVITY_AVG_COLOR,
        backgroundColor: ACTIVITY_AVG_COLOR,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        spanGaps: true,
        tension: 0.25,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 10, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => (c.raw == null ? 'No lead moved' : `${c.raw} days on average`) } },
        datalabels: {
          align: 'top', offset: 6, color: '#5b21b6', font: { size: 10, weight: 'bold' },
          formatter: (v, c) => (v == null ? '' : (c.dataIndex % Math.ceil(rows.length / 8 || 1) === 0 ? v : '')),
        },
      },
      scales: {
        x: { ...ACTIVITY_AXIS.x, ticks: { ...ACTIVITY_AXIS.x.ticks, maxRotation: 60, minRotation: 0 } },
        y: { ...ACTIVITY_AXIS.y, title: { display: true, text: 'Days', color: '#64748b', font: { size: 11 } } },
      },
    },
  });
}

// ---- tables ---------------------------------------------------------------

const ACTIVITY_SUMMARY_HEADERS = ['In From Activity', 'Moved to To Activity', '% Moved', 'Avg Days',
  'Median Days', '90th Pct Days', 'Fastest', 'Slowest'];

const activitySummaryCells = r => ({
  'In From Activity': fmtIN(r.cohort),
  'Moved to To Activity': fmtIN(r.moved),
  '% Moved': actPct(r.pct),
  'Avg Days': actDays(r.avg),
  'Median Days': actDays(r.median),
  '90th Pct Days': actDays(r.p90),
  Fastest: actDays(r.min),
  Slowest: actDays(r.max),
});

function renderActivityByTeam(ch){
  const rows = activityGroup(ch, rec => activityTeamOf(rec.row))
    .sort((a, b) => b.cohort - a.cohort);
  const all = [...rows, activityTotalRow(ch)];
  applyHeatAndLegend(all, 'cohort', '#legend-act-team', `Row heat by leads in ${ch.from.label}`);
  const headers = ['Team', ...ACTIVITY_SUMMARY_HEADERS];
  makeSortableTable('#tbl-act-team', headers,
    all.map(r => ({ Team: r.label, ...activitySummaryCells(r), _tot: !!r._tot, _heat: r._heat })),
    () => renderActivityByTeam(ch));
}

function renderActivityByRm(ch){
  const rows = activityGroup(ch, rec => rec.row.currentRmName || '(no RM)', rec => activityTeamOf(rec.row))
    .sort((a, b) => b.cohort - a.cohort);
  const headers = ['RM', 'Team', ...ACTIVITY_SUMMARY_HEADERS];
  makeSortableTable('#tbl-act-rm', headers,
    [...rows, activityTotalRow(ch)].map(r => ({
      RM: r.label, Team: r.extra || '', ...activitySummaryCells(r), _tot: !!r._tot,
    })),
    () => renderActivityByRm(ch));
}

function renderActivityByMonth(ch, byMonth){
  const rows = [...byMonth].sort((a, b) => monthKey(b.label) - monthKey(a.label));
  const headers = ['Month of From Activity', ...ACTIVITY_SUMMARY_HEADERS];
  renderTable('#tbl-act-month', headers,
    [...rows, activityTotalRow(ch)].map(r => ({
      'Month of From Activity': r.label, ...activitySummaryCells(r), _tot: !!r._tot,
    })));
}

// Rows = From activity, columns = To activity. Each cell reads
// "<avg days> · <moved> of <cohort>" so the chosen pair above can be compared
// against every other pair under the same Team / RM / Month selection.
function renderActivityMatrix(){
  const matrix = activityMatrix();
  const headers = ['From ↓ / To →', 'In From Activity', ...activityToOptions().map(a => a.label)];
  const rows = matrix.map(r => {
    const o = { 'From ↓ / To →': `<strong>${escHtml(r.from.label)}</strong>`, 'In From Activity': fmtIN(r.cohort) };
    r.to.forEach(c => {
      o[c.to.label] = c.to.key === r.from.key
        ? '<span style="color:#cbd5e1">—</span>'
        : (c.moved
          ? `<strong>${escHtml(actDays(c.avg))}</strong><br><span style="font-size:10px;color:#64748b">${fmtIN(c.moved)} of ${fmtIN(r.cohort)} · ${fmtPct(r.cohort ? c.moved / r.cohort : 0)}</span>`
          : '<span style="color:#94a3b8">0</span>');
    });
    return o;
  });
  renderTable('#tbl-act-matrix', headers, rows, { html: true });
}

// ---- lead detail ---------------------------------------------------------

const ACTIVITY_DETAIL_HEADERS = ['Client Name', 'RM', 'Team', 'Current Status', 'Platform', 'Campaign',
  'From Activity', 'From Date', 'To Activity', 'To Date', 'Days to Move'];

function activityDetailRow(ch, rec){
  return {
    'Client Name': rec.row.clientName,
    RM: rec.row.currentRmName,
    Team: activityTeamOf(rec.row),
    'Current Status': rec.row.leadStatus,
    Platform: rec.row.platformName,
    Campaign: rec.row['Campaign Name'],
    'From Activity': ch.from.label,
    'From Date': toIsoDate(rec.fromDate),
    'To Activity': ch.to.label,
    'To Date': rec.toDate ? toIsoDate(rec.toDate) : '',
    'Days to Move': rec.days == null ? '' : rec.days,
  };
}

function renderActivityDetail(ch){
  // Leads that moved first (fastest first), then the ones still sitting in the
  // From activity — the ones a reader most often wants to chase.
  const moved = [...ch.moved].sort((a, b) => a.days - b.days);
  const notMoved = ch.cohort.filter(r => r.days == null);
  const all = [...moved, ...notMoved];
  const perPage = 15;
  const totalPages = Math.max(1, Math.ceil(all.length / perPage));
  STATE.activity.page = Math.min(Math.max(1, STATE.activity.page), totalPages);
  const start = (STATE.activity.page - 1) * perPage;
  renderTable('#tbl-act-detail', ACTIVITY_DETAIL_HEADERS,
    all.slice(start, start + perPage).map(rec => {
      const o = activityDetailRow(ch, rec);
      o['Days to Move'] = rec.days == null ? 'Not moved' : fmtIN(rec.days);
      return o;
    }));

  const info = $('#act-page-info');
  if(info) info.textContent = `Page ${STATE.activity.page} of ${totalPages} (${fmtIN(all.length)} lead(s): `
    + `${fmtIN(moved.length)} moved, ${fmtIN(notMoved.length)} not)`;
  const prev = $('#act-prev');
  if(prev){ prev.disabled = STATE.activity.page <= 1; prev.onclick = () => { STATE.activity.page--; renderActivityDetail(ch); }; }
  const next = $('#act-next');
  if(next){ next.disabled = STATE.activity.page >= totalPages; next.onclick = () => { STATE.activity.page++; renderActivityDetail(ch); }; }
  const dl = $('#act-download');
  if(dl) dl.onclick = () => downloadActivityExcel(ch, all);
}

function downloadActivityExcel(ch, all){
  const sheet = (headers, rows) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
    return ws;
  };
  // Raw numbers in the workbook, not the page's "34d" / "62.5%" display text,
  // so the file can be pivoted and charted without re-parsing.
  const summaryHeaders = ['Label', 'Team', 'In From Activity', 'Moved', '% Moved', 'Avg Days', 'Median Days',
    '90th Pct Days', 'Fastest Days', 'Slowest Days', 'To stamp before From stamp'];
  const summaryRow = r => ({
    Label: r.label, Team: r.extra || '', 'In From Activity': r.cohort, Moved: r.moved,
    '% Moved': r.cohort ? Math.round(r.pct * 10000) / 100 : 0,
    'Avg Days': actDaysExact(r.avg), 'Median Days': actDaysExact(r.median), '90th Pct Days': actDaysExact(r.p90),
    'Fastest Days': actDaysExact(r.min), 'Slowest Days': actDaysExact(r.max),
    'To stamp before From stamp': r.reversed,
  });
  const byTeam = activityGroup(ch, rec => activityTeamOf(rec.row)).sort((a, b) => b.cohort - a.cohort);
  const byRm = activityGroup(ch, rec => rec.row.currentRmName || '(no RM)', rec => activityTeamOf(rec.row))
    .sort((a, b) => b.cohort - a.cohort);
  const byMonth = activityGroup(ch, rec => rec.fromMonth).sort((a, b) => monthKey(b.label) - monthKey(a.label));
  const total = activityTotalRow(ch);

  const f = STATE.activity;
  const wsSel = XLSX.utils.aoa_to_sheet([
    ['Activity Change Days'], [],
    ['From Activity', ch.from.label], ['To Activity', ch.to.label],
    ['Month of From Activity', activitySelText(f.month)], ['Team', activitySelText(f.team)], ['RM', activitySelText(f.rm)],
    ['Lead Head (Dashboard header filter)', STATE.filterLeadHead], [],
    ['In the From activity', ch.cohort.length], ['Moved to the To activity', ch.moved.length],
    ['% Moved', total.cohort ? Math.round(total.pct * 10000) / 100 : 0],
    ['Average days to move', actDaysExact(total.avg)], ['Median days to move', actDaysExact(total.median)],
    ['To stamp dated before the From stamp (not counted as moved)', ch.reversed], [],
    ['How a move is counted',
      'The export carries one timestamp per activity — the LAST time the lead entered it, with no per-event history. '
      + 'A lead counts as moved when it has a To stamp dated on or after its From stamp. A To stamp that predates the '
      + 'From stamp is reported above but not counted as a move.'],
    ['Team / RM basis', 'The lead\'s current RM, and that RM\'s team (EMPLOYEE_REF, then RM Master Mapping).'],
    ['Data till', STATE.dataTill || ''], ['Downloaded', new Date().toLocaleString('en-IN')],
  ]);
  wsSel['!cols'] = [{ wch: 56 }, { wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(ACTIVITY_DETAIL_HEADERS, all.map(rec => activityDetailRow(ch, rec))), 'Leads');
  XLSX.utils.book_append_sheet(wb, sheet(summaryHeaders, [...byTeam, total].map(summaryRow)), 'By Team');
  XLSX.utils.book_append_sheet(wb, sheet(summaryHeaders, [...byRm, total].map(summaryRow)), 'By RM');
  XLSX.utils.book_append_sheet(wb, sheet(summaryHeaders, [...byMonth, total].map(summaryRow)), 'By Month');
  XLSX.utils.book_append_sheet(wb, wsSel, 'Selection');
  const slug = s => s.replace(/[^A-Za-z0-9]+/g, '');
  XLSX.writeFile(wb, `Activity_${slug(ch.from.label)}_to_${slug(ch.to.label)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---- orchestration -------------------------------------------------------

const ACTIVITY_HOSTS = ['#tbl-act-team', '#tbl-act-rm', '#tbl-act-month', '#tbl-act-matrix', '#tbl-act-detail'];

function activityClear(html){
  _activityFiltersFor = null;
  const tiles = $('#act-kpis'); if(tiles) tiles.innerHTML = '';
  const note = $('#act-note'); if(note) note.innerHTML = html || '';
  ['#legend-act-team', '#act-volume-hint', '#act-trend-hint']
    .forEach(sel => { const el = $(sel); if(el) el.innerHTML = ''; });
  ACTIVITY_HOSTS.forEach(sel => { const el = $(sel); if(el) el.innerHTML = ''; });
  ['activityBucketChart', 'activityVolumeChart', 'activityTrendChart'].forEach(k => {
    if(STATE[k]){ STATE[k].destroy(); STATE[k] = null; }
  });
  const info = $('#act-page-info'); if(info) info.textContent = '';
}

function renderActivityChange(){
  if(!STATE.filesLoaded.fin23){
    activityClear('');
    setNotUploaded('#tbl-act-detail', 'fin23');
    return;
  }
  if(!activityDatesAvailable()){
    activityClear(`<div class="file-not-uploaded"><span class="fnu-icon">&#9888;</span>
      <strong>This B2C export has no activity-date columns.</strong><br>
      Activity Change Days needs <code>${activityMissingFields().join('</code>, <code>')}</code> — columns the
      FIN23 export only started carrying on 2nd Nov 2026. Everything else on the dashboard is unaffected.<br>
      Download a fresh copy of the B2C lead file and upload it on the backend <code>/upload</code> page, then reload.</div>`);
    return;
  }
  if(_activityFiltersFor !== activityFilterSignature()) buildActivityFilters();

  const ch = activityChange();
  const title = $('#act-title');
  if(title) title.textContent = `${ch.from.label} → ${ch.to.label}`;
  if(ch.same){
    activityClear(`<div class="file-not-uploaded"><span class="fnu-icon">&#9888;</span>
      <strong>From Activity and To Activity are the same.</strong><br>
      Pick two different activities to measure the move between them.</div>`);
    return;
  }

  const byMonth = activityGroup(ch, rec => rec.fromMonth);
  const total = activityTotalRow(ch);

  const tiles = [
    { label: `In ${ch.from.label}`, value: fmtIN(ch.cohort.length), tone: 'blue' },
    { label: `Moved to ${ch.to.label}`, value: fmtIN(ch.moved.length), tone: 'green' },
    { label: '% Moved', value: actPct(total.pct), tone: 'orange' },
    { label: 'Avg Days to Move', value: total.avg == null ? '—' : fmtIN(Math.round(total.avg)), tone: 'violet' },
    { label: 'Median Days to Move', value: total.median == null ? '—' : fmtIN(Math.round(total.median)), tone: 'cyan' },
    { label: `Still Not in ${ch.to.label}`, value: fmtIN(ch.cohort.length - ch.moved.length), tone: 'red' },
  ];
  const host = $('#act-kpis');
  if(host) host.innerHTML = tiles.map(c => `
    <div class="kpi kpi-${c.tone}">
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${escHtml(c.label)}</div>
    </div>`).join('');

  const note = $('#act-note');
  if(note){
    const f = STATE.activity;
    const parts = [
      `Cohort: every lead whose <strong>${escHtml(ch.from.label)}</strong> date falls in <strong>${escHtml(activitySelText(f.month))}</strong>`
      + ` month(s), for Team <strong>${escHtml(activitySelText(f.team))}</strong> and RM <strong>${escHtml(activitySelText(f.rm))}</strong>`
      + ` (Lead Head <strong>${escHtml(STATE.filterLeadHead)}</strong>, from the header).`,
      `A lead counts as moved when its <strong>${escHtml(ch.to.label)}</strong> date is on or after its `
      + `<strong>${escHtml(ch.from.label)}</strong> date.`,
    ];
    if(ch.reversed) parts.push(`<strong>${fmtIN(ch.reversed)}</strong> lead(s) in this cohort have their `
      + `<strong>${escHtml(ch.to.label)}</strong> date <em>earlier</em> than their <strong>${escHtml(ch.from.label)}</strong> date. `
      + `The export keeps only the last stamp per activity, so that move cannot be read as `
      + `${escHtml(ch.from.label)} → ${escHtml(ch.to.label)}; they are in the cohort but not counted as moved.`);
    if(!ch.cohort.length) parts.push('<strong>No lead matches this selection.</strong> Widen the month, team or RM filter.');
    note.innerHTML = parts.join(' ');
  }

  const win = activityChartMonths(byMonth);
  renderActivityBucketChart(ch);
  renderActivityVolumeChart(ch, win);
  renderActivityTrendChart(win);
  activityChartHint('#act-volume-hint', win,
    `Per month in which a lead entered ${ch.from.label}: how many did, and how many went on to ${ch.to.label}.`);
  activityChartHint('#act-trend-hint', win,
    `Averaged over the leads that moved, so a month where none did is left as a gap. Use Median Days in the tables when a few very slow leads pull the average.`);
  renderActivityByTeam(ch);
  renderActivityByRm(ch);
  renderActivityByMonth(ch, byMonth);
  renderActivityMatrix();
  renderActivityDetail(ch);

  const reset = $('#act-reset');
  if(reset) reset.onclick = () => {
    STATE.activity = { team: 'All', rm: 'All', month: 'All', from: 'created', to: 'inprocess', page: 1 };
    _activityFiltersFor = null;
    buildActivityFilters();
    renderActivityChange();
  };
}
