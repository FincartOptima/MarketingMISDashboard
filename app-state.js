// app-state.js — STATE object, file-label helpers, RM/team lookup bootstrap.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- state ----
const STATE = {
  raw: [],
  b2b: [],
  b2bRaw: [],
  b2bFilters: {},
  rev: [],
  fy: [],
  pa: [],
  rmMaster: [],
  rmMasterLookup: {},
  rmMasterTeam: {},
  months: [],
  empref: [],
  teamMap: {},
  cost: [],
  filesLoaded: { fin23: false, rev: false, b2b: false, fy: false, pa: false },
  rmPerfMonth: 'All',
  rmPerfRefCold: 'Include',
  filterMonth: 'All',
  filterRefCold: 'Include',
  filterTable: 'All',
  mtdStart: 1,
  mtdEnd: 11,
  mtdFilterRefCold: 'Include',
  revTeam: 'All',
  revMonth: 'All',
  revLPFilter: 'Include',
  psTeamFilter: 'All',
  lpTableMode: 'All',
  lpTeamFilter: 'All',
  lpCampaignFilter: null,
  lpLandingPages: [],
  revChart: null,
  statusChart: null,
  // Chart.js instances for the dashboard breakdown visualisations, keyed by
  // section id. Registered and destroyed via renderBreakdownChart() in
  // app-tables.js so repeated renders don't leak canvases.
  charts: {},
  rawFilters: {},
  premiumUnlocked: false,
  teamPerfMode: 'current',
  campaignTeamMode: 'current',
};

function notUploadedHTML(key){
  return `<div class="file-not-uploaded"><span class="fnu-icon">&#9888;</span><strong>${FILE_LABELS[key]}</strong> was not found in the repository.<br>Add/update this file in the repo and refresh the page.</div>`;
}
function setNotUploaded(selector, key){
  const el = $(selector);
  if(el) el.innerHTML = notUploadedHTML(key);
}
function tabNotUploaded(contentSelector, key){
  const el = $(contentSelector);
  if(el) el.innerHTML = `<div class="tab-not-uploaded">${notUploadedHTML(key)}</div>`;
}

// ---- bootstrap ----

// Case/whitespace-insensitive lookup key for RM/team names, used wherever a
// raw name needs to match a lookup table key (RM Master Mapping, team maps).
function normalizeNameKey(name){
  return (name || '').toString().trim().toLowerCase();
}

function loadEmployeeFromStorage(){
  try{
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.EMPREF);
    if(saved){ STATE.empref = JSON.parse(saved); return; }
  }catch(e){}
  STATE.empref = (window.SNAPSHOT && window.SNAPSHOT.EMPLOYEE_REF) ? JSON.parse(JSON.stringify(window.SNAPSHOT.EMPLOYEE_REF)) : [['Emp Code','Team','Name']];
}
function rebuildTeamMap(){
  STATE.teamMap = {};
  for(let i=1;i<STATE.empref.length;i++){
    const r = STATE.empref[i]; if(!r) continue;
    const name = normalizeNameKey(r[2]);
    const team = (r[1]||'').toString().trim();
    if(name) STATE.teamMap[name] = team;
  }
  for(const row of STATE.raw){
    const key = normalizeNameKey(row.currentRmName);
    const existingTeam = (row.Team||'').toString().trim();
    if(row._hasSourceTeam){
      row.Team = existingTeam || 'SV';
    } else {
      row.Team = STATE.teamMap[key] || existingTeam || 'SV';
    }
  }
}

function loadRMMasterFromStorage(){
  try{
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.RM_MASTER);
    if(saved){ STATE.rmMaster = JSON.parse(saved); buildRMMasterLookup(); return; }
  }catch(e){}
  STATE.rmMaster = (window.SNAPSHOT && window.SNAPSHOT['RM Master Mapping'])
    ? JSON.parse(JSON.stringify(window.SNAPSHOT['RM Master Mapping']))
    : [['Source Name','Correct RM Name','Team']];
  buildRMMasterLookup();
}
function buildRMMasterLookup(){
  STATE.rmMasterLookup = {};
  STATE.rmMasterTeam = {};
  for(let i=1;i<STATE.rmMaster.length;i++){
    const r = STATE.rmMaster[i]; if(!r) continue;
    const src = normalizeNameKey(r[0]);
    const correct = (r[1]||'').toString().trim();
    const team = (r[2]||'').toString().trim();
    if(src && correct) STATE.rmMasterLookup[src] = correct;
    if(correct && team) STATE.rmMasterTeam[correct.toLowerCase()] = team;
  }
}
function mapRM(rawName){
  const k = normalizeNameKey(rawName);
  if(!k) return '';
  return STATE.rmMasterLookup[k] || (rawName||'').toString().trim();
}
function persistRMMaster(){
  try{ localStorage.setItem(CONFIG.STORAGE_KEYS.RM_MASTER, JSON.stringify(STATE.rmMaster)); }catch(e){}
}

function loadCostFromStorage(){
  try{
    const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.COST);
    if(saved){ STATE.cost = JSON.parse(saved); return; }
  }catch(e){}
  const c = window.SNAPSHOT && window.SNAPSHOT['Cost Per Campaign'];
  STATE.cost = c ? JSON.parse(JSON.stringify(c)) : [['Campaign Name']];
}

function reconcileCostMonths(){
  if(!STATE.cost.length) STATE.cost = [['Campaign Name']];
  const header = STATE.cost[0];
  const existingMonths = header.slice(1).map(toMmmYyyy);
  for(const m of STATE.months){
    if(!existingMonths.includes(m)){
      const [mon,yr] = m.split('-');
      const monIdx = MONTHS_3.indexOf(mon);
      const dateStr = new Date(+yr, monIdx, 1).toISOString();
      header.push(dateStr);
      for(let i=1;i<STATE.cost.length;i++) STATE.cost[i].push(0);
      existingMonths.push(m);
    }
  }
  const order = header.slice(1).map((h,idx)=>({h, m: toMmmYyyy(h), idx:idx+1}))
                .sort((a,b)=>monthKey(a.m)-monthKey(b.m));
  const newHeader = ['Campaign Name', ...order.map(o=>o.h)];
  const newRows = [newHeader];
  for(let i=1;i<STATE.cost.length;i++){
    const row = STATE.cost[i];
    newRows.push([row[0], ...order.map(o=>row[o.idx])]);
  }
  STATE.cost = newRows;
}

