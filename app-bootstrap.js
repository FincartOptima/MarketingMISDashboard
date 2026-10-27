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
    title: 'Category × Status Breakdown',
    desc: 'Lead counts by category and status. <strong>Category Names are dynamically read from uploaded data</strong> — new categories are automatically included. CONVERTED uses CM, IN PROCESS uses LPM, all other statuses (ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD) use CTM.<br><strong>Same Month:</strong> status column matches selected month(s) AND CTM matches.<br><strong>Any Month:</strong> status column matches selected month(s) but CTM outside (only applies to CONVERTED/IN PROCESS; other statuses will be 0 since their column IS CTM).<br><strong>Default:</strong> status column matches selected month(s).<br><br>This table (like every other table on the Dashboard tab) also honors the <strong>Lead Head</strong> filter in the header above — it filters by the B2C file\'s leadHead column (options read dynamically from the uploaded data), defaults to <strong>Primary</strong> so an Additional/secondary-applicant row on the same lead isn\'t double-counted, and can be set to All to remove the restriction.',
    cols: 'Campaign Name / Category Name (dynamic, all unique values — the source\'s "Category Name" and "Campaign Name" columns map onto the same field) · leadHead (Lead Head filter, in the header) · leadStatus · CTM (Created Month, used for ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CM (Converted Month, for CONVERTED) · LPM (Lead In-Process Month, for IN PROCESS)',
    source: 'RAW_DATA sheet',
    note: 'FMONTH and LSM are not used in this table. For ASSIGNED, RE-ASSIGNED, FOLLOW UP, ON HOLD, DEAD — only CTM and leadStatus are used. AnyMonth mode only affects CONVERTED (CM) and IN PROCESS (LPM) since for other statuses the filter column is CTM itself.'
  },
  'team-perf': {
    title: 'Team Performance Matrix',
    desc: 'Lead and status counts per team. Use the <strong>CurrentRM / FirstRM toggle</strong> to switch how team assignment works:<br>• <strong>CurrentRM</strong> (default): team is determined by the current RM holding the lead (currentRmName → EMPLOYEE_REF).<br>• <strong>FirstRM</strong>: team is determined by the first RM originally assigned (firstRmName → EMPLOYEE_REF).<br><strong>Total Leads</strong> is the sum of the status columns — every lead with a status event in the selected period (CONVERTED by CM, IN PROCESS by LPM, the rest by CTM). Each status uses its own event-date column, so every row adds up and Conv. Rate (CONVERTED ÷ Total Leads) can never exceed 100%. A <strong>Grand Total</strong> row ties the table to the source file.<br><br>Use the <strong>Team filter</strong> to drill into a single team: the table switches to one row per RM in that team, with the same status columns.',
    cols: 'currentRmName or firstRmName (→ team, toggled; RM Master Mapping aliases resolved, names trimmed) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM (selected months, for ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · LPM (selected months, for IN PROCESS) · CM (selected months, for CONVERTED)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'Total Leads can exceed the Generated Leads KPI and the Campaign × Team table: those count leads CREATED in the period, whereas this counts every lead with a status event in it (an older lead converted this month is in CONVERTED, so it is in Total Leads too). The footnote under the table shows the exact difference. FirstRM mode shows the original team assignment before any transfers; RMs missing from EMPLOYEE_REF land on SV and are listed in the Data Health panel.'
  },
  'workshop-status': {
    title: 'Workshop Status Distribution',
    desc: 'Status breakdown for BTL Marketing workshop leads, grouped by the person running the landing page. Landing pages containing "-D" are Devanshi\'s, "-H" are Himanshi\'s, "-S" are Shreya\'s; any BTL Marketing landing page matching none of these falls into Unclassified. Honors the global Month, Ref+Cold, and Status filters. <strong>Lead Conversion Rate</strong> = CONVERTED ÷ Total. <strong>Lead (In Process + Converted) Rate</strong> = (CONVERTED + IN PROCESS) ÷ Total.',
    cols: 'platformName (= BTL Marketing only) · landingPage (substring match: -D / -H / -S) · leadStatus (CONVERTED / IN PROCESS / ASSIGNED / RE-ASSIGNED / FOLLOW UP / ON HOLD / DEAD) · CTM / LPM / CM (selected months, per status)',
    source: 'RAW_DATA sheet'
  },
  'rm-transfer': {
    title: 'FirstRM to CurrentRM Transfer',
    desc: 'Shows leads that were transferred from one RM to another (where firstRmName ≠ currentRmName). The summary row shows how many leads moved <strong>out</strong> of each team (based on firstRmName\'s team) and lists the top destination teams.<br><br>Click a team row to expand RM-level details: the original RM (FirstRM), campaign, transfer count, destination RM (CurrentRM), destination team, and lead status.<br><br>Three blocks below it count <strong>every</strong> lead, not just the transferred ones, split into <strong>Same Team</strong> (the lead\'s current Team still equals firstRmName\'s team — includes a handoff between two RMs on the same team, deliberately looser than "same RM" per a 2026-09 comparison against a manually-built reference pivot), <strong>Transferred to SV</strong> (current Team is SV and it isn\'t Same Team — covers every generic placeholder currentRmName under that team, e.g. "Support Wealth Manager", not just a literal currentRmName of "SV"), and <strong>Transferred to another team</strong> (anything else): first the overall totals, then the same split by <strong>Category Name</strong> (Branding, Corporate, Google, Social Media, etc.), then by the <strong>originating team</strong> (firstRmName\'s team, same "From Team" grouping as the main table). <strong>Retained %</strong> = Same Team ÷ Total for that row. These three blocks also treat "All Months" as literally every lead ever (no Apr-2026 cutoff), unlike the main table above and every other month-wise table on this dashboard.',
    cols: 'firstRmName (→ source team via EMPLOYEE_REF) · currentRmName (→ destination team via EMPLOYEE_REF / Team column) · Campaign Name · leadStatus · CTM (selected months)',
    source: 'RAW_DATA sheet, EMPLOYEE_REF sheet',
    note: 'Main table: only leads where firstRmName ≠ currentRmName (case-insensitive) are counted; if both are blank, the lead is excluded. Honors global Month, Ref+Cold, Status, and Lead Head filters. The three summary blocks below it honor Ref+Cold/Status/Lead Head but not the FY-scoped Month convention — see above.'
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
  'stagnant-inprocess': {
    title: 'Stagnant In-Process Leads',
    desc: 'Every lead currently <strong>In Process</strong> (same rule as everywhere else: leadStatus is IN PROCESS and it hasn\'t since converted) whose <strong>leadInProcessDate</strong> is more than 2 calendar months before today — i.e. it\'s been sitting with no resolution for over 2 months. <strong>Overview</strong> gives the total plus a severity split (2–3 / 3–6 / 6+ months). <strong>By Team</strong> breaks the same list down by the <strong>current RM\'s</strong> team — whoever is sitting on the lead now, not whoever first touched it — so it stays consistent with By Client and the By Team — Full Breakdown table below it. Leads parked with the Support Wealth Manager pool show under <strong>SV</strong>, which is where they actually are. <strong>By Client</strong> lists every one of them, 10 per page — use Download Excel to get the complete list in one file regardless of which page you\'re on.',
    cols: 'leadStatus (IN PROCESS) · CM (must be blank — excludes leads that have since converted) · leadInProcessDate (compared against today minus 2 months) · currentRmName → Team (via STATE.teamMap) · platformName · Campaign Name',
    source: 'RAW_DATA sheet',
    note: 'Deliberately ignores the Month/Ref+Cold/Status/Lead Head filters — this is a point-in-time "who needs follow-up right now" list, always measured against today\'s real date, not a historical breakdown. The <strong>By Client</strong> table has its own <strong>Team</strong> filter (default All) that narrows just that table and its Excel download — Overview and By Team above it always cover every team regardless of this filter.'
  },
  'stagnant-team-summary': {
    title: 'Stagnant In-Process Leads — By Team, Full Breakdown',
    desc: 'Three strictly nested lead pools, all read fresh from RAW_DATA, all ignoring the dashboard\'s Month/Ref+Cold/Status/Lead Head filters (same as the rest of this section — a real-time snapshot, not historical): <strong>Total Leads</strong> is every lead for that team, no conditions. <strong>Total In-Process Leads</strong> adds one condition (leadStatus = IN PROCESS and no Converted Month, same CM-presence rule used dashboard-wide). <strong>Stagnant In-Process Leads</strong> adds one more (leadInProcessDate older than 2 months) — the exact same list as the "By Team" table above it. Because each pool is the previous one with an extra condition layered on, Stagnant is always ≤ In-Process is always ≤ Total for every single team, and every column\'s team rows sum exactly to the Grand Total row — there\'s no separate reconciliation step needed.<br><br>Team here is the <strong>current RM\'s</strong> team (via currentRmName → STATE.teamMap) — all three pools (Total Leads, Total In-Process, Stagnant) use this same lookup, and it matches the "By Team" and "By Client" tables above, so they never disagree about which team a lead belongs to.<br><br><strong>% Stagnant of In-Process</strong> = Stagnant ÷ Total In-Process (how much of that team\'s current in-process book is stuck). <strong>% Stagnant of Total Leads</strong> = Stagnant ÷ Total Leads (how much of that team\'s entire lead book is stuck in-process).',
    cols: 'leadStatus, CM (CM-presence rule), leadInProcessDate (vs. today minus 2 months), currentRmName → Team (via STATE.teamMap) — all from RAW_DATA',
    source: 'RAW_DATA sheet',
    note: 'Verified: summing every team\'s Total Leads/Total In-Process/Stagnant In-Process columns exactly equals the Grand Total row\'s corresponding figure, and Stagnant ≤ In-Process ≤ Total holds for every team — checked directly against the live data, not just by construction.'
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
    desc: 'Team-level aggregation across the full pipeline: Leads, Quality, Plans, Revenue >15K, Transactional, Revenue. <strong>Total Leads here means leads CREATED in the selected period</strong> (the top of the funnel), whereas the Dashboard Team Performance Matrix counts every lead with a status event in the period — so the two totals differ by the older leads converted / taken in-process in the period.',
    cols: 'RAW_DATA — currentRmName (→ team, via Team column) / CTM (selected months) / leadStatus (CONVERTED) with CM / leadStatus (IN PROCESS) with LPM | FY Sheet — Month (selected months) / mappedRM (all RMs) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total | EMPLOYEE_REF — currentRmName (→ team name)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input, EMPLOYEE_REF sheets'
  },
  'rmperf-detail': {
    title: 'Team × RM Detailed Breakdown',
    desc: 'Same pipeline metrics as the Summary table but per individual RM. currentRmName is resolved to a canonical name via RM Master Mapping before matching to FY / Revenue Input.',
    cols: 'RAW_DATA — currentRmName (all RMs) / CTM (selected months) / leadStatus (CONVERTED) with CM / leadStatus (IN PROCESS) with LPM | FY Sheet — Month (selected months) / mappedRM (all RMs) | Plan Approval — Month (selected months) / mappedRM (all RMs) / clientType (NEW) | Revenue Input — RM (all RMs) / OLD CHECK (selected months) / CLIENT TYPE (REVENUE BASED / NOT ELIGIBLE) / Total | RM Master Mapping — source name (→ canonical RM name)',
    source: 'RAW_DATA, FY 2026-2027, Plan Approval, Revenue Input, EMPLOYEE_REF, RM Master Mapping sheets'
  },
  'bd2': {
    title: 'BD Performance — Calls to Conversion',
    desc: 'The BD funnel end to end: calls, meetings, who joined, and where those clients stand in Workpoint (the B2C file).<br><br><strong>Meetings</strong> are the leads in the BD tracker\'s "&lt;Person&gt; Q&lt;N&gt;" sheets, counted in the month of their <strong>Date Assigned</strong>; a lead logged twice counts as two meetings, as in the original Call Flow. <strong>Joined</strong> means GMeet Joined? is Yes.<br><br><strong>Mapping to B2C uses the client\'s email only</strong> (tracker Email ↔ B2C userId). A lead whose email is not found — a typo, a lead not in the CRM, or one created before the period the uploaded B2C file covers — is grouped as <strong>Unmatched</strong>: its own team, its own platform, and its own status.<br><br><strong>Filters.</strong> Month and Person apply everywhere. Team, RM and Platform (the B2C platform) apply to every lead-based figure. A lead\'s <strong>RM</strong> is its <strong>first RM</strong> in B2C and its <strong>Team</strong> is that RM\'s team; the one exception is a lead whose first RM is on the BD team (Himani, Suhani, Kajal, Kunal, Srishti), which takes its <strong>current RM</strong> and that RM\'s team instead. Choose an RM in the RM filter (type to search; the list narrows to the chosen Team) to see that RM\'s flow. The BD Daily Log has no team, RM or platform, so Calls Made / Connected / CNP show "—" while any of them is set rather than a number that ignores your filter. Unmatched can be picked as a Team, an RM and a Platform, so those leads are not lost when you filter.',
    cols: 'Tracker: Person (sheet name), Email, Date Assigned, GMeet Joined? · BD Daily Log: BD Name, Date, Total Calls, Calls Connected, CNP · B2C: userId (email), leadStatus, Converted Month (CM), Team, platformName',
    source: 'BD Accountability Tracker file (tracker sheets + BD Daily Log) and the RAW_DATA (B2C) sheet',
    note: 'The "Download the meeting list" link gives one line per meeting with its B2C match and status. The ↓ Excel button in the header downloads the RM-wise flow (one row per RM, with a Grand Total), the same meetings, and a Selection sheet with the filters used and a tie-out, so any number can be checked against the B2C file.'
  },
  'bd2-health': {
    title: 'BD data health & flow checks',
    desc: 'This panel watches the data behind the tab and the arithmetic of the flow, and says how to fix what it finds. A count on the tab button shows the errors and warnings from any tab.<br><br><strong>Data issues</strong> describe the whole Google Sheet and ignore the filters, so none can hide. <strong>Error</strong> = figures on the tab are missing or wrong now (a tracker column whose header the dashboard no longer recognises, no B2C data, the bundled snapshot instead of live data). <strong>Warning</strong> = rows that need fixing (missing or unreadable dates, blank or unmatched emails, GMeet Joined? not logged, a first RM missing from EMPLOYEE_REF, BD Daily Log rows that do not add up or are out of date, an old B2C file). <strong>Note</strong> = worth knowing (repeat entries, a day with two Daily Log rows). Each item says what is wrong, what it does to the figures and how to fix it. <em>Download the rows</em> lists the exact rows (the Google Sheet tab and, where the backend provides it, the row number; the BD rep, the email and what to do), and <em>Download every row to fix</em> gives them all with a How to fix sheet. The sheet is re-read at most every 5 minutes, so reload the page after fixing it.<br><br><strong>Flow checks</strong> prove the arithmetic, for the current selection and for the whole sheet: Meetings Scheduled = Joined + Not Joined + Pending + Not Logged; Meetings Joined = In Process + Converted + Other States + Unmatched; the BD-rep, Team and RM tables each add up to their Grand Total and to the flow; Mapped + Unmapped = Clients and Clients + repeat entries = Meetings; the status of the joined meetings is re-counted straight from the B2C file and must match; and every meeting can be reached through the Team, Platform and Person filters. A failed check means the tab is calculating wrongly, not that a sheet needs fixing.',
    cols: 'Tracker: Date Assigned, Email, GMeet Joined? (and the tab each row is on) · BD Daily Log: Date, BD Name, Total Calls, Calls Connected, CNP · B2C: userId (email), leadStatus, Converted Month, firstRmName, currentRmName, Team, createdDate',
    source: 'BD Accountability Tracker file (tracker tabs + BD Daily Log), the RAW_DATA (B2C) sheet, EMPLOYEE_REF and RM MASTER MAPPING'
  },
  'bd2-flow': {
    title: 'Call Flow — Calls to Conversion',
    desc: '<strong>Total Calls Made</strong> splits into <strong>Calls Connected</strong> and <strong>CNP</strong> (BD Daily Log). <strong>Meetings Scheduled</strong> comes from the tracker and splits into <strong>Joined</strong>, <strong>Not Joined</strong>, <strong>Pending</strong> and <strong>Not Logged</strong> (no GMeet value entered); those four always add up to Meetings Scheduled.<br><br>The bottom row continues the flow from <strong>Meeting Joined</strong>: <strong>In Process</strong> = the client\'s B2C status is IN PROCESS; <strong>Converted</strong> = the client has a Converted Month in B2C (the same rule used across the dashboard); <strong>Other States</strong> = Assigned, Re-assigned, Follow Up, On Hold or Dead; <strong>Unmatched</strong> = email not found in B2C. Those four add up to Meeting Joined, and each card shows its share of the meetings joined.<br><br>"Meetings ÷ Calls Connected" compares two different sheets, so treat it as directional. It is left out while a Team, RM or Platform filter is set, since the call side cannot be filtered by them.',
    cols: 'Calls: BD Daily Log · Meetings, GMeet Joined?: tracker · In Process, Converted: B2C leadStatus / Converted Month, matched by email',
    source: 'BD Accountability Tracker file and the RAW_DATA (B2C) sheet',
    note: 'A client logged twice in the tracker counts once per entry here, like every Call Flow figure, so the cards always add up exactly.'
  },
  'bd2-rep': {
    title: 'BD Employee-wise Flow',
    desc: 'The flow, one row per BD rep (the tracker sheet owner): <strong>Calls Made</strong> and <strong>Calls Connected</strong> from the BD Daily Log, <strong>Meetings Scheduled</strong> and <strong>Meetings Joined</strong> from the tracker, then the joined meetings split by Workpoint status — <strong>In Process</strong>, <strong>Converted</strong>, <strong>Other States</strong>, <strong>Unmatched</strong> — which add up to Meetings Joined. The Grand Total row is the whole selection. Calls show "—" while a Team or Platform filter is set.<br><br><strong>Joined %</strong> = Joined ÷ Meetings Scheduled. <strong>In Process %</strong> and <strong>Converted %</strong> are of <strong>Meetings Joined</strong>.',
    cols: 'Person (tracker sheet name) / BD Name (BD Daily Log) — joined by name · Total Calls, Calls Connected · Date Assigned, GMeet Joined? · B2C status and Converted Month by email',
    source: 'BD Accountability Tracker file (tracker sheets + BD Daily Log) and the RAW_DATA (B2C) sheet',
    note: 'A rep with calls but no tracker rows (or the reverse) still appears, with 0 on the side that is missing.'
  },
  'bd2-team': {
    title: 'Team-BD Performance',
    desc: 'The same flow by <strong>team</strong>, shown as one small flow per team and then as a table. A lead\'s team is the team of its <strong>first RM</strong> in B2C, matched by email, so it stays with the team that first handled the lead even if the lead is later moved (for example to the Support Wealth Manager pool). The exception: a lead whose first RM is on the <strong>BD team</strong> has no real owner team yet, so it takes the team of its <strong>current RM</strong>. Leads not found in B2C are grouped as <strong>Unmatched</strong>. The note above the flows says how many meetings were assigned each way, and the meeting list download shows the first RM, current RM and basis for every meeting. An <strong>RM</strong> follows the same rule, and the RM filter narrows this view to that RM\'s meetings.<br><br>Calls are not split by team in the BD Daily Log, so this view starts at Meetings Scheduled. Bars in each card are scaled to that team\'s own meetings, so the shape of the funnel is comparable between teams.',
    cols: 'Tracker: Email, Date Assigned, GMeet Joined? · B2C: userId (email), Team, leadStatus, Converted Month',
    source: 'BD Accountability Tracker file and the RAW_DATA (B2C) sheet, EMPLOYEE_REF (for B2C Team)',
    note: 'A first RM whose name is not in EMPLOYEE_REF cannot be placed in a team, so it is counted under SV, the dashboard-wide default; the note above the flows counts any such meetings.'
  },
  'bd2-mapping': {
    title: 'Google Sheet Clients — Mapped to Workpoint B2C',
    desc: 'Every client in the BD tracker (the Google Sheet) is matched to the Workpoint B2C file by <strong>email only</strong> (tracker Email ↔ B2C userId). A client is one distinct email, so a client logged twice counts once; a row with no email cannot be matched and counts as its own unmapped client.<br><br><strong>Mapped</strong> = the email was found in B2C. <strong>Unmapped</strong> = it was not: a typo (even one character), a blank email, a lead that is not in the CRM, or a lead created before the period the uploaded B2C file covers. Unmapped clients have no B2C record, so no RM, team, platform or status — they are grouped as <strong>Unmatched</strong> across this tab, and their meetings still count in the flow.<br><br>The three cards follow the filters at the top; the line under them is always the whole sheet. The table gives the same counts per BD rep, so you can see whose emails need fixing; a client logged by two reps counts for each of them.',
    cols: 'Tracker: Email, Person (sheet name) · B2C: userId (email)',
    source: 'BD Accountability Tracker file and the RAW_DATA (B2C) sheet',
    note: 'Fixing a typo\'d email in the Google Sheet moves that client from Unmapped to Mapped on the next sync.'
  },
  'bd2-rm': {
    title: 'RM BD Performance',
    desc: 'The flow by <strong>RM</strong>: for each RM, the meetings scheduled with them, how many joined, and where the joined clients stand in Workpoint — one small flow per RM (busiest first) and then a table. A lead\'s RM is its <strong>first RM</strong> in B2C, matched by email; the exception is a lead whose first RM is on the <strong>BD team</strong> (Himani, Suhani, Kajal, Kunal, Srishti), which is shown under its <strong>current RM</strong>. Leads not found in B2C are grouped as <strong>Unmatched</strong>.<br><br><strong>Support Wealth Manager</strong> is the generic pool most BD-desk leads end up in, not a person. Use the <strong>RM filter</strong> at the top (type to search) to see one or more RMs; the cards show the 24 busiest until you choose Show all, and the table always lists every RM. <strong>Download Excel</strong> gives the RM table, the meetings behind it and the selection with a tie-out.<br><br>Calls are not split by RM in the BD Daily Log, so this view starts at Meetings Scheduled.',
    cols: 'Tracker: Email, Date Assigned, GMeet Joined? · B2C: userId (email), firstRmName, currentRmName, leadStatus, Converted Month',
    source: 'BD Accountability Tracker file and the RAW_DATA (B2C) sheet, EMPLOYEE_REF (RM spelling and team)',
    note: 'A first RM that is not in EMPLOYEE_REF is still shown under its own name, but its team is counted as SV; the note above the flows counts any such meetings.'
  },
  'lp-status': {
    title: 'Landing Page × Status Breakdown',
    desc: 'Lead counts by landing page and status, filtered by campaign(s) (multi-select, with Select All). <strong>Landing pages are dynamically read from uploaded data and mapped to their Campaign Name.</strong> CONVERTED uses CM, IN PROCESS uses LPM, all other statuses use CTM.<br><strong>Same Month:</strong> status column matches selected month(s) AND CTM matches.<br><strong>Any Month:</strong> status column matches selected month(s) but CTM outside (only applies to CONVERTED/IN PROCESS).<br><strong>Default:</strong> status column matches selected month(s).',
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
  initDashSubtabs();
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
