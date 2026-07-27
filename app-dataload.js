// app-dataload.js — Excel row parsing, month detection, repo-data bootstrap/loading screen.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- file load ----
// Only used now for the small in-tab "Upload Excel" edits on EMPLOYEE_REF / RM Master
// Mapping. The five main data sources are pre-extracted offline by extract.py into
// data.js (see loadAllFromRepo) — no in-browser XLSX parsing for those anymore.
async function readWb(file){
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, {type:'array', sheets:[0]});
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

function isValidMonth(m){
  if(!m || m==='N/A') return false;
  const parts = m.match(/^[A-Za-z]{3}-(\d{4})$/);
  return parts && +parts[1]>=2000 && +parts[1]<=2099;
}
function detectMonths(){
  const set = new Set();
  for(const r of STATE.raw){
    if(isValidMonth(r.FMONTH)) set.add(r.FMONTH);
  }
  for(const r of STATE.b2bRaw){
    if(isValidMonth(r.CreateMonth)) set.add(r.CreateMonth);
  }
  for(const r of STATE.fy){ if(isValidMonth(r.Month)) set.add(r.Month); }
  for(const r of STATE.pa){ if(isValidMonth(r.Month)) set.add(r.Month); }
  for(const r of (STATE.rev||[])){
    const raw = r['OLD CHECK']||r['Old Check']||r['old check']||r['OldCheck']||'';
    const m = normalizeMonthLabel(raw) || toMmmYyyy(raw);
    if(isValidMonth(m)) set.add(m);
  }
  STATE.months = sortMonths(Array.from(set));
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

function setLoadingStatus(text){
  const el = $('#loading-status');
  if(el) el.textContent = text;
}

// Data is fetched from the hosted backend API (PythonAnywhere) instead of a static
// data.js bundle — the /upload form there replaces the local extract.py + git push
// workflow. Falls back to window.MARKETING_DATA (data.js) if the API is unreachable.
async function loadAllFromRepo(){
  // #upload-screen and #app both start with display:none in CSS — without this,
  // the page stays completely blank (no spinner, no error) for the entire loading
  // and render pass, which can take well over a minute on a large dataset.
  showUpload();
  STATE.filesLoaded = { fin23: false, rev: false, b2b: false, fy: false, pa: false };

  loadEmployeeFromStorage();
  loadCostFromStorage();
  loadRMMasterFromStorage();

  setLoadingStatus('Fetching latest data…');
  // Yield one frame so the loading screen actually paints before the heavy
  // synchronous work below (buildRawData + renderAll) blocks the main thread.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  let d = {};
  try {
    const res = await fetch(DATA_API_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error(`API returned ${res.status}`);
    d = await res.json();
  } catch(e) {
    console.warn('[MIS] Failed to fetch data from API, falling back to data.js', e);
    d = window.MARKETING_DATA || {};
  }

  if(d.fin23 && d.fin23.length){
    STATE.raw = buildRawData(d.fin23);
    STATE.rawFilters = {};
    STATE.filesLoaded.fin23 = true;
  } else {
    console.warn('[MIS] fin23 data missing from data.js');
    STATE.raw = []; STATE.rawFilters = {};
  }

  rebuildTeamMap();

  if(d.rev && d.rev.length){
    STATE.rev = d.rev;
    STATE.filesLoaded.rev = true;
  } else {
    console.warn('[MIS] rev data missing from data.js');
    STATE.rev = [];
  }

  if(d.b2b && d.b2b.length){
    STATE.b2bRaw = buildB2BRaw(d.b2b);
    STATE.b2b = buildB2BData(STATE.b2bRaw);
    STATE.b2bFilters = {};
    STATE.filesLoaded.b2b = true;
  } else {
    console.warn('[MIS] b2b data missing from data.js');
    STATE.b2bRaw = []; STATE.b2b = []; STATE.b2bFilters = {};
  }

  if(d.fy && d.fy.length){
    STATE.fy = buildFYData(d.fy);
    STATE.filesLoaded.fy = true;
  } else {
    console.warn('[MIS] fy data missing from data.js');
    STATE.fy = [];
  }

  if(d.pa && d.pa.length){
    STATE.pa = buildPAData(d.pa);
    STATE.filesLoaded.pa = true;
  } else {
    console.warn('[MIS] pa data missing from data.js');
    STATE.pa = [];
  }

  if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
  if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });

  // If a Google Sheets Cost Per Campaign source is configured (Settings), it overrides
  // whatever loadCostFromStorage() set above — same as the old auto-load flow.
  setLoadingStatus('Syncing Cost Per Campaign…');
  await syncCostFromSheets(true);

  detectMonths();
  reconcileCostMonths();
  initFilters();
  initRevFilters();

  setLoadingStatus(`Rendering dashboard (${STATE.raw.length.toLocaleString()} leads)… this can take a minute for large files.`);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  renderAll();
  showApp();
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
  // Mirror the coverage date into the rail footer alongside the live-data pulse.
  const railSync = $('#side-sync');
  if(railSync) railSync.textContent = `${num2(day)} ${mon.slice(0,3)} ${yr}`;
}
const num2 = n => String(n).padStart(2,'0');

