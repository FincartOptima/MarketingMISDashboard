// app-bootstrap.js — Mirror scrollbar, table info popups, app boot sequence.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

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
    desc: 'Cross-tabulation: rows grouped by platform name against created month. Each cell is a raw lead count. <strong>Platforms are dynamically read from uploaded data</strong> — new platforms are automatically included.',
    cols: 'platformName (dynamic, all unique values from data) · CTM (selected months)',
    source: 'RAW_DATA sheet'
  },
  'status-month-mapped': {
    title: 'Status Distribution · Mapped Teams',
    desc: 'Status × Month table restricted to leads where currentRmName maps to a named team (any team except SV) via EMPLOYEE_REF.',
    cols: 'currentRmName (non-SV team from EMPLOYEE_REF, via Team) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months) · LPM (selected months) · CM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'IN PROCESS count uses LPM (Lead In-Process Month). RAW_DATA FMONTH for non-converted leads = CTM (Created Month). Leads created before the selected month that moved to IN PROCESS within it are counted here but will not appear in a RAW_DATA filter on FMONTH.'
  },
  'status-month-sv': {
    title: 'Status Distribution · SV (Unmapped)',
    desc: 'Status × Month table restricted to leads where currentRmName is blank or not found in EMPLOYEE_REF — these default to the SV bucket.',
    cols: 'currentRmName (blank or not in EMPLOYEE_REF → SV) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months) · LPM (selected months) · CM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'IN PROCESS count uses LPM (Lead In-Process Month). RAW_DATA FMONTH for non-converted leads = CTM (Created Month). Leads created before the selected month that moved to IN PROCESS within it are counted here but will not appear in a RAW_DATA filter on FMONTH.'
  },
  'platform-status': {
    title: 'Platform × Status Breakdown',
    desc: 'Lead counts by platform and status. <strong>Platforms are dynamically read from uploaded data</strong> — new platforms are automatically included. CONVERTED uses CM, IN PROCESS uses LPM, all other statuses (ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD) use CTM.<br><strong>Same Month:</strong> status column matches selected month(s) AND CTM matches.<br><strong>Any Month:</strong> status column matches selected month(s) but CTM outside (only applies to CONVERTED/IN PROCESS; other statuses will be 0 since their column IS CTM).<br><strong>Default:</strong> status column matches selected month(s).',
    cols: 'platformName (dynamic, all unique values) · leadStatus · CTM (Created Month, used for ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CM (Converted Month, for CONVERTED) · LPM (Lead In-Process Month, for IN PROCESS)',
    source: 'RAW_DATA sheet',
    note: 'FMONTH and LSM are not used in this table. For ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD — only CTM and leadStatus are used. AnyMonth mode only affects CONVERTED (CM) and IN PROCESS (LPM) since for other statuses the filter column is CTM itself.'
  },
  'team-perf': {
    title: 'Team Performance Matrix',
    desc: 'Lead and status counts per team. Use the <strong>CurrentRM / FirstRM toggle</strong> to switch how team assignment works:<br>• <strong>CurrentRM</strong> (default): team is determined by the current RM holding the lead (currentRmName → EMPLOYEE_REF).<br>• <strong>FirstRM</strong>: team is determined by the first RM originally assigned (firstRmName → EMPLOYEE_REF).<br>Total Leads uses CTM. Each status uses its own event-date column.<br><br>Use the <strong>Team filter</strong> to drill into a single team: the table switches to one row per RM in that team, with the same status columns.',
    cols: 'currentRmName or firstRmName (→ team, toggled) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months, for Total Leads / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · LPM (selected months, for IN PROCESS) · CM (selected months, for CONVERTED)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'IN PROCESS uses LPM; Total Leads uses CTM — so status columns may not sum to Total Leads. Switching to FirstRM mode shows the original team assignment before any transfers.'
  },
  'workshop-status': {
    title: 'Workshop Status Distribution',
    desc: 'Status breakdown for BTL Marketing workshop leads, grouped by the person running the landing page. Landing pages containing "-D" are Devanshi\'s, "-H" are Himanshi\'s, "-S" are Shreya\'s; any BTL Marketing landing page matching none of these falls into Unclassified. Honors the global Month, Ref+Cold, and Status filters. <strong>Lead Conversion Rate</strong> = CONVERTED ÷ Total. <strong>Lead (In Process + Converted) Rate</strong> = (CONVERTED + IN PROCESS) ÷ Total.',
    cols: 'platformName (= BTL Marketing only) · landingPage (substring match: -D / -H / -S) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM / LPM / CM (selected months, per status)',
    source: 'RAW_DATA sheet'
  },
  'rm-transfer': {
    title: 'FirstRM to CurrentRM Transfer',
    desc: 'Shows leads that were transferred from one RM to another (where firstRmName ≠ currentRmName). The summary row shows how many leads moved <strong>out</strong> of each team (based on firstRmName\'s team) and lists the top destination teams.<br><br>Click a team row to expand RM-level details: the original RM (FirstRM), campaign, transfer count, destination RM (CurrentRM), destination team, and lead status.',
    cols: 'firstRmName (→ source team via EMPLOYEE_REF) · currentRmName (→ destination team via EMPLOYEE_REF / Team column) · Campaign Name · leadStatus · CTM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'Only leads where firstRmName ≠ currentRmName (case-insensitive) are counted. If both are blank, the lead is excluded. Honors global Month and Ref/Cold filters.'
  },
  'campaign-team': {
    title: 'Leads per Campaign · Team × Campaign',
    desc: 'Shows how many leads were assigned to which team from marketing campaigns. Lead counts cross-tabulated by team (from currentRmName) and campaign. CTM used to apply the month filter.',
    cols: 'currentRmName (→ team name from EMPLOYEE_REF) · Campaign Name (all campaign values) · CTM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet'
  },
  'income': {
    title: 'Income Segment Analysis',
    desc: 'Leads, Converted, In Process, and Quality Leads (Converted + In Process) by income band. <strong>Income bands are dynamically read from uploaded data</strong> — new bands are automatically included. Known bands appear in preferred order, followed by any new values sorted alphabetically. Leads filtered by CTM; Converted by CM; In Process by LPM.',
    cols: 'annualIncome (dynamic, all unique values from data) · CTM (selected months) · leadStatus (CONVERTED) with CM (selected months) · leadStatus (IN PROCESS) with LPM (selected months)',
    source: 'RAW_DATA sheet',
    note: 'Leads column uses CTM; In Process uses LPM; Converted uses CM. A lead created before the selected month that moved to IN PROCESS within it will appear in the In Process column but not in Leads — so Leads and Quality Leads counts are on different bases and will not add up directly.'
  },
  'cost-summary': {
    title: 'Cost Summary by Campaign',
    desc: 'Campaign costs from the CPC tab summed over selected months, with CPL and CPQL calculated. <strong>Campaigns are dynamically read from the Cost Per Campaign data</strong> — new campaigns are automatically included. Quality Leads = rows where leadStatus is CONVERTED or IN PROCESS, filtered by CTM.',
    cols: 'Campaign Name (dynamic, from Cost Per Campaign tab) · CTM (selected months) · leadStatus (CONVERTED / IN PROCESS, for Quality Leads count)',
    source: 'RAW_DATA sheet, Cost Per Campaign tab'
  },
  'cpl-rm': {
    title: 'Cost Per Lead · per Team / RM',
    desc: 'Campaign costs split proportionally to each RM based on their share of that campaign\'s leads. Total Leads, Total Cost, and Quality Leads all use <strong>currentRmName</strong> (the RM currently holding the lead). CPL = Total Cost / Total Leads; CPQL = Total Cost / Quality Leads.',
    cols: 'currentRmName (for Total Leads, Total Cost &amp; Quality Leads) · Campaign Name (all campaigns) · CTM (selected months) · leadStatus (CONVERTED / IN PROCESS, for Quality Leads)',
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
    cols: 'RAW_DATA — currentRmName (→ team, via Team column) / CTM (selected months) / leadStatus (CONVERTED) with CM / leadStatus (IN PROCESS) with LPM | FY Sheet — Month (selected months) / mappedRM (all RMs) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total | EMPLOYEE_REF — currentRmName (→ team name)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input, EMPLOYEE_REF sheets'
  },
  'rmperf-detail': {
    title: 'Team × RM Detailed Breakdown',
    desc: 'Same pipeline metrics as the Summary table but per individual RM. currentRmName is resolved to a canonical name via RM Master Mapping before matching to FY / Revenue Input.',
    cols: 'RAW_DATA — currentRmName (all RMs) / CTM (selected months) / leadStatus (CONVERTED) with CM / leadStatus (IN PROCESS) with LPM | FY Sheet — Month (selected months) / mappedRM (all RMs) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total | RM Master Mapping — source name (→ canonical RM name)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input, EMPLOYEE_REF, RM Master Mapping sheets'
  },
  'bdperf': {
    title: 'BD Performance — Accountability Tracker',
    desc: 'Each rep\'s leads live in a sheet named "&lt;Person&gt; Q&lt;N&gt;" (e.g. "Himani Q1") in the BD Accountability Tracker upload — new quarters are picked up automatically once a sheet with that name exists, no code change needed. Only <strong>Date Assigned</strong>, <strong>Email</strong>, and <strong>GMeet Joined?</strong> are read from the tracker itself.<br><br>Every lead is matched to its B2C record by email (BD tracker) &lt;-&gt; userId (B2C — despite the name, it\'s the client\'s email, and is unique across the file). For a matched lead, <strong>Stage</strong>, <strong>RM</strong>, <strong>Team</strong>, and <strong>Month</strong> all come from that B2C record (Stage uses the same CM-presence CONVERTED rule as the rest of the dashboard, not just leadStatus). A lead with no match (not yet in the CRM, or an email typo) is labeled "(Not in CRM)" under team SV, excluded from the Stage breakdown, and its Month falls back to the tracker\'s own Date Assigned.<br><br>By default the table shows one row per <strong>Team</strong>; selecting a single team in the Team filter drills down to one row per <strong>RM</strong> within it — same pattern as the Dashboard tab\'s Team Performance Matrix. <strong>Person</strong> (which BD rep sourced the lead) and <strong>Month</strong> are independent filters layered on top and also narrow the two charts above the table.<br><br>Conv. Rate = CONVERTED ÷ Total. GMeet Joined counts rows marked "Yes" only — the tracker also uses "Pending" and blank, both excluded from this Yes-only count (and from the pie chart).',
    cols: 'Sheet name (→ Person) · Email (→ matched to B2C userId) · GMeet Joined? (Yes/No/Pending) · Date Assigned (Month fallback for unmatched leads) · B2C leadStatus/CM (→ Stage) · B2C currentRmName (→ RM) · B2C Team (→ Team) · B2C CTM (→ Month)',
    source: 'BD Accountability Tracker file, RAW_DATA (B2C) sheet, RM Master Mapping sheet',
    note: 'B2C\'s currentRmName isn\'t reliably canonical on its own (casing varies lead to lead) so it\'s passed through the same RM Master Mapping used dashboard-wide before display.'
  },
  'lp-status': {
    title: 'Landing Page × Status Breakdown',
    desc: 'Lead counts by landing page and status, filtered by campaign. <strong>Landing pages are dynamically read from uploaded data and mapped to their Campaign Name.</strong> CONVERTED uses CM, IN PROCESS uses LPM, all other statuses use CTM.<br><strong>Same Month:</strong> status column matches selected month(s) AND CTM matches.<br><strong>Any Month:</strong> status column matches selected month(s) but CTM outside (only applies to CONVERTED/IN PROCESS).<br><strong>Default:</strong> status column matches selected month(s).',
    cols: 'landingPage (dynamic) · Campaign Name (mapped from landing page rows) · leadStatus · CTM (Created Month, used for ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CM (Converted Month, for CONVERTED) · LPM (Lead In-Process Month, for IN PROCESS)',
    source: 'RAW_DATA sheet',
    note: 'FMONTH and LSM are not used in this table. Each landing page is mapped to the most common Campaign Name among its rows. For ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD — only CTM and leadStatus are used. AnyMonth only affects CONVERTED (CM) and IN PROCESS (LPM).'
  },
  'mtd': {
    title: 'MTD Performance — Month-to-Date by Campaign',
    desc: 'Shows month-to-date lead activity for the last 3 months (from Apr-2026 onward), broken down by campaign. <strong>Campaigns are dynamically read from uploaded data</strong> — new campaigns are automatically included.<br><br>For each campaign and month, it counts:<br>• <strong>Leads (MTD)</strong> — leads created within the selected day window (by createdDate).<br>• <strong>Converted (MTD)</strong> — leads with status CONVERTED whose convertedDate falls within the day window.<br>• <strong>In Process (MTD)</strong> — leads with status IN PROCESS whose leadInProcessDate falls within the day window.<br>• <strong>Qualified (MTD)</strong> — Converted + In Process.<br><br><strong>Projected</strong> columns extrapolate the MTD count to a full 30-day month: <code>MTD ÷ window days × 30</code>.',
    cols: 'Campaign Name (dynamic, all unique values) · createdDate (day window filter for Leads) · convertedDate (day window filter for Converted) · leadInProcessDate (day window filter for In Process) · leadStatus (CONVERTED / IN PROCESS)',
    source: 'RAW_DATA sheet',
    note: 'The day window (e.g. Day 1 to Day 11) filters on the day-of-month portion of each date field. Ref+Cold filter controls which campaigns appear: Include = all, Exclude = hides Referral and Cold Data, Only Referral = shows only Referral.'
  },
  'rmrev': {
    title: 'RM Revenue',
    desc: 'Revenue data from Revenue Input filtered by month. Revenue >15K = CLIENT TYPE "REVENUE BASED"; Transactional = CLIENT TYPE "NOT ELIGIBLE". RM names normalised via RM Master Mapping.',
    cols: 'RM (all RM names) · OLD CHECK (selected months) · CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) · Total (revenue amount) · LP (Referral / campaign category values)',
    source: 'Revenue Input sheet, RM Master Mapping sheet'
  },
};
CONFIG.TABLE_INFO = TABLE_INFO;

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
  // A self-contained "Download Webpage" export embeds its own data — use it directly
  // instead of fetching from the repo.
  if(window.__PRELOADED_STATE__){
    try{
      loadEmployeeFromStorage();
      loadCostFromStorage();
      loadRMMasterFromStorage();
      await applyPreloadedState(window.__PRELOADED_STATE__);
      await syncCostFromSheets(true);
      renderAll();
      showApp();
      return;
    }catch(e){
      console.error('Failed to apply preloaded state:', e);
    }
  }
  await loadAllFromRepo();
}
if(document.readyState === 'loading'){
  window.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
