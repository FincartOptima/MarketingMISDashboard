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
  rmMasterAmbiguous: {},
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
  lpLandingPages: null,
  revChart: null,
  statusChart: null,
  bdGmeetChart: null,
  bdStageChart: null,
  bdCallsChart: null,
  rawFilters: {},
  premiumUnlocked: false,
  dashSubtab: 'overview',
  bdSubtab: 'callflow',
  stagnantPage: 1,
  stagnantTeamFilter: 'All',
  teamPerfMode: 'first',
  campaignTeamMode: 'first',
  categorizedLeads: [],
  categorizedCategoryFilter: 'All',
  categorizedPage: 1,
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
// Inner whitespace is collapsed too: EMPLOYEE_REF has "Swaraj  Singh Thakur"
// and "Ravi Sharma " which would never match the CRM's spelling otherwise.
function normalizeNameKey(name){
  return cleanName(name).toLowerCase();
}

// Trim and collapse whitespace in a free-text name.
const cleanName = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

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
    const existingTeam = (row.Team||'').toString().trim();
    if(row._hasSourceTeam){
      row.Team = existingTeam || 'SV';
    } else {
      row.Team = teamForRmName(row.currentRmName) || existingTeam || 'SV';
    }
    row.FirstTeam = teamForRmName(row.firstRmName) || 'SV';
  }
}

// Team for one RM name, or '' when it can't be resolved: EMPLOYEE_REF first,
// then the RM Master alias's canonical name (EMPLOYEE_REF, then the mapping's
// own Team). An alias that points at two different people stays unresolved.
function teamForRmName(name){
  const k = normalizeNameKey(name);
  if(!k) return '';
  if(STATE.teamMap[k]) return STATE.teamMap[k];
  const canon = STATE.rmMasterLookup[k];
  if(canon && !STATE.rmMasterAmbiguous[k]){
    const ck = normalizeNameKey(canon);
    return STATE.teamMap[ck] || STATE.rmMasterTeam[ck] || '';
  }
  return '';
}

// Team of a lead's first RM; every FirstRM view goes through this.
function firstRmTeam(row){
  return row.FirstTeam || teamForRmName(row.firstRmName) || 'SV';
}

function loadRMMasterFromStorage(){
  STATE.rmMaster = loadOverrideOrSnapshot(CONFIG.STORAGE_KEYS.RM_MASTER, 'RM Master Mapping', [['Source Name','Correct RM Name','Team']]);
  buildRMMasterLookup();
}
function buildRMMasterLookup(){
  STATE.rmMasterLookup = {};
  STATE.rmMasterTeam = {};
  STATE.rmMasterAmbiguous = {};
  for(let i=1;i<STATE.rmMaster.length;i++){
    const r = STATE.rmMaster[i]; if(!r) continue;
    const src = normalizeNameKey(r[0]);
    const correct = (r[1]||'').toString().replace(/\s+/g,' ').trim();
    const team = (r[2]||'').toString().trim();
    if(src && correct){
      // The later row still wins in mapRM(); the alias is only recorded so
      // teamForRmName() won't guess between the two people.
      const prev = STATE.rmMasterLookup[src];
      if(prev && normalizeNameKey(prev) !== normalizeNameKey(correct)) STATE.rmMasterAmbiguous[src] = true;
      STATE.rmMasterLookup[src] = correct;
    }
    if(correct && team) STATE.rmMasterTeam[normalizeNameKey(correct)] = team;
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
// no Stage/RM/Team data in the CRM for that lead. It gets a team row of its
// own (BD_NOT_IN_CRM) rather than being folded into SV, and shows the status
// the BD rep logged in the tracker (Current Stage) since the CRM has none.
// Month falls back to the tracker's own Date Assigned (Column A).
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
      r.effectiveStage = BD_STAGES.includes(r.currentStage) ? r.currentStage : '';
      r.effectiveRM = '(Not in CRM)';
      r.effectiveTeam = BD_NOT_IN_CRM;
      r.effectiveMonth = toMmmYyyy(r.dateAssigned) || 'N/A';
      r.effectivePlatform = '';
    }
  }
}
// The tracker (its sheet names) and the BD Daily Log both name the BD rep, and
// the two are joined by that name. A capitalisation or spacing slip in either
// ("kajal" vs "Kajal") would split one person in two: a Person filter that
// matches only half their rows, and a rep row with calls but no leads. This
// folds spellings that differ only by case/space onto one name, preferring the
// tracker's since its sheet names are the authoritative labels. Runs once at
// load, so every BD view sees a single spelling.
function canonicalizeBDNames(){
  const tidy = v => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  const canon = new Map();                       // lower-cased key -> chosen spelling
  const decide = (rows, field) => {
    const spellings = new Map();                 // key -> Map(spelling -> count)
    for(const r of rows){
      const s = tidy(r[field]); if(!s) continue;
      const k = s.toLowerCase();
      if(canon.has(k)) continue;                 // an earlier (more authoritative) source decided it
      if(!spellings.has(k)) spellings.set(k, new Map());
      spellings.get(k).set(s, (spellings.get(k).get(s) || 0) + 1);
    }
    for(const [k, m] of spellings) canon.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };
  decide(STATE.bd, 'person');                    // tracker first
  decide(STATE.bdCalls, 'bdName');               // then the Daily Log, for names the tracker lacks

  const changed = new Set();
  const apply = (rows, field, source) => {
    for(const r of rows){
      const s = tidy(r[field]); if(!s) continue;
      const c = canon.get(s.toLowerCase());
      if(c && c !== r[field]){ changed.add('"' + r[field] + '" (' + source + ') -> "' + c + '"'); r[field] = c; }
    }
  };
  apply(STATE.bd, 'person', 'tracker');
  apply(STATE.bdCalls, 'bdName', 'BD Daily Log');
  if(changed.size){
    console.warn('[MIS] BD names: ' + [...changed].join(', ') + ' — same person, different capitalisation or spacing, '
      + 'so they were merged. To fix at source, use one spelling in the tracker sheet names and the BD Daily Log.');
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

