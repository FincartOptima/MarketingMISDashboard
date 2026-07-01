/* Marketing MIS Web Dashboard
   Uploads:  FIN23 raw + Revenue Input
   Team map: EMPLOYEE_REF (bundled snapshot, editable, persisted in localStorage)
   Months:   detected dynamically from RAW_DATA — Dashboard/MTD/Processed/Cost auto-extend.
*/

const MONTHS_3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STATUSES = ['CONVERTED','IN PROCESS','ASSIGNED','RE-ASSIGNED','FOLLOW UP','ON HOLD','DEAD'];
const FIXED_TEAMS = ['Akanksha','Ankit S','Anmol G','Ratan P','Ravi S','Vidhi','Vivek S','Yash T','SV','Ambika S'];
const RAW_COLUMNS = ['currentRmName','Team','clientName','landingPage','platformName','Campaign Name','userId','createdDate','CTM','lastStatusDate','LSM','leadInProcessDate','LPM','leadHead','leadStatus','convertedDate','CM','firstRmName','Team of FirstRM','convertedByName','annualIncome','clientCategory','FMONTH'];
const B2B_RAW_COLUMNS = ['name','email','phone','companyName','companyEmail','leadHead','currentRmName','firstRmName','createdDate','CreateMonth','brokerName','brokerEmail','leadStatus','platformName','categoryName','landingPage','enquiryType'];

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const pad2  = n => String(n).padStart(2,'0');
const fmtIN = n => (n==null||isNaN(n))?'':Number(n).toLocaleString('en-IN');
const fmtINR= n => (n==null||isNaN(n))?'₹0':'₹'+Math.round(n).toLocaleString('en-IN');
const fmtPct= n => (n==null||isNaN(n))?'0%':(n*100).toFixed(2)+'%';
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// ---- date parsing ----
function parseDateAny(v){
  if(v==null||v===''||v==='N/A') return null;
  if(v instanceof Date && !isNaN(v)) return v;
  if(typeof v==='number'){ const d=new Date(Date.UTC(1899,11,30)+v*86400000); return isNaN(d)?null:d; }
  if(typeof v==='string'){
    const s = v.trim(); if(!s||s.toUpperCase()==='N/A') return null;
    let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if(m){ const d=new Date(+m[3], +m[2]-1, +m[1]); return isNaN(d)?null:d; }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m){ const d=new Date(+m[1], +m[2]-1, +m[3]); return isNaN(d)?null:d; }
    const d = new Date(s.replace(' ','T')); return isNaN(d)?null:d;
  }
  return null;
}
const toMmmYyyy  = v => { const norm = normalizeMonthLabel(v); if(norm) return norm; const d=parseDateAny(v); return d ? MONTHS_3[d.getMonth()]+'-'+d.getFullYear() : 'N/A'; };
const toIsoDate  = v => { const d=parseDateAny(v); return d ? d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()) : ''; };
const monthKey   = mmm => {
  const norm = normalizeMonthLabel(mmm);
  if(!norm) return -1;
  const [m,y]=norm.split('-');
  return +y*100 + MONTHS_3.indexOf(m);
};
const sortMonths = arr => arr.filter(m=>m && m!=='N/A').sort((a,b)=>monthKey(a)-monthKey(b));
const pickField = (row, ...names) => {
  for(const name of names){
    if(row[name] != null && row[name] !== '') return row[name];
  }
  return '';
};
function normalizeMonthLabel(v){
  if(v==null || v==='' || v==='N/A') return '';
  if(v instanceof Date && !isNaN(v)) return MONTHS_3[v.getMonth()]+'-'+v.getFullYear();
  const s = String(v).trim();
  const m = s.match(/^([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if(m){
    const mon = m[1].slice(0,1).toUpperCase()+m[1].slice(1,3).toLowerCase();
    const yr = m[2].length===2 ? '20'+m[2] : m[2];
    return MONTHS_3.includes(mon) ? mon+'-'+yr : '';
  }
  // Handle full month name: "April 2026", "April-2026"
  const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const fm = s.match(/^([A-Za-z]+)[- ,]+(\d{4})$/);
  if(fm){
    const idx = FULL_MONTHS.findIndex(n=>n.toLowerCase()===fm[1].toLowerCase());
    if(idx>=0) return MONTHS_3[idx]+'-'+fm[2];
  }
  const d = parseDateAny(v);
  return d ? MONTHS_3[d.getMonth()]+'-'+d.getFullYear() : '';
}
function statusMonthCol(status){
  if(status === 'CONVERTED') return 'CM';
  if(status === 'IN PROCESS') return 'LPM';
  return 'CTM';
}
function dashboardStatusMonthCol(status){
  if(status === 'CONVERTED') return 'CM';
  if(status === 'IN PROCESS') return 'LPM';
  return 'FMONTH';
}
function anyMonthCol(status){
  if(status === 'CONVERTED') return 'CM';
  if(status === 'IN PROCESS') return 'LPM';
  return 'CTM';
}

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
  revChart: null,
  statusChart: null,
  rawFilters: {},
  premiumUnlocked: false,
};

const PREMIUM_TABS = ['rmperf', 'rmrev'];
const PREMIUM_PASSWORD = 'Password';

const FILE_LABELS = {
  fin23: 'FIN23 Lead Management file',
  rev:   'Revenue Input file',
  b2b:   'B2B Corporate Lead file',
};
function notUploadedHTML(key){
  return `<div class="file-not-uploaded"><span class="fnu-icon">&#9888;</span><strong>${FILE_LABELS[key]}</strong> has not been uploaded.<br>Re-upload from the upload screen to load this data.</div>`;
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
function loadEmployeeFromStorage(){
  try{
    const saved = localStorage.getItem('empref_override');
    if(saved){ STATE.empref = JSON.parse(saved); return; }
  }catch(e){}
  STATE.empref = (window.SNAPSHOT && window.SNAPSHOT.EMPLOYEE_REF) ? JSON.parse(JSON.stringify(window.SNAPSHOT.EMPLOYEE_REF)) : [['Emp Code','Team','Name']];
}
function rebuildTeamMap(){
  STATE.teamMap = {};
  for(let i=1;i<STATE.empref.length;i++){
    const r = STATE.empref[i]; if(!r) continue;
    const name = (r[2]||'').toString().trim().toLowerCase();
    const team = (r[1]||'').toString().trim();
    if(name) STATE.teamMap[name] = team;
  }
  for(const row of STATE.raw){
    const key = (row.currentRmName||'').toString().trim().toLowerCase();
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
    const saved = localStorage.getItem('rmmaster_override');
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
    const src = (r[0]||'').toString().trim().toLowerCase();
    const correct = (r[1]||'').toString().trim();
    const team = (r[2]||'').toString().trim();
    if(src && correct) STATE.rmMasterLookup[src] = correct;
    if(correct && team) STATE.rmMasterTeam[correct.toLowerCase()] = team;
  }
}
function mapRM(rawName){
  const k = (rawName||'').toString().trim().toLowerCase();
  if(!k) return '';
  return STATE.rmMasterLookup[k] || (rawName||'').toString().trim();
}
function persistRMMaster(){
  try{ localStorage.setItem('rmmaster_override', JSON.stringify(STATE.rmMaster)); }catch(e){}
}

function loadCostFromStorage(){
  try{
    const saved = localStorage.getItem('cpc_override');
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

// ---- file load ----
async function readWb(file){
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, {type:'array', cellDates:true});
}
function findSheetName(wb, ...names){
  const targets = names.map(n => n.toLowerCase());
  return wb.SheetNames.find(n => targets.includes(n.toLowerCase())) || wb.SheetNames[0];
}

function buildRawData(finRows){
  return finRows.map(r => {
    const rm = (pickField(r,'currentRmName','Current RM Name','RM','Curren RM')||'').toString().trim();
    const cd = pickField(r,'createdDate','Created Date','created date');
    const lsd = pickField(r,'lastStatusDate','Last Status Date','last status date');
    const lpd = pickField(r,'leadInProcessDate','LeadProcessDate','Lead In Process Date','lead in process date');
    const cvd = pickField(r,'convertedDate','Converted Date','converted date');
    const createdMmm = normalizeMonthLabel(pickField(r,'CTM','Created Month')) || toMmmYyyy(cd);
    const lpm = normalizeMonthLabel(pickField(r,'LPM','LeadProcessMonth')) || toMmmYyyy(lpd);
    const convertedMmm = normalizeMonthLabel(pickField(r,'CM','Converted Month','ConvertedMonth')) ||
      ((cvd && cvd!=='' && cvd!=='N/A') ? toMmmYyyy(cvd) : '');
    const fmonth = normalizeMonthLabel(pickField(r,'FMONTH','FMonth')) ||
      ((convertedMmm && convertedMmm!=='N/A') ? convertedMmm : createdMmm);
    const sourceTeam = pickField(r,'Team');
    return {
      currentRmName: rm,
      Team: sourceTeam||'SV',
      _hasSourceTeam: sourceTeam !== '',
      clientName: pickField(r,'clientName','Client Name')||'',
      landingPage: pickField(r,'landingPage','Landing Page')||'',
      platformName: pickField(r,'platformName','Platform Name')||'',
      'Campaign Name': pickField(r,'Campaign Name','categoryName','campaignName','Category Name')||'',
      userId: pickField(r,'userId','User ID')||'',
      createdDate: toIsoDate(cd) || (cd||''),
      CTM: createdMmm,
      lastStatusDate: toIsoDate(lsd) || (lsd||''),
      LSM: toMmmYyyy(lsd),
      leadInProcessDate: (lpd==='N/A'||!lpd) ? 'N/A' : (toIsoDate(lpd) || lpd),
      LPM: lpm,
      leadHead: pickField(r,'leadHead','Lead Head')||'',
      leadStatus: (pickField(r,'leadStatus','Lead Status')||'').toString().trim().toUpperCase(),
      convertedDate: (cvd==='N/A'||!cvd) ? '' : (toIsoDate(cvd) || cvd),
      CM: convertedMmm || 'N/A',
      firstRmName: pickField(r,'firstRmName','First RM Name')||'',
      convertedByName: pickField(r,'convertedByName','Converted By Name')||'',
      annualIncome: pickField(r,'annualIncome','Annual Income')||'',
      clientCategory: pickField(r,'clientCategory','Client Category')||'',
      FMONTH: fmonth,
    };
  });
}

function detectMonths(){
  const set = new Set();
  for(const r of STATE.raw){
    if(r.FMONTH && r.FMONTH!=='N/A') set.add(r.FMONTH);
  }
  for(const r of STATE.b2bRaw){
    if(r.CreateMonth) set.add(r.CreateMonth);
  }
  for(const r of STATE.fy){ if(r.Month) set.add(r.Month); }
  for(const r of STATE.pa){ if(r.Month) set.add(r.Month); }
  // Pick up Revenue Input months (OLD CHECK) so the Month filter dynamically extends
  // when future months arrive in the revenue file.
  for(const r of (STATE.rev||[])){
    const raw = r['OLD CHECK']||r['Old Check']||r['old check']||r['OldCheck']||'';
    const m = normalizeMonthLabel(raw) || toMmmYyyy(raw);
    if(m && m!=='N/A') set.add(m);
  }
  STATE.months = sortMonths(Array.from(set));
}

function parseRevenueInput(wb){
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, {header:1, defval:'', raw:true, blankrows:false});
  let headerIdx = 0;
  for(let i=0;i<Math.min(rows.length,5);i++){
    const r = rows[i].map(x => (x||'').toString().toLowerCase());
    if(r.includes('clientname') && r.includes('rm') && r.includes('total')){ headerIdx = i; break; }
  }
  const headers = rows[headerIdx].map(h => (h||'').toString().trim());
  const data = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const row = rows[i];
    const obj = {}; let any = false;
    for(let c=0;c<headers.length;c++){
      const v = row[c]; obj[headers[c]] = (v==null?'':v);
      if(v!=null && v!=='') any = true;
    }
    if(any) data.push(obj);
  }
  return data;
}

function buildB2BRaw(rows){
  return rows.map(r => {
    const cd = (r.createdDate||r.CreatedDate||'').toString().trim();
    const cm = normalizeMonthLabel(r.CreateMonth||r.createMonth) || toMmmYyyy(cd);
    return {
      name:         (r.name||r.Name||'').toString().trim(),
      email:        (r.email||'').toString().trim(),
      phone:        (r.phone||'').toString().trim(),
      companyName:  (r.companyName||r.CompanyName||'').toString().trim(),
      companyEmail: (r.companyEmail||'').toString().trim(),
      leadHead:     (r.leadHead||'').toString().trim(),
      currentRmName:(r.currentRmName||r.CurrentRmName||'').toString().trim(),
      firstRmName:  (r.firstRmName||r.FirstRmName||'').toString().trim(),
      createdDate:  cd,
      CreateMonth:  cm,
      brokerName:   (r.brokerName||'').toString().trim(),
      brokerEmail:  (r.brokerEmail||'').toString().trim(),
      leadStatus:   (r.lea||r.leadStatus||r.status||r.Status||'').toString().trim().toUpperCase(),
      platformName: (r.platformName||'').toString().trim(),
      categoryName: (r.categoryName||'').toString().trim(),
      landingPage:  (r.landingPage||'').toString().trim(),
      enquiryType:  (r.enquiryType||'').toString().trim(),
    };
  });
}
function buildB2BData(rawRows){
  return rawRows.map(r => ({
    name:          r.name,
    companyName:   r.companyName,
    currentRmName: r.currentRmName,
    CreateMonth:   r.CreateMonth,
    status:        r.leadStatus,
    enquiryType:   r.enquiryType,
    platformName:  r.platformName,
  }));
}

// Case-insensitive column picker for uploaded xlsx files where header casing varies
function pickFieldCI(r, ...names){
  for(const n of names){ if(r[n]!=null && r[n]!=='') return r[n]; }
  const keys = Object.keys(r);
  for(const n of names){
    const nl = n.toLowerCase().trim();
    const k = keys.find(k => k.toLowerCase().trim() === nl);
    if(k && r[k]!=null && r[k]!=='') return r[k];
  }
  return '';
}

// Map full or short month name to MONTHS_3 index (0..11), or -1 if not a month
function monthNameToIdx(v){
  if(v==null) return -1;
  const s = String(v).trim().toLowerCase();
  if(!s) return -1;
  const FULL = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  let i = FULL.findIndex(n => n===s || n.slice(0,3)===s.slice(0,3));
  return i;
}

// Resolve "April" → "Apr-2026" using a sibling date column for the year.
// If sibling date missing, fall back to financial-year heuristic: Apr-Dec → fyStart, Jan-Mar → fyStart+1.
function resolveBareMonth(monthVal, siblingDate, fyStart){
  // 1) If month already looks like "Mmm-yyyy" / "Mmm-yy" / a Date / serial — let normalizeMonthLabel handle it.
  const norm = normalizeMonthLabel(monthVal);
  if(norm) return norm;
  const idx = monthNameToIdx(monthVal);
  if(idx < 0) return '';
  // 2) Try sibling date for year
  const d = parseDateAny(siblingDate);
  let year = d ? d.getFullYear() : null;
  // 3) Fall back to FY heuristic (FY 2026-2027 starts Apr 2026)
  if(!year && fyStart!=null){
    year = (idx >= 3) ? fyStart : (fyStart + 1); // Apr (idx 3) onward → fyStart; Jan/Feb/Mar → fyStart+1
  }
  if(!year) return '';
  return MONTHS_3[idx]+'-'+year;
}

// FY 2026-2027 — Financial Plans source. Map via RM Name.
function buildFYData(rows){
  return rows.map(r => {
    const rmName = (pickFieldCI(r,'RM Name','RM','rmName')||'').toString().trim();
    const rawMonth = pickFieldCI(r,'Month','month','MONTH');
    const sibDate  = pickFieldCI(r,'Tkt Recd Date','Ticket Recd Date','Date','Created Date','Resolution Date');
    return {
      Month:       resolveBareMonth(rawMonth, sibDate, 2026),
      rmName:      rmName,
      mappedRM:    mapRM(rmName),
      workpoint:   (pickFieldCI(r,'Excel/ Workpoint','Excel/Workpoint','ExcelWorkpoint','Excel / Workpoint','Workpoint','Work Point','workpoint','excel/workpoint','excel/ workpoint')||'').toString().trim(),
      leadSource:  (pickFieldCI(r,'Lead Source ','Lead Source','leadSource','Lead source')||'').toString().trim(),
      clientName:  (pickFieldCI(r,'Client Name','clientName')||'').toString().trim(),
    };
  });
}
// Plan Approval Sheet — Financial Plans source. Map via Advisor.
function buildPAData(rows){
  return rows.map(r => {
    const advisor = (pickFieldCI(r,'Advisor','advisor','ADVISOR','Advisor Name')||'').toString().trim();
    const rawMonth = pickFieldCI(r,'Month','month','MONTH');
    const sibDate  = pickFieldCI(r,'Date','Approval Date','Created Date');
    return {
      Month:       resolveBareMonth(rawMonth, sibDate, 2026),
      advisor:     advisor,
      mappedRM:    mapRM(advisor),
      clientType:  (pickFieldCI(r,'Client Type','clientType','CLIENT TYPE','Client type')||'').toString().trim(),
      leadSource:  (pickFieldCI(r,'Lead Source','Lead Source ','leadSource','Lead source')||'').toString().trim(),
      clientName:  (pickFieldCI(r,'Client Name','clientName')||'').toString().trim(),
    };
  });
}

async function handleLoad(){
  const fin    = $('#fin23-file').files[0];
  const rev    = $('#rev-file').files[0];
  const b2bFile= $('#b2b-file').files[0];
  if(!fin && !rev && !b2bFile){ alert('Please upload at least one file.'); return; }

  $('#load-btn').disabled = true;
  $('#load-btn').textContent = 'Loading…';
  STATE.filesLoaded = { fin23: false, rev: false, b2b: false,
    fy: STATE.fy.length>0, pa: STATE.pa.length>0 };

  try{
    loadEmployeeFromStorage();
    loadCostFromStorage();
    loadRMMasterFromStorage();

    if(fin){
      const finWb = await readWb(fin);
      const finSheet = findSheetName(finWb, 'RAW_DATA', 'RawData');
      const finRows = XLSX.utils.sheet_to_json(finWb.Sheets[finSheet], {defval:'', raw:true});
      STATE.raw = buildRawData(finRows);
      STATE.rawFilters = {};
      STATE.filesLoaded.fin23 = true;
    } else {
      STATE.raw = [];
      STATE.rawFilters = {};
    }

    rebuildTeamMap();

    if(rev){
      const revWb = await readWb(rev);
      STATE.rev = parseRevenueInput(revWb);
      STATE.filesLoaded.rev = true;
    } else {
      STATE.rev = [];
    }

    if(b2bFile){
      const b2bWb = await readWb(b2bFile);
      const b2bRows = XLSX.utils.sheet_to_json(b2bWb.Sheets[b2bWb.SheetNames[0]], {defval:'', raw:true});
      STATE.b2bRaw = buildB2BRaw(b2bRows);
      STATE.b2b = buildB2BData(STATE.b2bRaw);
      STATE.b2bFilters = {};
      STATE.filesLoaded.b2b = true;
    } else {
      STATE.b2bRaw = [];
      STATE.b2b = [];
      STATE.b2bFilters = {};
    }

    detectMonths();
    reconcileCostMonths();
    initFilters();
    initRevFilters();
    renderAll();
    showApp();
  }catch(e){
    console.error(e); alert('Failed to load: ' + e.message);
  }finally{
    $('#load-btn').disabled = false;
    $('#load-btn').textContent = 'Load Dashboard';
  }
}

function showUpload(){ $('#upload-screen').style.display='flex'; $('#app').style.display='none'; }
function showApp()   { $('#upload-screen').style.display='none'; $('#app').style.display='block'; updateDataSubtitle(); }

function updateDataSubtitle(){
  const el = $('#app-subtitle');
  if(!el) return;
  if(!STATE.raw || !STATE.raw.length){ el.textContent = '—'; return; }
  let maxTs = 0;
  for(const r of STATE.raw){
    const d = r.createdDate;
    if(!d) continue;
    const t = new Date(d).getTime();
    if(!isNaN(t) && t > maxTs) maxTs = t;
  }
  if(!maxTs){ el.textContent = '—'; return; }
  const dt = new Date(maxTs);
  const day = dt.getDate();
  const mon = dt.toLocaleString('en-IN',{month:'long'});
  const yr  = dt.getFullYear();
  const d1 = day % 10, d2 = day % 100;
  const suffix = (d2>=11&&d2<=13)?'th':d1===1?'st':d1===2?'nd':d1===3?'rd':'th';
  STATE.dataTill = `Data till ${day}${suffix} ${mon} ${yr}`;
  el.textContent = STATE.dataTill;
}

// ---- filters / tabs ----
const FY_CUTOFF = monthKey('Apr-2026');
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
  requestAnimationFrame(() => {
    const panel = $('#tab-'+id);
    if(panel) panel.querySelectorAll('.table-wrap').forEach(attachMirrorScroll);
  });
}

// ---- aggregators ----
function applyRefColdFilter(rows){
  const mode = rcFilter(STATE.filterRefCold);
  if(mode === 'Exclude')
    return rows.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  if(mode === 'Only Referral')
    return rows.filter(r => r['Campaign Name']==='Referral');
  return rows;
}

function topKPIs(){
  let rows = applyRefColdFilter(STATE.raw);
  // YTD Leads (Fixed) is intentionally NOT affected by the Month or Ref+Cold filters —
  // it always reflects the full fixed FY period, unfiltered, and only changes when data is reloaded.
  const ytd = STATE.raw.filter(r=>filteredMonths().includes(r.FMONTH)).length;
  const generated = rows.filter(r=>monthFilter(r.CTM)).length;
  const sc = st => rows.filter(r => r.leadStatus===st && monthFilter(r[statusMonthCol(st)])).length;
  const converted = sc('CONVERTED'), inProcess = sc('IN PROCESS');
  return {
    ytd, generated, assigned: sc('ASSIGNED'), converted, inProcess,
    followUp: sc('FOLLOW UP'), onHold: sc('ON HOLD'), dead: sc('DEAD'),
    reAssigned: sc('RE-ASSIGNED'),
    qlRate: generated>0 ? (converted+inProcess)/generated : 0,
  };
}

function liveDataKPIs(){
  let rows = applyRefColdFilter(STATE.raw);
  const assigned = rows.filter(r=>r.leadStatus==='ASSIGNED' && monthFilter(r.CTM)).length;
  if(isAllMonths()) return { assigned, anyConv: null, anyIP: null, sameConv: null, sameIP: null };
  // AnyMonth = status event in selected month(s), lead CREATED outside those month(s)
  // SameMonth = status event in selected month(s), lead CREATED in the same selected month(s)
  const anyConv = rows.filter(r =>
    r.leadStatus==='CONVERTED' && monthFilter(r.CM) && !monthFilter(r.CTM)
  ).length;
  const anyIP = rows.filter(r =>
    r.leadStatus==='IN PROCESS' && monthFilter(r.LPM) && !monthFilter(r.CTM)
  ).length;
  const sameConv = rows.filter(r =>
    r.leadStatus==='CONVERTED' && monthFilter(r.CM) && monthFilter(r.CTM)
  ).length;
  const sameIP = rows.filter(r =>
    r.leadStatus==='IN PROCESS' && monthFilter(r.LPM) && monthFilter(r.CTM)
  ).length;
  return { assigned, anyConv, anyIP, sameConv, sameIP };
}

function platformsForLeadsTable(){
  return [
    {label:'Google Adwords', match: r => r.platformName==='Google Adwords' || r['Campaign Name']==='Google'},
    {label:'Social Media',   match: r => r['Campaign Name']==='Social Media'},
    {label:'Workshop',       match: r => r.platformName==='BTL Marketing'},
    {label:'Brand Marketing',match: r => r.platformName==='Brand Marketing'},
    {label:'Referral',       match: r => r.platformName==='Referral'},
    {label:'Cold Leads',     match: r => r.platformName==='Cold Leads'},
  ];
}

function leadsByPlatformMonth(){
  const buckets = platformsForLeadsTable();
  const rows = STATE.raw;
  const months = filteredMonths();
  const refMode = STATE.filterRefCold;
  const out = buckets.map(b => {
    const o = {Platform: b.label, total:0};
    months.forEach(m => {
      let c = rows.filter(x => b.match(x) && x.CTM===m).length;
      if(refMode==='Exclude' && (b.label==='Referral' || b.label==='Cold Leads')) c = 0;
      o[m] = c; o.total += c;
    });
    return o;
  });
  const gt = {Platform:'Grand Total', total:0, _tot:true};
  months.forEach(m => gt[m] = out.reduce((s,r)=>s+r[m],0));
  gt.total = out.reduce((s,r)=>s+r.total,0);
  out.push(gt);
  return out;
}

function statusByMonth(teamFilter){
  const months = filteredMonths();
  const firstRmTeam = r => {
    const key = (r.firstRmName||'').toString().trim().toLowerCase();
    return STATE.teamMap[key] || 'SV';
  };
  let base = STATE.raw;
  if(teamFilter === 'SV') base = base.filter(r => firstRmTeam(r) === 'SV');
  else if(teamFilter === 'non-SV') base = base.filter(r => firstRmTeam(r) !== 'SV');
  return STATUSES.map(st => {
    const r = {Status: st, total: 0};
    months.forEach(m => {
      const col = statusMonthCol(st);
      const c = base.filter(x => x.leadStatus===st && x[col]===m).length;
      r[m] = c; r.total += c;
    });
    return r;
  });
}

function platformStatusBreakdown(){
  const month = STATE.filterMonth;
  const mode = STATE.filterTable;
  let rows = applyRefColdFilter(STATE.raw);
  if(STATE.psTeamFilter !== 'All') rows = rows.filter(r => r.Team === STATE.psTeamFilter);
  const groups = [
    {label:'Google Adwords', match: r => r.platformName==='Google Adwords'},
    {label:'Facebook',       match: r => r.platformName==='Facebook'},
    {label:'Brand Marketing',match: r => r.platformName==='Brand Marketing'},
    {label:'BTL Marketing',  match: r => r.platformName==='BTL Marketing'},
    {label:'Referral',       match: r => r.platformName==='Referral'},
    {label:'Emailer',        match: r => r.platformName==='Emailer'},
    {label:'Direct Registration', match: r => r.platformName==='Direct Registration'},
    {label:'Cold Leads',     match: r => r.platformName==='Cold Leads'},
  ];
  const out = [];
  for(const g of groups){
    const sub = rows.filter(g.match);
    const obj = {Platform: g.label}; let total = 0;
    for(const st of STATUSES){
      let pool = sub.filter(r => r.leadStatus===st);
      if(!isAllMonths()){
        if(mode==='AnyMonth'){
          const acol = anyMonthCol(st);
          pool = pool.filter(r => monthFilter(r[acol]) && !monthFilter(r.CTM));
        } else if(mode==='SameMonth'){
          const acol = anyMonthCol(st);
          pool = pool.filter(r => monthFilter(r[acol]) && monthFilter(r.CTM));
        } else {
          const acol = anyMonthCol(st);
          pool = pool.filter(r => monthFilter(r[acol]));
        }
      }
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    obj.LCR = total>0 ? obj.CONVERTED/total : 0;
    out.push(obj);
  }
  const gt = {Platform:'Grand Total', _tot:true};
  let tot = 0;
  STATUSES.forEach(st => { gt[st] = out.reduce((s,r)=>s+r[st],0); tot += gt[st]; });
  gt.Total = tot;
  gt.LCR = null;
  out.push(gt);
  return out;
}

function landingPageStatusBreakdown(){
  const mode = STATE.lpTableMode || 'All';
  let rows = applyRefColdFilter(STATE.raw);
  if(STATE.lpTeamFilter !== 'All') rows = rows.filter(r => r.Team === STATE.lpTeamFilter);
  if(STATE.lpCampaignFilter && STATE.lpCampaignFilter !== 'All')
    rows = rows.filter(r => r['Campaign Name'] === STATE.lpCampaignFilter);

  // Group by landingPage — every row lands in exactly one bucket so grand total reconciles
  const lpMap = new Map();
  for(const r of rows){
    const lp = r.landingPage || '';
    if(!lpMap.has(lp)) lpMap.set(lp, []);
    lpMap.get(lp).push(r);
  }
  const sortedLPs = [...lpMap.keys()].sort((a,b)=>{
    if(a==='' && b!=='') return 1;
    if(a!=='' && b==='') return -1;
    return a.localeCompare(b);
  });

  const applyMode = (pool, acol) => {
    if(isAllMonths()) return pool;
    if(mode==='AnyMonth')   return pool.filter(r => monthFilter(r[acol]) && !monthFilter(r.CTM));
    if(mode==='SameMonth')  return pool.filter(r => monthFilter(r[acol]) && monthFilter(r.CTM));
    return pool.filter(r => monthFilter(r[acol]));
  };

  const out = [];
  for(const lp of sortedLPs){
    const sub = lpMap.get(lp);
    const obj = {'Landing Page': lp || '(Blank)'}; let total = 0;
    for(const st of STATUSES){
      const pool = applyMode(sub.filter(r => r.leadStatus===st), anyMonthCol(st));
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    obj.LCR  = total>0 ? obj.CONVERTED/total : 0;
    obj.QLCR = total>0 ? ((obj.CONVERTED||0)+(obj['IN PROCESS']||0))/total : 0;
    out.push(obj);
  }
  const gt = {'Landing Page':'Grand Total', _tot:true}; let tot=0;
  STATUSES.forEach(st=>{ gt[st]=out.reduce((s,r)=>s+r[st],0); tot+=gt[st]; });
  gt.Total=tot; gt.LCR=null; gt.QLCR=null;
  out.push(gt);
  return out;
}

function teamPerformance(){
  let base = applyRefColdFilter(STATE.raw);
  const teams = FIXED_TEAMS.slice();
  const firstRmTeam = r => {
    const key = (r.firstRmName||'').toString().trim().toLowerCase();
    return STATE.teamMap[key] || 'SV';
  };

  return teams.map(team => {
    const rows = base.filter(r => firstRmTeam(r) === team);
    const totalLeads = rows.filter(r => monthFilter(r.CTM)).length;
    const obj = {Team: team, 'Total Leads': totalLeads};
    for(const st of STATUSES){
      const pool = rows.filter(r => r.leadStatus===st && monthFilter(r[statusMonthCol(st)]));
      obj[st] = pool.length;
    }
    obj['Conv. Rate'] = totalLeads>0 ? obj.CONVERTED/totalLeads : 0;
    return obj;
  });
}

function campaignByTeam(){
  const refMode = rcFilter(STATE.filterRefCold);
  let base = applyRefColdFilter(STATE.raw);
  base = base.filter(r => monthFilter(r.CTM));

  const cpc = STATE.cost;
  const campaigns = [];
  for(let i=1;i<cpc.length;i++){
    const name = cpc[i][0];
    if(!name) continue;
    if(refMode==='Exclude' && (name==='Referral' || name==='Cold Data')) continue;
    campaigns.push(name);
  }
  // include any extra campaigns that exist in raw but not in CPC
  const knownSet = new Set(campaigns);
  for(const r of base){
    const c = r['Campaign Name'];
    if(c && !knownSet.has(c) && !(refMode==='Exclude' && (c==='Referral'||c==='Cold Data'))){
      campaigns.push(c); knownSet.add(c);
    }
  }

  // Map firstRmName → team using teamMap (mirror rebuildTeamMap: lowercase key, 'SV' default)
  const firstRmTeam = r => {
    const key = (r.firstRmName||'').toString().trim().toLowerCase();
    return STATE.teamMap[key] || 'SV';
  };

  // Show all FIXED_TEAMS that have leads, plus any extra team values, so no lead is dropped
  const teamSet = new Set(base.map(r => firstRmTeam(r)));
  const teams = FIXED_TEAMS.filter(t => teamSet.has(t));
  for(const t of teamSet){ if(!teams.includes(t)) teams.push(t); }

  const rows = teams.map(team => {
    const obj = {Team: team}; let total = 0;
    for(const c of campaigns){
      const n = base.filter(r => firstRmTeam(r)===team && r['Campaign Name']===c).length;
      obj[c] = n; total += n;
    }
    obj.Total = total;
    return obj;
  });
  const gt = {Team:'Grand Total', _tot:true, Total:0};
  for(const c of campaigns){
    gt[c] = rows.reduce((s,r)=>s+(r[c]||0),0);
    gt.Total += gt[c];
  }
  rows.push(gt);
  return {campaigns, rows};
}

function incomeSegment(){
  const rows = applyRefColdFilter(STATE.raw);
  const leadRows = rows.filter(r => monthFilter(r.CTM));
  const convRows = rows.filter(r => r.leadStatus==='CONVERTED' && monthFilter(r.CM));
  const ipRows   = rows.filter(r => r.leadStatus==='IN PROCESS' && monthFilter(r.LPM));
  const order = ['Above 20 Lac','15 Lac to 20 Lac','10 Lac to 20 Lac','10 Lac to 15 Lac','5 Lac to 10 Lac','0 to 5 Lac'];
  const orderSet = new Set(order);
  const bandSet = new Set(leadRows.map(r=>r.annualIncome).filter(Boolean));
  const bands = [];
  for(const b of order){ if(bandSet.has(b)) bands.push(b); }

  const mkRow = (label, sub, conv, ip, opts={}) => {
    const quality = conv + ip;
    return { 'Income Band': label, Leads: sub, Converted: conv, 'In Process': ip,
      'Quality Leads': quality,
      'Conv. Rate':  sub>0 ? conv/sub    : 0,
      'QLCR':        sub>0 ? quality/sub : 0,
      ...opts };
  };

  const results = bands.map(b => mkRow(
    b,
    leadRows.filter(r => r.annualIncome === b).length,
    convRows.filter(r => r.annualIncome === b).length,
    ipRows.filter(r => r.annualIncome === b).length
  ));

  const blankSub = leadRows.filter(r => !r.annualIncome || String(r.annualIncome).trim()==='').length;
  const blankCon = convRows.filter(r => !r.annualIncome || String(r.annualIncome).trim()==='').length;
  const blankIP  = ipRows.filter(r => !r.annualIncome || String(r.annualIncome).trim()==='').length;
  results.push(mkRow('Blank Values', blankSub, blankCon, blankIP, {_blank:true}));

  const otherSub = leadRows.filter(r => r.annualIncome && String(r.annualIncome).trim()!=='' && !orderSet.has(r.annualIncome)).length;
  const otherCon = convRows.filter(r => r.annualIncome && String(r.annualIncome).trim()!=='' && !orderSet.has(r.annualIncome)).length;
  const otherIP  = ipRows.filter(r => r.annualIncome && String(r.annualIncome).trim()!=='' && !orderSet.has(r.annualIncome)).length;
  results.push(mkRow('Other Values', otherSub, otherCon, otherIP, {_other:true}));

  const totalBandLeads = leadRows.length;
  results.forEach(r => { r['Share %'] = totalBandLeads>0 ? r.Leads/totalBandLeads : 0; });
  return results;
}

function costSummaryByCampaign(){
  const cpc = STATE.cost; const header = cpc[0]||[];
  const monthCols = header.slice(1).map(toMmmYyyy);
  const refMode = rcFilter(STATE.filterRefCold);
  const out = []; let totLeads=0, totCost=0, totQual=0;
  for(let i=1;i<cpc.length;i++){
    const row = cpc[i]; const name = row[0];
    let leads = STATE.raw.filter(r => r['Campaign Name']===name && monthFilter(r.CTM)).length;
    let qual  = STATE.raw.filter(r => r['Campaign Name']===name && monthFilter(r.CTM) && (r.leadStatus==='CONVERTED'||r.leadStatus==='IN PROCESS')).length;
    // sum cost across the effective months (selected months, or all dropdown months when "All")
    const cost = effectiveMonths().reduce((s,m) => { const idx=monthCols.indexOf(m); return s + (idx>=0?(Number(row[idx+1])||0):0); }, 0);
    if(refMode==='Exclude' && (name==='Referral' || name==='Cold Data')){ leads = 0; qual = 0; }
    const cpl  = leads>0 ? cost/leads : 0;
    const cpql = qual>0  ? cost/qual  : 0;
    out.push({Campaign:name, Leads:leads, 'Cost (₹)':cost, 'CPL (₹)':cpl, 'Quality Leads':qual, 'CPQL (₹)':cpql});
    totLeads += leads; totCost += cost; totQual += qual;
  }
  out.push({Campaign:'Grand Total', Leads:totLeads, 'Cost (₹)':totCost, 'CPL (₹)':totLeads>0?totCost/totLeads:0,
    'Quality Leads':totQual, 'CPQL (₹)':totQual>0?totCost/totQual:0, _tot:true});
  return out;
}

function costPerLeadPerRM(){
  const cpc = STATE.cost; const header = cpc[0]||[];
  const monthCols = header.slice(1).map(toMmmYyyy);
  const month = STATE.filterMonth, refMode = STATE.filterRefCold;

  const costSummary = costSummaryByCampaign();
  const cplMap = {};
  for(const c of costSummary){ if(!c._tot) cplMap[c.Campaign] = c['CPL (₹)']; }

  let scope = STATE.raw;
  if(refMode==='Exclude') scope = scope.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  if(month!=='All') scope = scope.filter(r => r.CTM===month);
  scope = scope.filter(r => r.Team !== 'SV');

  const rms = {};
  for(const r of scope){
    const rm = r.currentRmName || '(unassigned)';
    if(!rms[rm]) rms[rm] = {RM: rm, Team: r.Team||'', Leads:0, Cost:0};
    rms[rm].Leads++;
    rms[rm].Cost += cplMap[r['Campaign Name']] || 0;
  }
  return Object.values(rms).map(o => ({
    Team:o.Team, RM:o.RM, Leads:o.Leads,
    'Cost (₹)': o.Cost, 'CPL (₹)': o.Leads>0?o.Cost/o.Leads:0,
  })).sort((a,b)=> a.Team.localeCompare(b.Team) || b.Leads-a.Leads);
}

function costPerLeadPerRMWithTotals(){
  const month = STATE.filterMonth, refMode = STATE.filterRefCold;
  const costSummary = costSummaryByCampaign();
  const cplMap = {};
  const campaignSet = new Set();
  let totalLeads = 0, totalCost = 0, totalCpl = 0, totalQual = 0;

  for(const row of costSummary){
    const costKey = Object.keys(row).find(k => k.startsWith('Cost '));
    const cplKey = Object.keys(row).find(k => k.startsWith('CPL '));
    if(row._tot){
      totalLeads = row.Leads || 0;
      totalCost = Number(row[costKey]) || 0;
      totalCpl = Number(row[cplKey]) || 0;
      totalQual = row['Quality Leads'] || 0;
    } else {
      campaignSet.add(row.Campaign);
      cplMap[row.Campaign] = Number(row[cplKey]) || 0;
    }
  }

  let scope = STATE.raw;
  if(refMode==='Exclude') scope = scope.filter(r => r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  if(month!=='All') scope = scope.filter(r => r.CTM===month);
  scope = scope.filter(r => campaignSet.has(r['Campaign Name']));

  // Total Leads counted by firstRmName
  const leadCounts = {};
  for(const r of scope){
    const frmName = (r.firstRmName||'').trim();
    const frmTeam = STATE.teamMap[frmName.toLowerCase()] || r['Team of FirstRM'] || 'SV';
    const rm = frmTeam === 'SV' ? 'SV Team (Collective)' : (frmName || '(unassigned)');
    const key = frmTeam === 'SV' ? 'SV' : frmTeam + '|' + rm;
    leadCounts[key] = (leadCounts[key] || 0) + 1;
  }

  // Cost and quality leads counted by currentRmName
  const groups = {};
  for(const r of scope){
    const team = r.Team || 'SV';
    const rm = team === 'SV' ? 'SV Team (Collective)' : (r.currentRmName || '(unassigned)');
    const key = team === 'SV' ? 'SV' : team + '|' + rm;
    if(!groups[key]) groups[key] = {Team:team, RM:rm, totalLeads:0, totalCost:0, qualLeads:0};
    groups[key].totalCost += cplMap[r['Campaign Name']] || 0;
    if(r.leadStatus==='CONVERTED' || r.leadStatus==='IN PROCESS') groups[key].qualLeads++;
  }

  // Merge firstRM lead counts into groups
  for(const key of Object.keys(leadCounts)){
    if(!groups[key]){
      const parts = key.split('|');
      const team = parts[0] || 'SV';
      const rm = parts[1] || 'SV Team (Collective)';
      groups[key] = {Team:team, RM:rm, totalLeads:0, totalCost:0, qualLeads:0};
    }
    groups[key].totalLeads = leadCounts[key];
  }

  const rows = Object.values(groups).map(r => ({
    ...r,
    cpl:  r.totalLeads > 0 ? r.totalCost / r.totalLeads : 0,
    cpql: r.qualLeads  > 0 ? r.totalCost / r.qualLeads  : 0,
  })).sort((a,b) => {
    if(a.Team==='SV' && b.Team!=='SV') return 1;
    if(a.Team!=='SV' && b.Team==='SV') return -1;
    return a.Team.localeCompare(b.Team) || b.totalLeads-a.totalLeads;
  });

  rows.push({
    Team:'Grand Total', RM:'',
    totalLeads, totalCost,
    cpl: totalCpl,
    qualLeads: totalQual,
    cpql: totalQual > 0 ? totalCost / totalQual : 0,
    _tot:true,
  });
  return rows;
}

function inProcessDataset(){
  const month = STATE.filterMonth;
  let base = applyRefColdFilter(STATE.raw);
  const statuses = ['DEAD','ON HOLD','ASSIGNED','RE-ASSIGNED','FOLLOW UP','CONVERTED'];
  const teams = FIXED_TEAMS.slice();

  const out = teams.map(team => {
    const rows = base.filter(r => r.Team === team);
    const obj = {Team: team}; let total = 0;
    for(const st of statuses){
      let pool;
      if(month==='All'){
        pool = rows.filter(r => r.LPM!=='N/A' && r.leadStatus===st);
      } else {
        pool = rows.filter(r => r.LPM===month && r.leadStatus===st);
      }
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    return obj;
  });
  const gt = {Team:'Grand Total', _tot:true, Total:0};
  statuses.forEach(st => { gt[st] = out.reduce((s,r)=>s+r[st],0); gt.Total += gt[st]; });
  out.push(gt);
  return {statuses, data: out};
}

function convertedDataset(){
  const month = STATE.filterMonth;
  let base = applyRefColdFilter(STATE.raw);
  const statuses = ['DEAD','ON HOLD','ASSIGNED','RE-ASSIGNED','FOLLOW UP','IN PROCESS'];
  const teams = FIXED_TEAMS.slice();

  const isExcelMonthShape = v => /^.{3}-.{4}$/.test(String(v ?? ''));
  const out = teams.map(team => {
    const rows = base.filter(r => r.Team === team);
    const obj = {Team: team}; let total = 0;
    for(const st of statuses){
      let pool;
      if(month==='All'){
        pool = rows.filter(r => isExcelMonthShape(r.CM) && r.leadStatus===st);
      } else {
        pool = rows.filter(r => r.CM===month && r.leadStatus===st);
      }
      obj[st] = pool.length; total += pool.length;
    }
    obj.Total = total;
    return obj;
  });
  const gt = {Team:'Grand Total', _tot:true, Total:0};
  statuses.forEach(st => { gt[st] = out.reduce((s,r)=>s+r[st],0); gt.Total += gt[st]; });
  out.push(gt);
  return {statuses, data: out};
}

// ---- RM Performance (Lead → Revenue tracker) ----
function isAllRmPerfMonths(){ return STATE.rmPerfMonth==='All' || (Array.isArray(STATE.rmPerfMonth) && STATE.rmPerfMonth.length===0); }
function rmPerfMonthMatch(m){
  const sel = STATE.rmPerfMonth;
  if(isAllRmPerfMonths()) return filteredMonths().includes(m);
  if(Array.isArray(sel)) return sel.includes(m);
  return m === sel;
}
function rmPerformance(){
  const monthMatch = m => rmPerfMonthMatch(m);
  const refExclude = STATE.rmPerfRefCold === 'Exclude';
  const campOK = r => !refExclude || (r['Campaign Name']!=='Referral' && r['Campaign Name']!=='Cold Data');
  const lsOK = ls => !refExclude || (ls!=='Referral' && ls!=='ReferralProgram');
  const lpOK = lp => !refExclude || (lp!=='Referral' && lp!=='ReferralProgram');

  // ---- per-RM (currentRmName / mapped) ----
  const leadsForRM = rm => STATE.raw.filter(r => r.currentRmName===rm && monthMatch(r.CTM) && campOK(r)).length;
  // Quality = CONVERTED (by CM) + IN PROCESS (by LPM) — same column logic as KPI cards
  const qualityForRM = rm => STATE.raw.filter(r => r.currentRmName===rm && campOK(r) && (
    (r.leadStatus==='CONVERTED' && monthMatch(r.CM)) ||
    (r.leadStatus==='IN PROCESS' && monthMatch(r.LPM))
  )).length;
  const rmEq = (a, b) => (a||'').trim().toLowerCase() === (b||'').trim().toLowerCase();
  const fpForRM = rm => {
    const fy = STATE.fy.filter(r => rmEq(r.mappedRM, rm) && monthMatch(r.Month) && lsOK(r.leadSource)).length;
    const pa = STATE.pa.filter(r => rmEq(r.mappedRM, rm) && r.clientType.toUpperCase()==='NEW' && monthMatch(r.Month) && lsOK(r.leadSource)).length;
    return fy + pa;
  };
  // Normalize OLD CHECK to "Mmm-yyyy" so the filter works regardless of how it's stored
  // (string "Jun-2026", "June 2026", Date object, Excel date serial, etc.)
  const revMonthOf = r => {
    const raw = r['OLD CHECK']||r['Old Check']||r['old check']||r['OldCheck']||'';
    return normalizeMonthLabel(raw) || toMmmYyyy(raw) || String(raw||'').trim();
  };
  const revRowMatches = r => {
    if(!monthMatch(revMonthOf(r))) return false;
    const lp = (r.LP||r.lp||r['Campaign Category']||'').toString().trim();
    return lpOK(lp);
  };
  const revAmount = r => Number(r.Total||r.TOTAL||r.total||0) || 0;
  const revClientType = r => (r['CLIENT TYPE']||r['client type']||r['Client Type']||'').toString().toUpperCase();
  // Revenue Input RM names also flow through RM Master Mapping so abbreviated or
  // variant names (e.g. "Vivek", "Ravi Sharma ", "Akansha") resolve to the canonical
  // RM name that EMPLOYEE_REF and the rest of the dashboard recognize.
  const revRawRm = r => (r.RM||r.rm||r['Curren RM']||r['Current RM']||'').toString().trim();
  const revMappedRm = r => mapRM(revRawRm(r)) || revRawRm(r);
  const revRowsForRM = rm => {
    const U = rm.toUpperCase();
    return STATE.rev.filter(r => revMappedRm(r).toUpperCase() === U && revRowMatches(r));
  };
  const rev15kForRM = rm => revRowsForRM(rm).filter(r => revClientType(r)==='REVENUE BASED').length;
  const transForRM  = rm => revRowsForRM(rm).filter(r => revClientType(r)==='NOT ELIGIBLE').length;
  const revenueForRM= rm => revRowsForRM(rm).reduce((s,r)=> s + revAmount(r), 0);

  // Team-direct revenue aggregation — guarantees no revenue rows are lost even if
  // an RM is missing from EMPLOYEE_REF. Team is resolved by cascade:
  //   1) RM Master Mapping team column (canonical-RM → team)
  //   2) EMPLOYEE_REF team map (RM → team)
  //   3) fall back to "Unmatched" so the grand total still reconciles
  const teamForRevRow = r => {
    const mapped = revMappedRm(r);
    const k = (mapped||'').toString().trim().toLowerCase();
    return STATE.rmMasterTeam[k] || STATE.teamMap[k] || 'Unmatched';
  };
  const revTeamAgg = {};
  for(const r of STATE.rev){
    if(!revRowMatches(r)) continue;
    const t = teamForRevRow(r);
    if(!revTeamAgg[t]) revTeamAgg[t] = {revenue:0, rev15k:0, trans:0};
    revTeamAgg[t].revenue += revAmount(r);
    const ct = revClientType(r);
    if(ct==='REVENUE BASED') revTeamAgg[t].rev15k++;
    else if(ct==='NOT ELIGIBLE') revTeamAgg[t].trans++;
  }

  // ---- team-based (raw) for summary leads/quality ----
  const leadsForTeam = team => STATE.raw.filter(r => r.Team===team && monthMatch(r.CTM) && campOK(r)).length;
  // Quality = CONVERTED (by CM) + IN PROCESS (by LPM) — same column logic as KPI cards
  const qualityForTeam = team => STATE.raw.filter(r => r.Team===team && campOK(r) && (
    (r.leadStatus==='CONVERTED' && monthMatch(r.CM)) ||
    (r.leadStatus==='IN PROCESS' && monthMatch(r.LPM))
  )).length;

  // Group revenue rows by team → canonical (mapped) RM name so the detail table can
  // include every RM that has revenue (even ones missing from EMPLOYEE_REF).
  const revByTeamRM = {}; // team → { mappedRM → [rev rows] }
  for(const r of STATE.rev){
    if(!revRowMatches(r)) continue;
    const mapped = revMappedRm(r) || '(blank RM)';
    const team = teamForRevRow(r);
    if(!revByTeamRM[team]) revByTeamRM[team] = {};
    (revByTeamRM[team][mapped] = revByTeamRM[team][mapped] || []).push(r);
  }
  const revStatsFor = rows => ({
    rev15k:  rows.filter(r => revClientType(r)==='REVENUE BASED').length,
    trans:   rows.filter(r => revClientType(r)==='NOT ELIGIBLE').length,
    revenue: rows.reduce((s,r)=> s + revAmount(r), 0),
  });

  const teams = FIXED_TEAMS.slice();
  const detail = [];
  const summary = [];
  for(const team of teams){
    const rms = [];
    const seenRM = new Set();
    for(let i=1;i<STATE.empref.length;i++){
      const er = STATE.empref[i]; if(!er) continue;
      if((er[1]||'').toString().trim()===team){
        const nm = (er[2]||'').toString().trim();
        if(nm && !seenRM.has(nm.toLowerCase())){ rms.push(nm); seenRM.add(nm.toLowerCase()); }
      }
    }
    // Add RMs that have revenue rows attributed to this team but aren't in EMPLOYEE_REF
    const teamRevRMs = revByTeamRM[team] || {};
    for(const rm of Object.keys(teamRevRMs)){
      if(!seenRM.has(rm.toLowerCase())){ rms.push(rm); seenRM.add(rm.toLowerCase()); }
    }

    let tFp=0;
    for(const rm of rms){
      const row = { team, rm,
        leads: leadsForRM(rm), quality: qualityForRM(rm),
        fp: fpForRM(rm), rev15k: rev15kForRM(rm),
        trans: transForRM(rm), revenue: revenueForRM(rm) };
      detail.push(row);
      tFp += row.fp;
    }
    // Team-direct totals from STATE.rev guarantee no revenue rows are lost
    // even if the RM is missing from EMPLOYEE_REF or unmapped.
    const t = revTeamAgg[team] || {revenue:0, rev15k:0, trans:0};
    summary.push({ team,
      leads: leadsForTeam(team), quality: qualityForTeam(team),
      fp: tFp, rev15k: t.rev15k, trans: t.trans, revenue: t.revenue });
  }

  // Surface unmatched-RM revenue in both the summary AND the detail table
  // so the grand total reconciles exactly with the Revenue Input file.
  const um = revTeamAgg['Unmatched'];
  if(um && (um.revenue || um.rev15k || um.trans)){
    summary.push({ team:'Unmatched RM', leads:0, quality:0, fp:0,
      rev15k: um.rev15k, trans: um.trans, revenue: um.revenue });
    const unmatchedRMs = revByTeamRM['Unmatched'] || {};
    for(const rm of Object.keys(unmatchedRMs)){
      const stats = revStatsFor(unmatchedRMs[rm]);
      detail.push({ team:'Unmatched RM', rm,
        leads:0, quality:0, fp:0,
        rev15k:stats.rev15k, trans:stats.trans, revenue:stats.revenue });
    }
  }

  // Grand totals: leads/quality/fp from FIXED_TEAMS, revenue from the direct rev aggregation
  // (sum across all teams including 'Unmatched').
  const grand = summary.reduce((g,s)=>({
    leads:g.leads+s.leads, quality:g.quality+s.quality, fp:g.fp+s.fp,
    rev15k:g.rev15k+s.rev15k, trans:g.trans+s.trans, revenue:g.revenue+s.revenue,
  }), {leads:0,quality:0,fp:0,rev15k:0,trans:0,revenue:0});
  // Direct count from FY/PA sheets so plans for unmapped RMs are never lost
  grand.fp = STATE.fy.filter(r => monthMatch(r.Month) && lsOK(r.leadSource)).length
           + STATE.pa.filter(r => r.clientType.toUpperCase()==='NEW' && monthMatch(r.Month) && lsOK(r.leadSource)).length;

  // ---- KPI strip ----
  const statusCount = st => {
    const base = STATE.raw.filter(r => campOK(r));
    const col = st==='CONVERTED'?'CM': st==='IN PROCESS'?'LPM':'CTM';
    return base.filter(r=>r.leadStatus===st && monthMatch(r[col])).length;
  };
  const kpi = {
    totalLeads: STATE.raw.filter(r => monthMatch(r.CTM) && campOK(r)).length,
    converted: statusCount('CONVERTED'), inProcess: statusCount('IN PROCESS'),
    followUp: statusCount('FOLLOW UP'), onHold: statusCount('ON HOLD'), dead: statusCount('DEAD'),
  };

  return { kpi, summary, detail, grand };
}

// ---- B2B Corp Leads ----
function b2bKPI(){
  const month = STATE.filterMonth;
  if(!STATE.b2b.length) return 0;
  if(month==='All') return STATE.b2b.length;
  return STATE.b2b.filter(r => r.CreateMonth===month).length;
}

function b2bByRMStatus(){
  const month = STATE.filterMonth;
  const data = month==='All' ? STATE.b2b : STATE.b2b.filter(r => r.CreateMonth===month);
  const B2B_STATUSES = ['ASSIGNED','DEAD','FOLLOW UP','ON HOLD','RE-ASSIGNED'];
  const rms = Array.from(new Set(data.map(r => r.currentRmName).filter(Boolean))).sort();
  const out = rms.map(rm => {
    const sub = data.filter(r => r.currentRmName===rm);
    const obj = {RM: rm}; let total = 0;
    for(const st of B2B_STATUSES){ obj[st] = sub.filter(r => r.status===st).length; total += obj[st]; }
    obj.Total = total;
    return obj;
  });
  if(!out.length) return {statuses: B2B_STATUSES, data: []};
  const gt = {RM:'Grand Total', _tot:true, Total:0};
  B2B_STATUSES.forEach(st => { gt[st] = out.reduce((s,r)=>s+r[st],0); gt.Total += gt[st]; });
  out.push(gt);
  return {statuses: B2B_STATUSES, data: out};
}

function renderB2BTable(){
  if(!STATE.filesLoaded.b2b){ setNotUploaded('#tbl-b2b','b2b'); return; }
  const month = STATE.filterMonth;
  const {statuses, data} = b2bByRMStatus();
  const title = 'B2B CORP LEADS — RM × STATUS  (' + (month==='All'?'All Months':month) + ')';
  const el = $('#b2b-table-title'); if(el) el.textContent = title;
  const host = '#tbl-b2b';
  if(!data.length){
    $(host).innerHTML = '<div class="meta" style="padding:12px">No B2B data — upload the B2B Corporate Lead file.</div>';
    return;
  }
  const headers = ['RM', ...statuses, 'Total'];
  const rows = data.map(r => {
    const o = {RM: r.RM, _tot: !!r._tot};
    statuses.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  renderTable(host, headers, rows);
}

function renderRMPerfFunnel(grand){
  const host = $('#rmperf-funnel'); if(!host) return;
  const stages = [
    {label:'Total Leads',           value:grand.leads,   color:'var(--blue)'},
    {label:'Quality Leads',         value:grand.quality, color:'var(--green)'},
    {label:'Plans Made',            value:grand.fp,      color:'var(--violet)'},
    {label:'Revenue >15K Clients',  value:grand.rev15k,  color:'var(--orange)'},
    {label:'Transactional Clients', value:grand.trans,   color:'var(--pink)'},
  ];
  const max = Math.max(...stages.map(s=>s.value), 1);
  const leads = grand.leads || 0;
  const sub = $('#rmperf-funnel-sub');
  if(sub){
    const m = STATE.rmPerfMonth;
    const mLabel = (m==='All' || (Array.isArray(m) && m.length===0)) ? 'All Months'
      : (Array.isArray(m) ? m.join(', ') : m);
    sub.textContent = '(' + mLabel + ' · ' + STATE.rmPerfRefCold + ')';
  }

  host.innerHTML = stages.map((s,i) => {
    // Square-root scaling so small stages (e.g. Plans Made vs Total Leads) stay visible,
    // plus a 45% floor so labels and values never get clipped.
    const ratio = s.value / max;
    const widthPct = Math.max(Math.sqrt(ratio) * 100, 45);
    const convFromLeads = leads>0 ? (s.value/leads*100) : 0;
    const conv = i===0
      ? '100% of leads'
      : `${convFromLeads.toFixed(1)}% of leads`;
    const arrow = i>0 ? '<div class="funnel-arrow">▼</div>' : '';
    return `${arrow}
      <div class="funnel-stage">
        <div class="funnel-bar" style="width:${widthPct}%;background:${s.color}">
          <span class="funnel-label">${s.label}</span>
          <span class="funnel-value">${fmtIN(s.value)}</span>
        </div>
        <div class="funnel-conv">${conv}</div>
      </div>`;
  }).join('');
}

function renderRMPerformance(){
  if(!STATE.premiumUnlocked) return;
  // Sync in-tab filter dropdowns (multi-select)
  const rmMonths = filteredMonths();
  if($('#rmperf-month-wrap')){
    buildMultiSelect('#rmperf-month-wrap', ['All',...rmMonths], STATE.rmPerfMonth,
      val => { STATE.rmPerfMonth = val; STATE.revMonth = val; renderRMPerformance(); if($('#rev-month-filter-wrap')) initRevFilters(); renderRMRev(); },
      {multi:true});
  }
  if($('#rmperf-refcold-wrap')){
    buildMultiSelect('#rmperf-refcold-wrap', ['Include','Exclude'], STATE.rmPerfRefCold,
      val => { STATE.rmPerfRefCold = val; renderRMPerformance(); }, {multi:false});
  }

  // Upload-status banner for FY / Plan Approval
  const fpReady = STATE.filesLoaded.fy || STATE.filesLoaded.pa;
  const banner = $('#rmperf-upload-banner');
  if(banner){
    const fyTxt = STATE.filesLoaded.fy ? `✓ FY 2026-2027 (${STATE.fy.length} rows)` : '✗ FY 2026-2027 not uploaded';
    const paTxt = STATE.filesLoaded.pa ? `✓ Plan Approval (${STATE.pa.length} rows)` : '✗ Plan Approval not uploaded';
    banner.innerHTML = `<span class="${STATE.filesLoaded.fy?'rmperf-ok':'rmperf-miss'}">${fyTxt}</span>
      <span class="${STATE.filesLoaded.pa?'rmperf-ok':'rmperf-miss'}">${paTxt}</span>
      ${fpReady?'':'<span class="rmperf-hint">Upload these to populate <strong>Financial Plans Made</strong>.</span>'}`;
  }

  if(!STATE.filesLoaded.fin23 && !STATE.filesLoaded.rev && !fpReady){
    setNotUploaded('#rmperf-summary','fin23');
    $('#rmperf-detail').innerHTML = '';
    $('#rmperf-kpis').innerHTML = '';
    $('#rmperf-funnel').innerHTML = '';
    return;
  }

  const {kpi, summary, detail, grand} = rmPerformance();

  // KPI strip
  const kpiCards = [
    {label:'Total Leads', value:fmtIN(kpi.totalLeads), tone:'blue'},
    {label:'Converted', value:fmtIN(kpi.converted), tone:'green'},
    {label:'In Process', value:fmtIN(kpi.inProcess), tone:'cyan'},
    {label:'Follow Up', value:fmtIN(kpi.followUp), tone:'amber'},
    {label:'On Hold', value:fmtIN(kpi.onHold), tone:'orange'},
    {label:'Dead', value:fmtIN(kpi.dead), tone:'red'},
  ];
  $('#rmperf-kpis').innerHTML = kpiCards.map(c=>`
    <div class="kpi kpi-${c.tone}"><div class="kpi-value">${c.value}</div><div class="kpi-label">${c.label}</div></div>`).join('');

  renderRMPerfFunnel(grand);

  // Summary table (team level)
  const sHeaders = ['Team','Total Leads','Quality Leads','Financial Plans Made','Revenue >15K Clients','Transactional Clients','Total Revenue (₹)'];
  applyHeat(summary, 'leads');
  renderHeatLegend('#legend-rmperf-summary', 'Row heat by Total Leads');
  const sRows = summary.map(r => ({
    Team: r.team,
    'Total Leads': fmtIN(r.leads),
    'Quality Leads': fmtIN(r.quality),
    'Financial Plans Made': fmtIN(r.fp),
    'Revenue >15K Clients': fmtIN(r.rev15k),
    'Transactional Clients': fmtIN(r.trans),
    'Total Revenue (₹)': fmtINR(r.revenue),
    _heat: r._heat,
  }));
  sRows.push({
    Team:'TOTAL',
    'Total Leads': fmtIN(grand.leads),
    'Quality Leads': fmtIN(grand.quality),
    'Financial Plans Made': fmtIN(grand.fp),
    'Revenue >15K Clients': fmtIN(grand.rev15k),
    'Transactional Clients': fmtIN(grand.trans),
    'Total Revenue (₹)': fmtINR(grand.revenue),
    _tot:true,
  });
  renderTable('#rmperf-summary', sHeaders, sRows);

  // Detail table (team × RM) with team subtotals
  const dHeaders = ['Team','RM Name','Total Leads','Quality Leads','Financial Plans Made','Revenue >15K Clients','Transactional Clients','Total Revenue (₹)'];
  applyHeat(detail, 'leads');
  renderHeatLegend('#legend-rmperf-detail', 'Row heat by Total Leads (excludes Team Totals)');
  const dRows = [];
  const byTeam = {};
  detail.forEach(r => (byTeam[r.team] = byTeam[r.team]||[]).push(r));
  // Include FIXED_TEAMS in order, plus any extra teams in detail (e.g. "Unmatched RM")
  const teamOrder = FIXED_TEAMS.concat(Object.keys(byTeam).filter(t => !FIXED_TEAMS.includes(t)));
  for(const team of teamOrder){
    const rms = byTeam[team] || [];
    if(!rms.length) continue;
    let t={leads:0,quality:0,fp:0,rev15k:0,trans:0,revenue:0};
    rms.forEach(r => {
      dRows.push({
        Team: r.team, 'RM Name': r.rm,
        'Total Leads': fmtIN(r.leads), 'Quality Leads': fmtIN(r.quality),
        'Financial Plans Made': fmtIN(r.fp), 'Revenue >15K Clients': fmtIN(r.rev15k),
        'Transactional Clients': fmtIN(r.trans), 'Total Revenue (₹)': fmtINR(r.revenue),
        _heat: r._heat,
      });
      t.leads+=r.leads; t.quality+=r.quality; t.fp+=r.fp; t.rev15k+=r.rev15k; t.trans+=r.trans; t.revenue+=r.revenue;
    });
    dRows.push({
      Team: team+' Total', 'RM Name':'',
      'Total Leads': fmtIN(t.leads), 'Quality Leads': fmtIN(t.quality),
      'Financial Plans Made': fmtIN(t.fp), 'Revenue >15K Clients': fmtIN(t.rev15k),
      'Transactional Clients': fmtIN(t.trans), 'Total Revenue (₹)': fmtINR(t.revenue),
      _tot:true,
    });
  }
  renderTable('#rmperf-detail', dHeaders, dRows);
}

async function handleRMPerfUpload(kind, file){
  if(!file) return;
  try{
    const wb = await readWb(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:'', raw:true});
    if(kind==='fy'){
      STATE.fy = buildFYData(rows);
      STATE.filesLoaded.fy = true;
    } else {
      STATE.pa = buildPAData(rows);
      STATE.filesLoaded.pa = true;
    }
    detectMonths();
    initFilters();
    renderRMPerformance();
  }catch(e){
    console.error(e); alert('Failed to load file: ' + e.message);
  }
}

function mtdPerformance(){
  const refMode = STATE.mtdFilterRefCold;
  const ALL_BUCKETS = ['Branding','Social Media','Google','Corporate','Referral','Cold Data'];
  const CORE_BUCKETS = ['Branding','Social Media','Google','Corporate'];
  const buckets = refMode === 'Only Referral' ? ['Referral']
                : refMode === 'Exclude'        ? CORE_BUCKETS
                : ALL_BUCKETS;
  const mtdMonths = STATE.months.filter(m => monthKey(m) >= monthKey('Apr-2026'));
  const sd = STATE.mtdStart, ed = STATE.mtdEnd;
  const days = (ed-sd+1) || 1;
  const proj = v => v/days*30;
  const out = [];

  for(const m of mtdMonths){
    const [mon,yr] = m.split('-');
    const monIdx = MONTHS_3.indexOf(mon);
    const yyyymm = yr+'-'+pad2(monIdx+1);

    for(const c of buckets){
      const pool = STATE.raw.filter(r => r['Campaign Name']===c);

      const leads = pool.filter(r => {
        const d = r.createdDate;
        if(!d || d.length < 10) return false;
        if(d.substring(0,7) !== yyyymm) return false;
        const day = parseInt(d.substring(8,10), 10);
        return day >= sd && day <= ed;
      }).length;

      const conv = pool.filter(r => {
        if(r.leadStatus !== 'CONVERTED') return false;
        const d = r.convertedDate;
        if(!d || d.length < 10) return false;
        if(d.substring(0,7) !== yyyymm) return false;
        const day = parseInt(d.substring(8,10), 10);
        return day >= sd && day <= ed;
      }).length;

      const ip = pool.filter(r => {
        if(r.leadStatus !== 'IN PROCESS') return false;
        const d = r.leadInProcessDate;
        if(!d || d.length < 10) return false;
        if(d.substring(0,7) !== yyyymm) return false;
        const day = parseInt(d.substring(8,10), 10);
        return day >= sd && day <= ed;
      }).length;

      out.push({Month:m, Campaign:c, Leads:leads, LeadsProj:proj(leads),
        Conv:conv, ConvProj:proj(conv), InProc:ip, InProcProj:proj(ip),
        Qual:conv+ip, QualProj:proj(conv+ip)});
    }
  }
  return out;
}

// ---- PROCESSED tab ----
function processedPlatform(){
  const buckets = platformsForLeadsTable();
  const rows = STATE.raw, months = STATE.months;
  const out = buckets.map(b => {
    const o = {Platform:b.label, total:0};
    months.forEach(m => { o[m] = rows.filter(x => b.match(x) && x.CTM===m).length; o.total += o[m]; });
    return o;
  });
  const gt = {Platform:'Grand Total', total:0, _tot:true};
  months.forEach(m => gt[m] = out.reduce((s,r)=>s+r[m],0));
  gt.total = out.reduce((s,r)=>s+r.total,0); out.push(gt);
  return out;
}
function processedStatus(){
  const months = STATE.months;
  return STATUSES.map(st => {
    const r = {Status:st, total:0};
    months.forEach(m => {
      const col = statusMonthCol(st);
      r[m] = STATE.raw.filter(x => x.leadStatus===st && x[col]===m).length; r.total += r[m];
    });
    return r;
  });
}

// ---- RM Revenue ----
function revenueAggregatedByTeam(){
  let rows = STATE.rev;
  if(!isAllRevMonths()){
    rows = rows.filter(r => revMonthMatch(String(r['OLD CHECK']||r['Old Check']||r['old check']||'')));
  }
  const lpMode = STATE.revLPFilter;
  if(lpMode === 'Exclude'){
    rows = rows.filter(r => {
      const lp = (r.LP||r.lp||r['Campaign Category']||'').toString().trim();
      return lp !== 'Referral' && lp !== 'Cold Data';
    });
  } else if(lpMode === 'Only Referral'){
    rows = rows.filter(r => {
      const lp = (r.LP||r.lp||r['Campaign Category']||'').toString().trim();
      return lp === 'Referral';
    });
  }
  const teamMap = {};
  for(const r of rows){
    const rm = (r.RM||r.rm||r['Curren RM']||'').toString().trim();
    if(!rm) continue;
    const key = rm.toLowerCase();
    const team = STATE.teamMap[key] || '';
    if(!teamMap[team]) teamMap[team] = {Team: team||'(unassigned)', RevBased:0, NotEligible:0, Total:0};
    const ct = (r['CLIENT TYPE']||r['client type']||'').toString().toUpperCase();
    if(ct==='REVENUE BASED') teamMap[team].RevBased++;
    if(ct==='NOT ELIGIBLE') teamMap[team].NotEligible++;
    teamMap[team].Total += Number(r.Total||r.TOTAL||r.total||0) || 0;
  }
  let arr = Object.values(teamMap);
  arr.sort((a,b) => b.Total - a.Total);
  return arr;
}
function revenueAggregated(){
  let rows = STATE.rev;
  if(!isAllRevMonths()){
    rows = rows.filter(r => revMonthMatch(String(r['OLD CHECK']||r['Old Check']||r['old check']||'')));
  }
  const lpMode = STATE.revLPFilter;
  if(lpMode === 'Exclude'){
    rows = rows.filter(r => {
      const lp = (r.LP||r.lp||r['Campaign Category']||'').toString().trim();
      return lp !== 'Referral' && lp !== 'Cold Data';
    });
  } else if(lpMode === 'Only Referral'){
    rows = rows.filter(r => {
      const lp = (r.LP||r.lp||r['Campaign Category']||'').toString().trim();
      return lp === 'Referral';
    });
  }
  const map = {};
  for(const r of rows){
    const rm = (r.RM||r.rm||r['Curren RM']||'').toString().trim();
    if(!rm) continue;
    const key = rm.toLowerCase();
    if(!map[key]) map[key] = {RM: rm, Team: STATE.teamMap[key] || '', RevBased:0, NotEligible:0, Total:0};
    const ct = (r['CLIENT TYPE']||r['client type']||'').toString().toUpperCase();
    if(ct==='REVENUE BASED') map[key].RevBased++;
    if(ct==='NOT ELIGIBLE') map[key].NotEligible++;
    map[key].Total += Number(r.Total||r.TOTAL||r.total||0) || 0;
  }
  let arr = Object.values(map);
  if(!isAllRevTeams()) arr = arr.filter(o => revTeamMatch(o.Team));
  arr.sort((a,b) => b.Total - a.Total);
  return arr;
}

function drawRevChart(){
  if(!window.Chart) return;
  const data = isAllRevTeams() ? revenueAggregatedByTeam().slice(0, 20) : revenueAggregated().slice(0, 20);
  const ctx = $('#rev-chart').getContext('2d');
  if(STATE.revChart) STATE.revChart.destroy();
  STATE.revChart = new Chart(ctx, {
    type:'bar',
    plugins: [ChartDataLabels],
    data: {
      labels: data.map(d => isAllRevTeams() ? d.Team : d.RM),
      datasets: [{
        label: 'Total Revenue (₹)',
        data: data.map(d => d.Total),
        backgroundColor: '#5b8dff',
        borderRadius: 4,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins: {
        legend:{ labels:{ color:'#cfd9f0' } },
        tooltip:{ callbacks:{ label: c => '₹'+Math.round(c.raw).toLocaleString('en-IN') } },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#cfd9f0',
          font: { size: 10, weight: 'bold' },
          formatter: v => '₹'+Math.round(v).toLocaleString('en-IN'),
        }
      },
      scales: {
        x:{ ticks:{ color:'#9aa6bf', autoSkip:false, maxRotation:60, minRotation:45 }, grid:{ color:'rgba(255,255,255,.05)' } },
        y:{ ticks:{ color:'#9aa6bf', callback: v => '₹'+Number(v).toLocaleString('en-IN') }, grid:{ color:'rgba(255,255,255,.05)' } }
      }
    }
  });
}

// ---- MISSING leads ----
function missingLeads(){
  const out = [];
  for(const r of STATE.raw){
    const reasons = [];
    if(!r.currentRmName) reasons.push('No RM');
    if(!r['Campaign Name']) reasons.push('No Campaign');
    if(!r.leadStatus) reasons.push('No Status');
    if(!r.createdDate) reasons.push('No Created');
    if(!r.Team || r.Team==='SV') {} // SV is default, not missing
    if(reasons.length){ out.push({...r, Reason: reasons.join(', ')}); }
  }
  return out;
}

// ---- table renderer ----
function renderTable(host, headers, rows, opts={}){
  const fmt = opts.fmt || ((v)=>v);
  const rowClass = r => {
    const parts = [];
    if(r._tot) parts.push('grand');
    if(r._heat) parts.push('heat-'+r._heat);
    return parts.join(' ');
  };
  const html = `<table class="data ${opts.cls||''}">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${rowClass(r)}">${headers.map(h=>`<td>${fmt(r[h],h,r)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
  if(typeof host==='string') $(host).innerHTML = html; else host.innerHTML = html;
}

// ---- heat tiers (quartile-based row highlighting) ----
function numFromCell(v){
  if(v==null) return 0;
  if(typeof v==='number') return v;
  const s = String(v).replace(/[^\d.-]/g,'');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function applyHeat(rows, heatBy, opts={}){
  const invert = !!opts.invert; // invert=true → lower number gets 'high' tier (e.g. CPL)
  const valid = rows.filter(r => !r._tot);
  const vals = valid.map(r => numFromCell(r[heatBy])).slice().sort((a,b)=>a-b);
  if(vals.length < 2){ return rows; }
  const pick = q => vals[Math.min(vals.length-1, Math.max(0, Math.floor(vals.length*q)))];
  const q25 = pick(0.25), q50 = pick(0.50), q75 = pick(0.75);
  for(const r of valid){
    const v = numFromCell(r[heatBy]);
    let tier;
    if(v >= q75) tier = 'high';
    else if(v >= q50) tier = 'mid';
    else if(v >= q25) tier = 'low';
    else tier = 'vlow';
    if(invert){
      // flip the scale: best becomes worst
      tier = {high:'vlow', mid:'low', low:'mid', vlow:'high'}[tier];
    }
    r._heat = tier;
  }
  return rows;
}
function renderHeatLegend(host, metricLabel, invert){
  const el = typeof host==='string' ? $(host) : host;
  if(!el) return;
  const tiers = invert
    ? [['hl-high','Best (lowest 25%)'],['hl-mid','Good'],['hl-low','Below median'],['hl-vlow','Worst (top 25%)']]
    : [['hl-high','Top 25%'],['hl-mid','Above median'],['hl-low','Below median'],['hl-vlow','Bottom 25%']];
  el.innerHTML = '<div class="heat-legend">'
    + `<span class="hl-item" style="color:var(--text)">${escHtml(metricLabel)}:</span>`
    + tiers.map(([cls,lbl]) => `<span class="hl-item"><i class="hl-sw ${cls}"></i>${lbl}</span>`).join('')
    + '</div>';
}
function filterSummary(extra=''){
  const parts = ['Month: '+STATE.filterMonth, 'Ref+Cold: '+STATE.filterRefCold];
  if(extra) parts.push(extra);
  return '('+parts.join(' | ')+')';
}

// ---- sortable tables ----
const SORT_STATE = {};
function sortVal(v){
  if(v == null || v === '' || v === '—') return typeof v === 'string' ? '' : 0;
  const s = String(v).replace(/[₹,\s%]/g,'');
  const n = parseFloat(s);
  return isNaN(n) ? String(v).toLowerCase() : n;
}
function makeSortableTable(host, headers, rows, rerenderFn, opts={}){
  const id = typeof host==='string' ? host : '#el';
  if(!SORT_STATE[id]) SORT_STATE[id] = {col:null, dir:'desc'};
  const ss = SORT_STATE[id];
  let body = rows.filter(r=>!r._tot);
  const tots = rows.filter(r=>r._tot);
  if(ss.col){
    body = [...body].sort((a,b)=>{
      const av = sortVal(a[ss.col]), bv = sortVal(b[ss.col]);
      if(typeof av==='string'&&typeof bv==='string') return ss.dir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
      return ss.dir==='asc' ? av-bv : bv-av;
    });
  }
  const sorted = [...body, ...tots];
  const rowClass = r => [r._tot?'grand':'', r._heat?'heat-'+r._heat:''].filter(Boolean).join(' ');
  const thHtml = headers.map(h=>{
    const icon = ss.col===h ? (ss.dir==='asc'?'▲':'▼') : '⇅';
    return `<th class="srt-th" data-col="${escHtml(h)}" style="cursor:pointer;user-select:none;white-space:nowrap">${escHtml(h)} <span style="opacity:0.45;font-size:10px">${icon}</span></th>`;
  }).join('');
  const bodyHtml = sorted.map(r=>`<tr class="${rowClass(r)}">${headers.map(h=>`<td>${r[h]??''}</td>`).join('')}</tr>`).join('');
  const el = typeof host==='string' ? $(host) : host;
  el.innerHTML = `<table class="data ${opts.cls||''}"><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  el.querySelectorAll('th.srt-th').forEach(th=>{
    th.onclick=()=>{
      const col=th.dataset.col;
      ss.col===col ? (ss.dir=ss.dir==='desc'?'asc':'desc') : (ss.col=col, ss.dir='desc');
      rerenderFn();
    };
  });
}
function updateDashboardHeaderFilters(){
  const summary = filterSummary();
  [
    '#hdr-platform-month',
    '#hdr-status-month',
    '#hdr-team',
    '#hdr-campaign-team',
    '#hdr-income',
    '#hdr-cost-summary',
    '#hdr-cpl-rm',
  ].forEach(sel => { const el = $(sel); if(el) el.textContent = summary; });
  const ps = $('#hdr-platform-status');
  if(ps) ps.textContent = filterSummary('Table: '+STATE.filterTable);
}

// ---- renderers ----
function renderKPIs(){
  if(!STATE.filesLoaded.fin23){ $('#kpis').innerHTML = notUploadedHTML('fin23'); return; }
  const k = topKPIs();
  const cards = [
    {label:'YTD Leads (Fixed)', value: fmtIN(k.ytd), tone:'blue'},
    {label:'Generated Leads', value: fmtIN(k.generated), tone:'blue'},
    {label:'Converted',       value: fmtIN(k.converted), tone:'green'},
    {label:'In Process',      value: fmtIN(k.inProcess), tone:'cyan'},
    {label:'QL Conversion Rate', value: fmtPct(k.qlRate), tone:'violet'},
    {label:'Follow Up',       value: fmtIN(k.followUp), tone:'amber'},
    {label:'On Hold',         value: fmtIN(k.onHold), tone:'orange'},
    {label:'Dead',            value: fmtIN(k.dead), tone:'red'},
  ];
  $('#kpis').innerHTML = cards.map(c => `
    <div class="kpi kpi-${c.tone}">
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${c.label}</div>
    </div>`).join('');
}

function renderLiveKPIs(){
  if(!STATE.filesLoaded.fin23){ $('#live-kpis').innerHTML = ''; return; }
  const k = liveDataKPIs();
  const month = STATE.filterMonth;
  const hint = month==='All' ? '<span style="color:var(--muted);font-size:11px">(Select a month for AnyMonth data)</span>' : '';
  const cards = [
    {label:'Assigned', value: fmtIN(k.assigned), tone:'blue'},
    {label:'AnyMonth Converted', value: k.anyConv!==null ? fmtIN(k.anyConv) : '—', tone:'green'},
    {label:'AnyMonth InProcess', value: k.anyIP!==null ? fmtIN(k.anyIP) : '—', tone:'cyan'},
    {label:'Same Month Converted', value: k.sameConv!==null ? fmtIN(k.sameConv) : '—', tone:'green'},
    {label:'Same Month InProcess', value: k.sameIP!==null ? fmtIN(k.sameIP) : '—', tone:'cyan'},
    {label:'B2B Corp Leads', value: fmtIN(b2bKPI()), tone:'violet'},
  ];
  const el = $('#live-kpis');
  el.innerHTML = '<div style="font-size:12px;color:#cfd9f0;margin-bottom:6px;font-weight:600">▲ Live Data '+hint+'</div>' +
    '<div class="live-kpi-grid">' +
    cards.map(c => `
    <div class="kpi kpi-${c.tone}">
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-label">${c.label}</div>
    </div>`).join('') + '</div>';
}

function renderStatusDistributionChart(){
  if(!STATE.filesLoaded.fin23){ const w=$('#status-dist-chart-wrap'); if(w) w.innerHTML=notUploadedHTML('fin23'); return; }
  if(!window.Chart) return;
  const canvas = $('#status-dist-chart');
  if(!canvas) return;
  const k = topKPIs();
  const labels = ['Assigned', 'Re-Assigned', 'On Hold', 'Follow Up', 'In Process', 'Converted', 'Dead'];
  const values = [k.assigned, k.reAssigned, k.onHold, k.followUp, k.inProcess, k.converted, k.dead];
  const colors = ['#0284c7', '#8b5cf6', '#2563eb', '#f59e0b', '#0891b2', '#16a34a', '#dc2626'];
  const filter = $('#status-chart-filter');
  if(filter) filter.textContent = filterSummary();
  if(STATE.statusChart) STATE.statusChart.destroy();
  STATE.statusChart = new Chart(canvas.getContext('2d'), {
    type:'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data:{
      labels,
      datasets:[{
        label:'Clients',
        data:values,
        backgroundColor:colors,
        borderColor:colors,
        borderWidth:1,
        borderRadius:6,
        maxBarThickness:58,
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      layout:{padding:{top:22,right:8,left:4,bottom:0}},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c => `${c.label}: ${fmtIN(c.raw)}`}},
        datalabels:{
          anchor:'end',
          align:'top',
          offset:2,
          color:'#1f2937',
          font:{size:11,weight:'bold'},
          formatter:v => fmtIN(v),
        },
      },
      scales:{
        x:{
          ticks:{color:'#475569',font:{size:11,weight:'600'},maxRotation:0,minRotation:0},
          grid:{display:false},
          border:{color:'#cbd5e1'},
        },
        y:{
          beginAtZero:true,
          ticks:{color:'#64748b',callback:v => fmtIN(v)},
          grid:{color:'rgba(148,163,184,.25)'},
          border:{color:'#cbd5e1'},
        },
      },
    },
  });
}

function renderPlatformMonth(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-platform-month','fin23'); $('#legend-platform-month').innerHTML=''; return; }
  const data = leadsByPlatformMonth();
  const gt = data[data.length-1].total || 1;
  const months = filteredMonths();
  data.forEach((r,i) => r._tot = (i===data.length-1));
  applyHeat(data, 'total');
  renderHeatLegend('#legend-platform-month', 'Row heat by Total leads');
  const rows = data.map((r,i) => {
    const o = {Platform:r.Platform};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.Total = fmtIN(r.total);
    o['Share %'] = i===data.length-1 ? '100.00%' : fmtPct(r.total/gt);
    o._tot = r._tot; o._heat = r._heat;
    return o;
  });
  renderTable('#tbl-platform-month', ['Platform', ...months, 'Total', 'Share %'], rows);
}

function renderStatusMonth(){
  if(!STATE.filesLoaded.fin23){
    setNotUploaded('#tbl-status-month-mapped','fin23');
    setNotUploaded('#tbl-status-month-sv','fin23');
    $('#legend-status-month-mapped').innerHTML='';
    $('#legend-status-month-sv').innerHTML='';
    return;
  }
  const months = filteredMonths();
  const headers = ['Status', ...months, 'Total'];
  const fmt = data => data.map(r => {
    const o = {Status:r.Status};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.Total = fmtIN(r.total);
    o._heat = r._heat;
    return o;
  });
  const mapped = statusByMonth('non-SV');
  applyHeat(mapped, 'total');
  renderHeatLegend('#legend-status-month-mapped', 'Row heat by Total');
  renderTable('#tbl-status-month-mapped', headers, fmt(mapped));

  const sv = statusByMonth('SV');
  applyHeat(sv, 'total');
  renderHeatLegend('#legend-status-month-sv', 'Row heat by Total');
  renderTable('#tbl-status-month-sv', headers, fmt(sv));
}

function renderPlatformStatus(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-platform-status','fin23'); $('#legend-platform-status').innerHTML=''; return; }
  updateDashboardHeaderFilters();

  // Team filter for this table only
  const wrap = $('#ps-team-filter-wrap');
  if(wrap && !wrap.querySelector('select')){
    const allTeams = ['All', ...FIXED_TEAMS];
    const sel = document.createElement('select');
    sel.id = 'ps-team-filter';
    sel.style.cssText = 'margin-bottom:8px;font-size:12px';
    allTeams.forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
    sel.value = STATE.psTeamFilter;
    sel.onchange = e => { STATE.psTeamFilter = e.target.value; renderPlatformStatus(); };
    wrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Filter by Team:</label>';
    wrap.appendChild(sel);
  } else if(wrap){
    const sel = wrap.querySelector('select');
    if(sel) sel.value = STATE.psTeamFilter;
  }

  const data = platformStatusBreakdown();
  applyHeat(data, 'Total');
  renderHeatLegend('#legend-platform-status', 'Row heat by Total');
  const headers = ['Platform', ...STATUSES, 'Total', 'LCR', 'QLCR'];
  const rows = data.map(r => {
    const o = {Platform:r.Platform};
    STATUSES.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    o.LCR = r.LCR == null ? '' : fmtPct(r.LCR);
    const qlcr = r.Total > 0 ? ((r.CONVERTED||0) + (r['IN PROCESS']||0)) / r.Total : 0;
    o.QLCR = r._tot ? '' : fmtPct(qlcr);
    o._tot = !!r._tot; o._heat = r._heat;
    return o;
  });
  makeSortableTable('#tbl-platform-status', headers, rows, renderPlatformStatus);
}

function renderLandingPageStatus(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-lp-status','fin23'); $('#legend-lp-status').innerHTML=''; return; }

  // Build campaign list from current raw data (after ref/cold filter)
  const campaigns = ['All', ...Array.from(new Set(
    applyRefColdFilter(STATE.raw).map(r => r['Campaign Name']).filter(Boolean)
  )).sort()];

  // Default to first actual campaign if not yet set
  if(!STATE.lpCampaignFilter || !campaigns.includes(STATE.lpCampaignFilter)){
    STATE.lpCampaignFilter = campaigns[1] || 'All';
  }

  // ---- Table mode selector ----
  const modeWrap = $('#lp-mode-wrap');
  if(modeWrap && !modeWrap.querySelector('select')){
    const sel = document.createElement('select');
    sel.id = 'lp-filter-table';
    sel.style.cssText = 'font-size:12px;margin-left:6px';
    [['All','Default (status-specific month)'],['SameMonth','Same Month (CTM)'],['AnyMonth','Any Month (created before selected)']].forEach(([v,t])=>{
      const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o);
    });
    sel.value = STATE.lpTableMode;
    sel.onchange = e => { STATE.lpTableMode = e.target.value; renderLandingPageStatus(); };
    modeWrap.appendChild(sel);
  } else if(modeWrap){
    const sel = modeWrap.querySelector('select');
    if(sel) sel.value = STATE.lpTableMode;
  }

  // ---- Team filter ----
  const teamWrap = $('#lp-team-filter-wrap');
  if(teamWrap && !teamWrap.querySelector('select')){
    const allTeams = ['All', ...FIXED_TEAMS];
    const sel = document.createElement('select');
    sel.id = 'lp-team-filter';
    sel.style.cssText = 'font-size:12px';
    allTeams.forEach(t=>{ const o=document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
    sel.value = STATE.lpTeamFilter;
    sel.onchange = e => { STATE.lpTeamFilter = e.target.value; renderLandingPageStatus(); };
    teamWrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Team:</label>';
    teamWrap.appendChild(sel);
  } else if(teamWrap){
    const sel = teamWrap.querySelector('select');
    if(sel) sel.value = STATE.lpTeamFilter;
  }

  // ---- Campaign filter ----
  const campWrap = $('#lp-campaign-filter-wrap');
  if(campWrap){
    // Rebuild each time so list stays fresh if data changes
    campWrap.innerHTML = '<label style="font-size:12px;color:var(--muted);margin-right:6px">Campaign:</label>';
    const sel = document.createElement('select');
    sel.id = 'lp-campaign-filter';
    sel.style.cssText = 'font-size:12px';
    campaigns.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
    sel.value = STATE.lpCampaignFilter;
    sel.onchange = e => { STATE.lpCampaignFilter = e.target.value; renderLandingPageStatus(); };
    campWrap.appendChild(sel);
  }

  const data = landingPageStatusBreakdown();
  applyHeat(data, 'Total');
  renderHeatLegend('#legend-lp-status', 'Row heat by Total');
  const headers = ['Landing Page', ...STATUSES, 'Total', 'LCR', 'QLCR'];
  const rows = data.map(r => {
    const o = {'Landing Page': r['Landing Page']};
    STATUSES.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    o.LCR  = r.LCR  == null ? '' : fmtPct(r.LCR);
    o.QLCR = r.QLCR == null ? '' : fmtPct(r.QLCR);
    o._tot = !!r._tot; o._heat = r._heat;
    return o;
  });
  makeSortableTable('#tbl-lp-status', headers, rows, renderLandingPageStatus);
}

function renderCampaignByTeam(){
  const hdr = $('#hdr-campaign-team'); if(hdr) hdr.textContent = filterSummary();
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-campaign-team','fin23'); $('#legend-campaign-team').innerHTML=''; return; }
  const {campaigns, rows} = campaignByTeam();
  const headers = ['Team', ...campaigns, 'Total'];
  applyHeat(rows, 'Total');
  renderHeatLegend('#legend-campaign-team', 'Row heat by Total Leads');
  const data = rows.map(r => {
    const o = {Team:r.Team, _tot:r._tot, _heat:r._heat};
    campaigns.forEach(c => o[c] = fmtIN(r[c]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  makeSortableTable('#tbl-campaign-team', headers, data, renderCampaignByTeam);
}

function renderTeam(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-team','fin23'); $('#legend-team').innerHTML=''; return; }
  const data = teamPerformance();
  const headers = ['Team', 'Total Leads', 'CONVERTED', 'Conv. Rate', 'IN PROCESS', 'FOLLOW UP', 'ASSIGNED', 'RE-ASSIGNED', 'ON HOLD', 'DEAD'];
  applyHeat(data, 'Total Leads');
  renderHeatLegend('#legend-team', 'Row heat by Total Leads');
  const rows = data.map(r => ({
    Team: r.Team,
    'Total Leads': fmtIN(r['Total Leads']),
    CONVERTED: fmtIN(r.CONVERTED),
    'Conv. Rate': fmtPct(r['Conv. Rate']),
    'IN PROCESS': fmtIN(r['IN PROCESS']),
    'FOLLOW UP': fmtIN(r['FOLLOW UP']),
    ASSIGNED: fmtIN(r.ASSIGNED),
    'RE-ASSIGNED': fmtIN(r['RE-ASSIGNED']),
    'ON HOLD': fmtIN(r['ON HOLD']),
    DEAD: fmtIN(r.DEAD),
    _heat: r._heat, _tot: r._tot,
  }));
  makeSortableTable('#tbl-team', headers, rows, renderTeam);
}

function renderIncome(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-income','fin23'); $('#legend-income').innerHTML=''; return; }
  const data = incomeSegment();
  applyHeat(data, 'Leads');
  renderHeatLegend('#legend-income', 'Row heat by Leads');
  renderTable('#tbl-income',
    ['Income Band','Leads','Converted','In Process','Quality Leads','Conv. Rate','QLCR','Share %'],
    data.map(r => ({
      'Income Band': r['Income Band'],
      Leads: fmtIN(r.Leads),
      Converted: fmtIN(r.Converted),
      'In Process': fmtIN(r['In Process']),
      'Quality Leads': fmtIN(r['Quality Leads']),
      'Conv. Rate': fmtPct(r['Conv. Rate']),
      QLCR: fmtPct(r.QLCR),
      'Share %': fmtPct(r['Share %']),
      _heat: r._heat, _tot: r._tot,
    })));
}

function renderCostSummary(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-cost-summary','fin23'); $('#legend-cost-summary').innerHTML=''; return; }
  const data = costSummaryByCampaign();
  applyHeat(data, 'Leads');
  renderHeatLegend('#legend-cost-summary', 'Row heat by Leads');
  renderTable('#tbl-cost-summary', ['Campaign','Leads','Cost (₹)','CPL (₹)','Quality Leads','CPQL (₹)'], data.map(r => ({
    Campaign:r.Campaign, Leads:fmtIN(r.Leads), 'Cost (₹)':fmtINR(r['Cost (₹)']), 'CPL (₹)':fmtINR(r['CPL (₹)']),
    'Quality Leads':fmtIN(r['Quality Leads']), 'CPQL (₹)':fmtINR(r['CPQL (₹)']),
    _tot:r._tot, _heat:r._heat,
  })));
}

function renderCplRmLegacy(){
  const data = costPerLeadPerRM();
  renderTable('#tbl-cpl-rm', ['Team','RM','Leads','Cost (₹)','CPL (₹)'], data.map(r=>({
    Team:r.Team, RM:r.RM, Leads:fmtIN(r.Leads), 'Cost (₹)':fmtINR(r['Cost (₹)']), 'CPL (₹)':fmtINR(r['CPL (₹)']),
  })));
}

function renderCplRm(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-cpl-rm','fin23'); $('#legend-cpl-rm').innerHTML=''; return; }
  const data = costPerLeadPerRMWithTotals();
  data.forEach(r => { r.totalLeadsVal = r.totalLeads; });
  applyHeat(data, 'totalLeadsVal');
  renderHeatLegend('#legend-cpl-rm', 'Row heat by Total Leads');
  const headers = ['Team','RM','Total Leads','Total Cost (INR)','CPL (INR)','Quality Leads','CPQL (INR)'];
  const rows = data.map(r => ({
    Team:r.Team,
    RM:r.RM,
    'Total Leads':fmtIN(r.totalLeads),
    'Total Cost (INR)':fmtINR(r.totalCost),
    'CPL (INR)':fmtINR(r.cpl),
    'Quality Leads':fmtIN(r.qualLeads),
    'CPQL (INR)':fmtINR(r.cpql),
    _tot:r._tot, _heat:r._heat,
  }));
  makeSortableTable('#tbl-cpl-rm', headers, rows, renderCplRm);
}

function renderInProcessDataset(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-inprocess-ds','fin23'); return; }
  const month = STATE.filterMonth;
  const title = 'IN-PROCESS DATE SET, STATUS ≠ IN PROCESS   LPM: '+month+'  |  '+STATE.filterRefCold;
  $('#inprocess-ds-title').textContent = title;
  const {statuses, data} = inProcessDataset();
  const headers = ['Team', ...statuses, 'Total'];
  const rows = data.map(r => {
    const o = {Team: r.Team, _tot: !!r._tot};
    statuses.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  renderTable('#tbl-inprocess-ds', headers, rows);
}

function renderConvertedDataset(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-converted-ds','fin23'); return; }
  const month = STATE.filterMonth;
  const title = 'CONVERTED DATE SET, STATUS ≠ CONVERTED   CM: '+month+'  |  '+STATE.filterRefCold;
  $('#converted-ds-title').textContent = title;
  const {statuses, data} = convertedDataset();
  const headers = ['Team', ...statuses, 'Total'];
  const rows = data.map(r => {
    const o = {Team: r.Team, _tot: !!r._tot};
    statuses.forEach(s => o[s] = fmtIN(r[s]));
    o.Total = fmtIN(r.Total);
    return o;
  });
  renderTable('#tbl-converted-ds', headers, rows);
}

function renderMTD(){
  if(!STATE.filesLoaded.fin23){ tabNotUploaded('#mtd-tables','fin23'); return; }
  const data = mtdPerformance();
  const byMonth = {};
  data.forEach(r => (byMonth[r.Month] = byMonth[r.Month]||[]).push(r));
  $('#mtd-tables').innerHTML = Object.entries(byMonth).map(([m, rows]) => `
    <div class="mtd-block">
      <h3>${m}</h3>
      <div class="table-wrap">
      <table class="data">
        <thead>
          <tr><th rowspan="2">Campaign</th><th colspan="2">Leads</th><th colspan="2">Converted</th><th colspan="2">In Process</th><th colspan="2">Qualified</th></tr>
          <tr><th>MTD</th><th>Projected</th><th>MTD</th><th>Projected</th><th>MTD</th><th>Projected</th><th>MTD</th><th>Projected</th></tr>
        </thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${r.Campaign}</td>
          <td>${fmtIN(r.Leads)}</td><td>${r.LeadsProj.toFixed(1)}</td>
          <td>${fmtIN(r.Conv)}</td><td>${r.ConvProj.toFixed(1)}</td>
          <td>${fmtIN(r.InProc)}</td><td>${r.InProcProj.toFixed(1)}</td>
          <td>${fmtIN(r.Qual)}</td><td>${r.QualProj.toFixed(1)}</td>
        </tr>`).join('')}</tbody>
      </table>
      </div>
    </div>`).join('');
}

function renderCPC(){
  const cpc = STATE.cost; if(!cpc.length){ $('#cpc-editor').innerHTML='<p>No data.</p>'; return; }
  const header = cpc[0];
  const head = '<thead><tr>'+header.map((h,i)=>`<th>${i===0?'Campaign':toMmmYyyy(h)}</th>`).join('')+'</tr></thead>';
  const body = '<tbody>'+cpc.slice(1).map((row,ri)=>{
    return '<tr>'+row.map((v,ci)=>{
      if(ci===0) return `<td>${v}</td>`;
      return `<td><input type="number" data-r="${ri+1}" data-c="${ci}" value="${v||0}" class="cpc-input"/></td>`;
    }).join('')+'</tr>';
  }).join('')+'</tbody>';
  $('#cpc-editor').innerHTML = '<table class="data editable">'+head+body+'</table>';
  $$('.cpc-input').forEach(inp => {
    inp.oninput = () => {
      STATE.cost[+inp.dataset.r][+inp.dataset.c] = +inp.value || 0;
      try{ localStorage.setItem('cpc_override', JSON.stringify(STATE.cost)); }catch(e){}
      renderCostSummary(); renderCplRm(); renderMTD();
    };
  });
}

function renderProcessed(){
  if(!STATE.filesLoaded.fin23){
    ['#proc-platform','#proc-status','#proc-team'].forEach(s=>setNotUploaded(s,'fin23'));
    return;
  }
  const months = STATE.months;
  const plat = processedPlatform();
  renderTable('#proc-platform', ['Platform', ...months, 'total'], plat.map(r => {
    const o = {Platform:r.Platform};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.total = fmtIN(r.total); o._tot = !!r._tot;
    return o;
  }));
  const stat = processedStatus();
  renderTable('#proc-status', ['Status', ...months, 'total'], stat.map(r => {
    const o = {Status:r.Status};
    months.forEach(m => o[m] = fmtIN(r[m]));
    o.total = fmtIN(r.total); return o;
  }));
  const data = teamPerformance();
  const headers = ['Team', 'Total Leads', 'CONVERTED', 'Conv. Rate', 'IN PROCESS', 'FOLLOW UP', 'ASSIGNED', 'RE-ASSIGNED', 'ON HOLD', 'DEAD'];
  renderTable('#proc-team', headers, data.map(r => ({
    Team: r.Team,
    'Total Leads': fmtIN(r['Total Leads']),
    CONVERTED: fmtIN(r.CONVERTED),
    'Conv. Rate': fmtPct(r['Conv. Rate']),
    'IN PROCESS': fmtIN(r['IN PROCESS']),
    'FOLLOW UP': fmtIN(r['FOLLOW UP']),
    ASSIGNED: fmtIN(r.ASSIGNED),
    'RE-ASSIGNED': fmtIN(r['RE-ASSIGNED']),
    'ON HOLD': fmtIN(r['ON HOLD']),
    DEAD: fmtIN(r.DEAD),
  })));
}

function rawCellValue(row, col){
  if(col === 'Team of FirstRM'){
    const key = (row.firstRmName||'').toString().trim().toLowerCase();
    return key ? (STATE.teamMap[key] || 'SV') : '';
  }
  return String(row[col] ?? '');
}

function hasRawFilter(col){
  return Object.prototype.hasOwnProperty.call(STATE.rawFilters, col);
}

function rawFilterDisplay(col){
  if(!hasRawFilter(col)) return '';
  const filterVal = STATE.rawFilters[col];
  if(filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)){
    return `contains: "${filterVal.value}"`;
  }
  const vals = filterVal || [];
  if(vals.length === 0) return 'None';
  const display = vals.map(v => v === '' ? '(blank)' : v);
  return display.length <= 2 ? display.join(', ') : display.length + ' selected';
}

function rawFilteredRows(opts={}){
  const excludeCol = opts.excludeCol || '';
  const searchBox = $('#raw-search');
  const filter = (searchBox ? searchBox.value : '').toLowerCase();
  return STATE.raw.filter(row => {
    if(filter && !RAW_COLUMNS.some(col => rawCellValue(row, col).toLowerCase().includes(filter))) return false;
    for(const [col, filterVal] of Object.entries(STATE.rawFilters)){
      if(col === excludeCol) continue;
      if(filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)){
        if(!rawCellValue(row, col).toLowerCase().includes(filterVal.value.toLowerCase())) return false;
        continue;
      }
      if(!Array.isArray(filterVal)) continue;
      if(!filterVal.includes(rawCellValue(row, col))) return false;
    }
    return true;
  });
}

function rawFilterValues(col){
  const set = new Set(rawFilteredRows({excludeCol: col}).map(row => rawCellValue(row, col)));
  return Array.from(set).sort((a,b) => {
    if(a === '' && b !== '') return -1;
    if(a !== '' && b === '') return 1;
    return a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'});
  });
}

function handleRawFilterOutside(e){
  const menu = $('#raw-filter-menu');
  if(menu && !menu.contains(e.target) && !e.target.classList.contains('raw-filter-btn')) closeRawFilterMenu();
}

function closeRawFilterMenu(){
  const menu = $('#raw-filter-menu');
  if(menu) menu.remove();
  document.removeEventListener('click', handleRawFilterOutside, true);
  window.removeEventListener('resize', closeRawFilterMenu);
}

function openRawFilterMenu(col, anchor){
  closeRawFilterMenu();
  const values = rawFilterValues(col);
  const active = hasRawFilter(col);
  const selected = new Set(active ? (STATE.rawFilters[col] || []).map(String) : values);
  const menu = document.createElement('div');
  menu.id = 'raw-filter-menu';
  menu.className = 'raw-filter-menu';
  menu.innerHTML = `
    <div class="raw-filter-title">${escHtml(col)}</div>
    <input type="text" class="raw-filter-search" placeholder="Search values">
    <div class="raw-filter-actions">
      <button type="button" class="secondary" data-action="all">All</button>
      <button type="button" class="secondary" data-action="none">None</button>
    </div>
    <div class="raw-filter-options">
      ${values.map((value, idx) => `
        <label class="raw-filter-option">
          <input type="checkbox" data-idx="${idx}" ${selected.has(value) ? 'checked' : ''}>
          <span title="${escHtml(value || '(blank)')}">${escHtml(value || '(blank)')}</span>
        </label>
      `).join('') || '<div class="raw-filter-empty">No values</div>'}
    </div>
    <div class="raw-filter-footer">
      <button type="button" class="secondary" data-action="reset">Reset</button>
      <button type="button" data-action="apply">Apply</button>
    </div>
  `;
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const width = 280;
  menu.style.width = width + 'px';
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)) + 'px';

  menu.addEventListener('click', e => e.stopPropagation());
  menu.querySelector('[data-action="all"]').onclick = () => {
    menu.querySelectorAll('input[type=checkbox]').forEach(inp => inp.checked = true);
  };
  menu.querySelector('[data-action="none"]').onclick = () => {
    menu.querySelectorAll('input[type=checkbox]').forEach(inp => inp.checked = false);
  };
  menu.querySelector('[data-action="reset"]').onclick = () => {
    delete STATE.rawFilters[col];
    closeRawFilterMenu();
    renderRawData();
  };
  menu.querySelector('[data-action="apply"]').onclick = () => {
    const checked = Array.from(menu.querySelectorAll('input[type=checkbox]:checked')).map(inp => values[+inp.dataset.idx]);
    if(checked.length === values.length) delete STATE.rawFilters[col];
    else STATE.rawFilters[col] = checked;
    closeRawFilterMenu();
    renderRawData();
  };
  const search = menu.querySelector('.raw-filter-search');
  const options = Array.from(menu.querySelectorAll('.raw-filter-option'));
  search.oninput = () => {
    const q = search.value.toLowerCase();
    options.forEach(opt => {
      opt.style.display = opt.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
    });
  };
  search.onkeydown = e => {
    if(e.key === 'Enter' && search.value.trim()){
      STATE.rawFilters[col] = {type:'text', value: search.value.trim()};
      closeRawFilterMenu();
      renderRawData();
    }
  };
  search.focus();

  setTimeout(() => document.addEventListener('click', handleRawFilterOutside, true), 0);
  window.addEventListener('resize', closeRawFilterMenu);
}

function bindRawFilterButtons(){
  $$('.raw-filter-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      openRawFilterMenu(btn.dataset.col, btn);
    };
  });
}

// ---- B2B raw data filter ----
function b2bCellValue(row, col){ return String(row[col] ?? ''); }
function b2bHasFilter(col){ return Object.prototype.hasOwnProperty.call(STATE.b2bFilters, col); }
function b2bFilterDisplay(col){
  if(!b2bHasFilter(col)) return '';
  const vals = STATE.b2bFilters[col] || [];
  if(!vals.length) return 'None';
  const d = vals.map(v => v===''?'(blank)':v);
  return d.length <= 2 ? d.join(', ') : d.length+' selected';
}
function b2bFilteredRows(opts={}){
  const excl = opts.excludeCol||'';
  const q = ($('#b2b-search')||{value:''}).value.toLowerCase();
  return STATE.b2bRaw.filter(row => {
    if(q && !B2B_RAW_COLUMNS.some(c => b2bCellValue(row,c).toLowerCase().includes(q))) return false;
    for(const [col, vals] of Object.entries(STATE.b2bFilters)){
      if(col===excl || !Array.isArray(vals)) continue;
      if(!vals.includes(b2bCellValue(row,col))) return false;
    }
    return true;
  });
}
function b2bFilterValues(col){
  const set = new Set(b2bFilteredRows({excludeCol:col}).map(r => b2bCellValue(r,col)));
  return Array.from(set).sort((a,b)=>{
    if(a===''&&b!=='') return -1; if(a!==''&&b==='') return 1;
    return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
  });
}
function handleB2BFilterOutside(e){
  const m=$('#b2b-filter-menu');
  if(m && !m.contains(e.target) && !e.target.classList.contains('b2b-filter-btn')) closeB2BFilterMenu();
}
function closeB2BFilterMenu(){
  const m=$('#b2b-filter-menu'); if(m) m.remove();
  document.removeEventListener('click',handleB2BFilterOutside,true);
  window.removeEventListener('resize',closeB2BFilterMenu);
}
function openB2BFilterMenu(col, anchor){
  closeB2BFilterMenu();
  const values = b2bFilterValues(col);
  const active = b2bHasFilter(col);
  const selected = new Set(active ? (STATE.b2bFilters[col]||[]).map(String) : values);
  const menu = document.createElement('div');
  menu.id = 'b2b-filter-menu'; menu.className = 'raw-filter-menu';
  menu.innerHTML = `
    <div class="raw-filter-title">${escHtml(col)}</div>
    <input type="text" class="raw-filter-search" placeholder="Search values">
    <div class="raw-filter-actions">
      <button type="button" class="secondary" data-action="all">All</button>
      <button type="button" class="secondary" data-action="none">None</button>
    </div>
    <div class="raw-filter-options">
      ${values.map((v,i)=>`<label class="raw-filter-option"><input type="checkbox" data-idx="${i}" ${selected.has(v)?'checked':''}><span title="${escHtml(v||'(blank)')}">${escHtml(v||'(blank)')}</span></label>`).join('')||'<div class="raw-filter-empty">No values</div>'}
    </div>
    <div class="raw-filter-footer">
      <button type="button" class="secondary" data-action="reset">Reset</button>
      <button type="button" data-action="apply">Apply</button>
    </div>`;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect(), w=280;
  menu.style.cssText = `width:${w}px;left:${Math.max(8,Math.min(rect.left,window.innerWidth-w-8))}px;top:${Math.max(8,Math.min(rect.bottom+6,window.innerHeight-menu.offsetHeight-8))}px`;
  menu.addEventListener('click', e=>e.stopPropagation());
  menu.querySelector('[data-action="all"]').onclick  = ()=>menu.querySelectorAll('input[type=checkbox]').forEach(i=>i.checked=true);
  menu.querySelector('[data-action="none"]').onclick = ()=>menu.querySelectorAll('input[type=checkbox]').forEach(i=>i.checked=false);
  menu.querySelector('[data-action="reset"]').onclick = ()=>{ delete STATE.b2bFilters[col]; closeB2BFilterMenu(); renderB2BRawData(); };
  menu.querySelector('[data-action="apply"]').onclick = ()=>{
    const checked = Array.from(menu.querySelectorAll('input[type=checkbox]:checked')).map(i=>values[+i.dataset.idx]);
    if(checked.length===values.length) delete STATE.b2bFilters[col]; else STATE.b2bFilters[col]=checked;
    closeB2BFilterMenu(); renderB2BRawData();
  };
  const srch=menu.querySelector('.raw-filter-search'), opts2=Array.from(menu.querySelectorAll('.raw-filter-option'));
  srch.oninput=()=>{ const q=srch.value.toLowerCase(); opts2.forEach(o=>{ o.style.display=o.textContent.toLowerCase().includes(q)?'flex':'none'; }); };
  srch.focus();
  setTimeout(()=>document.addEventListener('click',handleB2BFilterOutside,true),0);
  window.addEventListener('resize',closeB2BFilterMenu);
}
function bindB2BFilterButtons(){
  $$('.b2b-filter-btn').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); openB2BFilterMenu(btn.dataset.col, btn); };
  });
}
function renderB2BRawData(){
  if(!STATE.filesLoaded.b2b){ $('#b2b-raw-meta').textContent=''; setNotUploaded('#b2b-raw-table-wrap','b2b'); return; }
  closeB2BFilterMenu();
  const rows = b2bFilteredRows(), limit=500, slice=rows.slice(0,limit);
  const head = '<thead><tr>'+B2B_RAW_COLUMNS.map(col => {
    const active=b2bHasFilter(col), sel=b2bFilterDisplay(col);
    return `<th><div class="raw-filter-head"><span>${escHtml(col)}</span><button type="button" class="b2b-filter-btn ${active?'active':''}" data-col="${escHtml(col)}" title="Filter ${escHtml(col)}">v</button></div>${sel?`<div class="raw-filter-selected" title="${escHtml(sel)}">${escHtml(sel)}</div>`:''}</th>`;
  }).join('')+'</tr></thead>';
  const body = '<tbody>'+slice.map(r=>'<tr>'+B2B_RAW_COLUMNS.map(col=>`<td>${escHtml(b2bCellValue(r,col))}</td>`).join('')+'</tr>').join('')+'</tbody>';
  const af = Object.keys(STATE.b2bFilters).length;
  $('#b2b-raw-meta').textContent = `Showing ${slice.length.toLocaleString()} of ${rows.length.toLocaleString()} rows (total ${STATE.b2bRaw.length.toLocaleString()})${af?` | Filters: ${af}`:''}`;
  $('#b2b-raw-table-wrap').innerHTML = '<table class="data compact raw-data-table">'+head+body+'</table>';
  bindB2BFilterButtons();
  requestAnimationFrame(attachAllMirrors);
}

function renderRawData(){
  if(!STATE.filesLoaded.fin23){ $('#raw-meta').textContent=''; setNotUploaded('#raw-table-wrap','fin23'); return; }
  closeRawFilterMenu();
  const rows = rawFilteredRows();
  const limit = 250;
  const slice = rows.slice(0, limit);
  const head = '<thead><tr>'+RAW_COLUMNS.map(col => {
    const active = hasRawFilter(col);
    const selected = rawFilterDisplay(col);
    return `<th>
      <div class="raw-filter-head">
        <span>${escHtml(col)}</span>
        <button type="button" class="raw-filter-btn ${active ? 'active' : ''}" data-col="${escHtml(col)}" title="Filter ${escHtml(col)}">v</button>
      </div>
      ${selected ? `<div class="raw-filter-selected" title="${escHtml(selected)}">${escHtml(selected)}</div>` : ''}
    </th>`;
  }).join('')+'</tr></thead>';
  const body = '<tbody>'+slice.map(r=>'<tr>'+RAW_COLUMNS.map(col=>`<td>${escHtml(rawCellValue(r, col))}</td>`).join('')+'</tr>').join('')+'</tbody>';
  const activeFilters = Object.keys(STATE.rawFilters).length;
  $('#raw-meta').textContent = `Showing ${slice.length.toLocaleString()} of ${rows.length.toLocaleString()} rows (total ${STATE.raw.length.toLocaleString()})${activeFilters ? ` | Filters: ${activeFilters}` : ''}.`;
  $('#raw-table-wrap').innerHTML = '<table class="data compact raw-data-table">'+head+body+'</table>';
  bindRawFilterButtons();
  requestAnimationFrame(attachAllMirrors);
}

function renderEmployee(){
  const rows = STATE.empref;
  if(!rows.length) rows.push(['Emp Code','Team','Name']);
  const header = rows[0];
  const head = '<thead><tr>'+header.map((h,i)=>`<th>${h}</th>`).join('')+(rows.length>1?'<th></th>':'')+'</tr></thead>';
  const body = '<tbody>'+rows.slice(1).map((row,ri)=>{
    return '<tr>'+row.map((v,ci)=>`<td><input class="emp-input" data-r="${ri+1}" data-c="${ci}" value="${(v??'').toString().replace(/"/g,'&quot;')}"/></td>`).join('')
      +`<td><button class="secondary emp-del" data-r="${ri+1}">×</button></td></tr>`;
  }).join('')+'</tbody>';
  $('#emp-editor').innerHTML = '<table class="data editable">'+head+body+'</table>';
  $$('.emp-input').forEach(inp => {
    inp.oninput = () => {
      STATE.empref[+inp.dataset.r][+inp.dataset.c] = inp.value;
      persistEmployee();
      rebuildTeamMap();
      renderAffectedByTeamChange();
    };
  });
  $$('.emp-del').forEach(btn => {
    btn.onclick = () => {
      STATE.empref.splice(+btn.dataset.r, 1);
      persistEmployee(); rebuildTeamMap(); renderEmployee(); renderAffectedByTeamChange(); initRevFilters();
    };
  });
}
function persistEmployee(){
  try{ localStorage.setItem('empref_override', JSON.stringify(STATE.empref)); }catch(e){}
}

function renderRMMaster(){
  const rows = STATE.rmMaster;
  if(!rows.length) rows.push(['Source Name','Correct RM Name','Team']);
  const header = rows[0];
  const head = '<thead><tr>'+header.map(h=>`<th>${escHtml(h)}</th>`).join('')+'<th></th></tr></thead>';
  const body = '<tbody>'+rows.slice(1).map((row,ri)=>{
    return '<tr>'+row.map((v,ci)=>`<td><input class="rmm-input" data-r="${ri+1}" data-c="${ci}" value="${(v??'').toString().replace(/"/g,'&quot;')}"/></td>`).join('')
      +`<td><button class="secondary rmm-del" data-r="${ri+1}">×</button></td></tr>`;
  }).join('')+'</tbody>';
  $('#rmm-editor').innerHTML = '<table class="data editable">'+head+body+'</table>';

  const stats = $('#rmm-stats');
  if(stats){
    const total = rows.length - 1;
    const teams = new Set(rows.slice(1).map(r => (r[2]||'').toString().trim()).filter(Boolean));
    const correct = new Set(rows.slice(1).map(r => (r[1]||'').toString().trim()).filter(Boolean));
    stats.innerHTML = `<strong>${total}</strong> mappings · <strong>${correct.size}</strong> unique canonical RMs · <strong>${teams.size}</strong> teams referenced`;
  }

  $$('.rmm-input').forEach(inp => {
    inp.oninput = () => {
      STATE.rmMaster[+inp.dataset.r][+inp.dataset.c] = inp.value;
      persistRMMaster();
      buildRMMasterLookup();
      // re-map FY/PA mappedRM since lookup changed
      if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
      if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
      // refresh stats only; do not full re-render the editor (would lose focus)
      const total = STATE.rmMaster.length - 1;
      const teams = new Set(STATE.rmMaster.slice(1).map(r => (r[2]||'').toString().trim()).filter(Boolean));
      const correct = new Set(STATE.rmMaster.slice(1).map(r => (r[1]||'').toString().trim()).filter(Boolean));
      if(stats) stats.innerHTML = `<strong>${total}</strong> mappings · <strong>${correct.size}</strong> unique canonical RMs · <strong>${teams.size}</strong> teams referenced`;
    };
  });
  $$('.rmm-del').forEach(btn => {
    btn.onclick = () => {
      STATE.rmMaster.splice(+btn.dataset.r, 1);
      persistRMMaster();
      buildRMMasterLookup();
      if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
      if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
      renderRMMaster();
    };
  });
}
function renderAffectedByTeamChange(){
  renderDashboard();
  renderProcessed();
  initRevFilters();
  renderRMRev();
}

function renderMissing(){
  if(!STATE.filesLoaded.fin23){ setNotUploaded('#tbl-missing','fin23'); return; }
  const rows = missingLeads();
  const cols = ['currentRmName','Team','clientName','Campaign Name','platformName','createdDate','leadStatus','Reason'];
  const head = '<thead><tr>'+cols.map(c=>`<th>${c}</th>`).join('')+'</tr></thead>';
  const body = '<tbody>'+rows.slice(0,500).map(r=>'<tr>'+cols.map(c=>`<td>${r[c]??''}</td>`).join('')+'</tr>').join('')+'</tbody>';
  $('#tbl-missing').innerHTML = `<div class="meta">${rows.length.toLocaleString()} rows flagged (showing first 500).</div><table class="data compact">${head}${body}</table>`;
}

function renderRMRev(){
  if(!STATE.premiumUnlocked) return;
  if(!STATE.filesLoaded.rev){ setNotUploaded('#tbl-rmrev','rev'); const cw=$('#rev-chart-wrap'); if(cw) cw.innerHTML=notUploadedHTML('rev'); return; }
  const isTeamView = isAllRevTeams();
  const data = isTeamView ? revenueAggregatedByTeam() : revenueAggregated();
  const headers = isTeamView ? ['Team','# Revenue-Based','# Not Eligible','Total Revenue (₹)'] : ['RM','Team','# Revenue-Based','# Not Eligible','Total Revenue (₹)'];
  const rows = data.map(r => isTeamView
    ? { Team: r.Team, '# Revenue-Based': fmtIN(r.RevBased), '# Not Eligible': fmtIN(r.NotEligible), 'Total Revenue (₹)': fmtINR(r.Total) }
    : { RM: r.RM, Team: r.Team, '# Revenue-Based': fmtIN(r.RevBased), '# Not Eligible': fmtIN(r.NotEligible), 'Total Revenue (₹)': fmtINR(r.Total) }
  );
  const tot = data.reduce((s,r)=>s+r.Total,0);
  const gtRow = isTeamView
    ? { Team:'Grand Total', '# Revenue-Based': fmtIN(data.reduce((s,r)=>s+r.RevBased,0)), '# Not Eligible': fmtIN(data.reduce((s,r)=>s+r.NotEligible,0)), 'Total Revenue (₹)': fmtINR(tot), _tot:true }
    : { RM:'Grand Total', Team:'', '# Revenue-Based': fmtIN(data.reduce((s,r)=>s+r.RevBased,0)), '# Not Eligible': fmtIN(data.reduce((s,r)=>s+r.NotEligible,0)), 'Total Revenue (₹)': fmtINR(tot), _tot:true };
  rows.push(gtRow);
  renderTable('#tbl-rmrev', headers, rows);
  drawRevChart();
}

function renderDashboard(){
  updateDashboardHeaderFilters();
  renderKPIs();
  renderLiveKPIs();
  renderStatusDistributionChart();
  renderPlatformMonth();
  renderStatusMonth();
  renderPlatformStatus();
  renderLandingPageStatus();
  renderTeam();
  renderCampaignByTeam();
  renderIncome();
  renderCostSummary();
  renderCplRm();
  renderInProcessDataset();
  renderConvertedDataset();
  renderB2BTable();
  requestAnimationFrame(attachAllMirrors);
}

function renderAll(){
  renderDashboard();
  renderRMPerformance();
  renderMTD();
  renderCPC();
  renderProcessed();
  renderRawData();
  renderB2BRawData();
  renderEmployee();
  renderRMMaster();
  renderMissing();
  renderRMRev();
  requestAnimationFrame(attachAllMirrors);
}

// ---- UI ----
function buildExportData(){
  return {
    exportedAt: new Date().toISOString(),
    raw: STATE.raw,
    b2bRaw: STATE.b2bRaw,
    revenue: STATE.rev,
    fy: STATE.fy,
    pa: STATE.pa,
    rmMaster: STATE.rmMaster,
    months: STATE.months,
    teamMap: STATE.empref,
    costPerCampaign: STATE.cost,
    filesLoaded: STATE.filesLoaded,
    dataTill: STATE.dataTill || null,
    filters: {
      currentMonth: STATE.filterMonth,
      refColdMode: STATE.filterRefCold,
      tableMode: STATE.filterTable,
      mtdRefColdMode: STATE.mtdFilterRefCold,
      revLPMode: STATE.revLPFilter,
      revTeam: STATE.revTeam,
      revMonth: STATE.revMonth,
      rmPerfMonth: STATE.rmPerfMonth,
      rmPerfRefCold: STATE.rmPerfRefCold,
    }
  };
}

function downloadRawJSON(filename){
  const data = buildExportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (filename||'marketing-mis-data') + '.json';
  a.click(); URL.revokeObjectURL(a.href);
}

async function downloadAsWebpage(){
  const filename = ($('#json-filename').value || 'marketing-mis-dashboard').trim().replace(/[^\w\-]/g, '') || 'marketing-mis-dashboard';
  try{
    $('#confirm-download').disabled = true;
    $('#confirm-download').textContent = 'Building…';

    const [htmlText, appJsText, snapJsText] = await Promise.all([
      fetch('index.html').then(r => r.text()),
      fetch('app.js').then(r => r.text()),
      fetch('snapshot.js').then(r => r.text()),
    ]);

    // Escape </script> inside JSON so it doesn't break the HTML script tag
    const stateJson = JSON.stringify(buildExportData())
      .replace(/<\/script>/gi, '<\\/script>')
      .replace(/<!--/g, '<\\!--');
    const preloadTag = `<script>window.__PRELOADED_STATE__=${stateJson};<\/script>`;

    let out = htmlText;
    // Replace the dynamic cache-busting loader with fully inlined scripts + preloaded state
    out = out.replace(
      /<script>\s*\(function\(\)\{[\s\S]*?snapshot\.js[\s\S]*?app\.js[\s\S]*?\}\)\(\);\s*<\/script>/,
      `<script>${snapJsText}<\/script>\n${preloadTag}\n<script>${appJsText}<\/script>`
    );

    const blob = new Blob([out], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename + '.html';
    a.click(); URL.revokeObjectURL(a.href);
  } catch(e){
    alert('Failed to build webpage: ' + e.message);
  } finally{
    $('#confirm-download').disabled = false;
    $('#confirm-download').textContent = 'Download';
  }
  closeDownloadModal();
}

async function applyPreloadedState(data){
  STATE.raw      = data.raw || [];
  STATE.b2bRaw   = data.b2bRaw || [];
  STATE.b2b      = buildB2BData(STATE.b2bRaw);
  STATE.rev      = data.revenue || [];
  STATE.fy       = data.fy || [];
  STATE.pa       = data.pa || [];
  STATE.empref   = data.teamMap || STATE.empref;
  STATE.cost     = data.costPerCampaign || STATE.cost;
  if(data.rmMaster && data.rmMaster.length){ STATE.rmMaster = data.rmMaster; }
  buildRMMasterLookup();
  STATE.filesLoaded = data.filesLoaded || {
    fin23: STATE.raw.length > 0,
    rev:   STATE.rev.length > 0,
    b2b:   STATE.b2bRaw.length > 0,
    fy:    STATE.fy.length > 0,
    pa:    STATE.pa.length > 0,
  };
  if(data.filters){
    if(data.filters.currentMonth)  STATE.filterMonth       = data.filters.currentMonth;
    if(data.filters.refColdMode)   STATE.filterRefCold     = data.filters.refColdMode;
    if(data.filters.tableMode)     STATE.filterTable       = data.filters.tableMode;
    if(data.filters.mtdRefColdMode) STATE.mtdFilterRefCold = data.filters.mtdRefColdMode;
    if(data.filters.revLPMode)     STATE.revLPFilter       = data.filters.revLPMode;
    if(data.filters.revTeam)       STATE.revTeam           = data.filters.revTeam;
    if(data.filters.revMonth)      STATE.revMonth          = data.filters.revMonth;
    if(data.filters.rmPerfMonth)   STATE.rmPerfMonth       = data.filters.rmPerfMonth;
    if(data.filters.rmPerfRefCold) STATE.rmPerfRefCold     = data.filters.rmPerfRefCold;
  }
  rebuildTeamMap();
  detectMonths();
  reconcileCostMonths();
  initFilters();
  initRevFilters();
  renderAll();
  showApp();
  updateDataSubtitle();
}

function openShareModal(){
  $('#share-result').style.display = 'none';
  $('#share-json-url').value = '';
  $('#share-modal').classList.add('active');
}
function closeShareModal(){ $('#share-modal').classList.remove('active'); }

function generateShareLink(){
  const url = ($('#share-json-url').value||'').trim();
  if(!url){ alert('Please paste a raw JSON URL first.'); return; }
  const base = window.location.origin + window.location.pathname;
  const link = base + '?json=' + encodeURIComponent(url);
  $('#share-result-url').value = link;
  $('#share-result').style.display = 'block';
}

// ============ SETTINGS (GitHub + Google Sheets) ============
const SETTINGS_KEY = 'mis_settings_v1';
function loadSettings(){
  try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }catch(e){ return {}; }
}
function saveSettings(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s||{}));
}
function ghRawUrl(s){
  if(!s.owner || !s.repo) return null;
  const branch = s.branch || 'main';
  const path = s.path || 'state.json';
  return `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${branch}/${path}?t=${Date.now()}`;
}

// Auto-detect GitHub Pages context from window.location so viewers
// don't need any per-user setup. Works for:
//   https://<owner>.github.io/<repo>/...   → owner/repo from URL
//   https://<owner>.github.io/             → user/org site, owner only (no repo)
function detectGhRawUrl(){
  try{
    const host = window.location.hostname;
    const m = host.match(/^([^.]+)\.github\.io$/);
    if(!m) return null;
    const owner = m[1];
    const parts = window.location.pathname.split('/').filter(Boolean);
    const repo = parts[0];
    if(!repo) return null;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/state.json?t=${Date.now()}`;
  }catch(e){ return null; }
}

async function publishToGitHub(){
  const s = loadSettings();
  if(!s.owner || !s.repo || !s.token){
    openSettingsModal();
    setPublishStatus('Please fill in GitHub settings first.', 'warn');
    return;
  }
  const branch = s.branch || 'main';
  const path   = s.path   || 'state.json';
  const apiUrl = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}`;
  showPublishModal('📤 Publishing…', 'Pushing your data to GitHub…');
  try{
    // Fetch existing file SHA (if exists) so we can update vs create
    let sha = null;
    try{
      const meta = await fetch(`${apiUrl}?ref=${branch}`, {
        headers: { Authorization: 'token ' + s.token, Accept: 'application/vnd.github+json' }
      });
      if(meta.ok){
        const j = await meta.json();
        sha = j.sha;
      } else if(meta.status !== 404){
        throw new Error('GitHub API: ' + meta.status + ' ' + (await meta.text()));
      }
    }catch(e){ /* 404 = file doesn't exist yet, that's OK */ }

    const jsonStr = JSON.stringify(buildExportData(), null, 2);
    const b64 = btoa(unescape(encodeURIComponent(jsonStr)));

    const body = {
      message: `Update dashboard state (${new Date().toISOString()})`,
      content: b64,
      branch,
    };
    if(sha) body.sha = sha;

    const put = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: 'token ' + s.token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if(!put.ok){
      const txt = await put.text();
      throw new Error('GitHub API: ' + put.status + ' — ' + txt);
    }

    const pagesUrl = `https://${s.owner}.github.io/${s.repo}/`;
    const sizeKb = (jsonStr.length/1024).toFixed(1);
    showPublishModal('✅ Published!', `
      <p>Your dashboard data is now live on GitHub.</p>
      <p style="margin-top:10px"><strong>Pushed:</strong> <code>${path}</code> on branch <code>${branch}</code> (${sizeKb} KB)</p>
      <p style="margin-top:10px"><strong>Share this URL:</strong></p>
      <div style="display:flex;gap:6px;margin-top:6px">
        <input type="text" readonly value="${pagesUrl}" style="flex:1;font-size:11px" id="publish-share-url">
        <button class="btn-green" onclick="navigator.clipboard.writeText('${pagesUrl}');this.textContent='Copied'">Copy</button>
      </div>
      <p class="muted" style="font-size:11px;margin-top:8px">Anyone opening this link will see your current data — no upload needed. GitHub Pages may take ~30 sec to refresh on first publish.</p>
    `);
  }catch(e){
    showPublishModal('❌ Publish failed', `<p>${e.message}</p><p class="muted" style="font-size:11px;margin-top:8px">Check token permissions (needs <code>repo</code> scope), repo name, and branch in Settings.</p>`);
  }
}

async function syncCostFromSheets(silent){
  const s = loadSettings();
  if(!s.gsUrl) return false;
  try{
    const res = await fetch(s.gsUrl + (s.gsUrl.includes('?')?'&':'?') + '_=' + Date.now());
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    const rows = parseCsv(txt);
    if(!rows.length || !rows[0].length) throw new Error('Sheet is empty');
    STATE.cost = rows;
    try{ localStorage.setItem('cpc_override', JSON.stringify(STATE.cost)); }catch(e){}
    if(!silent) setSettingsStatus(`✓ Loaded ${rows.length-1} campaign rows from Google Sheets`, 'ok');
    return true;
  }catch(e){
    if(!silent) setSettingsStatus('✗ Sheets sync failed: ' + e.message, 'err');
    return false;
  }
}

function parseCsv(text){
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(cur); cur = ''; }
      else if(c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if(c === '\r'){ /* skip */ }
      else cur += c;
    }
  }
  if(cur.length || row.length){ row.push(cur); rows.push(row); }
  // Cast numeric cells from col 1 onwards. Handle Indian-formatted numbers (4,77,321),
  // dashes/em-dashes/empty as 0, and stray whitespace.
  const toNum = v => {
    if(v == null) return 0;
    let s = String(v).trim();
    if(!s || s === '-' || s === '–' || s === '—' || s === 'N/A' || s.toLowerCase() === 'na') return 0;
    s = s.replace(/[,\s₹$]/g, '');
    const n = +s;
    return isNaN(n) ? 0 : n;
  };
  return rows.filter(r=>r.some(c=>String(c).trim()!=='')).map((r,ri)=>{
    if(ri === 0) return r.map(c => String(c).trim());
    return r.map((v,ci)=> ci===0 ? String(v).trim() : toNum(v) );
  });
}

function setSettingsStatus(msg, kind){
  const el = $('#settings-status');
  if(!el) return;
  const col = kind==='ok'?'#16a34a':kind==='err'?'#dc2626':kind==='warn'?'#d97706':'var(--muted)';
  el.innerHTML = `<span style="color:${col}">${msg}</span>`;
}
function setPublishStatus(msg, kind){ setSettingsStatus(msg, kind); }

function openSettingsModal(){
  const s = loadSettings();
  $('#cfg-gh-owner').value  = s.owner  || '';
  $('#cfg-gh-repo').value   = s.repo   || '';
  $('#cfg-gh-branch').value = s.branch || 'main';
  $('#cfg-gh-path').value   = s.path   || 'state.json';
  $('#cfg-gh-token').value  = s.token  || '';
  $('#cfg-gs-url').value    = s.gsUrl  || '';
  setSettingsStatus('', '');
  $('#settings-modal').classList.add('active');
}
function closeSettingsModal(){ $('#settings-modal').classList.remove('active'); }
function saveSettingsFromModal(){
  const s = {
    owner:  $('#cfg-gh-owner').value.trim(),
    repo:   $('#cfg-gh-repo').value.trim(),
    branch: $('#cfg-gh-branch').value.trim() || 'main',
    path:   $('#cfg-gh-path').value.trim()   || 'state.json',
    token:  $('#cfg-gh-token').value.trim(),
    gsUrl:  $('#cfg-gs-url').value.trim(),
  };
  saveSettings(s);
  setSettingsStatus('✓ Saved', 'ok');
}

function showPublishModal(title, html){
  $('#publish-title').textContent = title;
  $('#publish-body').innerHTML = html;
  $('#publish-modal').classList.add('active');
}
function closePublishModal(){ $('#publish-modal').classList.remove('active'); }

async function tryAutoLoad(){
  const params = new URLSearchParams(window.location.search);
  const jsonUrl = params.get('json');
  if(jsonUrl){
    try{
      const res = await fetch(jsonUrl);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      loadEmployeeFromStorage();
      loadCostFromStorage();
      loadRMMasterFromStorage();
      await applyPreloadedState(data);
      await syncCostFromSheets(true);
      renderAll();
      return true;
    } catch(e){
      console.warn('Failed to load from ?json= param:', e);
      alert('Could not load data from URL: ' + e.message);
    }
  }
  // Try GitHub auto-load — settings first, then auto-detect from URL
  const s = loadSettings();
  const ghUrl = ghRawUrl(s) || detectGhRawUrl();
  if(ghUrl){
    console.log('[MIS] Attempting auto-load from:', ghUrl);
    try{
      const res = await fetch(ghUrl);
      console.log('[MIS] state.json fetch status:', res.status);
      if(res.ok){
        const data = await res.json();
        console.log('[MIS] state.json loaded, keys:', Object.keys(data));
        loadEmployeeFromStorage();
        loadCostFromStorage();
        loadRMMasterFromStorage();
        await applyPreloadedState(data);
        await syncCostFromSheets(true);
        renderAll();
        return true;
      } else {
        console.warn('[MIS] state.json fetch returned', res.status, '— falling through to upload screen.');
      }
    } catch(e){ console.warn('[MIS] GitHub auto-load failed:', e); }
  } else {
    console.log('[MIS] No GitHub URL detected. Hostname:', window.location.hostname, 'Path:', window.location.pathname);
  }
  if(window.__PRELOADED_STATE__){
    try{
      loadEmployeeFromStorage();
      loadCostFromStorage();
      loadRMMasterFromStorage();
      await applyPreloadedState(window.__PRELOADED_STATE__);
      await syncCostFromSheets(true);
      renderAll();
      return true;
    } catch(e){
      console.error('Failed to apply preloaded state:', e);
      return false;
    }
  }
  return false;
}

function openDownloadModal(){
  $('#json-filename').value = 'marketing-mis-' + new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0');
  $('#download-modal').classList.add('active');
  $('#json-filename').focus();
}

function closeDownloadModal(){
  $('#download-modal').classList.remove('active');
}

function bindUI(){
  $('#load-btn').onclick = handleLoad;
  $('#reupload-btn').onclick = showUpload;

  $('#download-json-btn').onclick = openDownloadModal;
  $('#confirm-download').onclick = downloadAsWebpage;

  // GitHub publish + Settings
  const pubBtn = $('#publish-gh-btn');
  if(pubBtn) pubBtn.onclick = publishToGitHub;
  const setBtn = $('#settings-btn');
  if(setBtn) setBtn.onclick = openSettingsModal;
  const cancelSet = $('#cancel-settings');
  if(cancelSet) cancelSet.onclick = closeSettingsModal;
  const saveSet = $('#save-settings-btn');
  if(saveSet) saveSet.onclick = saveSettingsFromModal;
  const testGs = $('#test-gs-btn');
  if(testGs) testGs.onclick = async () => {
    saveSettingsFromModal();
    setSettingsStatus('Fetching from Google Sheets…', '');
    const ok = await syncCostFromSheets(false);
    if(ok) { reconcileCostMonths(); renderAll(); }
  };
  const setModalBg = $('#settings-modal');
  if(setModalBg) setModalBg.onclick = e => { if(e.target.id==='settings-modal') closeSettingsModal(); };
  const pubClose = $('#publish-close-btn');
  if(pubClose) pubClose.onclick = closePublishModal;
  const pubModalBg = $('#publish-modal');
  if(pubModalBg) pubModalBg.onclick = e => { if(e.target.id==='publish-modal') closePublishModal(); };
  $('#cancel-download').onclick = closeDownloadModal;
  $('#download-modal').onclick = e => { if(e.target.id==='download-modal') closeDownloadModal(); };
  $('#json-filename').onkeypress = e => { if(e.key==='Enter') downloadAsWebpage(); };


  // filter-month and filter-refcold are now custom multi-select widgets — wired inside initFilters()
  $('#filter-table').onchange = e => { STATE.filterTable = e.target.value; renderPlatformStatus(); };

  $('#mtd-start').onchange = e => { STATE.mtdStart = +e.target.value||1; renderMTD(); };
  $('#mtd-end').onchange = e => { STATE.mtdEnd = +e.target.value||30; renderMTD(); };
  $('#mtd-refcold').onchange = e => { STATE.mtdFilterRefCold = e.target.value; renderMTD(); };

  $('#rev-lp-filter').onchange = e => { STATE.revLPFilter = e.target.value; renderRMRev(); };

  // rev-team-filter-wrap and rev-month-filter-wrap are custom multi-select widgets — wired inside initRevFilters()

  // rmperf-month and rmperf-refcold are now custom multi-select widgets — wired inside renderRMPerformance()
  $('#rmperf-fy-file').onchange = e => handleRMPerfUpload('fy', e.target.files[0]);
  $('#rmperf-pa-file').onchange = e => handleRMPerfUpload('pa', e.target.files[0]);
  const recalcBtn = $('#rmperf-recalc');
  if(recalcBtn) recalcBtn.onclick = () => {
    const status = $('#rmperf-recalc-status');
    try{
      // Re-derive FY/PA Month resolution and re-map RM names against the current RM Master, then re-render.
      if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
      if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
      detectMonths();
      initFilters();
      renderRMPerformance();
      if(status){
        const ts = new Date().toLocaleTimeString();
        status.innerHTML = `<span style="color:var(--green);font-weight:600">✓ Recalculated at ${ts}</span> — FY rows: ${STATE.fy.length}, Plan Approval rows: ${STATE.pa.length}`;
      }
    }catch(e){
      console.error(e);
      if(status) status.innerHTML = `<span style="color:var(--red);font-weight:600">Error: ${escHtml(e.message)}</span>`;
    }
  };

  $('#raw-search').oninput = renderRawData;
  $('#raw-clear-filters').onclick = () => { STATE.rawFilters = {}; renderRawData(); };

  $('#b2b-search').oninput = renderB2BRawData;
  $('#b2b-clear-filters').onclick = () => { STATE.b2bFilters = {}; renderB2BRawData(); };

  $('#reset-cpc').onclick = () => {
    try{ localStorage.removeItem('cpc_override'); }catch(e){}
    loadCostFromStorage(); reconcileCostMonths();
    renderCPC(); renderCostSummary(); renderCplRm(); renderMTD();
  };

  $('#emp-add').onclick = () => {
    STATE.empref.push(['', '', '']);
    persistEmployee(); rebuildTeamMap(); renderEmployee();
  };
  $('#emp-reset').onclick = () => {
    try{ localStorage.removeItem('empref_override'); }catch(e){}
    loadEmployeeFromStorage(); rebuildTeamMap();
    renderEmployee(); renderAffectedByTeamChange();
  };

  // ---- Excel download / upload + global Calculate ----
  const downloadAsXlsx = (rows2D, sheetName, fileName) => {
    const ws = XLSX.utils.aoa_to_sheet(rows2D);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };
  const parseUploadedXlsx = async (file) => {
    const wb = await readWb(file);
    const sh = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sh, {header:1, defval:'', raw:true, blankrows:false});
    // strip empty trailing rows
    while(rows.length && rows[rows.length-1].every(c => c==='' || c==null)) rows.pop();
    return rows;
  };
  const setStatus = (sel, msg, kind='ok') => {
    const el = $(sel); if(!el) return;
    const color = kind==='err' ? 'var(--red)' : (kind==='ok' ? 'var(--green)' : 'var(--muted)');
    el.innerHTML = `<span style="color:${color};font-weight:600">${escHtml(msg)}</span>`;
  };
  const recalcAll = () => {
    rebuildTeamMap();
    buildRMMasterLookup();
    if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
    if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
    detectMonths();
    initFilters();
    if(typeof initRevFilters==='function') initRevFilters();
    renderAll();
  };

  // EMPLOYEE_REF · download Excel
  $('#emp-xlsx-download').onclick = () => {
    downloadAsXlsx(STATE.empref, 'EMPLOYEE_REF', 'EMPLOYEE_REF.xlsx');
    setStatus('#emp-status', `Downloaded ${STATE.empref.length-1} rows at ${new Date().toLocaleTimeString()}`);
  };
  // EMPLOYEE_REF · upload Excel
  $('#emp-xlsx-upload').onchange = async (e) => {
    const file = e.target.files[0]; if(!file) return;
    try{
      const rows = await parseUploadedXlsx(file);
      if(rows.length < 1) throw new Error('File has no rows');
      // header sanity-check
      const h = rows[0].map(c => (c||'').toString().toLowerCase());
      const hasCode = h.some(c => c.includes('code'));
      const hasTeam = h.some(c => c.includes('team'));
      const hasName = h.some(c => c.includes('name'));
      if(!hasCode || !hasTeam || !hasName){
        if(!confirm('Headers don\'t look like Emp Code / Team / Name. Use anyway? (columns are read in order: col 1 = code, col 2 = team, col 3 = name)')) { e.target.value=''; return; }
      }
      STATE.empref = rows;
      persistEmployee();
      recalcAll();
      setStatus('#emp-status', `Uploaded ${rows.length-1} rows from ${file.name} · all tabs recalculated`);
    }catch(err){
      console.error(err);
      setStatus('#emp-status', 'Upload failed: '+err.message, 'err');
    }
    e.target.value = '';
  };
  $('#emp-recalc').onclick = () => {
    recalcAll();
    setStatus('#emp-status', `Recalculated at ${new Date().toLocaleTimeString()} — every tab refreshed`);
  };

  // RM MASTER MAPPING · download Excel
  $('#rmm-xlsx-download').onclick = () => {
    downloadAsXlsx(STATE.rmMaster, 'RM Master Mapping', 'RM_Master_Mapping.xlsx');
    setStatus('#rmm-status', `Downloaded ${STATE.rmMaster.length-1} rows at ${new Date().toLocaleTimeString()}`);
  };
  // RM MASTER MAPPING · upload Excel
  $('#rmm-xlsx-upload').onchange = async (e) => {
    const file = e.target.files[0]; if(!file) return;
    try{
      const rows = await parseUploadedXlsx(file);
      if(rows.length < 1) throw new Error('File has no rows');
      const h = rows[0].map(c => (c||'').toString().toLowerCase());
      const hasSrc = h.some(c => c.includes('source'));
      const hasCorrect = h.some(c => c.includes('correct') || c.includes('canonical') || c.includes('rm name'));
      const hasTeam = h.some(c => c.includes('team'));
      if(!hasSrc || !hasCorrect || !hasTeam){
        if(!confirm('Headers don\'t look like Source Name / Correct RM Name / Team. Use anyway? (col 1 = source, col 2 = canonical, col 3 = team)')) { e.target.value=''; return; }
      }
      STATE.rmMaster = rows;
      persistRMMaster();
      recalcAll();
      renderRMMaster();
      setStatus('#rmm-status', `Uploaded ${rows.length-1} mappings from ${file.name} · all tabs recalculated`);
    }catch(err){
      console.error(err);
      setStatus('#rmm-status', 'Upload failed: '+err.message, 'err');
    }
    e.target.value = '';
  };
  $('#rmm-recalc').onclick = () => {
    recalcAll();
    setStatus('#rmm-status', `Recalculated at ${new Date().toLocaleTimeString()} — every tab refreshed`);
  };

  const exportSnapshot = () => {
    const snap = Object.assign({}, window.SNAPSHOT, {
      EMPLOYEE_REF: STATE.empref,
      'Cost Per Campaign': STATE.cost,
      'RM Master Mapping': STATE.rmMaster,
    });
    const content = 'window.SNAPSHOT = ' + JSON.stringify(snap) + ';';
    const blob = new Blob([content], {type: 'text/javascript'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'snapshot.js';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#emp-export').onclick = exportSnapshot;

  $('#rmm-add').onclick = () => {
    STATE.rmMaster.push(['', '', '']);
    persistRMMaster(); buildRMMasterLookup(); renderRMMaster();
  };
  $('#rmm-reset').onclick = () => {
    try{ localStorage.removeItem('rmmaster_override'); }catch(e){}
    loadRMMasterFromStorage(); buildRMMasterLookup();
    if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
    if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
    renderRMMaster();
    if(typeof renderRMPerformance==='function') renderRMPerformance();
  };
  $('#rmm-export').onclick = exportSnapshot;
}

// ---- top mirror scrollbar ----
function attachMirrorScroll(tableWrap){
  const existing = tableWrap.previousElementSibling;
  if(existing && existing.classList.contains('scroll-mirror')) existing.remove();

  const mirror = document.createElement('div');
  mirror.className = 'scroll-mirror';
  const inner = document.createElement('div');
  inner.className = 'scroll-mirror-inner';
  mirror.appendChild(inner);
  tableWrap.parentNode.insertBefore(mirror, tableWrap);

  requestAnimationFrame(() => {
    inner.style.width = tableWrap.scrollWidth + 'px';
    let syncing = false;
    mirror.addEventListener('scroll', () => {
      if(syncing) return; syncing = true;
      tableWrap.scrollLeft = mirror.scrollLeft;
      syncing = false;
    });
    tableWrap.addEventListener('scroll', () => {
      if(syncing) return; syncing = true;
      mirror.scrollLeft = tableWrap.scrollLeft;
      inner.style.width = tableWrap.scrollWidth + 'px';
      syncing = false;
    });
  });
}

function attachAllMirrors(){
  $$('.table-wrap').forEach(attachMirrorScroll);
}

const TABLE_INFO = {
  'status-chart': {
    title: 'Status Distribution Chart',
    desc: 'Bar chart showing count of leads per status for selected month(s). Each status is counted using its own event-date column.',
    cols: 'leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months) · LPM (selected months) · CM (selected months)',
    source: 'RAW_DATA sheet',
    note: 'IN PROCESS count uses LPM (Lead In-Process Month). RAW_DATA FMONTH for non-converted leads = CTM (Created Month). Leads created before the selected month that moved to IN PROCESS within it are counted here but will not appear in a RAW_DATA filter on FMONTH.'
  },
  'platform-month': {
    title: 'Leads Generated · Platform × Month',
    desc: 'Cross-tabulation: rows grouped by platform name against created month. Each cell is a raw lead count.',
    cols: 'platformName (Google Adwords / Facebook / Brand Marketing / BTL Marketing / Referral / Emailer / Direct Registration / Cold Leads) · CTM (selected months)',
    source: 'RAW_DATA sheet'
  },
  'status-month-mapped': {
    title: 'Status Distribution · Mapped Teams',
    desc: 'Status × Month table restricted to leads where firstRmName maps to a named team (any team except SV) via EMPLOYEE_REF.',
    cols: 'firstRmName (non-SV team from EMPLOYEE_REF) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months) · LPM (selected months) · CM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'IN PROCESS count uses LPM (Lead In-Process Month). RAW_DATA FMONTH for non-converted leads = CTM (Created Month). Leads created before the selected month that moved to IN PROCESS within it are counted here but will not appear in a RAW_DATA filter on FMONTH.'
  },
  'status-month-sv': {
    title: 'Status Distribution · SV (Unmapped)',
    desc: 'Status × Month table restricted to leads where firstRmName is blank or not found in EMPLOYEE_REF — these default to the SV bucket.',
    cols: 'firstRmName (blank or not in EMPLOYEE_REF → SV) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months) · LPM (selected months) · CM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'IN PROCESS count uses LPM (Lead In-Process Month). RAW_DATA FMONTH for non-converted leads = CTM (Created Month). Leads created before the selected month that moved to IN PROCESS within it are counted here but will not appear in a RAW_DATA filter on FMONTH.'
  },
  'platform-status': {
    title: 'Platform × Status Breakdown',
    desc: 'Lead counts by platform and status. CONVERTED uses CM, IN PROCESS uses LPM, all other statuses (ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD) use CTM.<br><strong>Same Month:</strong> status column matches selected month(s) AND CTM matches.<br><strong>Any Month:</strong> status column matches selected month(s) but CTM outside (only applies to CONVERTED/IN PROCESS; other statuses will be 0 since their column IS CTM).<br><strong>Default:</strong> status column matches selected month(s).',
    cols: 'platformName · leadStatus · CTM (Created Month, used for ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CM (Converted Month, for CONVERTED) · LPM (Lead In-Process Month, for IN PROCESS)',
    source: 'RAW_DATA sheet',
    note: 'FMONTH and LSM are not used in this table. For ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD — only CTM and leadStatus are used. AnyMonth mode only affects CONVERTED (CM) and IN PROCESS (LPM) since for other statuses the filter column is CTM itself.'
  },
  'team-perf': {
    title: 'Team Performance Matrix',
    desc: 'Lead and status counts per team. Team is resolved from firstRmName via EMPLOYEE_REF. Total Leads uses CTM. Each status uses its own event-date column.',
    cols: 'firstRmName (→ team name from EMPLOYEE_REF) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months, for Total Leads / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · LPM (selected months, for IN PROCESS) · CM (selected months, for CONVERTED)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'IN PROCESS count uses LPM (Lead In-Process Month); Total Leads uses CTM. A lead created before the selected month that moved to IN PROCESS within it appears in the IN PROCESS column but not in Total Leads — so status columns do not always sum to Total Leads. To match RAW_DATA, filter RAW_DATA by LPM for IN PROCESS and by CTM for all other statuses.'
  },
  'campaign-team': {
    title: 'Leads per Campaign · Team × Campaign',
    desc: 'Shows how many leads were assigned to which team from marketing campaigns. Lead counts cross-tabulated by team (from firstRmName) and campaign. CTM used to apply the month filter.',
    cols: 'firstRmName (→ team name from EMPLOYEE_REF) · Campaign Name (all campaign values) · CTM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet'
  },
  'income': {
    title: 'Income Segment Analysis',
    desc: 'Leads, Converted, In Process, and Quality Leads (Converted + In Process) by income band. Leads filtered by CTM; Converted by CM; In Process by LPM.',
    cols: 'annualIncome (Above 20 Lac / 15 Lac to 20 Lac / 10 Lac to 15 Lac / 5 Lac to 10 Lac / 0 to 5 Lac) · CTM (selected months) · leadStatus (CONVERTED) with CM (selected months) · leadStatus (IN PROCESS) with LPM (selected months)',
    source: 'RAW_DATA sheet',
    note: 'Leads column uses CTM; In Process uses LPM; Converted uses CM. A lead created before the selected month that moved to IN PROCESS within it will appear in the In Process column but not in Leads — so Leads and Quality Leads counts are on different bases and will not add up directly.'
  },
  'cost-summary': {
    title: 'Cost Summary by Campaign',
    desc: 'Campaign costs from the CPC tab summed over selected months, with CPL and CPQL calculated. Quality Leads = rows where leadStatus is CONVERTED or IN PROCESS, filtered by CTM.',
    cols: 'Campaign Name (all campaigns) · CTM (selected months) · leadStatus (CONVERTED / IN PROCESS, for Quality Leads count)',
    source: 'RAW_DATA sheet, Cost Per Campaign tab'
  },
  'cpl-rm': {
    title: 'Cost Per Lead · per Team / RM',
    desc: 'Campaign costs split proportionally to each RM based on their share of that campaign\'s leads. CPL = cost / Leads; CPQL = cost / Quality Leads.',
    cols: 'currentRmName (all RM names) · Campaign Name (all campaigns) · CTM (selected months) · leadStatus (CONVERTED / IN PROCESS, for Quality Leads)',
    source: 'RAW_DATA sheet, Cost Per Campaign tab, EMPLOYEE_REF sheet'
  },
  'inprocess-ds': {
    title: 'In-Process Date Set, Status ≠ IN PROCESS',
    desc: 'Data quality check: rows where leadInProcessDate is populated but leadStatus is not IN PROCESS — the lead moved out of in-process without the date being cleared.',
    cols: 'leadInProcessDate (not blank) · LPM (not blank) · leadStatus (DEAD / ON HOLD / ASSIGNED / RE-ASSIGNED / FOLLOW UP / CONVERTED)',
    source: 'RAW_DATA sheet'
  },
  'converted-ds': {
    title: 'Converted Date Set, Status ≠ CONVERTED',
    desc: 'Data quality check: rows where convertedDate is populated but leadStatus is not CONVERTED — possible data entry error or reversal.',
    cols: 'convertedDate (not blank) · CM (not blank) · leadStatus (DEAD / ON HOLD / ASSIGNED / RE-ASSIGNED / FOLLOW UP / IN PROCESS)',
    source: 'RAW_DATA sheet'
  },
  'b2b': {
    title: 'B2B Corp Leads — RM × Status',
    desc: 'B2B corporate lead counts by RM and status, filtered by CreateMonth. Requires separate B2B file upload.',
    cols: 'currentRmName (all RM names) · leadStatus (all statuses) · CreateMonth (selected months)',
    source: 'B2B Corporate Lead File'
  },
  'rmperf-funnel': {
    title: 'Conversion Funnel',
    desc: 'Pipeline stages: Total Leads → Quality Leads → Financial Plans → Revenue >15K → Transactional. Each stage draws from a different source sheet.',
    cols: 'RAW_DATA — CTM (selected months) / leadStatus (CONVERTED) with CM (selected months) / leadStatus (IN PROCESS) with LPM (selected months) | FY Sheet — Month (selected months) / mappedRM (all RMs) / leadSource (Referral excluded if filter on) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total (revenue amount)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input sheets'
  },
  'rmperf-summary': {
    title: 'RM Performance Summary — by Team',
    desc: 'Team-level aggregation across the full pipeline: Leads, Quality, Plans, Revenue >15K, Transactional, Revenue.',
    cols: 'RAW_DATA — CTM (selected months) / leadStatus (CONVERTED) with CM / leadStatus (IN PROCESS) with LPM | FY Sheet — Month (selected months) / mappedRM (all RMs) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total | EMPLOYEE_REF — firstRmName (→ team name)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input, EMPLOYEE_REF sheets'
  },
  'rmperf-detail': {
    title: 'Team × RM Detailed Breakdown',
    desc: 'Same pipeline metrics as the Summary table but per individual RM. currentRmName is resolved to a canonical name via RM Master Mapping before matching to FY / Revenue Input.',
    cols: 'RAW_DATA — currentRmName (all RMs) / CTM (selected months) / leadStatus (CONVERTED) with CM / leadStatus (IN PROCESS) with LPM | FY Sheet — Month (selected months) / mappedRM (all RMs) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total | RM Master Mapping — source name (→ canonical RM name)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input, EMPLOYEE_REF, RM Master Mapping sheets'
  },
  'lp-status': {
    title: 'Landing Page × Status Breakdown',
    desc: 'Lead counts by landing page and status, filtered by campaign. CONVERTED uses CM, IN PROCESS uses LPM, all other statuses use CTM.<br><strong>Same Month:</strong> status column matches selected month(s) AND CTM matches.<br><strong>Any Month:</strong> status column matches selected month(s) but CTM outside (only applies to CONVERTED/IN PROCESS).<br><strong>Default:</strong> status column matches selected month(s).',
    cols: 'landingPage · Campaign Name · leadStatus · CTM (Created Month, used for ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CM (Converted Month, for CONVERTED) · LPM (Lead In-Process Month, for IN PROCESS)',
    source: 'RAW_DATA sheet',
    note: 'FMONTH and LSM are not used in this table. For ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD — only CTM and leadStatus are used. AnyMonth only affects CONVERTED (CM) and IN PROCESS (LPM).'
  },
  'rmrev': {
    title: 'RM Revenue',
    desc: 'Revenue data from Revenue Input filtered by month. Revenue >15K = CLIENT TYPE "REVENUE BASED"; Transactional = CLIENT TYPE "NOT ELIGIBLE". RM names normalised via RM Master Mapping.',
    cols: 'RM (all RM names) · OLD CHECK (selected months) · CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) · Total (revenue amount) · LP (Referral / campaign category values)',
    source: 'Revenue Input sheet, RM Master Mapping sheet'
  },
};

function showInfoPopup(key){
  const info = TABLE_INFO[key];
  if(!info) return;
  const overlay = document.createElement('div');
  overlay.className = 'info-overlay';
  const popup = document.createElement('div');
  popup.className = 'info-popup';
  popup.innerHTML = `<button class="close-info">&times;</button>
    <h3>${info.title}</h3>
    <p>${info.desc}</p>
    <div class="info-label">Columns Used</div>
    <p>${info.cols}</p>
    <div class="info-label">Data Source</div>
    <p>${info.source}</p>
    ${info.note ? `<div class="info-label" style="color:#b45309">⚠ RAW_DATA Match Note</div><p style="color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-top:4px;font-size:12px">${info.note}</p>` : ''}`;
  document.body.appendChild(overlay);
  document.body.appendChild(popup);
  const close = () => { overlay.remove(); popup.remove(); };
  overlay.onclick = close;
  popup.querySelector('.close-info').onclick = close;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('.info-btn');
  if(btn){ e.stopPropagation(); showInfoPopup(btn.dataset.info); }
});

async function bootApp(){
  bindUI();
  tabBar();
  initPremiumLock();
  const autoLoaded = await tryAutoLoad();
  if(!autoLoaded) showUpload();
}
if(document.readyState === 'loading'){
  window.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
