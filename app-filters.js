// app-filters.js — Month/team/ref-cold filters, multi-select widget, tab bar, premium lock.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- filters / tabs ----
const FY_CUTOFF = monthKey(CONFIG.FY_CUTOFF_MONTH);
function filteredMonths(){ return STATE.months.filter(m => monthKey(m) >= FY_CUTOFF); }

// Multi-select helpers
function monthFilter(m){
  const f = STATE.filterMonth;
  if(!f || f === 'All' || (Array.isArray(f) && f.length === 0)) return filteredMonths().includes(m);
  if(Array.isArray(f)) return f.includes(m);
  return m === f;
}
function isAllMonths(){ const f = STATE.filterMonth; return !f || f === 'All' || (Array.isArray(f) && f.length === 0); }
// True only when the user explicitly picked specific months. "All" now means "all dropdown months (Apr-2026+)".
function hasSpecificMonths(){ return !isAllMonths(); }
// Returns the effective month list: user selection if any, else the full dropdown set (Apr-2026+).
function effectiveMonths(){
  const f = STATE.filterMonth;
  if(isAllMonths()) return filteredMonths();
  return Array.isArray(f) ? f : [f];
}
function rcFilter(mode){ const f = STATE.filterRefCold; return Array.isArray(f) ? (f[0] || 'Include') : (f || 'Include'); }

// Lead Head options are read from the data itself (like months), so a new
// value uploaded tomorrow shows up with no code change. Sourced from the
// FULL unfiltered STATE.raw — not a Lead-Head-filtered subset — since this
// list feeds the Lead Head dropdown itself: filtering it by the current Lead
// Head selection would mean the dropdown could only ever show one option.
function leadHeadOptions(){
  return [...new Set(STATE.raw.map(r => r.leadHead).filter(Boolean))].sort();
}

// The universal per-row filter for the whole Dashboard tab (header, alongside
// Month): Status, then Lead Head. Every Dashboard-tab aggregator that isn't
// explicitly exempt (e.g. the "Fixed" YTD figure) runs its rows through this,
// either directly or via applyRefColdFilter.
// - Status: CONVERTED uses the same CM-presence rule as isConvertedLead();
//   every other status also requires !isConvertedLead() so a lead never
//   matches two status buckets at once.
// - Lead Head: defaults to "Primary" (STATE.filterLeadHead) so an
//   Additional/secondary-applicant row on the same lead doesn't double-count
//   everywhere; "All" removes the restriction entirely.
function dashboardRowMatch(row){
  const f = STATE.filterStatus;
  if(f && f !== 'All' && !(Array.isArray(f) && f.length === 0)){
    const wanted = Array.isArray(f) ? f : [f];
    const statusOk = wanted.some(st => st === 'CONVERTED' ? isConvertedLead(row) : (row.leadStatus === st && !isConvertedLead(row)));
    if(!statusOk) return false;
  }
  const lh = STATE.filterLeadHead;
  if(lh && lh !== 'All' && row.leadHead !== lh) return false;
  return true;
}

// Build a custom multi-select (or single-select) dropdown widget
// opts.multi=false → radio-style (only one selected at a time)
function buildMultiSelect(containerId, options, currentVal, onChange, opts={}){
  const container = $(containerId);
  if(!container) return;
  const multi = opts.multi !== false;

  // Normalise currentVal to a Set
  let initSet;
  if(!currentVal || currentVal === 'All' || (Array.isArray(currentVal) && currentVal.length === 0)){
    initSet = new Set(['All']);
  } else if(Array.isArray(currentVal)){
    initSet = new Set(currentVal);
  } else {
    initSet = new Set([currentVal]);
  }
  const selected = new Set(initSet);

  function currentLabel(){
    if(selected.has('All') || selected.size === 0) return 'All';
    if(selected.size === 1) return [...selected][0];
    return selected.size + ' selected';
  }
  function emitChange(){
    let val;
    if(selected.has('All') || selected.size === 0) val = 'All';
    else if(selected.size === 1) val = [...selected][0];
    else val = [...selected];
    onChange(val);
  }

  const wrap = document.createElement('div');
  wrap.className = 'ms-wrap';

  const btn = document.createElement('div');
  btn.className = 'ms-btn';
  btn.innerHTML = `<span class="ms-label">${currentLabel()}</span><span class="ms-arrow">▼</span>`;

  const dropdown = document.createElement('div');
  dropdown.className = 'ms-dropdown';

  const allOpts = options[0] === 'All' ? options : ['All', ...options];
  allOpts.forEach(opt => {
    const item = document.createElement('label');
    item.className = 'ms-opt' + (opt === 'All' ? ' ms-all' : '') + (selected.has(opt) ? ' ms-selected' : '');
    item.onclick = e => e.stopPropagation();

    const cb = document.createElement('input');
    cb.type = multi ? 'checkbox' : 'checkbox'; // always checkbox for UI consistency
    cb.value = opt;
    cb.checked = selected.has(opt);

    cb.onchange = () => {
      if(!multi){
        // radio behaviour — clear all, select only this
        selected.clear();
        selected.add(opt);
        dropdown.querySelectorAll('input').forEach(c => {
          c.checked = c.value === opt;
          c.closest('.ms-opt').classList.toggle('ms-selected', c.checked);
        });
      } else if(opt === 'All'){
        selected.clear();
        selected.add('All');
        dropdown.querySelectorAll('input').forEach(c => {
          c.checked = c.value === 'All';
          c.closest('.ms-opt').classList.toggle('ms-selected', c.value === 'All');
        });
      } else {
        selected.delete('All');
        const allCb = dropdown.querySelector('input[value="All"]');
        if(allCb){ allCb.checked = false; allCb.closest('.ms-opt').classList.remove('ms-selected'); }
        if(cb.checked){ selected.add(opt); item.classList.add('ms-selected'); }
        else { selected.delete(opt); item.classList.remove('ms-selected'); }
        if(selected.size === 0){
          selected.add('All');
          if(allCb){ allCb.checked = true; allCb.closest('.ms-opt').classList.add('ms-selected'); }
        }
      }
      btn.querySelector('.ms-label').textContent = currentLabel();
      emitChange();
    };

    item.appendChild(cb);
    item.appendChild(document.createTextNode(' ' + opt));
    dropdown.appendChild(item);
  });

  btn.onclick = e => { e.stopPropagation(); wrap.classList.toggle('open'); };
  document.addEventListener('click', () => wrap.classList.remove('open'));

  wrap.appendChild(btn);
  wrap.appendChild(dropdown);
  container.innerHTML = '';
  container.appendChild(wrap);
}

function initFilters(){
  const months = filteredMonths();
  const curMonth = (Array.isArray(STATE.filterMonth)
    ? STATE.filterMonth.filter(m => months.includes(m))
    : (months.includes(STATE.filterMonth) ? STATE.filterMonth : 'All')) || 'All';
  STATE.filterMonth = curMonth;
  buildMultiSelect('#filter-month-wrap', ['All', ...months], STATE.filterMonth,
    val => { STATE.filterMonth = val; renderDashboard(); }, {multi: true});
  buildMultiSelect('#filter-refcold-wrap',
    ['Include','Exclude','Only Referral'], STATE.filterRefCold,
    val => { STATE.filterRefCold = val; renderDashboard(); }, {multi: false});
  buildMultiSelect('#filter-status-wrap', ['All', ...STATUSES], STATE.filterStatus,
    val => { STATE.filterStatus = val; renderDashboard(); }, {multi: true});

  const leadHeads = leadHeadOptions();
  if(STATE.filterLeadHead !== 'All' && !leadHeads.includes(STATE.filterLeadHead)) STATE.filterLeadHead = 'All';
  buildMultiSelect('#filter-leadhead-wrap', ['All', ...leadHeads], STATE.filterLeadHead,
    val => { STATE.filterLeadHead = val; renderDashboard(); }, {multi: false});
  renderLeadHeadBanner();
}
function renderLeadHeadBanner(){
  const el = $('#leadhead-banner');
  if(!el) return;
  const lh = STATE.filterLeadHead;
  el.textContent = lh === 'All'
    ? 'This dashboard displays all data regardless of Lead Head.'
    : `This dashboard displays all data where Lead Head is "${lh}".`;
}
function isPeriodNewOrModern(period){
  const s = String(period||'').trim();
  if(s==='NEW') return true;
  return /^[A-Za-z]{3}-\d{4}$/.test(s);
}
function periodLabel(period){
  const s = String(period||'').trim();
  return isPeriodNewOrModern(s) ? s : s + ' (old)';
}
function isAllRevTeams(){ return STATE.revTeam === 'All' || (Array.isArray(STATE.revTeam) && STATE.revTeam.length === 0); }
function isAllRevMonths(){ return STATE.revMonth === 'All' || (Array.isArray(STATE.revMonth) && STATE.revMonth.length === 0); }
function revTeamMatch(team){ if(isAllRevTeams()) return true; if(Array.isArray(STATE.revTeam)) return STATE.revTeam.includes(team); return team === STATE.revTeam; }
function revMonthMatch(m){ if(isAllRevMonths()) return true; if(Array.isArray(STATE.revMonth)) return STATE.revMonth.includes(m); return m === STATE.revMonth; }

function initRevFilters(){
  const teams = ['All', ...Array.from(new Set(STATE.empref.slice(1).map(r=>r[1]).filter(Boolean))).sort()];
  buildMultiSelect('#rev-team-filter-wrap', teams, STATE.revTeam,
    val => { STATE.revTeam = val; renderRMRev(); }, {label:'Team'});

  const revMonths = new Set();
  for(const r of STATE.rev){
    const v = r['OLD CHECK'] || r['Old Check'] || r['old check'];
    if(v && v!=='' && v!==0) revMonths.add(String(v));
  }
  const months = ['All', ...Array.from(revMonths).sort()];
  buildMultiSelect('#rev-month-filter-wrap', months, STATE.revMonth,
    val => { STATE.revMonth = val; STATE.rmPerfMonth = val; renderRMRev(); if($('#rmperf-month-wrap')) renderRMPerformance(); }, {label:'Period'});
}

function updatePremiumLockUI(){
  PREMIUM_TABS.forEach(id => {
    const panel = $('#tab-'+id);
    if(panel) panel.classList.toggle('locked', !STATE.premiumUnlocked);
  });
}

function initPremiumLock(){
  PREMIUM_TABS.forEach(id => {
    const input = $('#'+id+'-pw-input');
    const btn = $('#'+id+'-pw-submit');
    const err = $('#'+id+'-pw-error');
    if(!input || !btn) return;
    const tryUnlock = () => {
      if(input.value === PREMIUM_PASSWORD){
        STATE.premiumUnlocked = true;
        updatePremiumLockUI();
        input.value = '';
        if(err) err.textContent = '';
        renderRMPerformance();
        renderRMRev();
      } else {
        if(err) err.textContent = 'Incorrect password.';
      }
    };
    btn.onclick = tryUnlock;
    input.onkeydown = e => { if(e.key === 'Enter') tryUnlock(); };
  });
  updatePremiumLockUI();
}

function tabBar(){
  const tabs = [
    {id:'dashboard', label:'Dashboard',        primary:true},
    {id:'mtd',       label:'MTD Performance',  primary:true},
    {id:'rmperf',    label:'RM Performance',   primary:true},
    {id:'rmrev',     label:'RM Revenue',       primary:true},
    {id:'bdperf',    label:'BD Performance',   primary:true},
    {id:'cpc',       label:'Cost Per Campaign'},
    {id:'processed', label:'PROCESSED'},
    {id:'rawdata',   label:'RAW_DATA'},
    {id:'b2braw',    label:'B2B RAW_DATA'},
    {id:'employee',  label:'EMPLOYEE_REF'},
    {id:'rmmaster',  label:'RM MASTER MAPPING'},
    {id:'missing',   label:'MISSING_LEADS'},
  ];
  const bar = $('#tabs'); bar.innerHTML='';
  tabs.forEach((t,i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (t.primary?' primary':'');
    b.dataset.tab = t.id; b.textContent = t.label;
    b.onclick = () => activateTab(t.id);
    bar.appendChild(b);
  });
  activateTab('dashboard');
}
function activateTab(id){
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab===id));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+id));
  const hf = $('#header-dash-filters');
  if(hf) hf.style.display = id==='dashboard' ? '' : 'none';
  if(id==='rmrev') drawRevChart();
  if(id==='rmperf') renderRMPerformance();
  if(id==='bdperf') renderBDPerformance();
  requestAnimationFrame(() => {
    const panel = $('#tab-'+id);
    if(panel) panel.querySelectorAll('.table-wrap').forEach(attachMirrorScroll);
  });
}

// Dashboard-tab subsections (Overview / Category Distribution / Team
// Performance / ...) — a second-level tab bar so the whole tab isn't one
// long scroll. Every subpanel's tables still render on every filter change
// exactly as before (see renderDashboard); this only changes what's shown.
function initDashSubtabs(){
  $$('.dash-subtab').forEach(btn => {
    btn.onclick = () => activateDashSubtab(btn.dataset.subtab);
  });
}
function activateDashSubtab(id){
  STATE.dashSubtab = id;
  $$('.dash-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab===id));
  $$('.dash-subpanel').forEach(p => p.classList.toggle('active', p.id==='dashsub-'+id));
  requestAnimationFrame(() => {
    const panel = $('#dashsub-'+id);
    if(panel) panel.querySelectorAll('.table-wrap').forEach(attachMirrorScroll);
    // Charts built while their subpanel was display:none can end up stuck at
    // 0x0 (same class of issue showApp() works around) — force a resize now
    // that this subpanel is actually visible.
    if(window.Chart) Object.values(Chart.instances||{}).forEach(c => c.resize());
  });
}

