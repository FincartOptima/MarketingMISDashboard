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
    const rm = cleanName(pickField(r,'currentRmName','Current RM Name','RM','Curren RM'));
    const cd = pickField(r,'createdDate','Created Date','created date');
    const lsd = pickField(r,'lastStatusDate','Last Status Date','last status date');
    let lpd = pickField(r,'leadInProcessDate','LeadProcessDate','Lead In Process Date','lead in process date');
    let cvd = pickField(r,'convertedDate','Converted Date','converted date');
    const leadStatus = cleanName(pickField(r,'leadStatus','Lead Status')).toUpperCase();

    // IN PROCESS / CONVERTED with no date has no month and would drop out of
    // every table; use the last-status month instead and flag the row.
    const fallbackDate = !isBlankDate(lsd) ? lsd : cd;
    let ipInferred = false, cvInferred = false;
    if(leadStatus === 'IN PROCESS' && isBlankDate(lpd)
       && !normalizeMonthLabel(pickField(r,'LPM','LeadProcessMonth')) && !isBlankDate(fallbackDate)){
      lpd = fallbackDate; ipInferred = true;
    }
    if(leadStatus === 'CONVERTED' && isBlankDate(cvd)
       && !normalizeMonthLabel(pickField(r,'CM','Converted Month','ConvertedMonth')) && !isBlankDate(fallbackDate)){
      cvd = fallbackDate; cvInferred = true;
    }

    const createdMmm = normalizeMonthLabel(pickField(r,'CTM','Created Month')) || toMmmYyyy(cd);
    const lpm = normalizeMonthLabel(pickField(r,'LPM','LeadProcessMonth')) || toMmmYyyy(lpd);
    const convertedMmm = normalizeMonthLabel(pickField(r,'CM','Converted Month','ConvertedMonth')) ||
      ((cvd && cvd!=='' && cvd!=='N/A') ? toMmmYyyy(cvd) : '');
    const fmonth = normalizeMonthLabel(pickField(r,'FMONTH','FMonth')) ||
      ((convertedMmm && convertedMmm!=='N/A') ? convertedMmm : createdMmm);
    const sourceTeam = pickField(r,'Team');
    // Per-activity timestamps added to the FIN23 export on 2026-11-02 — the
    // CRM stamps the LAST time a lead entered each activity, so they are a
    // set of "latest seen in this state" marks, not an ordered history (see
    // activityFanOut in app-activity.js, which only counts a move as a
    // move when the To date is on/after the From date). Normalised to '' when
    // absent so an older export without these columns reads as "no stamp"
    // rather than the literal string 'N/A'.
    const actDate = (...names) => {
      const v = pickField(r, ...names);
      return isBlankDate(v) ? '' : (toIsoDate(v) || '');
    };
    return {
      currentRmName: rm,
      Team: sourceTeam||'SV',
      _hasSourceTeam: sourceTeam !== '',
      _ipInferred: ipInferred,
      _cvInferred: cvInferred,
      clientName: cleanName(pickField(r,'clientName','Client Name')),
      landingPage: cleanName(pickField(r,'landingPage','Landing Page')),
      platformName: cleanName(pickField(r,'platformName','Platform Name')),
      'Campaign Name': cleanName(pickField(r,'Campaign Name','categoryName','campaignName','Category Name')),
      userId: cleanName(pickField(r,'userId','User ID')),
      createdDate: toIsoDate(cd) || (cd||''),
      CTM: createdMmm,
      lastStatusDate: toIsoDate(lsd) || (lsd||''),
      LSM: toMmmYyyy(lsd),
      leadInProcessDate: (lpd==='N/A'||!lpd) ? 'N/A' : (toIsoDate(lpd) || lpd),
      LPM: lpm,
      leadHead: cleanName(pickField(r,'leadHead','Lead Head')),
      leadStatus,
      convertedDate: (cvd==='N/A'||!cvd) ? '' : (toIsoDate(cvd) || cvd),
      CM: convertedMmm || 'N/A',
      firstRmName: cleanName(pickField(r,'firstRmName','First RM Name')),
      convertedByName: cleanName(pickField(r,'convertedByName','Converted By Name')),
      annualIncome: pickField(r,'annualIncome','Annual Income')||'',
      clientCategory: pickField(r,'clientCategory','Client Category')||'',
      FMONTH: fmonth,
      leadOnHoldDate:   actDate('leadOnHoldDate','Lead On Hold Date'),
      leadFollowUpDate: actDate('leadFollowUpDate','Lead Follow Up Date'),
      leadDeadDate:     actDate('leadDeadDate','Lead Dead Date'),
      isClient:    String(pickField(r,'isClient','Is Client')||''),
      dndStatus:   String(pickField(r,'dndStatus','DND Status')||''),
      utmId:       String(pickField(r,'utmId','UTM Id')||''),
      utmSource:   String(pickField(r,'utmSource','UTM Source')||''),
      utmMedium:   String(pickField(r,'utmMedium','UTM Medium')||''),
      utmCampaign: String(pickField(r,'utmCampaign','UTM Campaign')||''),
      utmTerm:     String(pickField(r,'utmTerm','UTM Term')||''),
      utmContent:  String(pickField(r,'utmContent','UTM Content')||''),
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
      leadStatus:   (r.leadStatus||r.status||r.Status||'').toString().trim().toUpperCase(),
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

/**
 * Yield until the browser has had a chance to paint, so the loading screen is
 * actually on-screen before the heavy synchronous work that follows blocks the
 * main thread.
 *
 * requestAnimationFrame does NOT fire while the tab is hidden, so a bare
 * double-rAF await hangs forever if the dashboard is opened in a background
 * tab — leaving a permanently blank screen until the user focuses it. Racing
 * against a timer guarantees the pipeline always continues; when the tab is
 * visible the rAF path still wins and we get a real painted frame.
 */
function yieldToPaint(){
  return new Promise(resolve => {
    let settled = false;
    const finish = () => { if(!settled){ settled = true; resolve(); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 200);
  });
}

// ---- data-load failure screen ----
//
// There is deliberately NO local fallback. The page used to drop back to the
// bundled data.js when the API was unreachable, which meant a dashboard that
// looked completely normal while showing figures from whenever that bundle was
// last built — the worst possible failure mode for a reporting tool. Now a
// failed load renders this screen instead of the dashboard, and not a single
// figure is drawn. The one path that does not need the API is a self-contained
// saved webpage, which embeds its own data (applyPreloadedState) and never
// reaches this function — note that the exporter that builds those is itself
// broken today, see downloadAsWebpage() in app-ui.js.
const API_ORIGIN = (() => {
  try { return new URL(DATA_API_URL).origin; }
  catch(e){ return DATA_API_URL.replace(/\/api\/data\/?$/, ''); }
})();
const API_HEALTH_URL = API_ORIGIN + '/health';      // liveness only: {"status":"ok"}
const API_META_URL   = API_ORIGIN + '/api/meta';    // row count + last-updated, per file
const API_UPLOAD_URL = API_ORIGIN + '/upload';

/**
 * Plain-language diagnosis for one failed load. Keyed off what actually went
 * wrong so the steps shown are the ones worth trying, not a generic list.
 * @param {{kind:string, status?:number, error?:string}} fail
 */
function loadErrorDiagnosis(fail){
  const api = `<code>${escHtml(DATA_API_URL)}</code>`;
  const network = {
    lede: 'The browser could not reach the data API at all — the request never got a reply.',
    checks: [
      `Are you online? Open any other site to confirm.`,
      `Open ${api} in a new tab. A working API answers with text starting <code>{"meta":</code>. ` +
        `If the tab shows a PythonAnywhere error page, the backend itself is down.`,
      `If that tab works but this page still fails, the browser is blocking the cross-origin request: ` +
        `open the console with <strong>F12 → Console</strong> and look for a <strong>CORS</strong> or ` +
        `<strong>blocked</strong> message. An ad-blocker, a corporate proxy or a VPN is the usual cause.`,
      `On a free PythonAnywhere account the web app stops serving every 3 months. Sign in, open the ` +
        `<strong>Web</strong> tab and press <strong>Run until 3 months from today</strong>.`,
    ],
    fix: [
      'Reconnect or disable the blocker, then press Retry.',
      'If the backend is down, sign in to PythonAnywhere, press <strong>Reload</strong> on the Web tab, and wait ~20 seconds.',
      'Still failing? <code>/health</code> below answers whenever the app is alive. If it answers but <code>/api/data</code> does not, the fault is in the data rather than the hosting — check <code>/api/meta</code>.',
    ],
  };
  const byKind = {
    network,
    http: {
      lede: `The data API answered, but with an error: <strong>HTTP ${fail.status}</strong>.`,
      checks: [
        fail.status === 404
          ? `A 404 means the URL is wrong or the backend is running an older build without <code>/api/data</code>. Confirm <code>CONFIG.DATA_API_URL</code> in <code>app-config.js</code> matches the deployed app.`
          : `A ${fail.status} means the backend crashed while building the response. Its traceback is in the PythonAnywhere <strong>Error log</strong> (Web tab → Log files).`,
        `<code>/health</code> below answers whenever the app is alive, even when <code>/api/data</code> crashes — use it to tell a hosting problem from a data one.`,
        `<code>/api/meta</code> below lists the row count and last-updated time per file. A zero against <code>fin23</code> means nothing has been uploaded since the database was last reset.`,
      ],
      fix: [
        'Open the upload page below and re-upload the B2C export (and Revenue Input, B2B, FY2026, Plan Approval if they changed).',
        'If the error log shows a traceback, redeploy <code>backend/extract_lib.py</code> and <code>backend/app.py</code>, then press <strong>Reload</strong> on the PythonAnywhere Web tab.',
        'Press Retry once the upload page reports success.',
      ],
    },
    parse: {
      lede: 'The data API replied, but the reply was not readable JSON.',
      checks: [
        `Open ${api} in a new tab and look at what comes back — an HTML error page or a half-written response means the backend failed mid-request.`,
        'Check the PythonAnywhere <strong>Error log</strong> (Web tab → Log files) for a traceback at the matching time.',
        'A request that times out part-way through also lands here; a very large upload can take the backend past its limit.',
      ],
      fix: [
        'Press <strong>Reload</strong> on the PythonAnywhere Web tab, then Retry.',
        'If it keeps failing, re-upload the B2C export on the upload page so the stored payload is rewritten.',
      ],
    },
    empty: {
      lede: 'The data API is up and answered correctly, but it holds no B2C lead rows — so there is nothing to report on.',
      checks: [
        'Open <code>/api/meta</code> below: it lists the row count and last-updated time per file. A zero against <code>fin23</code> confirms it.',
        'Has anyone uploaded since the backend was last redeployed or its database reset? The upload page shows what is stored.',
        'If an upload was rejected, the upload page says which required column was missing — a renamed column in the export does that.',
      ],
      fix: [
        'Open the upload page below and upload the B2C (FIN23) export. It is the only required file.',
        'Wait for the page to confirm the row count, then press Retry.',
      ],
    },
  };
  return byKind[fail.kind] || network;
}

function showLoadError(fail){
  const panel = $('#load-error');
  const loading = document.querySelector('#upload-screen .fc-loading-content');
  const symbol = document.querySelector('#upload-screen .fc-loading-symbol');
  if(symbol) symbol.classList.remove('fc-spinning');   // stop the spinner behind the hidden panel
  if(loading) loading.style.display = 'none';
  $('#upload-screen').style.display = 'flex';
  $('#app').style.display = 'none';
  if(!panel) return;                                   // nothing to render into: console still has the error
  panel.hidden = false;

  const d = loadErrorDiagnosis(fail);
  $('#le-lede').innerHTML = d.lede;
  $('#le-detail').innerHTML = `${escHtml(fail.error || 'No further detail')}`
    + `<br>Endpoint: ${escHtml(DATA_API_URL)}`
    + `<br>Time: ${escHtml(new Date().toLocaleString('en-IN'))}`;
  $('#le-checks').innerHTML = d.checks.map(c => `<li>${c}</li>`).join('');
  $('#le-fix').innerHTML = d.fix.map(c => `<li>${c}</li>`).join('');
  $('#le-api').href = DATA_API_URL;
  $('#le-health').href = API_HEALTH_URL;
  $('#le-meta').href = API_META_URL;
  $('#le-upload').href = API_UPLOAD_URL;
  $('#le-retry').onclick = () => {
    panel.hidden = true;
    if(loading) loading.style.display = '';
    if(symbol) symbol.classList.add('fc-spinning');
    setLoadingStatus('Retrying…');
    loadAllFromRepo();
  };
}

/**
 * Fetch the dashboard payload, or describe the failure.
 * @returns {Promise<{ok:true, data:Object}|{ok:false, kind:string, status?:number, error:string}>}
 */
async function fetchDashboardData(){
  let res;
  try {
    res = await fetch(DATA_API_URL, { cache: 'no-store' });
  } catch(e) {
    return { ok: false, kind: 'network', error: e.message || String(e) };
  }
  if(!res.ok) return { ok: false, kind: 'http', status: res.status, error: `HTTP ${res.status} ${res.statusText || ''}`.trim() };
  let data;
  try {
    data = await res.json();
  } catch(e) {
    return { ok: false, kind: 'parse', error: e.message || String(e) };
  }
  if(!data || !Array.isArray(data.fin23) || !data.fin23.length){
    return { ok: false, kind: 'empty', error: 'The response carried no fin23 (B2C lead) rows.' };
  }
  return { ok: true, data };
}

// Data is fetched from the hosted backend API (PythonAnywhere); the /upload form
// there replaces the old local extract.py + git push workflow. A failed fetch is
// a hard stop — see showLoadError above.
async function loadAllFromRepo(){
  // #upload-screen and #app both start with display:none in CSS — without this,
  // the page stays completely blank (no spinner, no error) for the entire loading
  // and render pass, which can take well over a minute on a large dataset.
  showUpload();
  STATE.filesLoaded = { fin23: false, rev: false, b2b: false, fy: false, pa: false, bd: false, bdcalls: false, ld: false };

  loadEmployeeFromStorage();
  loadCostFromStorage();
  loadRMMasterFromStorage();

  setLoadingStatus('Fetching latest data…');
  await yieldToPaint();

  const fetched = await fetchDashboardData();
  if(!fetched.ok){
    console.error('[MIS] Could not load dashboard data from ' + DATA_API_URL, fetched);
    // Nothing is rendered: STATE.raw stays empty and the dashboard stays hidden.
    STATE.raw = []; STATE.rawFilters = {};
    STATE.dataSource = { error: fetched.error, generated: null, failed: true };
    showLoadError(fetched);
    return;
  }
  const d = fetched.data;
  STATE.dataSource = { error: null, generated: (d.meta && d.meta.generated) || null, failed: false };

  STATE.raw = buildRawData(d.fin23);
  STATE.rawFilters = {};
  STATE.filesLoaded.fin23 = true;

  rebuildTeamMap();

  if(d.rev && d.rev.length){
    STATE.rev = d.rev;
    STATE.filesLoaded.rev = true;
  } else {
    console.warn('[MIS] rev data missing from the API response');
    STATE.rev = [];
  }

  if(d.b2b && d.b2b.length){
    STATE.b2bRaw = buildB2BRaw(d.b2b);
    STATE.b2b = buildB2BData(STATE.b2bRaw);
    STATE.b2bFilters = {};
    STATE.filesLoaded.b2b = true;
  } else {
    console.warn('[MIS] b2b data missing from the API response');
    STATE.b2bRaw = []; STATE.b2b = []; STATE.b2bFilters = {};
  }

  if(d.fy && d.fy.length){
    STATE.fy = buildFYData(d.fy);
    STATE.filesLoaded.fy = true;
  } else {
    console.warn('[MIS] fy data missing from the API response');
    STATE.fy = [];
  }

  if(d.pa && d.pa.length){
    STATE.pa = buildPAData(d.pa);
    STATE.filesLoaded.pa = true;
  } else {
    console.warn('[MIS] pa data missing from the API response');
    STATE.pa = [];
  }

  if(d.bd && d.bd.length){
    STATE.bd = d.bd;
    annotateBDWithB2CMatch();
    STATE.filesLoaded.bd = true;
  } else {
    console.warn('[MIS] bd data missing from the API response');
    STATE.bd = [];
  }

  if(d.bdcalls && d.bdcalls.length){
    STATE.bdCalls = d.bdcalls;
    STATE.filesLoaded.bdcalls = true;
  } else {
    console.warn('[MIS] bdcalls data missing from the API response');
    STATE.bdCalls = [];
  }
  canonicalizeBDNames();

  // L&D Financial Planning workbook rows, as stored by the backend ('ld'). The L&D Dashboard tab
  // (app-ld.js) joins them to STATE.raw itself, the first time the tab is opened.
  STATE.ldRows = (d.ld && d.ld.length) ? d.ld : [];
  STATE.filesLoaded.ld = STATE.ldRows.length > 0;
  if(!STATE.filesLoaded.ld) console.warn('[MIS] ld (L&D workbook) data missing');

  // On-Hold lead remarks, bucketed into categories by a calibrated
  // rule-based matcher (see scratch_mfsa/classify.py) — extracted locally,
  // same non-live pattern as the file uploads above, into
  // categorized_leads_data.js (window.CATEGORIZED_LEADS_DATA).
  if(window.CATEGORIZED_LEADS_DATA && window.CATEGORIZED_LEADS_DATA.rows && window.CATEGORIZED_LEADS_DATA.rows.length){
    STATE.categorizedLeads = window.CATEGORIZED_LEADS_DATA.rows;
    STATE.categorizedScope = window.CATEGORIZED_LEADS_DATA.scope || null;
    STATE.categorizedGeneratedAt = window.CATEGORIZED_LEADS_DATA.generatedAt;
    STATE.filesLoaded.categorized = true;
  } else {
    console.warn('[MIS] Categorized leads data missing (categorized_leads_data.js not found or empty)');
    STATE.categorizedLeads = [];
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
  await yieldToPaint();

  renderAll();
  showApp();
}

function showUpload(){ $('#upload-screen').style.display='flex'; $('#app').style.display='none'; }
// Every Chart.js instance is constructed inside renderAll(), which runs while
// #app is still display:none (see loadAllFromRepo/applyPreloadedState) — so
// each chart measures a 0x0 container at creation time. Some recover on
// their own once shown, but not reliably across browsers, leaving charts
// like the Dashboard tab's Status Distribution bar blank until some later
// interaction happens to trigger a resize. Forcing a resize on every chart
// right after #app becomes visible fixes them all in one place. yieldToPaint
// (not a bare rAF) so this still resolves if the dashboard is opened in a
// background tab, where requestAnimationFrame alone would never fire.
function showApp(){
  $('#upload-screen').style.display='none';
  $('#app').style.display='block';
  updateDataSubtitle();
  yieldToPaint().then(() => {
    Object.values((window.Chart && Chart.instances) || {}).forEach(c => c.resize());
  });
}

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

