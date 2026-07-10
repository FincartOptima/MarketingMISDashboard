// app-ui.js — Settings modal, GitHub publish, Sheets sync, export/download, event binding.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

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
const SETTINGS_KEY = CONFIG.STORAGE_KEYS.SETTINGS;
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
  // Prefer the user's own configured URL, otherwise fall back to CONFIG.DEFAULT_GS_URL
  // so every visitor gets live cost data — not just whoever set gsUrl in Settings.
  const url = s.gsUrl || CONFIG.DEFAULT_GS_URL;
  if(!url) return false;
  try{
    const res = await fetch(url + (url.includes('?')?'&':'?') + '_=' + Date.now());
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    const rows = parseCsv(txt);
    if(!rows.length || !rows[0].length) throw new Error('Sheet is empty');
    STATE.cost = rows;
    try{ localStorage.setItem(CONFIG.STORAGE_KEYS.COST, JSON.stringify(STATE.cost)); }catch(e){}
    if(!silent) setSettingsStatus(`✓ Loaded ${rows.length-1} campaign rows from Google Sheets`, 'ok');
    return true;
  }catch(e){
    if(!silent) setSettingsStatus('✗ Sheets sync failed: ' + e.message, 'err');
    // Silent path: still surface *something* — most failures on the default URL
    // are caused by the sheet being share-restricted (redirects to Google login,
    // which comes back as a network error rather than a status code).
    else console.warn('[MIS] Cost Per Campaign live sync failed — sheet may not be shared publicly. Falling back to bundled snapshot.', e);
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
  const fbLink = $('#feedback-link');
  if(fbLink){
    if(FEEDBACK_FORM_URL) fbLink.href = FEEDBACK_FORM_URL;
    else fbLink.style.display = 'none';
  }

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
  $('#raw-download-excel').onclick = downloadRawExcel;

  $('#b2b-search').oninput = renderB2BRawData;
  $('#b2b-clear-filters').onclick = () => { STATE.b2bFilters = {}; renderB2BRawData(); };

  $('#reset-cpc').onclick = () => {
    try{ localStorage.removeItem(CONFIG.STORAGE_KEYS.COST); }catch(e){}
    loadCostFromStorage(); reconcileCostMonths();
    renderCPC(); renderCostSummary(); renderCplRm(); renderMTD();
  };

  $('#emp-add').onclick = () => {
    STATE.empref.push(['', '', '']);
    persistEmployee(); rebuildTeamMap(); renderEmployee();
  };
  $('#emp-reset').onclick = () => {
    try{ localStorage.removeItem(CONFIG.STORAGE_KEYS.EMPREF); }catch(e){}
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
    try{ localStorage.removeItem(CONFIG.STORAGE_KEYS.RM_MASTER); }catch(e){}
    loadRMMasterFromStorage(); buildRMMasterLookup();
    if(STATE.fy && STATE.fy.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
    if(STATE.pa && STATE.pa.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
    renderRMMaster();
    if(typeof renderRMPerformance==='function') renderRMPerformance();
  };
  $('#rmm-export').onclick = exportSnapshot;
}

