// app-activity.js — "Activity Change Days" (Dashboard subsection).
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// Answers one question: of the leads that entered an activity in a given
// month, WHERE DID THEY GO NEXT, how many went nowhere, and how long each
// move took.
//
// WHAT THE SOURCE GIVES US, and why that shapes everything here: the FIN23
// export carries ONE timestamp per activity (createdDate, leadFollowUpDate,
// leadOnHoldDate, leadInProcessDate, convertedDate, leadDeadDate) and the CRM
// overwrites each with the LAST time the lead entered that activity. There is
// no per-event history, so a lead that went On Hold -> In Process -> On Hold
// again shows only its final On Hold stamp and its final In Process stamp.
//
// Two readings follow from that, and the page shows both because they answer
// different questions:
//
//   NEXT STEP (the flow) — for each lead, the destination whose stamp is the
//   earliest one on/after the From stamp. Every lead lands in exactly one
//   destination or in "no further activity", so the flow PARTITIONS the
//   cohort and its nodes sum to it exactly. This is the actionable view: it
//   says where a cohort actually goes and how much of it stalls.
//
//   EVER REACHED (the table) — for each destination, every lead with a stamp
//   on/after the From stamp, counted once per destination. Overlapping, so
//   the column does NOT sum to the cohort: one lead can appear under three
//   destinations. This is the "did it eventually get there" view.
//
// A destination stamp dated BEFORE the From stamp is not a move either way
// (the file cannot tell us it happened after), so it is excluded from both
// and counted in the reversed tally the page reports.

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
/** Destinations for one From activity: every non-origin activity but itself. */
const activityDests = from => ACTIVITIES.filter(a => !a.origin && a.key !== from.key);

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
/** Local midnight today — the "sitting since" baseline for leads that never moved. */
function activityToday(){
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

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
 * own Month and From Activity supersede them.
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
 * The whole analysis for the selected From activity, in one pass.
 *
 * Each record: { row, fromDate, fromMonth, dest, toDate, days, ageDays }.
 * `dest` is null for a stalled lead, where `ageDays` is days since the From
 * stamp instead of `days`.
 *
 * Tie-break: two destinations stamped the same day are ordered by
 * CONFIG.ACTIVITIES, i.e. Follow Up, On Hold, In Process, Converted, Dead.
 * Dates carry no time (buildRawData truncates them), so same-day ties are
 * common and the rule has to be explicit rather than incidental.
 *
 * @returns {{from:Object, cohort:Array, dests:Array, stuck:Array, reach:Array, reversed:number}}
 */
function activityFanOut(){
  const from = activityByKey(STATE.activity.from);
  const months = activitySel(STATE.activity.month);
  const dests = activityDests(from);
  const nextOf = new Map(dests.map(d => [d.key, []]));
  const reachOf = new Map(dests.map(d => [d.key, []]));
  const out = { from, cohort: [], stuck: [], reversed: 0, dests: [], reach: [] };
  const today = activityToday();

  for(const r of activityPool()){
    const fd = parseDateAny(r[from.field]);
    if(!fd) continue;
    const fromMonth = activityMonthOf(fd);
    if(months && !months.includes(fromMonth)) continue;

    let next = null;
    for(const d of dests){
      const td = parseDateAny(r[d.field]);
      if(!td) continue;
      const days = Math.round((td.getTime() - fd.getTime()) / ACTIVITY_DAY_MS);
      if(days < 0){ out.reversed++; continue; }
      const rec = { row: r, fromDate: fd, fromMonth, dest: d, toDate: td, days, ageDays: null };
      reachOf.get(d.key).push(rec);
      if(!next || days < next.days) next = rec;
    }

    const landed = next || { row: r, fromDate: fd, fromMonth, dest: null, toDate: null, days: null,
                             ageDays: Math.round((today.getTime() - fd.getTime()) / ACTIVITY_DAY_MS) };
    if(next) nextOf.get(next.dest.key).push(landed); else out.stuck.push(landed);
    out.cohort.push(landed);
  }

  out.dests = dests.map(d => ({ act: d, recs: nextOf.get(d.key) }));
  out.reach = dests.map(d => ({ act: d, recs: reachOf.get(d.key) }));
  return out;
}

/** Cohort leads that did move on (the complement of fan.stuck). */
const activityMovedOn = fan => fan.cohort.filter(r => r.dest);

// ---- focus (drill-down) ---------------------------------------------------

// Clicking a flow card narrows the chart, the By Team table and the lead list
// to that one destination — or to the stalled leads — without changing the
// cohort above. null = the whole cohort.
function activityFocusRecs(fan){
  const f = STATE.activity.focus;
  if(!f) return { label: 'the whole cohort', recs: fan.cohort };
  if(f === 'stuck') return { label: 'leads with no further activity', recs: fan.stuck };
  const hit = fan.dests.find(d => d.act.key === f);
  return hit ? { label: 'leads whose next step was ' + hit.act.label, recs: hit.recs }
             : { label: 'the whole cohort', recs: fan.cohort };
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
const activityMoveStats = recs => activityStats(recs.filter(r => r.days != null).map(r => r.days));
const activityAgeStats  = recs => activityStats(recs.filter(r => r.ageDays != null).map(r => r.ageDays));

const ACTIVITY_BUCKETS = [
  { label: 'Same day',   hit: d => d === 0 },
  { label: '1–7 days',   hit: d => d >= 1  && d <= 7 },
  { label: '8–15 days',  hit: d => d >= 8  && d <= 15 },
  { label: '16–30 days', hit: d => d >= 16 && d <= 30 },
  { label: '31–60 days', hit: d => d >= 31 && d <= 60 },
  { label: '61–90 days', hit: d => d >= 61 && d <= 90 },
  { label: '90+ days',   hit: d => d >  90 },
];

function activityBucketCounts(recs){
  const days = recs.filter(r => r.days != null).map(r => r.days);
  return ACTIVITY_BUCKETS.map(b => ({ label: b.label, count: days.filter(b.hit).length }));
}

/**
 * Group the cohort by any key, summarising "moved on vs stalled" the same way
 * every time — shared by the By Team / By RM / By Month tables so the three
 * can never disagree about what a column means.
 */
function activityGroup(fan, keyOf, extraOf){
  const m = new Map();
  for(const rec of fan.cohort){
    const k = keyOf(rec) || '—';
    if(!m.has(k)) m.set(k, { label: k, recs: [], extra: extraOf ? extraOf(rec) : null });
    m.get(k).recs.push(rec);
  }
  return [...m.values()].map(g => activityGroupRow(g.label, g.recs, g.extra));
}
function activityGroupRow(label, recs, extra){
  const moved = recs.filter(r => r.dest);
  const stuck = recs.filter(r => !r.dest);
  const mv = activityMoveStats(moved), ag = activityAgeStats(stuck);
  return {
    label, extra, cohort: recs.length,
    moved: moved.length, movedPct: recs.length ? moved.length / recs.length : 0,
    stuck: stuck.length, stuckPct: recs.length ? stuck.length / recs.length : 0,
    avg: mv.avg, median: mv.median, p90: mv.p90, min: mv.min, max: mv.max,
    stuckMedianAge: ag.median, stuckMaxAge: ag.max,
  };
}
function activityTotalRow(fan){
  return { ...activityGroupRow('Grand Total', fan.cohort, ''), _tot: true };
}

// ---- all-transitions matrix ------------------------------------------------

// Every From × To pair at once for the current Team / RM / Month selection,
// as EVER-REACHED (not next-step), so the chosen From row can be read against
// the others. The Month filter applies to each row's OWN From activity, so a
// row is always "leads that entered this activity in the selected month(s)"
// and the Entered column differs row to row. Columns skip the origin
// activity, since nothing moves INTO Created / Assigned.
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
/** A focus on a destination the new From activity does not have must not stick. */
function activityPruneFocus(){
  const f = STATE.activity.focus;
  if(!f || f === 'stuck') return;
  const from = activityByKey(STATE.activity.from);
  if(!activityDests(from).some(d => d.key === f)) STATE.activity.focus = null;
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
  activityPruneFocus();
  buildMultiSelect('#act-team-wrap', ['All', ...activityTeamOptions()], f.team,
    val => { f.team = val; f.page = 1; activityPruneRm(); buildActivityRmFilter(); renderActivityChange(); }, { multi: true });
  buildActivityRmFilter();
  buildActivityMonthFilter();
  buildActivityFromFilter();
  _activityFiltersFor = activityFilterSignature();
}
function buildActivityRmFilter(){
  buildMultiSelect('#act-rm-wrap', ['All', ...activityRmOptions()], STATE.activity.rm,
    val => { STATE.activity.rm = val; STATE.activity.page = 1; renderActivityChange(); }, { multi: true, search: true });
}
function buildActivityMonthFilter(){
  buildMultiSelect('#act-month-wrap', ['All', ...activityMonthOptions()], STATE.activity.month,
    val => { STATE.activity.month = val; STATE.activity.page = 1; renderActivityChange(); }, { multi: true, search: true });
}
// From is single-pick, but buildMultiSelect always offers an "All" item (it is
// shared with the multi-select filters and prepends one unless the caller's
// own first option is 'All'). "All" means nothing for a cohort definition, so
// picking it snaps the widget back to the activity already selected rather
// than leaving the button labelled "All" over unchanged data.
function buildActivityFromFilter(){
  const f = STATE.activity;
  buildMultiSelect('#act-from-wrap', ACTIVITIES.map(a => a.label), activityLabel(f.from),
    val => {
      const a = ACTIVITIES.find(x => x.label === val);
      if(!a){ buildActivityFromFilter(); return; }
      f.from = a.key;
      f.page = 1;
      activityPruneMonth(); activityPruneFocus(); buildActivityMonthFilter(); renderActivityChange();
    }, { multi: false });
}

// ---- formatting helpers ---------------------------------------------------

const actDays = v => (v == null ? '—' : fmtIN(Math.round(v)) + 'd');
const actDaysExact = v => (v == null ? '' : Math.round(v * 10) / 10);
const actPct = v => (v == null ? '—' : fmtPct(v));

// ---- the flow -------------------------------------------------------------

// Tone per activity, so a destination keeps its colour across the flow and
// the tables. Dead reads red, Converted green, stalled grey.
const ACTIVITY_TONE = {
  created: 'blue', followup: 'amber', onhold: 'violet',
  inprocess: 'blue', converted: 'green', dead: 'red',
};
const activityTone = key => ACTIVITY_TONE[key] || 'muted';

function activityNode(opts){
  const sel = opts.focusKey && STATE.activity.focus === opts.focusKey;
  return `<div class="cf-node cf-${opts.tone}${opts.focusKey ? ' cf-click' : ''}${sel ? ' cf-on' : ''}"
       ${opts.focusKey ? `data-focus="${escHtml(opts.focusKey)}" role="button" tabindex="0"` : ''}
       ${opts.title ? `title="${escHtml(opts.title)}"` : ''}>
     <div class="cf-value">${opts.value}</div>
     <div class="cf-label">${escHtml(opts.label)}</div>
     ${opts.sub ? `<div class="cf-sub">${opts.sub}</div>` : ''}
   </div>`;
}

function renderActivityFlow(fan){
  const host = $('#act-flow');
  if(!host) return;
  const n = fan.cohort.length;
  const pct = v => (n ? fmtPct(v / n) : '0%');
  const moved = activityMovedOn(fan);

  // Destinations with at least one lead, busiest first; the rest are named in
  // the caption rather than drawn as a row of zeros.
  const live = fan.dests.filter(d => d.recs.length).sort((a, b) => b.recs.length - a.recs.length);
  const empty = fan.dests.filter(d => !d.recs.length);

  const nodes = live.map(d => {
    const st = activityMoveStats(d.recs);
    return activityNode({
      tone: activityTone(d.act.key), focusKey: d.act.key,
      value: fmtIN(d.recs.length), label: d.act.label,
      sub: `${pct(d.recs.length)} · median ${actDays(st.median)}`,
      title: `Click to narrow the chart, By Team table and lead list to these ${fmtIN(d.recs.length)} leads`,
    });
  });
  const ag = activityAgeStats(fan.stuck);
  nodes.push(activityNode({
    tone: 'muted', focusKey: 'stuck',
    value: fmtIN(fan.stuck.length), label: 'No further activity',
    sub: `${pct(fan.stuck.length)} · sitting median ${actDays(ag.median)}`,
    title: 'Leads with no activity stamp after this one — click to list them',
  }));

  const cols = Math.min(nodes.length, 6);
  host.innerHTML =
    `<div class="cf-flow">
      <div class="cf-row">${activityNode({
        tone: activityTone(fan.from.key), value: fmtIN(n),
        label: 'Entered ' + fan.from.label,
        sub: activitySel(STATE.activity.month)
          ? 'in ' + escHtml(activitySelText(STATE.activity.month))
          : 'in any month on record',
      })}</div>
      <div class="cf-split cf-split-${cols}"></div>
      <div class="cf-row cf-row-${cols}">${nodes.join('')}</div>
      <div class="cf-caption">
        Where those <strong>${fmtIN(n)}</strong> leads went <strong>next</strong> — each lead counted once, under its
        earliest stamp on or after the ${escHtml(fan.from.label)} stamp, so these cards add up to
        <strong>${fmtIN(n)}</strong> exactly.
        <strong>${fmtIN(moved.length)}</strong> moved on (${pct(moved.length)}); <strong>${fmtIN(fan.stuck.length)}</strong> did not.
        ${empty.length ? `No lead went next to ${empty.map(d => escHtml(d.act.label)).join(', ')}.` : ''}
        ${fan.reversed ? `${fmtIN(fan.reversed)} stamp(s) predate the ${escHtml(fan.from.label)} stamp and are not counted as moves.` : ''}
      </div>
     </div>`;

  host.querySelectorAll('.cf-click').forEach(el => {
    const set = () => {
      const k = el.dataset.focus;
      STATE.activity.focus = (STATE.activity.focus === k) ? null : k;
      STATE.activity.page = 1;
      renderActivityChange();
    };
    el.onclick = set;
    el.onkeydown = e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); set(); } };
  });
}

// ---- charts ---------------------------------------------------------------

// Sequential single-hue ramp, light → dark, over the ordered day buckets: the
// bars are one series (lead counts) and the colour reinforces "longer" — it is
// not a second variable.
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

function renderActivityBucketChart(recs){
  const data = activityBucketCounts(recs);
  const total = data.reduce((a, b) => a + b.count, 0);
  activityChart('activityBucketChart', '#act-bucket-chart', {
    type: 'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: data.map(d => d.label),
      datasets: [{
        label: 'Leads', data: data.map(d => d.count),
        backgroundColor: ACTIVITY_RAMP, borderColor: '#1e3a8a', borderWidth: 1,
        borderRadius: 4, maxBarThickness: 64,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 8, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => `${fmtIN(c.raw)} lead(s) · ${fmtPct(total ? c.raw / total : 0)} of those shown` } },
        datalabels: { anchor: 'end', align: 'top', offset: 2, color: '#1f2937',
          font: { size: 11, weight: 'bold' }, formatter: v => (v ? fmtIN(v) : '') },
      },
      scales: ACTIVITY_AXIS,
    },
  });
}

// The cohort can reach back years, and a chart of 50-odd months — several of
// them a single lead — is unreadable and drowns out the recent ones. The two
// month charts show a trailing window; the By Month table keeps every month.
const ACTIVITY_CHART_MONTHS = 13;
function activityChartMonths(byMonth){
  const sorted = [...byMonth].sort((a, b) => monthKey(a.label) - monthKey(b.label));
  const shown = sorted.length > ACTIVITY_CHART_MONTHS ? sorted.slice(-ACTIVITY_CHART_MONTHS) : sorted;
  return { shown, total: sorted.length, hidden: sorted.length - shown.length };
}
function activityHint(sel, text, win){
  const el = $(sel);
  if(!el) return;
  el.innerHTML = (win && win.hidden)
    ? `${text} Showing the most recent ${win.shown.length} of ${win.total} months — the By Month table below has every one.`
    : text;
}

function renderActivityVolumeChart(fan, win){
  const rows = win.shown;
  activityChart('activityVolumeChart', '#act-volume-chart', {
    type: 'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: rows.map(r => r.label),
      datasets: [
        { label: `Entered ${fan.from.label}`, data: rows.map(r => r.cohort),
          backgroundColor: ACTIVITY_COHORT_COLOR, borderRadius: 4, maxBarThickness: 34 },
        { label: 'Moved on to something', data: rows.map(r => r.moved),
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
        label: 'Median days to the next activity',
        data: rows.map(r => (r.moved ? Math.round(r.median * 10) / 10 : null)),
        borderColor: ACTIVITY_AVG_COLOR, backgroundColor: ACTIVITY_AVG_COLOR,
        borderWidth: 2, pointRadius: 4, pointHoverRadius: 7,
        pointBorderColor: '#fff', pointBorderWidth: 2, spanGaps: true, tension: 0.25,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, right: 10, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => (c.raw == null ? 'No lead moved on' : `${c.raw} days (median)`) } },
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

const ACTIVITY_SUMMARY_HEADERS = ['Entered', 'Moved On', '% Moved On', 'Median Days to Move',
  'Avg Days to Move', 'Never Moved', '% Never Moved', 'Median Days Sitting'];

const activitySummaryCells = r => ({
  Entered: fmtIN(r.cohort),
  'Moved On': fmtIN(r.moved),
  '% Moved On': actPct(r.movedPct),
  'Median Days to Move': actDays(r.median),
  'Avg Days to Move': actDays(r.avg),
  'Never Moved': fmtIN(r.stuck),
  '% Never Moved': actPct(r.stuckPct),
  'Median Days Sitting': actDays(r.stuckMedianAge),
});

// "% Never Moved vs Average" is the column that turns this table into a
// finding: 1.9x says the row is a problem, 1.0x says it is merely large.
// A multiple rather than a percentage-point gap, because a multiple stays
// comparable across From activities whose base rates differ wildly (7% of
// Created never moves again; 99% of On Hold does not). Blank for a row too
// small to judge, so nobody acts on two leads.
const activityIndexCell = (r, bench) => (r._tot
  ? '<strong>1.0&times;</strong>'
  : (r.cohort < ACTIVITY_MIN_BASE
    ? '<span style="color:#cbd5e1" title="Fewer than ' + ACTIVITY_MIN_BASE
      + ' leads - too few to judge">&mdash;</span>'
    : insightCell('<strong>' + (insightTimes(r.stuckPct, bench) || '&mdash;') + '</strong>',
        insightIndex(r.stuckPct, bench))));

function renderActivityByTeam(fan){
  const rows = activityGroup(fan, rec => activityTeamOf(rec.row)).sort((a, b) => b.stuck - a.stuck);
  const all = [...rows, activityTotalRow(fan)];
  const bench = fan.cohort.length ? fan.stuck.length / fan.cohort.length : 0;
  applyHeatAndLegend(all, 'stuck', '#legend-act-team', 'Row heat by leads that never moved');
  makeSortableTable('#tbl-act-team', ['Team', ...ACTIVITY_SUMMARY_HEADERS, '% Never Moved vs Average'],
    all.map(r => ({ Team: escHtml(r.label), ...activitySummaryCells(r),
      '% Never Moved vs Average': activityIndexCell(r, bench),
      _tot: !!r._tot, _heat: r._heat })),
    () => renderActivityByTeam(fan), { html: true });
}

function renderActivityByRm(fan){
  const rows = activityGroup(fan, rec => rec.row.currentRmName || '(no RM)', rec => activityTeamOf(rec.row))
    .sort((a, b) => b.stuck - a.stuck);
  const bench = fan.cohort.length ? fan.stuck.length / fan.cohort.length : 0;
  makeSortableTable('#tbl-act-rm', ['RM', 'Team', ...ACTIVITY_SUMMARY_HEADERS, '% Never Moved vs Average'],
    [...rows, activityTotalRow(fan)].map(r => ({
      RM: escHtml(r.label), Team: escHtml(r.extra || ''), ...activitySummaryCells(r),
      '% Never Moved vs Average': activityIndexCell(r, bench), _tot: !!r._tot,
    })),
    () => renderActivityByRm(fan), { html: true });
}

function renderActivityByMonth(fan, byMonth){
  const rows = [...byMonth].sort((a, b) => monthKey(b.label) - monthKey(a.label));
  renderTable('#tbl-act-month', ['Month Entered', ...ACTIVITY_SUMMARY_HEADERS],
    [...rows, activityTotalRow(fan)].map(r => ({
      'Month Entered': r.label, ...activitySummaryCells(r), _tot: !!r._tot,
    })));
}

// Next step vs ever reached, side by side — the one place the difference
// between the two readings is visible, and the reason the flow's Converted
// card is smaller than the eventual conversion count.
function renderActivityDestinations(fan){
  const n = fan.cohort.length;
  const headers = ['Destination', 'Went Here Next', '% of Cohort', 'Median Days (next step)',
    'Ever Reached', '% of Cohort (ever)', 'Median Days (ever)', 'Avg Days (ever)'];
  const rows = fan.dests.map((d, i) => {
    const nx = activityMoveStats(d.recs);
    const ev = activityMoveStats(fan.reach[i].recs);
    return {
      Destination: d.act.label,
      'Went Here Next': fmtIN(d.recs.length),
      '% of Cohort': actPct(n ? d.recs.length / n : 0),
      'Median Days (next step)': actDays(nx.median),
      'Ever Reached': fmtIN(fan.reach[i].recs.length),
      '% of Cohort (ever)': actPct(n ? fan.reach[i].recs.length / n : 0),
      'Median Days (ever)': actDays(ev.median),
      'Avg Days (ever)': actDays(ev.avg),
      _sort: d.recs.length,
    };
  }).sort((a, b) => b._sort - a._sort);
  rows.push({
    Destination: 'No further activity', 'Went Here Next': fmtIN(fan.stuck.length),
    '% of Cohort': actPct(n ? fan.stuck.length / n : 0),
    'Median Days (next step)': '—', 'Ever Reached': '—', '% of Cohort (ever)': '—',
    'Median Days (ever)': '—', 'Avg Days (ever)': '—', _tot: true,
  });
  renderTable('#tbl-act-dest', headers, rows);
}

// Rows = From activity, columns = To activity, ever-reached. Each cell reads
// "<median days> · <reached> of <entered>".
function renderActivityMatrix(){
  const matrix = activityMatrix();
  const headers = ['From ↓ / To →', 'Entered', ...activityToOptions().map(a => a.label)];
  const rows = matrix.map(r => {
    const o = { 'From ↓ / To →': `<strong>${escHtml(r.from.label)}</strong>`, Entered: fmtIN(r.cohort) };
    r.to.forEach(c => {
      o[c.to.label] = c.to.key === r.from.key
        ? '<span style="color:#cbd5e1">—</span>'
        : (c.moved
          ? `<strong>${escHtml(actDays(c.median))}</strong><br><span style="font-size:10px;color:#64748b">${fmtIN(c.moved)} of ${fmtIN(r.cohort)} · ${fmtPct(r.cohort ? c.moved / r.cohort : 0)}</span>`
          : '<span style="color:#94a3b8">0</span>');
    });
    return o;
  });
  renderTable('#tbl-act-matrix', headers, rows, { html: true });
}

// ---- lead detail ---------------------------------------------------------

const ACTIVITY_DETAIL_HEADERS = ['Client Name', 'RM', 'Team', 'Current Status', 'Platform', 'Campaign',
  'Entered', 'On', 'Next Activity', 'Next Date', 'Days'];

function activityDetailRow(fan, rec){
  return {
    'Client Name': rec.row.clientName,
    RM: rec.row.currentRmName,
    Team: activityTeamOf(rec.row),
    'Current Status': rec.row.leadStatus,
    Platform: rec.row.platformName,
    Campaign: rec.row['Campaign Name'],
    Entered: fan.from.label,
    On: toIsoDate(rec.fromDate),
    'Next Activity': rec.dest ? rec.dest.label : 'none yet',
    'Next Date': rec.toDate ? toIsoDate(rec.toDate) : '',
    Days: rec.dest ? rec.days : rec.ageDays,
  };
}

function renderActivityDetail(fan){
  const focus = activityFocusRecs(fan);
  // Stalled leads longest-sitting first (that is the follow-up list); movers
  // fastest first. With no drill-down, movers come before the stalled.
  const recs = [...focus.recs].sort((a, b) => {
    if(a.dest && b.dest) return a.days - b.days;
    if(!a.dest && !b.dest) return b.ageDays - a.ageDays;
    return a.dest ? -1 : 1;
  });
  const perPage = 15;
  const totalPages = Math.max(1, Math.ceil(recs.length / perPage));
  STATE.activity.page = Math.min(Math.max(1, STATE.activity.page), totalPages);
  const start = (STATE.activity.page - 1) * perPage;
  renderTable('#tbl-act-detail', ACTIVITY_DETAIL_HEADERS,
    recs.slice(start, start + perPage).map(rec => {
      const o = activityDetailRow(fan, rec);
      o.Days = rec.dest ? fmtIN(rec.days) : fmtIN(rec.ageDays) + ' sitting';
      return o;
    }));

  const scope = $('#act-detail-scope');
  if(scope) scope.textContent = STATE.activity.focus ? '— ' + focus.label : '';
  const info = $('#act-page-info');
  if(info) info.textContent = `Page ${STATE.activity.page} of ${totalPages} (${fmtIN(recs.length)} lead(s))`;
  const prev = $('#act-prev');
  if(prev){ prev.disabled = STATE.activity.page <= 1; prev.onclick = () => { STATE.activity.page--; renderActivityDetail(fan); }; }
  const next = $('#act-next');
  if(next){ next.disabled = STATE.activity.page >= totalPages; next.onclick = () => { STATE.activity.page++; renderActivityDetail(fan); }; }
  const dl = $('#act-download');
  if(dl) dl.onclick = () => downloadActivityExcel(fan, recs);
}

function downloadActivityExcel(fan, recs){
  const sheet = (headers, rows) => {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows.map(r => headers.map(h => r[h] ?? ''))]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(12, h.length + 2) }));
    return ws;
  };
  // Raw numbers in the workbook, not the page's "34d" / "62.5%" display text,
  // so the file can be pivoted and charted without re-parsing.
  const summaryHeaders = ['Label', 'Team', 'Entered', 'Moved On', '% Moved On', 'Median Days to Move',
    'Avg Days to Move', 'Never Moved', '% Never Moved', 'Median Days Sitting', 'Longest Sitting'];
  const summaryRow = r => ({
    Label: r.label, Team: r.extra || '', Entered: r.cohort, 'Moved On': r.moved,
    '% Moved On': r.cohort ? Math.round(r.movedPct * 10000) / 100 : 0,
    'Median Days to Move': actDaysExact(r.median), 'Avg Days to Move': actDaysExact(r.avg),
    'Never Moved': r.stuck, '% Never Moved': r.cohort ? Math.round(r.stuckPct * 10000) / 100 : 0,
    'Median Days Sitting': actDaysExact(r.stuckMedianAge), 'Longest Sitting': actDaysExact(r.stuckMaxAge),
  });
  const byTeam = activityGroup(fan, rec => activityTeamOf(rec.row)).sort((a, b) => b.stuck - a.stuck);
  const byRm = activityGroup(fan, rec => rec.row.currentRmName || '(no RM)', rec => activityTeamOf(rec.row))
    .sort((a, b) => b.stuck - a.stuck);
  const byMonth = activityGroup(fan, rec => rec.fromMonth).sort((a, b) => monthKey(b.label) - monthKey(a.label));
  const total = activityTotalRow(fan);

  const n = fan.cohort.length;
  const destHeaders = ['Destination', 'Went Here Next', 'Next Step % of Cohort', 'Median Days (next step)',
    'Ever Reached', 'Ever Reached % of Cohort', 'Median Days (ever)'];
  const destRows = fan.dests.map((d, i) => {
    const nx = activityMoveStats(d.recs), ev = activityMoveStats(fan.reach[i].recs);
    return {
      Destination: d.act.label, 'Went Here Next': d.recs.length,
      'Next Step % of Cohort': n ? Math.round(10000 * d.recs.length / n) / 100 : 0,
      'Median Days (next step)': actDaysExact(nx.median),
      'Ever Reached': fan.reach[i].recs.length,
      'Ever Reached % of Cohort': n ? Math.round(10000 * fan.reach[i].recs.length / n) / 100 : 0,
      'Median Days (ever)': actDaysExact(ev.median),
    };
  });
  destRows.push({ Destination: 'No further activity', 'Went Here Next': fan.stuck.length,
    'Next Step % of Cohort': n ? Math.round(10000 * fan.stuck.length / n) / 100 : 0 });

  const f = STATE.activity;
  const wsSel = XLSX.utils.aoa_to_sheet([
    ['Activity Change Days'], [],
    ['From Activity', fan.from.label],
    ['Month Entered', activitySelText(f.month)], ['Team', activitySelText(f.team)], ['RM', activitySelText(f.rm)],
    ['Lead Head (Dashboard header filter)', STATE.filterLeadHead],
    ['Drill-down applied to the Leads sheet', f.focus ? activityFocusRecs(fan).label : 'none (whole cohort)'], [],
    ['Entered the From activity', n], ['Moved on', activityMovedOn(fan).length],
    ['% moved on', n ? Math.round(total.movedPct * 10000) / 100 : 0],
    ['Never moved again', fan.stuck.length],
    ['Median days to the next activity', actDaysExact(total.median)],
    ['Median days sitting, of those that never moved', actDaysExact(total.stuckMedianAge)],
    ['Stamps dated before the From stamp (not counted)', fan.reversed], [],
    ['Next Step vs Ever Reached',
      'Went Here Next counts each lead once, under its earliest stamp on or after the From stamp, so it partitions '
      + 'the cohort. Ever Reached counts a lead under every destination it reached, so it overlaps and does not sum '
      + 'to the cohort. The export keeps only the last stamp per activity, so neither can see a repeated visit.'],
    ['Same-day ties', 'Dates carry no time, so two destinations stamped the same day are ordered '
      + 'Follow Up, On Hold, In Process, Converted, Dead.'],
    ['Team / RM basis', 'The lead\'s current RM, and that RM\'s team (EMPLOYEE_REF, then RM Master Mapping).'],
    ['Data till', STATE.dataTill || ''], ['Downloaded', new Date().toLocaleString('en-IN')],
  ]);
  wsSel['!cols'] = [{ wch: 48 }, { wch: 100 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(ACTIVITY_DETAIL_HEADERS, recs.map(rec => activityDetailRow(fan, rec))), 'Leads');
  XLSX.utils.book_append_sheet(wb, sheet(destHeaders, destRows), 'Destinations');
  XLSX.utils.book_append_sheet(wb, sheet(summaryHeaders, [...byTeam, total].map(summaryRow)), 'By Team');
  XLSX.utils.book_append_sheet(wb, sheet(summaryHeaders, [...byRm, total].map(summaryRow)), 'By RM');
  XLSX.utils.book_append_sheet(wb, sheet(summaryHeaders, [...byMonth, total].map(summaryRow)), 'By Month');
  XLSX.utils.book_append_sheet(wb, wsSel, 'Selection');
  const slug = s => s.replace(/[^A-Za-z0-9]+/g, '');
  XLSX.writeFile(wb, `Activity_From_${slug(fan.from.label)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---- the finding -----------------------------------------------------------

// A team with fewer than this many leads in the cohort is reported in the
// tables but never named as best or worst - see rule 2 in app-insights.js.
const ACTIVITY_MIN_BASE = 30;

/**
 * Team x destination, as each team's OWN rate rather than as counts.
 *
 * This is the table that answers "40% move to on hold - whose?". Counts
 * cannot answer it: the biggest book has the most of every destination, so
 * ranking by count always returns the same name and tells you nothing. Each
 * cell here is the share of THAT team's own cohort, so a small team parking
 * everything is visible next to a big team parking a third.
 *
 * @returns {{dests:Array, rows:Array, bench:Object}} `bench` holds the
 *   whole-cohort rate per destination - the number each cell is judged against.
 */
function activityDrivers(fan){
  const dests = fan.dests.map(d => d.act);
  const m = new Map();
  for(const rec of fan.cohort){
    const team = activityTeamOf(rec.row);
    if(!m.has(team)) m.set(team, { label: team, cohort: 0, hit: {}, stuck: 0, stuckAges: [] });
    const g = m.get(team);
    g.cohort++;
    if(rec.dest) g.hit[rec.dest.key] = (g.hit[rec.dest.key] || 0) + 1;
    else { g.stuck++; if(rec.ageDays != null) g.stuckAges.push(rec.ageDays); }
  }
  const n = fan.cohort.length;
  const bench = { stuck: n ? fan.stuck.length / n : 0 };
  for(const d of fan.dests) bench[d.act.key] = n ? d.recs.length / n : 0;
  const rows = [...m.values()].map(g => {
    g.rate = {};
    for(const d of dests) g.rate[d.key] = g.cohort ? (g.hit[d.key] || 0) / g.cohort : 0;
    g.stuckRate = g.cohort ? g.stuck / g.cohort : 0;
    g.stuckMedian = activityStats(g.stuckAges).median;
    g.judgeable = g.cohort >= ACTIVITY_MIN_BASE;
    return g;
  // Judgeable books first, worst of them at the top; the teams too small to
  // read sink to the bottom. Sorting on rate alone put a 6-lead team at 100%
  // in the first row, which is the exact noise rule 2 exists to keep out of
  // sight — and the first row is the one people act on.
  }).sort((a, b) => (b.judgeable - a.judgeable) || (b.stuckRate - a.stuckRate) || (b.cohort - a.cohort));
  return { dests, rows, bench };
}

function renderActivityDrivers(fan){
  const drv = activityDrivers(fan);
  const dests = drv.dests, bench = drv.bench;
  const ARROW = '→ ';
  const headers = ['Team', 'Entered'].concat(dests.map(d => ARROW + d.label),
    ['Never Moved', 'Median Days Sitting']);
  const cell = (count, rate, benchRate, big) => {
    if(!count) return '<span style="color:#cbd5e1">&mdash;</span>';
    const body = '<strong>' + fmtPct(rate) + '</strong><br>'
      + '<span style="font-size:10px;color:#64748b">' + fmtIN(count) + '</span>';
    // Only flag a team big enough to judge, and only against a benchmark that
    // exists; otherwise the grid lights up on noise.
    return (big && benchRate > 0) ? insightCell(body, rate / benchRate) : body;
  };
  const out = drv.rows.map(g => {
    const big = g.cohort >= ACTIVITY_MIN_BASE;
    const o = {
      Team: escHtml(g.label) + (insightIsPool(g.label)
        ? ' <span style="font-size:10px;color:#94a3b8">(pool)</span>' : ''),
      Entered: fmtIN(g.cohort),
      'Never Moved': cell(g.stuck, g.stuckRate, bench.stuck, big),
      'Median Days Sitting': actDays(g.stuckMedian),
    };
    dests.forEach(d => { o[ARROW + d.label] = cell(g.hit[d.key] || 0, g.rate[d.key], bench[d.key], big); });
    return o;
  });
  const n = fan.cohort.length;
  const tot = {
    Team: '<strong>All teams (the benchmark)</strong>', Entered: fmtIN(n),
    'Never Moved': '<strong>' + fmtPct(bench.stuck) + '</strong><br>'
      + '<span style="font-size:10px;color:#64748b">' + fmtIN(fan.stuck.length) + '</span>',
    'Median Days Sitting': actDays(activityAgeStats(fan.stuck).median), _tot: true,
  };
  fan.dests.forEach(d => {
    tot[ARROW + d.act.label] = '<strong>' + fmtPct(bench[d.act.key]) + '</strong><br>'
      + '<span style="font-size:10px;color:#64748b">' + fmtIN(d.recs.length) + '</span>';
  });
  out.push(tot);
  renderTable('#tbl-act-drivers', headers, out, { html: true });
}

/**
 * The headline verdict for the whole section.
 *
 * Built from rates, not counts, and it names the team only when the team
 * clears ACTIVITY_MIN_BASE. The unassigned SV pool is reported on its own line
 * because it is not a book anyone owns and it would otherwise win every
 * ranking by sheer size.
 */
function activityInsight(fan){
  const n = fan.cohort.length;
  if(!n) return null;

  const stuckRank = insightRank(
    activityDrivers(fan).rows.map(g => ({ label: g.label, base: g.cohort, hits: g.stuck })),
    { minBase: ACTIVITY_MIN_BASE });
  const stuckPct = fan.stuck.length / n;
  const ag = activityAgeStats(fan.stuck);
  const from = escHtml(fan.from.label);

  const biggest = [...fan.dests].sort((a, b) => b.recs.length - a.recs.length)[0];
  const points = [];

  // Where the cohort actually goes, so the verdict is not only bad news.
  if(biggest && biggest.recs.length){
    const st = activityMoveStats(biggest.recs);
    points.push('Of those that do move, most go to <strong>' + escHtml(biggest.act.label) + '</strong> &mdash; '
      + '<strong>' + fmtIN(biggest.recs.length) + '</strong> (' + fmtPct(biggest.recs.length / n)
      + ') in a median of <strong>' + actDays(st.median) + '</strong>.');
  }

  // Rule 1: the named culprit is a rate against the average, never a count.
  const spread = insightSpread(stuckRank, { noun: 'book', verb: 'leaves' });
  if(spread) points.push(spread);

  if(stuckRank.pool){
    points.push('The biggest single pile is the unassigned <strong>' + escHtml(stuckRank.pool.label)
      + '</strong> pool: <strong>' + fmtIN(stuckRank.pool.hits) + '</strong> of its '
      + fmtIN(stuckRank.pool.base) + ' (' + fmtPct(stuckRank.pool.rate) + '). That is an ownership problem, '
      + 'not a performance one &mdash; nobody is accountable for these until they are assigned.');
  }

  const dead = fan.dests.find(d => d.act.key === 'dead');
  const conv = fan.dests.find(d => d.act.key === 'converted');
  if(dead && conv && dead.recs.length > conv.recs.length * 2 && dead.recs.length >= 20){
    points.push('<strong>' + fmtIN(dead.recs.length) + '</strong> went straight to <strong>Dead</strong> against '
      + '<strong>' + fmtIN(conv.recs.length) + '</strong> straight to <strong>Converted</strong> &mdash; '
      + insightTimes(dead.recs.length, conv.recs.length) + ' as many.');
  }

  const held = insightHeldNote(stuckRank, 'lead(s)');

  return {
    tone: stuckPct >= 0.5 ? 'bad' : (stuckPct >= 0.25 ? 'warn' : 'good'),
    head: 'What this says',
    verdict: '<strong>' + fmtPct(stuckPct) + '</strong> of the <strong>' + fmtIN(n)
      + '</strong> leads that entered <strong>' + from + '</strong> have no later activity at all'
      + (ag.median == null ? '.' : ' &mdash; a median of <strong>' + actDays(ag.median)
        + '</strong> sitting, the oldest <strong>' + actDays(ag.max) + '</strong>.'),
    points: points,
    action: fan.stuck.length
      ? '<a href="#" class="in-act-btn">Show me those ' + fmtIN(fan.stuck.length) + ' leads &rarr;</a>'
      : '',
    onAction: () => {
      STATE.activity.focus = 'stuck';
      STATE.activity.page = 1;
      renderActivityChange();
      const host = $('#tbl-act-detail');
      if(host && host.scrollIntoView) host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    basis: 'Rates are each team&rsquo;s share of its <em>own</em> cohort, so a large book cannot top the list '
      + 'by size alone. ' + held + ' Teams are the lead&rsquo;s <strong>current</strong> owner.',
  };
}

// ---- orchestration -------------------------------------------------------

const ACTIVITY_HOSTS = ['#act-flow', '#act-insight', '#tbl-act-dest', '#tbl-act-drivers',
  '#tbl-act-team', '#tbl-act-rm', '#tbl-act-month', '#tbl-act-matrix', '#tbl-act-detail'];

function activityClear(html){
  _activityFiltersFor = null;
  const tiles = $('#act-kpis'); if(tiles) tiles.innerHTML = '';
  const note = $('#act-note'); if(note) note.innerHTML = html || '';
  ['#legend-act-team', '#act-bucket-hint', '#act-volume-hint', '#act-trend-hint']
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
  activityPruneFocus();

  const fan = activityFanOut();
  const byMonth = activityGroup(fan, rec => rec.fromMonth);
  const total = activityTotalRow(fan);
  const moved = activityMovedOn(fan);
  const focus = activityFocusRecs(fan);

  const title = $('#act-title');
  if(title) title.textContent = 'From ' + fan.from.label;

  const tiles = [
    { label: 'Entered ' + fan.from.label, value: fmtIN(fan.cohort.length), tone: 'blue' },
    { label: 'Moved On', value: fmtIN(moved.length), tone: 'green' },
    { label: '% Moved On', value: actPct(total.movedPct), tone: 'orange' },
    { label: 'Median Days to Move', value: total.median == null ? '—' : fmtIN(Math.round(total.median)), tone: 'violet' },
    { label: 'Never Moved Again', value: fmtIN(fan.stuck.length), tone: 'red' },
    { label: 'Median Days Sitting', value: total.stuckMedianAge == null ? '—' : fmtIN(Math.round(total.stuckMedianAge)), tone: 'amber' },
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
      `Cohort: every lead whose <strong>${escHtml(fan.from.label)}</strong> date falls in `
      + `<strong>${escHtml(activitySelText(f.month))}</strong> month(s), for Team `
      + `<strong>${escHtml(activitySelText(f.team))}</strong> and RM <strong>${escHtml(activitySelText(f.rm))}</strong> `
      + `(Lead Head <strong>${escHtml(STATE.filterLeadHead)}</strong>, from the header).`,
    ];
    if(f.focus) parts.push(`Drilled into <strong>${escHtml(focus.label)}</strong> — the chart, By Team table and lead `
      + `list below show only those ${fmtIN(focus.recs.length)}. Click the highlighted card again to clear it.`);
    if(!fan.cohort.length) parts.push('<strong>No lead matches this selection.</strong> Widen the month, team or RM filter.');
    note.innerHTML = parts.join(' ');
  }

  renderActivityFlow(fan);
  insightCard('#act-insight', activityInsight(fan));

  const win = activityChartMonths(byMonth);
  renderActivityBucketChart(focus.recs);
  renderActivityVolumeChart(fan, win);
  renderActivityTrendChart(win);
  activityHint('#act-bucket-hint',
    `Days from the ${escHtml(fan.from.label)} stamp to the next activity, for ${escHtml(focus.label)}. `
    + 'Leads that never moved are not in this chart — the Never Moved Again tile counts them.');
  activityHint('#act-volume-hint',
    `Per month in which a lead entered ${escHtml(fan.from.label)}: how many did, and how many went on to anything else.`, win);
  activityHint('#act-trend-hint',
    'Median over the leads that moved on, so a month where none did is left as a gap.', win);

  renderActivityDestinations(fan);
  renderActivityDrivers(fan);
  renderActivityByTeam(fan);
  renderActivityByRm(fan);
  renderActivityByMonth(fan, byMonth);
  renderActivityMatrix();
  renderActivityDetail(fan);

  const reset = $('#act-reset');
  if(reset) reset.onclick = () => {
    STATE.activity = { team: 'All', rm: 'All', month: 'All', from: 'created', focus: null, page: 1 };
    _activityFiltersFor = null;
    buildActivityFilters();
    renderActivityChange();
  };
}
