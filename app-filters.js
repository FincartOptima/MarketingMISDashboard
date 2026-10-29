// app-filters.js — Month/team/ref-cold filters, multi-select widget, tab bar, premium lock.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- filters / tabs ----
const FY_CUTOFF = monthKey(CONFIG.FY_CUTOFF_MONTH);
// Memoised — it runs per row inside the filters. detectMonths() assigns a
// fresh STATE.months array, so its identity is a safe cache key.
let _fyMonths = { src: null, len: -1, list: [], set: new Set() };
function filteredMonths(){
  if(_fyMonths.src !== STATE.months || _fyMonths.len !== STATE.months.length){
    const list = STATE.months.filter(m => monthKey(m) >= FY_CUTOFF);
    _fyMonths = { src: STATE.months, len: STATE.months.length, list, set: new Set(list) };
  }
  return _fyMonths.list;
}

// Multi-select helpers
function monthFilter(m){
  const f = STATE.filterMonth;
  if(!f || f === 'All' || (Array.isArray(f) && f.length === 0)){ filteredMonths(); return _fyMonths.set.has(m); }
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

// Dropdowns are rebuilt often, so closing on an outside click is one shared listener rather than one per widget.
document.addEventListener('click', () => $$('.ms-wrap.open').forEach(w => w.classList.remove('open')));

// Build a custom multi-select (or single-select) dropdown widget
// opts.multi=false → radio-style (only one selected at a time)
// opts.search=true → a type-to-filter box at the top of the list, for long lists
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

  let searchBox = null;
  if(opts.search){
    searchBox = document.createElement('input');
    searchBox.type = 'text';
    searchBox.className = 'ms-search';
    searchBox.placeholder = 'Search…';
    searchBox.onclick = e => e.stopPropagation();
    searchBox.oninput = () => {
      const q = searchBox.value.trim().toLowerCase();
      dropdown.querySelectorAll('.ms-opt:not(.ms-all)').forEach(it => {
        it.style.display = !q || it.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
    dropdown.appendChild(searchBox);
  }

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
        dropdown.querySelectorAll('.ms-opt input').forEach(c => {
          c.checked = c.value === opt;
          c.closest('.ms-opt').classList.toggle('ms-selected', c.checked);
        });
        wrap.classList.remove('open');
      } else if(opt === 'All'){
        selected.clear();
        selected.add('All');
        dropdown.querySelectorAll('.ms-opt input').forEach(c => {
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

  btn.onclick = e => {
    e.stopPropagation();
    $$('.ms-wrap.open').forEach(w => { if(w !== wrap) w.classList.remove('open'); });
    wrap.classList.toggle('open');
    if(searchBox && wrap.classList.contains('open')){ searchBox.value = ''; searchBox.oninput(); searchBox.focus(); }
  };

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

// Dashboard, MTD Performance, BD Performance, Categorized Leads and L&D Dashboard stay in the bar; every other
// tab (menu: true) opens from the "More" dropdown at the end of it.
function tabBar(){
  const tabs = [
    {id:'dashboard', label:'Dashboard',        primary:true},
    {id:'mtd',       label:'MTD Performance',  primary:true},
    {id:'bdperf',    label:'BD Performance',   primary:true},
    {id:'categorized', label:'Categorized Leads', primary:true},
    {id:'ld',        label:'L&D Dashboard',    primary:true},
    {id:'rmperf',    label:'RM Performance',   menu:true},
    {id:'rmrev',     label:'RM Revenue',       menu:true},
    {id:'cpc',       label:'Cost Per Campaign', menu:true},
    {id:'processed', label:'PROCESSED',        menu:true},
    {id:'rawdata',   label:'RAW_DATA',         menu:true},
    {id:'b2braw',    label:'B2B RAW_DATA',     menu:true},
    {id:'employee',  label:'EMPLOYEE_REF',     menu:true},
    {id:'rmmaster',  label:'RM MASTER MAPPING', menu:true},
    {id:'missing',   label:'MISSING_LEADS',    menu:true},
  ];
  const bar = $('#tabs'); bar.innerHTML='';
  tabs.filter(t => !t.menu).forEach(t => {
    const b = document.createElement('button');
    b.className = 'tab' + (t.primary?' primary':'');
    b.dataset.tab = t.id; b.textContent = t.label;
    b.onclick = () => activateTab(t.id);
    bar.appendChild(b);
  });
  buildTabMenu(bar, tabs.filter(t => t.menu));
  activateTab('dashboard');
}

// The "More" button and its menu. The menu hangs off <body> and is positioned from the button:
// #tabs scrolls sideways, so a menu inside it would be clipped.
let _tabMenuTabs = [];
let _tabMenuBound = false;
function buildTabMenu(bar, menuTabs){
  _tabMenuTabs = menuTabs;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.id = 'tab-more'; btn.className = 'tab tab-more';
  btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span class="tab-more-label">More</span><span class="tab-more-caret">&#9662;</span>';
  bar.appendChild(btn);

  const stale = $('#tab-menu'); if(stale) stale.remove();
  const menu = document.createElement('div');
  menu.id = 'tab-menu'; menu.className = 'tab-menu'; menu.setAttribute('role', 'menu');
  menuTabs.forEach(t => {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'tab-menu-item'; item.setAttribute('role', 'menuitem');
    item.dataset.tab = t.id; item.textContent = t.label;
    item.onclick = () => { closeTabMenu(); activateTab(t.id); };
    menu.appendChild(item);
  });
  document.body.appendChild(menu);

  btn.onclick = () => menu.classList.contains('open') ? closeTabMenu() : openTabMenu();
  menu.onkeydown = e => {
    const items = [...menu.querySelectorAll('.tab-menu-item')], at = items.indexOf(document.activeElement);
    if(e.key === 'ArrowDown'){ e.preventDefault(); items[(at + 1) % items.length].focus(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
  };
  if(_tabMenuBound) return;
  _tabMenuBound = true;
  document.addEventListener('click', e => { if(!e.target.closest('#tab-menu, #tab-more')) closeTabMenu(); });
  document.addEventListener('keydown', e => {
    const open = $('#tab-menu') && $('#tab-menu').classList.contains('open');
    if(e.key === 'Escape' && open){ closeTabMenu(); $('#tab-more').focus(); }
  });
  window.addEventListener('resize', closeTabMenu);
  bar.addEventListener('scroll', closeTabMenu);
}
function openTabMenu(){
  const btn = $('#tab-more'), menu = $('#tab-menu');
  if(!btn || !menu) return;
  menu.classList.add('open');
  const r = btn.getBoundingClientRect();
  menu.style.top = r.bottom + 'px';
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  (menu.querySelector('.tab-menu-item.active') || menu.querySelector('.tab-menu-item')).focus();
}
function closeTabMenu(){
  const btn = $('#tab-more'), menu = $('#tab-menu');
  if(menu) menu.classList.remove('open');
  if(btn) btn.setAttribute('aria-expanded', 'false');
}
function activateTab(id){
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab===id));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+id));
  // A tab opened from the menu is named on the More button, which takes the active look.
  const inMenu = _tabMenuTabs.find(t => t.id === id);
  const more = $('#tab-more');
  if(more){
    more.classList.toggle('active', !!inMenu);
    more.querySelector('.tab-more-label').textContent = inMenu ? inMenu.label : 'More';
  }
  $$('#tab-menu .tab-menu-item').forEach(i => i.classList.toggle('active', i.dataset.tab === id));
  const hf = $('#header-dash-filters');
  if(hf) hf.style.display = id==='dashboard' ? '' : 'none';
  if(id==='rmrev') drawRevChart();
  if(id==='rmperf') renderRMPerformance();
  if(id==='bdperf') renderBD2();
  if(id==='categorized') renderCategorizedLeads();
  if(id==='ld') renderLD();
  requestAnimationFrame(() => {
    const panel = $('#tab-'+id);
    if(panel) panel.querySelectorAll('.table-wrap').forEach(attachMirrorScroll);
  });
}

// Dashboard-tab subsections (Overview / Category Distribution / Team
// Performance / ...) — a second-level tab bar so the whole tab isn't one
// long scroll. Every subpanel's tables still render on every filter change
// exactly as before (see renderDashboard); this only changes what's shown.
// BD Performance reuses the same .dash-subtab/.dash-subpanel visual classes
// for its own subsections (see activateBd2Subtab in app-bd2.js) — every
// selector here is scoped to #tab-dashboard so the two tabs' sub-nav bars
// don't interfere with each other.
function initDashSubtabs(){
  $$('#tab-dashboard .dash-subtab').forEach(btn => {
    btn.onclick = () => activateDashSubtab(btn.dataset.subtab);
  });
}
function activateDashSubtab(id){
  STATE.dashSubtab = id;
  $$('#tab-dashboard .dash-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab===id));
  $$('#tab-dashboard .dash-subpanel').forEach(p => p.classList.toggle('active', p.id==='dashsub-'+id));
  requestAnimationFrame(() => {
    const panel = $('#dashsub-'+id);
    if(panel) panel.querySelectorAll('.table-wrap').forEach(attachMirrorScroll);
    // Charts built while their subpanel was display:none can end up stuck at
    // 0x0 (same class of issue showApp() works around) — force a resize now
    // that this subpanel is actually visible.
    if(window.Chart) Object.values(Chart.instances||{}).forEach(c => c.resize());
  });
}
