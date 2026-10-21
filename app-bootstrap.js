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
  'bdperf': {
    title: 'BD Performance — Accountability Tracker',
    desc: 'Each rep\'s leads live in a sheet named "&lt;Person&gt; Q&lt;N&gt;" (e.g. "Himani Q1") in the BD Accountability Tracker — synced live from the BD team\'s own Google Sheet on every page load, not a manual file upload — new quarters are picked up automatically once a sheet with that name exists, no code change needed. Only <strong>Date Assigned</strong>, <strong>Email</strong>, <strong>GMeet Joined?</strong>, and <strong>Current Stage</strong> are read from the tracker itself.<br><br>Every lead is matched to its B2C record by email (BD tracker) &lt;-&gt; userId (B2C — despite the name, it\'s the client\'s email, and is unique across the file). For a matched lead, <strong>Stage</strong>, <strong>RM</strong>, <strong>Team</strong>, <strong>Month</strong>, and <strong>Platform</strong> all come from that B2C record (Stage uses the same CM-presence CONVERTED rule as the rest of the dashboard, not just leadStatus) — note this means RM/Team reflect who <em>currently</em> owns the lead in the CRM, not who the tracker originally assigned it to; leads that have been reassigned since will show under their new owner. A lead with no match (not yet in the CRM, or an email typo) gets a team row of its own, <strong>Not in CRM</strong>, rather than being folded into SV. The CRM has no Stage for it, so it shows the status the BD rep logged in the tracker\'s own Current Stage instead, and its Month falls back to the tracker\'s own Date Assigned. <strong>Not Logged</strong> catches any lead whose relevant Stage field is simply blank — under BD Team Status, that\'s a lead the rep hasn\'t updated Current Stage for yet. It still counts toward Total, so every row\'s stage columns plus Not Logged always add up to Total exactly.<br><br><strong>Each client is counted once.</strong> The tracker can list the same email more than once (a lead logged twice by one rep, or by two reps), so counting rows would double-count it. Every lead-level table and chart on this sub-tab counts distinct clients, using each client\'s most recent entry (latest Date Assigned) so Stage and GMeet reflect where the client stands now. The note above the table gives the duplicate count and lists every affected row. Filtered to one rep you see the distinct clients that rep logged; with no rep filter every client counts once overall, so per-rep figures can add up to slightly more than the overall total (a client two reps both logged is credited to each). Call Flow is the exception — it counts assignments (leads handed to a rep in a month), so it stays row-based.<br><br>By default the table shows one row per <strong>Team</strong>; selecting a single team in the Team filter drills down to one row per <strong>RM</strong> within it — same pattern as the Dashboard tab\'s Team Performance Matrix. A <strong>Workpoint Status / BD Team Status</strong> toggle above the table switches which Stage classification the columns tally: <strong>Workpoint Status</strong> (default) uses the B2C-derived Stage described above; <strong>BD Team Status</strong> instead uses the tracker\'s own self-reported Current Stage column, unchanged since the BD rep last updated it — the two can disagree once a lead is reassigned or its CRM status moves on after the tracker was last updated. The <strong>Current Stage</strong> bar chart above follows this same toggle (see the label under its heading), switching its bars between the two classifications along with the table. Click any column header to sort. <strong>Person</strong> (which BD rep logged the lead), <strong>Month</strong>, and <strong>Platform</strong> are independent filters layered on top and also narrow the charts and the GMeet-vs-In-Process table below them; <strong>Reset filters</strong> clears all of them (including the GMeet pie\'s click-filter) back to All in one click — it does not affect the Workpoint/BD Team Status toggle. While the pie\'s click-filter is active a <strong>GMeet: Yes/No/Pending ×</strong> button appears beside Reset; click it to clear just that filter. Month, Person and Platform dropdowns stay open while you tick several options; Team is a single choice.<br><br>The separate <strong>GMeet Joined? vs In Process</strong> table always shows all GMeet states side by side (Yes, No, Pending and Not Logged — clients with no value entered, so the Grand Total equals the Team/RM total) — it deliberately ignores the pie chart\'s own click-filter (collapsing to one state would defeat a table meant to compare them) but still honors Month/Team/Person/Platform. Unlike the Team/RM table, it is always sourced from the tracker\'s own Current Stage column (the BD Team\'s Google Sheet), regardless of the toggle above, since it is meant to reflect what BD ops themselves logged.<br><br>Conv. Rate = CONVERTED ÷ Total. QL Conv. Rate = (CONVERTED + IN PROCESS) ÷ Total. In Process Rate (GMeet table only) = rows with tracker Current Stage = IN PROCESS ÷ Total. GMeet Joined counts clients whose entry is marked "Yes" only — the tracker also uses "Pending" and blank, both excluded from this Yes-only count (and from the pie chart).<br><br><strong>Assigned by BD</strong> = distinct clients the BD team handed to that team (tracker <strong>Team Leader</strong>) or RM (tracker <strong>Assigned RM</strong>), dated by Date Assigned. <strong>Mapped to CRM</strong> = how many of those are found in the CRM and are still held by that team / RM. The other columns follow current CRM ownership, so a lead assigned to an RM and since moved to another RM or the SV pool counts in Assigned by BD but not in the Total of that RM. Names the tracker spells too loosely to match (e.g. "Assigned RM not recognised") get their own row so the column still adds up.',
    cols: 'Sheet name (→ Person) · Email (→ matched to B2C userId) · GMeet Joined? (Yes/No/Pending) · Date Assigned (Month fallback for unmatched leads) · Current Stage (tracker\'s own field → BD Team Status, GMeet-vs-In-Process table, and the Stage of leads with no B2C match) · B2C leadStatus/CM (→ Stage / Workpoint Status) · B2C currentRmName (→ RM) · B2C Team (→ Team) · B2C CTM (→ Month) · B2C platformName (→ Platform)',
    source: 'BD Accountability Tracker file (incl. its own Current Stage column), RAW_DATA (B2C) sheet, RM Master Mapping sheet',
    note: 'B2C\'s currentRmName isn\'t reliably canonical on its own (casing varies lead to lead) so it\'s passed through the same RM Master Mapping used dashboard-wide before display.'
  },
  'bdcalls': {
    title: 'BD Daily Log — Call Activity',
    desc: 'Reads the <strong>BD Daily Log</strong> sheet in the same BD Accountability Tracker upload as the rest of this tab — one row per BD rep per day, with no per-lead detail at all (it\'s pure call-activity volume, not tied to individual clients). Because of that it has no Team or Platform of its own, so only the <strong>Month</strong> and <strong>Person</strong> filters at the top of the tab apply to it; Team/Platform are ignored here.<br><br><strong>Total Calls Made</strong>, <strong>Calls Connected</strong>, and <strong>CNP</strong> (Calls Not Picked) are read directly from their own columns and shown as-is — CNP is <em>not</em> recomputed as Total minus Connected. In this upload a small number of rows (about 1 in 20) don\'t add up exactly, and a couple are clearly data-entry errors (CNP larger than Total Calls on that day) — rather than silently "fixing" someone\'s logged numbers, the dashboard shows exactly what\'s in the sheet and lets Connected%/CNP% be whatever the raw numbers produce for those rows.<br><br>The chart aggregates by month (three bars side by side — Made / Connected / CNP) since 100+ individual daily bars would be unreadable; the table breaks the same filtered rows down by BD rep instead, so the two are complementary views of the same underlying rows rather than duplicates of each other.<br><br><strong>Meetings Scheduled</strong> is <em>not</em> shown in this table — it\'s tracker-sourced (Date Assigned, not this sheet), so it lives in the Call Flow diagram/table above instead. See that section\'s info button for why.',
    cols: 'Date (→ Month, via the shared Month filter) · BD Name (→ Person, via the shared Person filter — same rep names as the rest of the tab) · Total Calls Made · Calls Connected · CNP',
    source: 'BD Accountability Tracker file, "BD Daily Log" sheet',
    note: 'Rows with a blank Date or blank BD Name are dropped during extraction — the source sheet has a few scratch/placeholder rows (an unlabelled future-quarter row, a hidden grand-total row) that carry numbers but aren\'t real daily entries.'
  },
  'bdcallflow': {
    title: 'Call Flow — Calls to Meetings Joined',
    desc: 'The BD funnel end to end: <strong>Total Calls Made</strong> splits into <strong>Calls Connected</strong> and <strong>CNP</strong> (not picked); connected calls lead to <strong>Meetings Scheduled</strong>; and those meetings end up <strong>Joined</strong>, <strong>Not Joined</strong>, <strong>Pending</strong>, or <strong>Not Logged</strong>.<br><br><strong>Meetings Scheduled</strong> is every lead in the "&lt;Person&gt; Q&lt;N&gt;" tracker sheets whose <strong>Date Assigned</strong> falls in the selected month(s) — every lead handed to a BD rep that period counts as a meeting scheduled with them (verified against the source file: Suhani\'s 27 leads assigned in September match the BD team\'s own day-by-day count exactly). <strong>Joined / Not Joined / Pending / Not Logged</strong> is that <em>exact same set of leads</em>, broken down by their own <strong>GMeet Joined?</strong> column (Not Logged = no value entered there yet) — so those four always add up to Meetings Scheduled precisely, with nothing left over.<br><br>The one place two different sheets meet is <strong>Calls Connected → Meetings Scheduled</strong>: Calls Made/Connected/CNP are the BD reps\' own daily tallies in the <strong>BD Daily Log</strong> sheet, while Meetings Scheduled is counted from the tracker sheets instead. Treat that specific percentage as directional (roughly how many connected calls turn into a scheduled meeting) rather than a strict conversion, since the two sides aren\'t the same underlying records.<br><br><strong>Month</strong> and <strong>Person</strong> filter the whole flow. <strong>Team</strong> and <strong>Platform</strong> filter Meetings Scheduled and the four meeting outcomes (they come from the tracker rows, which carry the matched lead\'s team and platform) but <em>not</em> the three call stages: the BD Daily Log has no team or platform, so Calls Made / Connected / CNP always show every call for the selected month and rep. Because the call side is then unfiltered, <strong>Meetings ÷ Calls Connected</strong> shows n/a while a Team or Platform is set, and a note above the diagram says so.<br><br>The percentage on each box is its share of the stage it came from: Connected/CNP ÷ Calls Made, Meetings ÷ Connected, and each GMeet state ÷ Meetings Scheduled.',
    cols: 'Total Calls Made · Calls Connected · CNP — from BD Daily Log · Date Assigned (→ Meetings Scheduled) · GMeet Joined? Yes/No/Pending/blank — from the tracker sheets',
    source: 'BD Accountability Tracker file: "BD Daily Log" sheet (calls) + the "<Person> Q<N>" lead sheets (meetings scheduled, GMeet outcomes)',
    note: 'The stage-by-stage table below the diagram carries the same numbers with an explicit Source column per row, if you need to cite where a specific figure came from.'
  },
  'bd-month-mismatch': {
    title: 'Why "Meetings Scheduled" Doesn\'t Always Match the Lead-Level Detail Total',
    desc: '"Meetings Scheduled" (Call Flow, above) dates a lead by the tracker\'s own <strong>Date Assigned</strong>. Every table in the <strong>Lead-Level Detail</strong> sub-tab (GMeet Joined?, Current Stage, Team/RM Breakdown) instead dates the same lead by its matched B2C record\'s <strong>Created Month</strong> — the same convention Month filtering uses everywhere else on this dashboard. The two usually agree, but a lead can be handed to a BD rep in a different month than it was created in B2C, so the two totals can legitimately differ for the same month selection — as they do when the tracker lists the same client more than once, because Meetings Scheduled counts every assignment while Lead-Level Detail counts each client once.<br><br>This table is the complete, named reconciliation: every lead where the two month-anchors disagree for the currently selected month(s), so nothing is left unaccounted for. <strong>Counted In</strong> shows which of the two totals includes that lead — "Call Flow only" means its Date Assigned falls in the selection but its B2C Created Month doesn\'t (counted in Meetings Scheduled, not in the Lead-Level Detail total); "Lead-Level Detail only" is the reverse. <strong>Why</strong> says what caused it: either the two month anchors disagree, or the row is a <strong>repeat entry</strong> — the tracker lists that client more than once, so the extra entries count in Meetings Scheduled (one per assignment) but not in the Lead-Level Detail total. An unmatched lead\'s "B2C Created Month" is defined as its own Date Assigned, so it can only appear here as a repeat entry, never because the months disagree.',
    cols: 'email (→ matched to the B2C RAW_DATA sheet\'s userId) · clientName (from that matched B2C row) · person (BD rep) · dateAssigned (tracker) · effectiveMonth (B2C CTM for matched leads)',
    source: 'BD Accountability Tracker file (the "<Person> Q<N>" sheets), RAW_DATA (B2C) sheet',
    note: 'Scoped to Month + Person + Team + Platform, matching Call Flow\'s meeting counts and the Lead-Level Detail totals it reconciles.'
  },
  'bd-gmeet-converted': {
    title: 'GMeet Joined? vs Converted',
    desc: 'The same layout as <strong>GMeet Joined? vs In Process</strong>, but counting conversions: one row per GMeet state (Yes, No, Pending, and Not Logged for clients with no value entered), so you can see whether joining the meeting predicts a conversion.<br><br><strong>Converted comes from the Workpoint B2C file, not the tracker.</strong> Each lead\'s email in the BD tracker is matched to the B2C <em>userId</em> (the client\'s email); a matched lead counts as converted when its B2C record has a Converted Month (the same CM-presence rule used across the dashboard). <strong>Matched</strong> is how many leads were found in B2C this way and <strong>Not Matched</strong> how many were not — typo\'d or blank emails, leads not in the CRM, or leads created before the period the uploaded B2C file covers. A lead that was not found has no CRM status to read, so it counts as <em>not</em> converted; that is why the table shows both rates: <strong>Converted Rate</strong> = Converted ÷ Total, and <strong>Rate of Matched</strong> = Converted ÷ Matched, which leaves the unknowns out.<br><br>Each client counts once (latest tracker entry), and the table honors Month/Team/Person/Platform but ignores the pie chart\'s click-filter. <strong>Download the lead list</strong> gives one line per client behind the counts — BD rep, email, whether it was found in B2C, its B2C status and converted month — so any number can be checked against the B2C file.',
    cols: 'email (BD tracker) → userId (B2C) · gmeetJoined (tracker) · B2C Converted Month (CM) → Converted · whether the email matched at all → Matched / Not Matched',
    source: 'BD Accountability Tracker file (GMeet Joined?, Email) and the RAW_DATA (B2C) sheet (Converted Month)',
    note: 'Converted here counts only leads found in B2C, so it can be slightly lower than a figure that also trusts the tracker\'s own stage for leads the CRM does not have.'
  },
  'bd-calls-conversion': {
    title: 'Calls Made vs Conversion — by BD Rep',
    desc: 'One row per BD rep, joining the two data sources this tab is built from: <strong>Calls Made</strong> is the rep\'s own daily tally from the <strong>BD Daily Log</strong> sheet — like everywhere else that sheet is used, it only honors the <strong>Month + Person</strong> filters, since it has no per-lead link to derive a Team or Platform from. <strong>Total Leads</strong>, <strong>GMeet Joined</strong>, and <strong>Converted</strong> come from the tracker + B2C match instead, and honor the <strong>full Month/Team/Person/Platform</strong> scope. The two sides are joined by matching the tracker\'s own <em>person</em> field against the Daily Log\'s <em>BD Name</em> — the same correlation the Call Flow section already relies on.<br><br><strong>Total Leads</strong> counts each rep\'s distinct clients (a client they logged twice counts once). The Grand Total counts each client once overall, so when two reps both logged the same client the rep rows can add up to slightly more than the Grand Total — a note under the table gives the number.<br><br><strong>Converted</strong> uses the same CM-presence rule (a lead counts as Converted once it has a Converted Month, regardless of its current status) that the rest of the dashboard uses — <strong>not</strong> the tracker\'s own Current Stage column, which is the BD team\'s self-reported stage (Lead Assigned / In Follow-Up / In Process / Dropped / Tax Filing Done / On Hold-Dead) and has no "Converted" value of its own.<br><br><strong>Conversion Rate</strong> = Converted ÷ <strong>Total Leads</strong> — the same Converted ÷ Total definition used everywhere else on the dashboard (Team/RM Breakdown, MTD, etc.), not ÷ Calls Made: Calls Made counts every dial across the month (often thousands per rep), so a call-based rate would read as a misleadingly tiny fraction of a percent instead of a real conversion rate.',
    cols: 'bdName (BD Daily Log) / person (tracker) — joined by name · totalCalls (BD Daily Log) · gmeetJoined (tracker) · effectiveStage (B2C-derived, CM-presence rule)',
    source: 'BD Accountability Tracker file: "BD Daily Log" sheet (calls) + the "<Person> Q<N>" sheets (GMeet Joined?), matched to B2C for Team/Platform/Converted status',
    note: 'If a rep has calls in the Daily Log but no matching name in the tracker sheets (or vice versa), they still appear here with 0 in whichever side is missing — Calls Made and GMeet Joined/Converted are computed independently before being joined by name.'
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
  initBdSubtabs();
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
