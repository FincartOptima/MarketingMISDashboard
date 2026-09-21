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
  bd: [],
  bdCalls: [],
  rmMaster: [],
  rmMasterLookup: {},
  rmMasterTeam: {},
  months: [],
  empref: [],
  teamMap: {},
  cost: [],
  filesLoaded: { fin23: false, rev: false, b2b: false, fy: false, pa: false, bd: false, bdcalls: false },
  rmPerfMonth: 'All',
  rmPerfRefCold: 'Include',
  filterMonth: 'All',
  filterRefCold: 'Include',
  filterStatus: 'All',
  // Dashboard-tab-wide, alongside Month/Ref+Cold/Status — defaults to
  // "Primary" (not "All") since counting every Additional/secondary-applicant
  // row alongside the Primary one would double-count leads dashboard-wide.
  filterLeadHead: 'Primary',
  filterTable: 'All',
  teamPerfTeamFilter: 'All',
  bdMonthFilter: 'All',
  bdTeamFilter: 'All',
  bdPersonFilter: 'All',
  bdGmeetFilter: 'All',
  bdPlatformFilter: 'All',
  bdStatusSource: 'workpoint',
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
  bdGmeetChart: null,
  bdStageChart: null,
  bdCallsChart: null,
  rawFilters: {},
  premiumUnlocked: false,
  dashSubtab: 'overview',
  teamPerfMode: 'first',
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

// ---- local-edit overrides (EMPLOYEE_REF / RM Master Mapping / Cost Per
// Campaign) — saved to localStorage so an in-tab edit survives a refresh,
// but auto-expired the moment the shipped snapshot.js changes underneath it.
//
// Without this, a saved override wins over snapshot.js FOREVER: on
// 2026-09-17 one laptop's EMPLOYEE_REF override — saved before the "Ambika"/
// "DIY Team" teams existed — silently kept overriding every snapshot.js
// update since, so that laptop's Team Performance Matrix diverged from a
// colleague's (who had no override) with no visible sign anything was
// wrong. Fingerprinting the shipped snapshot at save time and comparing it
// again at load time means any future snapshot.js update is detected
// automatically and the stale override is dropped — no manual Reset click,
// no version number for anyone to remember to bump.
function snapshotFingerprint(str){
  let h = 0;
  for(let i=0;i<str.length;i++) h = (Math.imul(31,h) + str.charCodeAt(i)) | 0;
  return h.toString(36);
}
function currentSnapshotBase(snapshotKey){
  return snapshotFingerprint(JSON.stringify((window.SNAPSHOT && window.SNAPSHOT[snapshotKey]) || ''));
}
function loadOverrideOrSnapshot(storageKey, snapshotKey, fallback){
  const currentBase = currentSnapshotBase(snapshotKey);
  try{
    const saved = localStorage.getItem(storageKey);
    if(saved){
      if(localStorage.getItem(storageKey + '_base') === currentBase) return JSON.parse(saved);
      localStorage.removeItem(storageKey);
      localStorage.removeItem(storageKey + '_base');
    }
  }catch(e){}
  const snap = window.SNAPSHOT && window.SNAPSHOT[snapshotKey];
  return snap ? JSON.parse(JSON.stringify(snap)) : fallback;
}
function persistOverride(storageKey, snapshotKey, data){
  try{
    localStorage.setItem(storageKey, JSON.stringify(data));
    localStorage.setItem(storageKey + '_base', currentSnapshotBase(snapshotKey));
  }catch(e){}
}

function loadEmployeeFromStorage(){
  STATE.empref = loadOverrideOrSnapshot(CONFIG.STORAGE_KEYS.EMPREF, 'EMPLOYEE_REF', [['Emp Code','Team','Name']]);
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
  STATE.rmMaster = loadOverrideOrSnapshot(CONFIG.STORAGE_KEYS.RM_MASTER, 'RM Master Mapping', [['Source Name','Correct RM Name','Team']]);
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

// Matches every BD tracker row to its B2C record by email (BD tracker) <->
// userId (B2C, despite the name — verified to be the client's email and
// unique across the file). The tracker only supplies dateAssigned/email/
// gmeetJoined now — Stage/RM/Team/Month all come from the matched B2C
// record (bdStageFromB2C/buildB2CEmailIndex, both in app-aggregators.js).
// The matched RM name is passed through mapRM() since B2C's own
// currentRmName isn't reliably canonical on its own (e.g. "Ankit Kumar
// KaundaL" on one lead vs. the properly-cased form on another) — this keeps
// the RM breakdown from fragmenting the same person into multiple rows.
//
// No match found (lead not yet in the CRM, or an email typo) means there's
// no Stage/RM/Team data at all for that lead: it's labeled "(Not in CRM)"
// under the SV team and excluded from the Stage breakdown (still counted in
// Total). Month falls back to the tracker's own Date Assigned (Column A).
function annotateBDWithB2CMatch(){
  const b2cIndex = buildB2CEmailIndex();
  for(const r of STATE.bd){
    const email = (r.email||'').toString().trim().toLowerCase();
    const b2cRow = email ? b2cIndex[email] : null;
    if(b2cRow){
      r.crmMatched = true;
      r.effectiveStage = bdStageFromB2C(b2cRow);
      r.effectiveRM = mapRM(b2cRow.currentRmName) || b2cRow.currentRmName || '(unassigned)';
      r.effectiveTeam = b2cRow.Team || 'SV';
      r.effectiveMonth = b2cRow.CTM;
      r.effectivePlatform = b2cRow.platformName || '';
    } else {
      r.crmMatched = false;
      r.effectiveStage = '';
      r.effectiveRM = '(Not in CRM)';
      r.effectiveTeam = 'SV';
      r.effectiveMonth = toMmmYyyy(r.dateAssigned) || 'N/A';
      r.effectivePlatform = '';
    }
  }
}
function persistRMMaster(){
  persistOverride(CONFIG.STORAGE_KEYS.RM_MASTER, 'RM Master Mapping', STATE.rmMaster);
}

function loadCostFromStorage(){
  STATE.cost = loadOverrideOrSnapshot(CONFIG.STORAGE_KEYS.COST, 'Cost Per Campaign', [['Campaign Name']]);
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

