// app-ui.js — Settings modal, GitHub publish, Sheets sync, export/download, event binding.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- export / state snapshot ----

/** The full dashboard state, as embedded in a downloaded webpage or pushed to GitHub. */
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
    },
  };
}

/** Trigger a browser download of `blob` as `filename`. */
function triggerDownload(blob, filename){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadRawJSON(filename){
  const blob = new Blob([JSON.stringify(buildExportData(), null, 2)], { type: 'application/json' });
  triggerDownload(blob, `${filename || 'marketing-mis-data'}.json`);
}

async function downloadAsWebpage(){
  const filename = ($('#json-filename').value || 'marketing-mis-dashboard').trim().replace(/[^\w\-]/g, '')
    || 'marketing-mis-dashboard';
  const confirmBtn = $('#confirm-download');
  try{
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Building…';

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

    // Replace the dynamic cache-busting loader with fully inlined scripts + preloaded state
    const out = htmlText.replace(
      /<script>\s*\(function\(\)\{[\s\S]*?snapshot\.js[\s\S]*?app\.js[\s\S]*?\}\)\(\);\s*<\/script>/,
      `<script>${snapJsText}<\/script>\n${preloadTag}\n<script>${appJsText}<\/script>`
    );

    triggerDownload(new Blob([out], { type: 'text/html' }), `${filename}.html`);
  } catch(e){
    // This path is currently always hit: the single app.js this fetches was
    // split into the app-*.js files years of commits ago, so the request
    // 404s. Spell that out rather than surfacing a bare parse error.
    alert(
      `Could not build the webpage.\n\n${e.message}\n\n` +
      'Likely cause: this exporter still fetches a single "app.js", but the code now ships as ' +
      'separate app-*.js files, so that request fails.\n\n' +
      'Fix: update downloadAsWebpage() in app-ui.js to inline the file list from index.html\'s ' +
      'script loader instead of app.js.'
    );
  } finally{
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Download';
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
    const f = data.filters;
    // Only overwrite what the snapshot actually carried, so a partial
    // export doesn't blank out filters that have sensible defaults.
    if(f.currentMonth)    STATE.filterMonth       = f.currentMonth;
    if(f.refColdMode)     STATE.filterRefCold     = f.refColdMode;
    if(f.tableMode)       STATE.filterTable       = f.tableMode;
    if(f.mtdRefColdMode)  STATE.mtdFilterRefCold  = f.mtdRefColdMode;
    if(f.revLPMode)       STATE.revLPFilter       = f.revLPMode;
    if(f.revTeam)         STATE.revTeam           = f.revTeam;
    if(f.revMonth)        STATE.revMonth          = f.revMonth;
    if(f.rmPerfMonth)     STATE.rmPerfMonth       = f.rmPerfMonth;
    if(f.rmPerfRefCold)   STATE.rmPerfRefCold     = f.rmPerfRefCold;
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
  const url = ($('#share-json-url').value || '').trim();
  if(!url){ alert('Please paste a raw JSON URL first.'); return; }
  const base = window.location.origin + window.location.pathname;
  $('#share-result-url').value = `${base}?json=${encodeURIComponent(url)}`;
  $('#share-result').style.display = 'block';
}

// ============ SETTINGS (GitHub + Google Sheets) ============
const SETTINGS_KEY = CONFIG.STORAGE_KEYS.SETTINGS;

function loadSettings(){
  try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }catch(e){ return {}; }
}
function saveSettings(s){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s || {}));
}

function ghRawUrl(s){
  if(!s.owner || !s.repo) return null;
  return `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${s.branch || 'main'}/${s.path || 'state.json'}?t=${Date.now()}`;
}

// Auto-detect GitHub Pages context from window.location so viewers
// don't need any per-user setup. Works for:
//   https://<owner>.github.io/<repo>/...   → owner/repo from URL
//   https://<owner>.github.io/             → user/org site, owner only (no repo)
function detectGhRawUrl(){
  try{
    const owner = window.location.hostname.match(/^([^.]+)\.github\.io$/)?.[1];
    if(!owner) return null;
    const repo = window.location.pathname.split('/').filter(Boolean)[0];
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
  const authHeaders = { Authorization: `token ${s.token}`, Accept: 'application/vnd.github+json' };
  showPublishModal('📤 Publishing…', 'Pushing your data to GitHub…');
  try{
    // Existing file's SHA, so the PUT updates rather than fails. A 404 just
    // means first publish; anything else is a real error worth surfacing.
    let sha = null;
    try{
      const meta = await fetch(`${apiUrl}?ref=${branch}`, { headers: authHeaders });
      if(meta.ok) sha = (await meta.json()).sha;
      else if(meta.status !== 404) throw new Error(`GitHub API: ${meta.status} ${await meta.text()}`);
    }catch(e){ /* 404 = file doesn't exist yet, that's OK */ }

    const jsonStr = JSON.stringify(buildExportData(), null, 2);
    const body = {
      message: `Update dashboard state (${new Date().toISOString()})`,
      content: btoa(unescape(encodeURIComponent(jsonStr))),
      branch,
    };
    if(sha) body.sha = sha;

    const put = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if(!put.ok) throw new Error(`GitHub API: ${put.status} — ${await put.text()}`);

    const pagesUrl = `https://${s.owner}.github.io/${s.repo}/`;
    showPublishModal('✅ Published!', `
      <p>Your dashboard data is now live on GitHub.</p>
      <p style="margin-top:10px"><strong>Pushed:</strong> <code>${path}</code> on branch <code>${branch}</code> (${(jsonStr.length / 1024).toFixed(1)} KB)</p>
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

// ---- guard: Cost Per Campaign live sync ----
// Cost drives every CAC and cost-per-lead figure on the dashboard. When the
// Google Sheet can't be read — most often because sharing was tightened, which
// comes back as a network error rather than an HTTP status — the app silently
// falls back to the snapshot bundled at build time. The numbers still render,
// just quietly out of date, which is the worst kind of wrong.
const COST_SYNC = { attempted: false, ok: false, error: null, rowsLoaded: 0, shapeWarning: null };

/** Minimum viable Cost Per Campaign sheet: a campaign-name column plus >=1 month column. */
function validateCostSheet(rows){
  if(!rows.length) return 'the sheet came back empty';
  const header = rows[0] || [];
  if(header.length < 2) return `the header row has only ${header.length} column(s); expected a campaign name plus at least one month`;
  if(rows.length < 2) return 'the sheet has a header but no campaign rows';
  return null;
}

/** @returns {{headline:string, detail:string, fix:string}|null} null when cost data is live and well-formed. */
function costSyncIssueReport(){
  if(!COST_SYNC.attempted || (COST_SYNC.ok && !COST_SYNC.shapeWarning)) return null;
  if(COST_SYNC.shapeWarning){
    return {
      headline: 'Cost Per Campaign sheet looks malformed',
      detail: `The live sheet loaded but ${COST_SYNC.shapeWarning}. Cost, CAC and cost-per-lead figures built from it may be wrong.`,
      fix: 'Open the Cost Per Campaign Google Sheet and confirm row 1 is a header (campaign name in column A, one column per month) with campaign rows beneath it.',
    };
  }
  return {
    headline: 'Showing bundled cost data, not the live sheet',
    detail: `The Cost Per Campaign sheet could not be read (${COST_SYNC.error}), so every Cost, CAC and cost-per-lead figure is coming from the snapshot bundled with the site and may be out of date.`,
    fix: 'Most often the sheet\'s sharing was tightened. Open it and set "Anyone with the link → Viewer", then reload. To point at a different sheet, use Settings → Google Sheets URL.',
  };
}

/**
 * Show or clear the cost-sync warning on the Cost Per Campaign tab.
 * Inserted as a sibling after #cpc-editor so renderCPC's own redraws
 * (which replace only the editor's contents) don't wipe it.
 */
function renderCostSyncWarning(){
  const editor = $('#cpc-editor');
  if(!editor || !editor.parentNode) return;
  const existing = $('#cpc-sync-warning');
  const report = costSyncIssueReport();
  if(!report){ existing?.remove(); return; }

  const html = `<div class="file-not-uploaded" id="cpc-sync-warning">` +
    `<span class="fnu-icon">&#9888;</span><strong>${escHtml(report.headline)}</strong><br>` +
    `${escHtml(report.detail)}<br><em>${escHtml(report.fix)}</em></div>`;
  if(existing) existing.outerHTML = html;
  else editor.insertAdjacentHTML('afterend', html);
}

async function syncCostFromSheets(silent){
  const s = loadSettings();
  // Prefer the user's own configured URL, otherwise fall back to CONFIG.DEFAULT_GS_URL
  // so every visitor gets live cost data — not just whoever set gsUrl in Settings.
  const url = s.gsUrl || CONFIG.DEFAULT_GS_URL;
  if(!url) return false;
  COST_SYNC.attempted = true;
  COST_SYNC.shapeWarning = null;
  try{
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    if(!rows.length || !rows[0].length) throw new Error('Sheet is empty');

    COST_SYNC.shapeWarning = validateCostSheet(rows);
    STATE.cost = rows;
    persistOverride(CONFIG.STORAGE_KEYS.COST, 'Cost Per Campaign', STATE.cost);
    COST_SYNC.ok = true;
    COST_SYNC.error = null;
    COST_SYNC.rowsLoaded = rows.length - 1;
    if(!silent) setSettingsStatus(`✓ Loaded ${rows.length - 1} campaign rows from Google Sheets`, 'ok');
    if(COST_SYNC.shapeWarning) console.warn(`[MIS] Cost Per Campaign sheet shape problem: ${COST_SYNC.shapeWarning}`);
    renderCostSyncWarning();
    return true;
  }catch(e){
    COST_SYNC.ok = false;
    COST_SYNC.error = e.message;
    if(!silent) setSettingsStatus(`✗ Sheets sync failed: ${e.message}`, 'err');
    // Silent path: still surface *something* — most failures on the default URL
    // are caused by the sheet being share-restricted (redirects to Google login,
    // which comes back as a network error rather than a status code).
    else console.warn('[MIS] Cost Per Campaign live sync failed — sheet may not be shared publicly. Falling back to bundled snapshot.', e);
    renderCostSyncWarning();
    return false;
  }
}

/** Blank-ish cell values that should read as 0 rather than NaN. */
const CSV_ZERO_VALUES = new Set(['', '-', '–', '—', 'N/A', 'NA']);

/** Indian-formatted numbers ("4,77,321"), currency symbols and dashes all become numbers. */
function csvCellToNumber(v){
  if(v == null) return 0;
  const s = String(v).trim();
  if(CSV_ZERO_VALUES.has(s.toUpperCase())) return 0;
  const n = +s.replace(/[,\s₹$]/g, '');
  return isNaN(n) ? 0 : n;
}

/**
 * Minimal RFC4180-ish CSV parser (quoted fields, escaped quotes, CRLF).
 * Column 0 stays text (campaign name); everything else is cast to a number.
 * @returns {Array<Array<string|number>>} Header row first.
 */
function parseCsv(text){
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i + 1] === '"'){ cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else if(c === '"'){ inQuotes = true; }
    else if(c === ','){ row.push(cur); cur = ''; }
    else if(c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
    else if(c !== '\r'){ cur += c; }
  }
  if(cur.length || row.length){ row.push(cur); rows.push(row); }

  return rows
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map((r, ri) => ri === 0
      ? r.map(c => String(c).trim())
      : r.map((v, ci) => ci === 0 ? String(v).trim() : csvCellToNumber(v)));
}

function setSettingsStatus(msg, kind){
  const el = $('#settings-status');
  if(!el) return;
  const color = { ok: '#16a34a', err: '#dc2626', warn: '#d97706' }[kind] || 'var(--muted)';
  el.innerHTML = `<span style="color:${color}">${msg}</span>`;
}
function setPublishStatus(msg, kind){ setSettingsStatus(msg, kind); }

const SETTINGS_FIELDS = {
  '#cfg-gh-owner':  'owner',
  '#cfg-gh-repo':   'repo',
  '#cfg-gh-branch': 'branch',
  '#cfg-gh-path':   'path',
  '#cfg-gh-token':  'token',
  '#cfg-gs-url':    'gsUrl',
};
const SETTINGS_DEFAULTS = { branch: 'main', path: 'state.json' };

function openSettingsModal(){
  const s = loadSettings();
  for(const [sel, key] of Object.entries(SETTINGS_FIELDS)){
    $(sel).value = s[key] || SETTINGS_DEFAULTS[key] || '';
  }
  setSettingsStatus('', '');
  $('#settings-modal').classList.add('active');
}
function closeSettingsModal(){ $('#settings-modal').classList.remove('active'); }

function saveSettingsFromModal(){
  const s = {};
  for(const [sel, key] of Object.entries(SETTINGS_FIELDS)){
    s[key] = $(sel).value.trim() || SETTINGS_DEFAULTS[key] || '';
  }
  saveSettings(s);
  setSettingsStatus('✓ Saved', 'ok');
}

function showPublishModal(title, html){
  $('#publish-title').textContent = title;
  $('#publish-body').innerHTML = html;
  $('#publish-modal').classList.add('active');
}
function closePublishModal(){ $('#publish-modal').classList.remove('active'); }

/** Load state from a URL, apply it, and render. Shared by the ?json= and GitHub paths. */
async function loadStateFromUrl(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  loadEmployeeFromStorage();
  loadCostFromStorage();
  loadRMMasterFromStorage();
  await applyPreloadedState(data);
  await syncCostFromSheets(true);
  renderAll();
}

async function tryAutoLoad(){
  const jsonUrl = new URLSearchParams(window.location.search).get('json');
  if(jsonUrl){
    try{
      await loadStateFromUrl(jsonUrl);
      return true;
    } catch(e){
      console.warn('Failed to load from ?json= param:', e);
      alert(`Could not load data from URL: ${e.message}`);
    }
  }

  // Try GitHub auto-load — settings first, then auto-detect from URL
  const ghUrl = ghRawUrl(loadSettings()) || detectGhRawUrl();
  if(ghUrl){
    console.log('[MIS] Attempting auto-load from:', ghUrl);
    try{
      await loadStateFromUrl(ghUrl);
      return true;
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
  const now = new Date();
  $('#json-filename').value = `marketing-mis-${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  $('#download-modal').classList.add('active');
  $('#json-filename').focus();
}
function closeDownloadModal(){ $('#download-modal').classList.remove('active'); }

// ============ SHARED HELPERS ============

/** Drop a localStorage override and the snapshot fingerprint saved alongside it. */
function clearOverride(storageKey){
  try{
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`${storageKey}_base`);
  }catch(e){ /* private mode / quota — nothing to clean up */ }
}

/**
 * Re-resolve FY and Plan Approval advisor names through the current RM Master
 * mapping. Must run after any edit to the mapping or to those datasets,
 * otherwise RM Performance silently attributes rows to stale names.
 */
function remapAdvisorNames(){
  if(STATE.fy?.length) STATE.fy.forEach(r => { r.mappedRM = mapRM(r.rmName); });
  if(STATE.pa?.length) STATE.pa.forEach(r => { r.mappedRM = mapRM(r.advisor); });
}

function downloadAsXlsx(rows2D, sheetName, fileName){
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows2D), sheetName);
  XLSX.writeFile(wb, fileName);
}

async function parseUploadedXlsx(file){
  const wb = await readWb(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
    { header: 1, defval: '', raw: true, blankrows: false });
  while(rows.length && rows[rows.length - 1].every(c => c === '' || c == null)) rows.pop();
  return rows;
}

function setStatus(sel, msg, kind = 'ok'){
  const el = $(sel);
  if(!el) return;
  const color = kind === 'err' ? 'var(--red)' : (kind === 'ok' ? 'var(--green)' : 'var(--muted)');
  el.innerHTML = `<span style="color:${color};font-weight:600">${escHtml(msg)}</span>`;
}

/** Full recalculation after a reference-table edit — every tab reflects the change. */
function recalcAll(){
  rebuildTeamMap();
  buildRMMasterLookup();
  remapAdvisorNames();
  detectMonths();
  initFilters();
  if(typeof initRevFilters === 'function') initRevFilters();
  renderAll();
}

// ---- guard: event bindings whose target is missing ----
// bindUI wires ~35 controls. Assigning .onclick on a missing element throws,
// which would abandon every binding after it — the page then looks fine but
// half its buttons do nothing. Recording and reporting instead keeps the rest
// wired and makes the breakage visible.
const _missingBindTargets = [];

/** Bind `handler` to `event` on `selector`, recording (not throwing) if absent. */
function bindEvent(selector, event, handler){
  const el = $(selector);
  if(!el){ _missingBindTargets.push(`${selector} (${event})`); return null; }
  el[event] = handler;
  return el;
}
const bindClick = (selector, handler) => bindEvent(selector, 'onclick', handler);

/** @returns {{headline:string, detail:string, fix:string}|null} null when every control bound. */
function bindingIssueReport(){
  if(!_missingBindTargets.length) return null;
  return {
    headline: `${_missingBindTargets.length} control(s) could not be wired up`,
    detail: `These elements are referenced by app-ui.js but don't exist in the page, so the ` +
            `matching buttons do nothing: ${_missingBindTargets.slice(0, 10).join(', ')}.`,
    fix: 'Either the element id changed in index.html or the markup was removed. Match the id in ' +
         'index.html to the selector in app-ui.js\'s bind* functions.',
  };
}

// ============ EVENT BINDING ============

function bindHeaderActions(){
  const fbLink = $('#feedback-link');
  if(fbLink){
    if(FEEDBACK_FORM_URL) fbLink.href = FEEDBACK_FORM_URL;
    else fbLink.style.display = 'none';
  }
  bindClick('#download-json-btn', openDownloadModal);
  bindClick('#confirm-download', downloadAsWebpage);
  bindClick('#cancel-download', closeDownloadModal);
  bindClick('#download-modal', e => { if(e.target.id === 'download-modal') closeDownloadModal(); });
  bindEvent('#json-filename', 'onkeypress', e => { if(e.key === 'Enter') downloadAsWebpage(); });
}

function bindSettingsAndPublish(){
  bindClick('#publish-gh-btn', publishToGitHub);
  bindClick('#settings-btn', openSettingsModal);
  bindClick('#cancel-settings', closeSettingsModal);
  bindClick('#save-settings-btn', saveSettingsFromModal);
  bindClick('#test-gs-btn', async () => {
    saveSettingsFromModal();
    setSettingsStatus('Fetching from Google Sheets…', '');
    if(await syncCostFromSheets(false)){ reconcileCostMonths(); renderAll(); }
  });
  bindClick('#settings-modal', e => { if(e.target.id === 'settings-modal') closeSettingsModal(); });
  bindClick('#publish-close-btn', closePublishModal);
  bindClick('#publish-modal', e => { if(e.target.id === 'publish-modal') closePublishModal(); });
}

function bindTabFilters(){
  // filter-month / filter-refcold / rev-*-filter-wrap / rmperf-* are custom
  // multi-select widgets, wired inside initFilters / initRevFilters / renderRMPerformance.
  bindEvent('#filter-table', 'onchange', e => { STATE.filterTable = e.target.value; renderPlatformStatus(); });
  bindEvent('#mtd-start', 'onchange', e => { STATE.mtdStart = +e.target.value || 1; renderMTD(); });
  bindEvent('#mtd-end', 'onchange', e => { STATE.mtdEnd = +e.target.value || 30; renderMTD(); });
  bindEvent('#mtd-refcold', 'onchange', e => { STATE.mtdFilterRefCold = e.target.value; renderMTD(); });
  bindEvent('#rev-lp-filter', 'onchange', e => { STATE.revLPFilter = e.target.value; renderRMRev(); });

  bindClick('#rmperf-recalc', () => {
    const status = $('#rmperf-recalc-status');
    try{
      remapAdvisorNames();
      detectMonths();
      initFilters();
      renderRMPerformance();
      if(status){
        status.innerHTML = `<span style="color:var(--green);font-weight:600">✓ Recalculated at ${new Date().toLocaleTimeString()}</span>`
          + ` — FY rows: ${STATE.fy.length}, Plan Approval rows: ${STATE.pa.length}`;
      }
    }catch(e){
      console.error(e);
      if(status) status.innerHTML = `<span style="color:var(--red);font-weight:600">Error: ${escHtml(e.message)}</span>`;
    }
  });
}

function bindRawDataTabs(){
  bindEvent('#raw-search', 'oninput', renderRawData);
  bindClick('#raw-clear-filters', () => { STATE.rawFilters = {}; renderRawData(); });
  bindClick('#raw-download-excel', downloadRawExcel);
  bindEvent('#b2b-search', 'oninput', renderB2BRawData);
  bindClick('#b2b-clear-filters', () => { STATE.b2bFilters = {}; renderB2BRawData(); });
}

function bindCostControls(){
  bindClick('#reset-cpc', () => {
    clearOverride(CONFIG.STORAGE_KEYS.COST);
    loadCostFromStorage();
    reconcileCostMonths();
    renderCPC(); renderCostSummary(); renderCplRm(); renderMTD();
  });
}

/**
 * Wire one reference table's Excel upload: parse, sanity-check the headers,
 * apply, persist, then recalculate every tab.
 * @param {{input:string, status:string, expect:Array<Array<string>>, warning:string,
 *          apply:Function, after?:Function, label:string}} cfg
 *   `expect` is a list of keyword groups; each group must match some header.
 */
function bindXlsxUpload(cfg){
  bindEvent(cfg.input, 'onchange', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    try{
      const rows = await parseUploadedXlsx(file);
      if(rows.length < 1) throw new Error('File has no rows');
      const headers = rows[0].map(c => (c || '').toString().toLowerCase());
      const headersLookRight = cfg.expect.every(group => headers.some(h => group.some(kw => h.includes(kw))));
      if(!headersLookRight && !confirm(cfg.warning)){ e.target.value = ''; return; }

      cfg.apply(rows);
      recalcAll();
      cfg.after?.();
      setStatus(cfg.status, `Uploaded ${rows.length - 1} ${cfg.label} from ${file.name} · all tabs recalculated`);
    }catch(err){
      console.error(err);
      setStatus(cfg.status, `Upload failed: ${err.message}`, 'err');
    }
    e.target.value = '';
  });
}

/** snapshot.js content with the current reference tables baked in, for committing to the repo. */
function exportSnapshot(){
  const snap = Object.assign({}, window.SNAPSHOT, {
    EMPLOYEE_REF: STATE.empref,
    'Cost Per Campaign': STATE.cost,
    'RM Master Mapping': STATE.rmMaster,
  });
  triggerDownload(new Blob([`window.SNAPSHOT = ${JSON.stringify(snap)};`], { type: 'text/javascript' }), 'snapshot.js');
}

function bindEmployeeEditor(){
  bindClick('#emp-add', () => {
    STATE.empref.push(['', '', '']);
    persistEmployee(); rebuildTeamMap(); renderEmployee();
  });
  bindClick('#emp-reset', () => {
    clearOverride(CONFIG.STORAGE_KEYS.EMPREF);
    loadEmployeeFromStorage(); rebuildTeamMap();
    renderEmployee(); renderAffectedByTeamChange();
  });
  bindClick('#emp-xlsx-download', () => {
    downloadAsXlsx(STATE.empref, 'EMPLOYEE_REF', 'EMPLOYEE_REF.xlsx');
    setStatus('#emp-status', `Downloaded ${STATE.empref.length - 1} rows at ${new Date().toLocaleTimeString()}`);
  });
  bindXlsxUpload({
    input: '#emp-xlsx-upload',
    status: '#emp-status',
    label: 'rows',
    expect: [['code'], ['team'], ['name']],
    warning: 'Headers don\'t look like Emp Code / Team / Name. Use anyway? (columns are read in order: col 1 = code, col 2 = team, col 3 = name)',
    apply: rows => { STATE.empref = rows; persistEmployee(); },
  });
  bindClick('#emp-recalc', () => {
    recalcAll();
    setStatus('#emp-status', `Recalculated at ${new Date().toLocaleTimeString()} — every tab refreshed`);
  });
  bindClick('#emp-export', exportSnapshot);
}

function bindRmMasterEditor(){
  bindClick('#rmm-xlsx-download', () => {
    downloadAsXlsx(STATE.rmMaster, 'RM Master Mapping', 'RM_Master_Mapping.xlsx');
    setStatus('#rmm-status', `Downloaded ${STATE.rmMaster.length - 1} rows at ${new Date().toLocaleTimeString()}`);
  });
  bindXlsxUpload({
    input: '#rmm-xlsx-upload',
    status: '#rmm-status',
    label: 'mappings',
    expect: [['source'], ['correct', 'canonical', 'rm name'], ['team']],
    warning: 'Headers don\'t look like Source Name / Correct RM Name / Team. Use anyway? (col 1 = source, col 2 = canonical, col 3 = team)',
    apply: rows => { STATE.rmMaster = rows; persistRMMaster(); },
    after: renderRMMaster,
  });
  bindClick('#rmm-recalc', () => {
    recalcAll();
    setStatus('#rmm-status', `Recalculated at ${new Date().toLocaleTimeString()} — every tab refreshed`);
  });
  bindClick('#rmm-add', () => {
    STATE.rmMaster.push(['', '', '']);
    persistRMMaster(); buildRMMasterLookup(); renderRMMaster();
  });
  bindClick('#rmm-reset', () => {
    clearOverride(CONFIG.STORAGE_KEYS.RM_MASTER);
    loadRMMasterFromStorage(); buildRMMasterLookup();
    remapAdvisorNames();
    renderRMMaster();
    if(typeof renderRMPerformance === 'function') renderRMPerformance();
  });
  bindClick('#rmm-export', exportSnapshot);
}

function bindUI(){
  bindHeaderActions();
  bindSettingsAndPublish();
  bindTabFilters();
  bindRawDataTabs();
  bindCostControls();
  bindEmployeeEditor();
  bindRmMasterEditor();

  const report = bindingIssueReport();
  if(report) console.warn(`[MIS] ${report.headline}: ${report.detail} Fix: ${report.fix}`);
}
