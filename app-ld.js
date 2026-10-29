// app-ld.js — L&D Dashboard tab: the L&D team's financial-planning work (plan approvals and FY
// planning tickets) joined to the client's Workpoint lead record.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// Ported from the standalone L&D dashboard's offline build (tools/build_dashboard.py in the
// L-D-Financial-Plan repo); the same joining now runs in the browser on:
//   STATE.ldRows      the L&D workbook ('ld' in /api/data: the upload form, or the Google Sheet
//                     sync once LD_SHEET_ID is set on the backend)
//   STATE.raw         the daily B2C (FIN23) upload: Workpoint status, RM / team, created date, tier
//   LD_LEAD_SNAPSHOT  ld_leads_snapshot.js: hard-coded Workpoint values for L&D clients the daily
//                     B2C file does not carry (it only holds this FY's leads), keyed by email hash.
//                     The live B2C record always wins; regenerate with build_ld_snapshot.py.
// Rules carried over unchanged:
//   - clients are de-duplicated on a normalised email (ldNormKey) across every L&D tab;
//   - only clients found in the lead data count in any analysis; the rest are listed as Unmapped;
//   - month filters mean "active in that month", and ticket subjects / plan approvals are
//     month-scoped too, so activity in one month never makes a client count in another.
// Everything lives inside the LD closure so its many small names cannot collide with the other
// app-*.js files; renderLD() is the one entry point (called by activateTab).

const LD = (() => {
  'use strict';

  // ---------- rules ----------
  // The FY ticket subjects that count as L&D plan work in the L&D Flow (spelled as in the sheet).
  const LD_SUBJECTS = ['FP Creation', 'FP With Analysis', 'Wealth Plan', 'Retirement Plan'];
  // Dropped wholesale by request: April 2026's FY rows carry almost no client emails. Matched on the
  // resolved month, not the word "April", so April of a later FY is kept.
  const EXCLUDE_MONTH_KEYS = new Set(['2026-04']);
  // Typos in the planning sheet that point at a real lead (left = as typed). Keep in step with
  // EMAIL_ALIASES in build_ld_snapshot.py.
  const EMAIL_ALIASES = { 'inayakpatilvp111@gmail.com': 'vinayakpatilvp111@gmail.com' };
  const TIER_VALUES = { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma', gama: 'Gamma',
                        '(investment transactional)': 'Investment Transactional' };
  const TENURE_VALUES = { new: 'New', existing: 'Existing' };
  const BLANK = 'Blank';
  const NO_LEAD_TEAM = 'No lead record';
  const PRODUCTS = [['unlisted', 'Unlisted Allocation'], ['grip', 'GRIP Allocation'], ['ulip', 'ULIP Allocation'],
                    ['surplus', 'Monthly Revised Surplus'], ['equity', 'Total Equity allocation']]
    .map(([k, label]) => ({ k, label }));
  // Advisor / Lead Source are typed by hand; an email or phone pasted into one is blanked.
  const LOOKS_LIKE_PII = /[\w.+-]+@[\w-]+\.[\w.-]+|\d{7,}/;

  // Indian FY from the dashboard-wide cutoff (CONFIG.FY_CUTOFF_MONTH, e.g. "Apr-2026").
  const FY_YEAR = +String(CONFIG.FY_CUTOFF_MONTH || 'Apr-2026').slice(-4) || 2026;
  const FY_START = FY_YEAR + '-04-01', FY_END = (FY_YEAR + 1) + '-03-31';
  const FY_LABEL = 'FY ' + FY_YEAR + '-' + String((FY_YEAR + 1) % 100).padStart(2, '0');

  const MONTH_NAMES = {};
  ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
   'november', 'december'].forEach((m, i) => {
    MONTH_NAMES[m] = MONTH_NAMES[m.slice(0, 3)] = [i + 1, MONTHS_3[i]];
  });
  MONTH_NAMES.sept = [9, 'Sep'];

  // ---------- cell helpers (mirror the Python build exactly) ----------
  const pad = n => String(n).padStart(2, '0');
  // Header text -> lookup key. Case and spacing don't matter ("Email ID" = "Email Id" = "email  id"),
  // so a column retyped slightly differently in a new quarter's tab is still found.
  const headerKey = h => String(h).replace(/\s+/g, ' ').trim().toLowerCase();
  // A cell as text. The backend hands datetimes over as "YYYY-MM-DD HH:MM:SS"; the date part is
  // what the sheet shows, so that is what every comparison and the data-flag tables use.
  function s(v){
    if(v == null) return '';
    if(typeof v === 'number') return String(v);
    const t = String(v).trim();
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t) ? t.slice(0, 10) : t;
  }
  // Email join key: every whitespace and invisible/control character removed, lower-cased. Keep in
  // step with norm_key in build_ld_snapshot.py (the snapshot is keyed on its hash).
  const ldNormKey = v => v == null ? '' : String(v).replace(/\p{C}/gu, '').replace(/\s+/g, '').toLowerCase();
  const emailKey = v => { const k = ldNormKey(v); return EMAIL_ALIASES[k] || k; };
  const scrub = v => (v && LOOKS_LIKE_PII.test(v)) ? '' : v;
  const clientTier = raw => { const t = (raw || '').trim(); return t ? (TIER_VALUES[t.toLowerCase()] || t) : ''; };
  const clientTenure = raw => { const t = (raw || '').trim(); return t ? (TENURE_VALUES[t.toLowerCase()] || t) : ''; };
  // An L&D staff name -> one spelling per person; "RM" in Drafted By means the RM drafted it.
  function ldPerson(v){
    const name = String(v || '').replace(/\s+/g, ' ').trim().replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
    return name.toLowerCase() === 'rm' ? '' : name;
  }

  function isoDate(y, m, d){
    if(y < 1 || m < 1 || m > 12 || d < 1) return null;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if(d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) return null;
    return String(y).padStart(4, '0') + '-' + pad(m) + '-' + pad(d);
  }
  // A typed or exported date -> "YYYY-MM-DD", or null. Accepts the same formats as the Python
  // build: ISO (with or without time), dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy (the FY sheets' 01.04.2026)
  // and "1 Sept 26" / "1 September 2026" as typed on some approval dates.
  function parseDate(v){
    if(v == null) return null;
    let t = String(v).trim().replace(/T/g, ' ');
    if(!t || ['N/A', 'NA', '-', 'NULL', 'NONE'].includes(t.toUpperCase())) return null;
    t = t.replace(/\bSept\b/gi, 'Sep').slice(0, 26);
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?: \d{1,2}:\d{1,2}:\d{1,2}(?:\.\d{1,6})?)?$/.exec(t);
    if(m) return isoDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(t);
    if(m) return isoDate(+m[4], +m[3], +m[1]);
    m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}|\d{2})$/.exec(t);
    if(m && MONTH_NAMES[m[2].toLowerCase()] && m[2].toLowerCase() !== 'sept'){
      const yy = +m[3], y = m[3].length === 2 ? (yy < 69 ? 2000 + yy : 1900 + yy) : yy;
      return isoDate(y, MONTH_NAMES[m[2].toLowerCase()][0], +m[1]);
    }
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.slice(0, 10));
    return m ? isoDate(+m[1], +m[2], +m[3]) : null;
  }
  const inFY = d => !!d && d >= FY_START && d <= FY_END;
  function dateIssue(parsed){
    if(!parsed) return 'Not recognized as a date';
    if(!inFY(parsed)) return 'Parses to ' + parsed + ', outside ' + FY_LABEL + ' (likely a typo year)';
    return null;
  }
  // (sort key, label) for a row: the typed Month column drives it, the in-FY date is the fallback.
  function monthKey(raw, dt){
    let [n, label] = MONTH_NAMES[raw.toLowerCase()] || [0, ''];
    if(!n && dt){ n = +dt.slice(5, 7); label = MONTHS_3[n - 1]; }
    if(!n) return ['zzzz', raw || 'Unknown'];
    const y = n >= 4 ? FY_YEAR : FY_YEAR + 1;
    return [y + '-' + pad(n), label + ' ' + y];
  }

  async function sha16(text){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- lead data ----------
  // email key -> Workpoint record: the daily B2C row first (Primary lead head wins on a repeat, as
  // in buildB2CEmailIndex), else the hard-coded snapshot. Team follows the dashboard-wide rule
  // (the current RM's team, SV when unknown) so team names match every other tab.
  async function leadLookup(keys){
    const live = new Map();
    for(const r of STATE.raw || []){
      const k = ldNormKey(r.userId);
      if(!k) continue;
      const prev = live.get(k);
      if(!prev || !(prev.leadHead === 'Primary' && r.leadHead !== 'Primary')) live.set(k, r);
    }
    const snap = (window.LD_LEAD_SNAPSHOT && window.LD_LEAD_SNAPSHOT.rows) || {};
    const out = new Map();
    let fromLive = 0, fromSnap = 0;
    for(const k of keys){
      const r = live.get(k);
      if(r){
        const cat = clientTier(r.clientCategory);
        out.set(k, { status: r.leadStatus || 'BLANK', rm: r.currentRmName || '', team: r.Team || 'SV',
          created: String(r.createdDate || '').slice(0, 10), converted: String(r.convertedDate || '').slice(0, 10),
          landing: r.landingPage || '', platform: r.platformName || '',
          tier: cat && cat.toLowerCase() !== 'other' ? cat : '', via: 'B2C' });
        fromLive++;
        continue;
      }
      const v = snap[await sha16(k)];
      if(v){
        const [status, created, converted, rm, cat, platform, landing] = v;
        out.set(k, { status: status || 'BLANK', rm: rm || '', team: teamForRmName(rm) || 'SV', created,
          converted, landing: landing || '', platform: platform || '', tier: clientTier(cat), via: 'Snapshot' });
        fromSnap++;
      }
    }
    return { map: out, fromLive, fromSnap };
  }

  // ---------- build: L&D rows -> tickets -> de-duplicated clients ----------
  function sheetConfigs(rows){
    return [...new Set(rows.map(r => r._sheet))].map(name => {
      const q = 'Q' + ((/q(\d+)\s*$/i.exec(name) || [])[1] || '?');
      return /^plan approval/.test(headerKey(name))
        ? { name, kind: 'pa', q, email: ['Email Id'], month: ['Month', 'D'], date: 'Date' }
        : { name, kind: 'fy', q, email: ['Client Mail ID'], month: ['Month'], date: 'Tkt Recd Date' };
    }).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'pa' ? -1 : 1) || a.q.localeCompare(b.q, undefined, { numeric: true }));
  }

  async function build(){
    // Re-key every row by headerKey once; where two headers collapse to the same key, the first
    // non-blank value is kept.
    const all = (STATE.ldRows || []).map(r => {
      const o = { _sheet: r._sheet, _row: r._row };
      for(const k of Object.keys(r)){
        if(k === '_sheet' || k === '_row') continue;
        const hk = headerKey(k);
        if(o[hk] == null || o[hk] === '') o[hk] = r[k];
      }
      return o;
    });
    const cfgs = sheetConfigs(all);
    const cell = (r, n) => r[headerKey(n)];
    const g = (r, ...names) => { for(const n of names){ const v = s(cell(r, n)); if(v) return v; } return ''; };
    const gnum = (r, n) => { const v = cell(r, n); if(typeof v === 'number') return v;
      const x = Number(String(v == null ? '' : v).replace(/,/g, '').trim() || 0); return isNaN(x) ? 0 : x; };

    const leadKeys = new Set();
    for(const cfg of cfgs) for(const r of all) if(r._sheet === cfg.name){ const k = emailKey(g(r, ...cfg.email)); if(k) leadKeys.add(k); }
    const leads = await leadLookup(leadKeys);

    const tickets = [];
    const diag = { noEmail: 0, excluded: 0, dateIssues: [], noEmailRows: [] };
    for(const cfg of cfgs){
      const rows = all.filter(r => r._sheet === cfg.name).sort((a, b) => a._row - b._row);
      for(const r of rows){
        const monthRaw = g(r, ...cfg.month);
        const rawDate = g(r, cfg.date), rowDt = parseDate(cell(r, cfg.date));
        const fyDt = inFY(rowDt) ? rowDt : null;
        const [mk, mlabel] = monthKey(monthRaw, fyDt);
        if(EXCLUDE_MONTH_KEYS.has(mk)){ diag.excluded++; continue; }
        const name = g(r, 'Client Name'), ticket = g(r, 'Ticket Id', 'SR No'), email = g(r, ...cfg.email);
        const subject = cfg.kind === 'fy' ? g(r, 'Ticket Subject') : '';
        const assigned = cfg.kind === 'fy' ? ldPerson(g(r, 'Assigned to')) : '';
        const approvedBy = cfg.kind === 'pa' ? ldPerson(g(r, 'Approved By')) : '';
        // pa: a Plan Approval row (always in the L&D Flow's scope); otherwise the flow's subject
        // filter decides, from `subject`.
        const pa = cfg.kind === 'pa';
        const emps = [...new Set([assigned, approvedBy].filter(Boolean))].sort();
        const flagDate = (column, raw, parsed) => {
          const issue = raw ? dateIssue(parsed) : null;
          if(issue && name) diag.dateIssues.push({ sheet: cfg.name, row: r._row, ticket, name, email, column,
            raw, issue, subject, mk, pa, emps });
        };
        flagDate(cfg.date, rawDate, rowDt);
        if(cfg.kind === 'pa') flagDate('Approval Date', g(r, 'Approval Date'), parseDate(cell(r, 'Approval Date')));

        const key = emailKey(email);
        if(!key){
          if(name){ diag.noEmail++; diag.noEmailRows.push({ sheet: cfg.name, row: r._row, ticket, name,
            month: monthRaw, date: rawDate, subject, mk, pa, emps }); }
          continue;
        }
        const lead = leads.map.get(key);
        const rec = {
          kind: cfg.kind, sheet: cfg.name, row: r._row, q: cfg.q, mk, m: mlabel, date: fyDt || '',
          key, email, name, subject, ticket, assigned, approvedBy,
          tierRaw: cfg.kind === 'fy' ? clientTier(g(r, 'Client Type')) : '',
          tenureRaw: cfg.kind === 'pa' ? clientTenure(g(r, 'Client Type')) : '',
          advisor: scrub(g(r, 'Advisor', 'RM Name')), appr: g(r, 'Approved By'),
          status: lead ? lead.status : 'NOT IN LEAD DATA', matched: !!lead, lead,
          rm: scrub(lead ? lead.rm : ''), team: lead ? lead.team : NO_LEAD_TEAM,
          platform: lead ? lead.platform : '',
          src: scrub(lead && lead.landing ? lead.landing : g(r, 'Lead Source')),
          created: lead ? lead.created : '', converted: lead ? lead.converted : '',
        };
        if(cfg.kind === 'pa'){
          const ap = parseDate(cell(r, 'Approval Date'));
          rec.appdate = inFY(ap) ? ap : '';
          rec.verdict = g(r, 'Approved/Rejected');
          rec.rev = Object.fromEntries(PRODUCTS.map(p => [p.k, gnum(r, p.label)]));
        } else {
          rec.appdate = ''; rec.verdict = ''; rec.rev = Object.fromEntries(PRODUCTS.map(p => [p.k, 0]));
        }
        tickets.push(rec);
      }
    }

    const clients = buildClients(tickets);
    const byKey = new Map(clients.map(c => [c.key, c]));
    for(const t of tickets){
      const c = byKey.get(t.key);
      t.tier = c.tier; t.tenure = c.tenure; t.subjKey = c.subjKey; t.inPA = c.inPA; t.cid = c.cid;
    }

    // Leads created inside the FY, by month and team — the top of the L&D Flow. Counted as B2C rows,
    // the same way every other tab counts leads.
    const leadsCreated = {};
    for(const r of STATE.raw || []){
      const d = String(r.createdDate || '').slice(0, 10);
      if(!inFY(d)) continue;
      const byTeam = leadsCreated[d.slice(0, 7)] = leadsCreated[d.slice(0, 7)] || {};
      const team = r.Team || 'SV';
      byTeam[team] = (byTeam[team] || 0) + 1;
    }
    const ldPeople = [...new Set(tickets.flatMap(t => [t.assigned, t.approvedBy]).filter(Boolean))].sort();
    const monthLabels = {};
    tickets.forEach(t => { monthLabels[t.mk] = t.m; });
    const snapMeta = window.LD_LEAD_SNAPSHOT || {};

    return {
      meta: {
        tabs: cfgs.map(c => c.name), excludedMonths: ['April 2026'], noEmailRows: diag.noEmail,
        products: PRODUCTS, subjects: [...new Set(clients.flatMap(c => c.subjects))].sort(),
        monthLabels, blankLabel: BLANK, ldSubjects: LD_SUBJECTS, ldPeople, fyStart: FY_START, fyLabel: FY_LABEL,
        leadsCreated, leadRows: (STATE.raw || []).length, ldRows: all.length,
        leadsFromLive: leads.fromLive, leadsFromSnapshot: leads.fromSnap,
        snapshotGenerated: snapMeta.generated || '', snapshotFile: snapMeta.leadFile || '',
        dataGenerated: (STATE.dataSource && STATE.dataSource.generated) || '',
      },
      clients,
      tickets: tickets.filter(t => t.kind === 'pa'),
      unmapped: clients.filter(c => !c.matched),
      dateIssues: diag.dateIssues,
      noEmailRows: diag.noEmailRows,
    };
  }

  // One record per email: the de-duplicated union of every L&D tab. "months" (every month the
  // client has a row) drives month filtering; "monthSubjects" / "paMonths" / "ldTouches" keep the
  // subject, plan-approval and per-employee activity month-scoped.
  function buildClients(tickets){
    const sorted = tickets.slice().sort((a, b) =>
      (a.mk < b.mk ? -1 : a.mk > b.mk ? 1 : 0) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (a.ticket < b.ticket ? -1 : a.ticket > b.ticket ? 1 : 0));
    const by = new Map();
    for(const t of sorted){
      let c = by.get(t.key);
      if(!c){
        c = { key: t.key, email: t.email, name: t.name, mk: t.mk, m: t.m, q: t.q, months: new Set(), paMonths: new Set(), fyMonths: new Set(),
          ldTouches: [], inPA: false, subjects: new Set(), monthSubjects: {}, tier: '', tenure: '',
          rev: Object.fromEntries(PRODUCTS.map(p => [p.k, 0])), nTickets: 0, nPA: 0, nFY: 0,
          advisor: '', appr: '', ticket: '', status: t.status, matched: t.matched, lead: t.lead, rm: t.rm,
          team: t.team, platform: t.platform, src: t.src, created: t.created, converted: t.converted,
          date: t.date, locations: [] };
        by.set(t.key, c);
      }
      c.nTickets++;
      c.months.add(t.mk);
      // One [month, person, role, subject] per source row: two FP tickets in a month are two plans.
      // Tickets of every subject are kept; the L&D Flow's subject filter picks which count.
      if(t.kind === 'pa'){
        if(t.approvedBy) c.ldTouches.push([t.mk, t.approvedBy, 'approved', '']);
      } else if(t.assigned){
        c.ldTouches.push([t.mk, t.assigned, 'created', t.subject]);
      }
      c.locations.push(t.sheet + ' row ' + t.row);
      if(t.kind === 'pa'){
        c.inPA = true; c.nPA++; c.paMonths.add(t.mk);
        PRODUCTS.forEach(p => { c.rev[p.k] += t.rev[p.k] || 0; });
        if(t.advisor) c.advisor = t.advisor;
        if(t.appr) c.appr = t.appr;
        if(t.ticket) c.ticket = t.ticket;
      } else {
        c.nFY++;
        c.fyMonths.add(t.mk);
        if(t.subject){
          c.subjects.add(t.subject);
          (c.monthSubjects[t.mk] = c.monthSubjects[t.mk] || new Set()).add(t.subject);
        }
      }
      // Tickets are visited oldest first, so the latest grading wins.
      if(t.tierRaw) c.tier = t.tierRaw;
      if(t.tenureRaw) c.tenure = t.tenureRaw;
      if(!c.advisor && t.advisor) c.advisor = t.advisor;
      if(!c.name && t.name) c.name = t.name;
    }
    const out = [...by.values()].map(c => {
      c.subjects = [...c.subjects].sort();
      c.subjKey = c.subjects.join('|');
      c.monthSubjects = Object.fromEntries(Object.entries(c.monthSubjects).map(([k, v]) => [k, [...v].sort()]));
      // Tier: the B2C client category first (live upload, else the snapshot); the L&D sheet's
      // grading only where B2C has no record of the client or marks it "Other".
      if(c.lead && c.lead.tier){ c.tier = c.lead.tier; c.tierSrc = c.lead.via === 'B2C' ? 'B2C' : 'B2C (snapshot)'; }
      else c.tierSrc = c.tier ? 'L&D sheet' : '';
      c.leadSrc = c.lead ? (c.lead.via === 'B2C' ? 'Daily B2C' : 'Snapshot') : '';
      delete c.lead;
      c.tier = c.tier || BLANK;
      c.tenure = c.tenure || BLANK;
      c.locations = c.locations.join('; ');
      c.months = [...c.months].sort();
      c.paMonths = [...c.paMonths].sort();
      c.fyMonths = [...c.fyMonths].sort();
      PRODUCTS.forEach(p => { c.rev[p.k] = Math.round(c.rev[p.k] * 100) / 100; });
      return c;
    });
    out.sort((a, b) => (a.mk < b.mk ? -1 : a.mk > b.mk ? 1 : 0) ||
      (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
    out.forEach((c, i) => { c.cid = i; });
    return out;
  }

  // ---------- UI ----------
  let model = null, modelFor = null, ui = null, building = null;
  const el = id => document.getElementById('ld-' + id);

  // ---------- tab lock ----------
  // A second sign-in in front of this tab only, checked the same way as the dashboard's own
  // (app-login.js): PBKDF2-SHA256 of "<username>:<password>" against a stored verifier, so the repo
  // holds neither. The username ignores case and spacing; the password is case-sensitive. Unlocking
  // lasts until the browser tab closes or the user signs out (app-login.js clears LD_LOCK.sessionKey).
  // Like app-login.js this is a front-end gate, not access control: the L&D rows still arrive with
  // /api/data for every signed-in visitor; it only keeps the tab itself closed. To change the login:
  //   python -c "import hashlib;print(hashlib.pbkdf2_hmac('sha256',b'<username lower-case>:<password>',b'<salt>',200000).hex())"
  const LD_LOCK = { salt: '919316fa753e66e3c72253782f0d370d', iterations: 200000, sessionKey: 'ld_auth',
                    verifier: '95733532cbce0f06c0bbe9c4a20c221bb48c8d2bb3d0af4df8c4285639c21d51' };
  const unlocked = () => { try{ return sessionStorage.getItem(LD_LOCK.sessionKey) === '1'; }catch(e){ return false; } };
  async function lockDerive(username, password){
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw',
      enc.encode(username.replace(/\s+/g, ' ').trim().toLowerCase() + ':' + password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(LD_LOCK.salt), iterations: LD_LOCK.iterations }, key, 256);
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
  }
  let lockBound = false;
  function bindLock(){
    if(lockBound) return;
    lockBound = true;
    const tab = document.getElementById('tab-ld'), form = el('lock-form'), err = el('lock-error'), btn = el('lock-submit');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const user = el('lock-user').value, pass = el('lock-pass').value;
      if(!user.trim() || !pass){ err.textContent = 'Enter the username and password.'; return; }
      btn.disabled = true; err.textContent = '';
      try{
        if(await lockDerive(user, pass) === LD_LOCK.verifier){
          try{ sessionStorage.setItem(LD_LOCK.sessionKey, '1'); }catch(e2){}
          el('lock-pass').value = '';
          tab.classList.remove('ld-locked');
          renderLD();
        } else {
          err.textContent = 'Incorrect username or password.';   // same message for either, so neither is confirmed
          el('lock-pass').value = ''; el('lock-pass').focus();
        }
      }catch(e2){
        err.textContent = 'Could not check the sign-in: ' + (e2 && e2.message || e2);
      }finally{
        btn.disabled = false;
      }
    });
    el('relock').addEventListener('click', () => {
      try{ sessionStorage.removeItem(LD_LOCK.sessionKey); }catch(e){}
      tab.classList.add('ld-locked');
      el('lock-user').focus();
    });
  }

  async function render(){
    bindLock();
    if(!unlocked()){
      document.getElementById('tab-ld').classList.add('ld-locked');
      el('lock-user').focus();
      return;
    }
    document.getElementById('tab-ld').classList.remove('ld-locked');
    const empty = el('empty'), layout = el('layout');
    if(!(STATE.ldRows && STATE.ldRows.length)){
      empty.hidden = false; layout.hidden = true;
      empty.innerHTML = '<b>No L&amp;D workbook on the server yet.</b> Upload the "Financial Planning Tickets Summary" ' +
        'workbook in the <b>L&amp;D Financial Planning workbook</b> field on the upload page — or, once the L&amp;D ' +
        'Google Sheet is linked (LD_SHEET_ID on the backend), it is pulled automatically.' +
        (STATE.dataSource && STATE.dataSource.fallback ? ' (The live data API could not be reached, so this page is ' +
          'running on the bundled fallback data, which has no L&amp;D rows.)' : '');
      return;
    }
    empty.hidden = true; layout.hidden = false;
    const key = [STATE.ldRows, STATE.raw, STATE.teamMap, STATE.rmMasterLookup];
    if(!model || !modelFor || key.some((x, i) => x !== modelFor[i])){
      if(!building){
        el('loading').hidden = false;
        building = build().then(m => { model = m; modelFor = key; ui = null; })
          .finally(() => { building = null; el('loading').hidden = true; });
      }
      await building;
    }
    if(!ui) ui = mount(model);
    ui.renderAll();
  }

  function mount(DATA){
    const META = DATA.meta, CLIENTS = DATA.clients, TICKETS = DATA.tickets || [];
    const HAS_PII = true;
    const $ = el;

    // ---------- status identity ----------
    const SLOTS = ['var(--s-converted)', 'var(--s-inprocess)', 'var(--s-reassigned)', 'var(--s-onhold)',
                   'var(--s-followup)', 'var(--s-assigned)', 'var(--s-dead)', 'var(--s-other)'];
    const STATUS = [
      { k: 'CONVERTED', label: 'Converted', c: 'var(--s-converted)', tex: 0 },
      { k: 'IN PROCESS', label: 'In process', c: 'var(--s-inprocess)', tex: 0 },
      { k: 'RE-ASSIGNED', label: 'Re-assigned', c: 'var(--s-reassigned)', tex: 0 },
      { k: 'ON HOLD', label: 'On hold', c: 'var(--s-onhold)', tex: 0 },
      { k: 'FOLLOW UP', label: 'Follow up', c: 'var(--s-followup)', tex: 0 },
      { k: 'ASSIGNED', label: 'Assigned', c: 'var(--s-assigned)', tex: 0 },
      { k: 'DEAD', label: 'Dead', c: 'var(--s-dead)', tex: 0 },
      { k: 'NOT IN LEAD DATA', label: 'Not in lead data', c: 'var(--s-none)', tex: 0 }
    ];
    (() => {
      let slot = 7;
      [...new Set(CLIENTS.map(c => c.status))].filter(k => !STATUS.some(s2 => s2.k === k)).sort().forEach(k => {
        const i = slot++;
        STATUS.splice(STATUS.length - 1, 0, { k, label: k.charAt(0) + k.slice(1).toLowerCase(),
          c: SLOTS[i % SLOTS.length], tex: Math.floor(i / SLOTS.length) });
      });
    })();
    const SMAP = Object.fromEntries(STATUS.map(x => [x.k, x]));
    const sInfo = k => SMAP[k] || { k, label: k, c: 'var(--s-other)', tex: 0 };
    const ANALYZE_STATUS = STATUS.filter(x => x.k !== 'NOT IN LEAD DATA');

    const MONTH_LABELS = META.monthLabels || {};
    const MONTHS = [...new Set(CLIENTS.flatMap(c => c.months))].sort().map(mk => ({ mk, m: MONTH_LABELS[mk] || mk }));
    const SUBJECTS = META.subjects || [];
    const SUBJECTS_SET = new Set(SUBJECTS);
    const FP_SUBJECTS = SUBJECTS.filter(x => /^FP |^FP$|Review\/Revise FP/i.test(x));
    const TIER_ORDER = ['Alpha', 'Beta', 'Gamma'];
    const orderedValues = (field, lead) => {
      const seen = [...new Set(CLIENTS.map(c => c[field]))];
      const head = lead.filter(v => seen.includes(v));
      const rest = seen.filter(v => !head.includes(v) && v !== BLANK).sort();
      return head.concat(rest, seen.includes(BLANK) ? [BLANK] : []);
    };
    const TIERS = orderedValues('tier', TIER_ORDER);
    const TENURES = orderedValues('tenure', ['New', 'Existing']);
    const TIER_SOURCE_NOTE = 'Tier is the client category in Workpoint B2C (the daily upload, or the hard-coded ' +
      'values for older leads); where B2C has no record of the client, or marks it <i>Other</i>, the grade on the ' +
      'L&amp;D sheet is used instead.';

    const state = {
      subjects: new Set(SUBJECTS),
      month: '', tier: '', tenure: '', team: '', platform: '', advisor: '', source: '', q: '',
      off: new Set(), product: 'all', sort: { key: 'mk', dir: 1 }
    };

    const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const pct = (n, d) => d ? (Math.round(n / d * 1000) / 10).toFixed(1) + '%' : '0%';
    const nf = n => n.toLocaleString('en-IN');
    function money(n){
      if(!n) return '–';
      const a = Math.abs(n), sign = n < 0 ? '-' : '';
      if(a >= 1e7) return sign + '₹' + (a / 1e7).toFixed(2) + ' Cr';
      if(a >= 1e5) return sign + '₹' + (a / 1e5).toFixed(2) + ' L';
      return sign + '₹' + Math.round(a).toLocaleString('en-IN');
    }
    const moneyFull = n => '₹' + Math.round(n).toLocaleString('en-IN');
    const revOf = r => !r.rev ? 0 : (state.product === 'all'
      ? PRODUCTS.reduce((a, p) => a + (r.rev[p.k] || 0), 0) : (r.rev[state.product] || 0));

    // ---------- the master filter (Details) ----------
    // Subjects scoped to the selected month, so a subject from one month can't leak into another.
    function subjectsInScope(c){
      if(!state.month) return c.subjects;
      return (c.monthSubjects && c.monthSubjects[state.month]) || [];
    }
    const inSubjectScope = c => c.inPA || subjectsInScope(c).some(x => state.subjects.has(x));
    // A client passes a month filter if it has ANY activity that month; a ticket if it IS that month.
    function passesFilters(r){
      return (!state.month || (r.months ? r.months.includes(state.month) : r.mk === state.month)) &&
             (!state.tier || r.tier === state.tier) && (!state.tenure || r.tenure === state.tenure) &&
             (!state.team || r.team === state.team) && (!state.platform || r.platform === state.platform) &&
             (!state.advisor || r.advisor === state.advisor) && (!state.source || r.src === state.source);
    }
    function searchOk(r){
      const q = state.q.trim().toLowerCase();
      if(!q) return true;
      return ((r.name || '') + ' ' + (r.email || '') + ' ' + (r.ticket || '') + ' ' + (r.advisor || '') + ' ' +
              (r.rm || '')).toLowerCase().includes(q);
    }
    const selected = () => CLIENTS.filter(c => inSubjectScope(c) && passesFilters(c) && searchOk(c));
    const statusVisible = r => !r.matched || !state.off.has(r.status);
    function selectedTickets(){
      const cids = new Set(selected().filter(statusVisible).map(c => c.cid));
      return TICKETS.filter(t => cids.has(t.cid) && passesFilters(t));
    }

    // ---------- vertical bar chart ----------
    function drawBars(chartEl, axisEl, cols, opts){
      opts = opts || {};
      const max = Math.max(1, ...cols.map(c => c.total));
      const step = max <= 10 ? 2 : max <= 20 ? 5 : max <= 60 ? 20 : max <= 150 ? 50 : max <= 400 ? 100 : max <= 1000 ? 200 : 500;
      const top = Math.ceil(max / step) * step || step;
      let gl = '';
      for(let v = 0; v <= top; v += step) gl += '<div class="gl" style="bottom:' + (v / top * 100) + '%"><span>' + v + '</span></div>';
      chartEl.innerHTML = '<div class="gridlines">' + gl + '</div>' + cols.map(c =>
        '<div class="vcol" data-chart="' + esc(opts.name || '') + '" data-key="' + esc(c.key) + '" data-dim="' + (c.dim ? 1 : 0) + '">' +
        '<div class="vval">' + nf(c.total) + '</div>' +
        '<div style="height:' + (c.total / top * 100) + '%;display:flex;flex-direction:column;justify-content:flex-end">' +
        '<div class="vbar" data-tex="' + (c.tex || 0) + '" style="--c:' + c.color + ';height:100%"></div></div></div>').join('');
      axisEl.innerHTML = cols.map(c => '<div class="vlab">' + esc(c.label) + '</div>').join('');
    }
    function crossHead(present, label){
      return '<thead><tr><th>' + label + '</th>' + present.map(x => '<th class="num">' + esc(x.label) + '</th>').join('') +
        '<th class="num">Mapped total</th><th class="num muted-col">Unmapped</th></tr></thead>';
    }

    // ---------- L&D Details ----------
    function renderDetails(){
      const sel = selected();
      const mapped = sel.filter(c => c.matched);
      const unmappedSel = sel.filter(c => !c.matched);
      const rows = mapped.filter(c => !state.off.has(c.status));
      const total = rows.length;
      const present = ANALYZE_STATUS.filter(x => rows.some(r => r.status === x.k));

      const subjCounts = {};
      SUBJECTS.forEach(x => { subjCounts[x] = 0; });
      CLIENTS.forEach(c => c.subjects.forEach(x => { if(x in subjCounts) subjCounts[x]++; }));
      $('subjChips').innerHTML = SUBJECTS.map(x => '<button class="subjchip" type="button" data-subj="' + esc(x) +
        '" aria-pressed="' + state.subjects.has(x) + '">' + esc(x) + '<span class="n">' + nf(subjCounts[x]) + '</span></button>').join('');
      $('subjDdLabel').textContent = state.subjects.size === SUBJECTS.length ? 'All subjects selected'
        : state.subjects.size === 0 ? 'No subjects selected' : state.subjects.size + ' of ' + SUBJECTS.length + ' subjects';
      const paBase = CLIENTS.filter(c => c.inPA).length;
      // Active-filter context, kept above the section tabs so it stays visible on every Details section.
      const optLabel = id => { const s = $(id); return s.value ? s.options[s.selectedIndex].text : ''; };
      const active = [['fMonth', 'Month'], ['fTier', 'Tier'], ['fTenure', 'Tenure'], ['fTeam', 'Team'], ['fPlatform', 'Platform'],
        ['fAdvisor', 'Advisor / RM'], ['fSource', 'Lead source']].filter(([id]) => $(id).value).map(([id, l]) => l + ': ' + optLabel(id));
      if(state.q.trim()) active.push('Search: “' + state.q.trim() + '”');
      if(state.off.size) active.push('Statuses hidden: ' + [...state.off].map(k => sInfo(k).label).join(', '));
      $('masterNote').innerHTML = '<b>' + nf(sel.length) + '</b> clients in view · ' +
        (active.length ? esc(active.join(' · ')) : 'no filters applied') + ' · ' + state.subjects.size + ' of ' + SUBJECTS.length +
        ' ticket subjects. The ' + nf(paBase) + ' clients on the Plan Approval sheets always count; the ticked subjects decide which ' +
        'FY-sheet clients are added on top.';
      const flowN = flowTouched().filter(c => c.matched).length;
      $('detailsScope').innerHTML = '<b>L&amp;D Details covers more than the Flow.</b> It counts every client on any L&amp;D tab — FY tickets ' +
        'of every ticked subject, and clients not found in Workpoint — so it shows <b>' + nf(sel.length) + '</b> clients here, against ' +
        '<b>' + nf(flowN) + '</b> touched leads in the current L&amp;D Flow (Plan Approval or the Flow\'s ticked subjects, matched to Workpoint only).';
      $('scopeDiff').innerHTML = '<b>Flow vs Details.</b> L&amp;D Flow counts leads <i>touched</i> by L&amp;D — a Plan Approval row or an FY ' +
        'ticket under the Flow\'s ticked subjects — and only those found in Workpoint. L&amp;D Details lists every client on any L&amp;D tab ' +
        'that passes its own filters, including clients not in Workpoint, so its totals are larger. The two views have separate filters.';

      const cnt = k => rows.filter(r => r.status === k).length;
      const fromPA = sel.filter(c => c.inPA).length, fyOnly = sel.length - fromPA;
      $('kpis').innerHTML = [
        { k: 'Clients in view', v: sel.length, n: 'de-duplicated across every L&amp;D tab', primary: true },
        { k: 'Plan approvals', v: fromPA, n: '<b>' + pct(fromPA, sel.length) + '</b> have an approved plan' },
        { k: 'FY tickets only', v: fyOnly, n: 'no plan approval yet' },
        { k: 'Mapped to lead data', v: mapped.length, n: '<b>' + pct(mapped.length, sel.length) + '</b> matched by email' },
        { k: 'Converted', v: cnt('CONVERTED'), n: '<b>' + pct(cnt('CONVERTED'), total) + '</b> of mapped' },
        { k: 'In process', v: cnt('IN PROCESS'), n: '<b>' + pct(cnt('IN PROCESS'), total) + '</b> of mapped' }
      ].map(t => '<div class="ld-kpi' + (t.primary ? ' ld-kpi-primary' : '') + '"><div class="ld-kpi-label">' + t.k + '</div>' +
        '<div class="ld-kpi-value">' + nf(t.v) + '</div><div class="ld-kpi-note">' + t.n + '</div></div>').join('');

      // 01 composition
      const bothCount = sel.filter(c => c.inPA && c.subjects.length).length;
      $('srcCap').innerHTML = 'The union is keyed on client email, so a client on both a Plan Approval sheet and an FY ' +
        'sheet is one client, not two — <b>' + nf(bothCount) + '</b> are in that overlap.';
      $('srcSplit').innerHTML =
        (fromPA ? '<div class="s-pa" style="flex:' + fromPA + '">Plan approval · ' + nf(fromPA) + '</div>' : '') +
        (fyOnly ? '<div class="s-fy" style="flex:' + fyOnly + '">FY tickets only · ' + nf(fyOnly) + '</div>' : '');
      const srcRows = [
        { l: 'On a Plan Approval sheet', n: fromPA, note: 'carries revenue and approval dates' },
        { l: '— of those, also on an FY sheet', n: bothCount, note: 'the de-duplicated overlap', indent: true },
        { l: 'FY sheets only', n: fyOnly, note: 'counted subject to the master filter' }
      ];
      $('srcTbl').innerHTML = '<thead><tr><th>Source</th><th class="num">Clients</th><th class="num">% of view</th><th>Note</th></tr></thead><tbody>' +
        srcRows.map(r => '<tr><td' + (r.indent ? ' style="padding-left:26px"' : '') + '>' + esc(r.l) + '</td><td class="num">' +
          nf(r.n) + '</td><td class="num">' + pct(r.n, sel.length) + '</td><td class="muted-col">' + esc(r.note) + '</td></tr>').join('') +
        '<tr class="totrow"><td>Total in view</td><td class="num">' + nf(sel.length) + '</td><td class="num">100%</td><td></td></tr></tbody>';

      // 02 lead status
      const statusCols = ANALYZE_STATUS.map(x => ({ key: x.k, label: x.label, color: x.c, tex: x.tex,
        total: mapped.filter(r => r.status === x.k).length, dim: state.off.has(x.k) }))
        .filter(c => c.total > 0).sort((a, b) => b.total - a.total);
      $('distCap').innerHTML = 'Clients by Workpoint lead status, out of <b>' + nf(mapped.length) + '</b> mapped (' +
        pct(mapped.length, sel.length) + ' of ' + nf(sel.length) + ' in view). Click a bar to exclude that status.';
      drawBars($('statusChart'), $('statusAxis'), statusCols, { name: 'status' });
      $('nomatchNote').innerHTML = unmappedSel.length
        ? '<span class="nm-name"><i class="dot"></i>Not matched to lead data</span><span class="nm-val">' + nf(unmappedSel.length) +
          '</span><span class="sub-pct">' + pct(unmappedSel.length, sel.length) + ' of view</span>' +
          '<p class="nm-note">No lead record for these emails, so they have no status — see Unmapped clients. Excluded from every status breakdown.</p>'
        : '';

      // 03 team / RM
      const teamDim = state.team ? 'rm' : 'team';
      const teamGroups = [...new Set(rows.map(r => r[teamDim]))].map(t => ({ t, n: rows.filter(r => r[teamDim] === t).length }))
        .sort((a, b) => b.n - a.n).map(x => x.t);
      $('teamTblTitle').textContent = state.team ? 'RM-wise status' : 'Team-wise status';
      $('teamTblCap').innerHTML = (state.team ? 'Mapped clients per RM within <b>' + esc(state.team) + '</b>, by lead status.'
        : 'Mapped clients per team, by lead status. Team is the current RM\'s team, as on every other tab.') + ' Sorted by client count.';
      $('teamTbl').innerHTML = '<thead><tr><th>' + (state.team ? 'RM' : 'Team') + '</th>' +
        present.map(x => '<th class="num">' + esc(x.label) + '</th>').join('') + '<th class="num">Total</th></tr></thead><tbody>' +
        teamGroups.map(t => { const tr = rows.filter(r => r[teamDim] === t);
          return '<tr><td>' + esc(t || '(No RM)') + '</td>' + present.map(x => '<td class="num">' +
            (tr.filter(r => r.status === x.k).length || '–') + '</td>').join('') + '<td class="num">' + tr.length + '</td></tr>'; }).join('') +
        '<tr class="totrow"><td>All ' + (state.team ? 'RMs' : 'teams') + '</td>' +
        present.map(x => '<td class="num">' + rows.filter(r => r.status === x.k).length + '</td>').join('') + '<td class="num">' + total + '</td></tr></tbody>';

      // 04 team x tier
      const tierColsPresent = TIERS.filter(v => rows.some(r => r.tier === v));
      $('teamTierTitle').textContent = state.team ? 'RM-wise client tier distribution' : 'Team-wise client tier distribution';
      $('teamTierCap').innerHTML = state.team ? 'Mapped clients per RM within <b>' + esc(state.team) + '</b>, by client tier.'
        : 'Mapped clients per team, by client tier.';
      $('teamTierTbl').innerHTML = '<thead><tr><th>' + (state.team ? 'RM' : 'Team') + '</th>' +
        tierColsPresent.map(v => '<th class="num">' + esc(v) + '</th>').join('') + '<th class="num">Total</th></tr></thead><tbody>' +
        teamGroups.map(t => { const tr = rows.filter(r => r[teamDim] === t);
          return '<tr><td>' + esc(t || '(No RM)') + '</td>' + tierColsPresent.map(v => '<td class="num">' +
            (tr.filter(r => r.tier === v).length || '–') + '</td>').join('') + '<td class="num">' + tr.length + '</td></tr>'; }).join('') +
        '<tr class="totrow"><td>All ' + (state.team ? 'RMs' : 'teams') + '</td>' +
        tierColsPresent.map(v => '<td class="num">' + rows.filter(r => r.tier === v).length + '</td>').join('') + '<td class="num">' + total + '</td></tr></tbody>';

      // 05 month x status — a client counts in every month it is active, so cells can exceed Total.
      const months = MONTHS.filter(m => !state.month || m.mk === state.month);
      $('monthMatrix').innerHTML = '<thead><tr><th>Lead status</th>' + months.map(m => '<th class="num">' + esc(m.m) + '</th>').join('') +
        '<th class="num">Total</th></tr></thead><tbody>' +
        present.map(x => { const cells = months.map(m => rows.filter(r => r.status === x.k && r.months.includes(m.mk)).length);
          return '<tr><td class="rowhead">' + esc(x.label) + '</td>' + cells.map((n, i) => '<td class="num cell" data-zero="' +
            (n === 0 ? 1 : 0) + '" title="' + esc(x.label) + ' · ' + esc(months[i].m) + ': ' + n + '">' + (n || '–') + '</td>').join('') +
            '<td class="num">' + rows.filter(r => r.status === x.k).length + '</td></tr>'; }).join('') +
        '<tr class="totrow"><td>All statuses</td>' + months.map(m => '<td class="num">' + rows.filter(r => r.months.includes(m.mk)).length + '</td>').join('') +
        '<td class="num">' + total + '</td></tr>' +
        (unmappedSel.length ? '<tr><td class="muted-col">Not matched</td>' + months.map(m => '<td class="num muted-col">' +
          (unmappedSel.filter(r => r.months.includes(m.mk)).length || '–') + '</td>').join('') +
          '<td class="num muted-col">' + unmappedSel.length + '</td></tr>' : '') + '</tbody>';

      // 06 subjects
      const subjSel = {};
      SUBJECTS.forEach(x => { subjSel[x] = 0; });
      sel.forEach(c => c.subjects.forEach(x => { if(x in subjSel) subjSel[x]++; }));
      const subjRows = SUBJECTS.map(x => ({ s: x, n: subjSel[x] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      const subjMax = Math.max(1, ...subjRows.map(x => x.n));
      $('subjCap').innerHTML = 'Ticket subjects across the <b>' + nf(sel.filter(c => c.subjects.length).length) + '</b> clients in view that ' +
        'have an FY ticket. A client working on two subjects appears under both, so these add up to more than the client count.';
      $('subjBars').innerHTML = subjRows.map(x => '<div class="hbar"><div class="lab">' + esc(x.s) + '</div><div class="track"><div class="fill" style="width:' +
        (x.n / subjMax * 100) + '%"></div></div><div class="val">' + nf(x.n) + '</div></div>').join('') ||
        '<p class="hint">No FY tickets in the current selection.</p>';

      // 07 tier + tenure
      function classTable(id, values, field, capId, capText){
        const present2 = values.filter(v => sel.some(c => c[field] === v));
        $(capId).innerHTML = capText;
        $(id).innerHTML = '<thead><tr><th>' + (field === 'tier' ? 'Tier' : 'Tenure') + '</th><th class="num">Clients</th>' +
          '<th class="num">% of view</th><th class="num">Mapped</th><th class="num muted-col">Unmapped</th></tr></thead><tbody>' +
          present2.map(v => { const cr = sel.filter(c => c[field] === v); const nm = cr.filter(c => !c.matched).length;
            return '<tr><td>' + esc(v) + '</td><td class="num">' + nf(cr.length) + '</td><td class="num">' + pct(cr.length, sel.length) +
              '</td><td class="num">' + nf(cr.length - nm) + '</td><td class="num muted-col">' + (nm || '–') + '</td></tr>'; }).join('') +
          '<tr class="totrow"><td>All</td><td class="num">' + nf(sel.length) + '</td><td class="num">100%</td><td class="num">' +
          nf(mapped.length) + '</td><td class="num">' + nf(unmappedSel.length) + '</td></tr></tbody>';
      }
      classTable('tierTbl', TIERS, 'tier', 'tierCap', TIER_SOURCE_NOTE + ' <b>' + BLANK + '</b> means neither source has a grade for that client.');
      classTable('tenureTbl', TENURES, 'tenure', 'tenureCap', 'Recorded <b>New / Existing</b> on the Plan Approval sheets. <b>' + BLANK +
        '</b> means the client has no plan approval, so no tenure was ever set.');

      // 08 tier x tenure
      const tiersP = TIERS.filter(v => sel.some(c => c.tier === v));
      const tenuresP = TENURES.filter(v => sel.some(c => c.tenure === v));
      $('crossCap').innerHTML = 'The two classifications are different things from different sources, so crossing them shows where ' +
        'they overlap — and how much of the book carries neither.';
      $('crossTbl').innerHTML = '<thead><tr><th>Tier ＼ Tenure</th>' + tenuresP.map(v => '<th class="num">' + esc(v) + '</th>').join('') +
        '<th class="num">Total</th></tr></thead><tbody>' +
        tiersP.map(tv => { const cells = tenuresP.map(nv => sel.filter(c => c.tier === tv && c.tenure === nv).length);
          return '<tr><td class="rowhead">' + esc(tv) + '</td>' + cells.map((n, i) => '<td class="num' +
            (tv === BLANK || tenuresP[i] === BLANK ? ' muted-col' : ' diag') + '">' + (n || '–') + '</td>').join('') +
            '<td class="num">' + nf(cells.reduce((a, b) => a + b, 0)) + '</td></tr>'; }).join('') +
        '<tr class="totrow"><td>Total</td>' + tenuresP.map(nv => '<td class="num">' + nf(sel.filter(c => c.tenure === nv).length) + '</td>').join('') +
        '<td class="num">' + nf(sel.length) + '</td></tr></tbody>';

      // 09 tier x status
      $('tierStatusTbl').innerHTML = crossHead(present, 'Tier') + '<tbody>' +
        tiersP.map(v => { const cr = rows.filter(r => r.tier === v); const nm = unmappedSel.filter(r => r.tier === v).length;
          return '<tr><td>' + esc(v) + '</td>' + present.map(x => { const n = cr.filter(r => r.status === x.k).length;
            return '<td class="num">' + (n || '–') + (n ? ' <span class="sub-pct">' + pct(n, cr.length) + '</span>' : '') + '</td>'; }).join('') +
            '<td class="num">' + nf(cr.length) + '</td><td class="num muted-col">' + (nm || '–') + '</td></tr>'; }).join('') +
        '<tr class="totrow"><td>All tiers</td>' + present.map(x => '<td class="num">' + rows.filter(r => r.status === x.k).length + '</td>').join('') +
        '<td class="num">' + nf(total) + '</td><td class="num">' + nf(unmappedSel.length) + '</td></tr></tbody>';

      // 10 revenue (plan approvals only)
      const revCells = selectedTickets();
      const prodLabel = state.product === 'all' ? 'All products (sum)' : (PRODUCTS.find(p => p.k === state.product) || {}).label;
      $('revCap').innerHTML = 'Showing <b>' + esc(prodLabel) + '</b> across <b>' + nf(revCells.length) + '</b> plan approvals. Grand total ' +
        moneyFull(revCells.reduce((a, r) => a + revOf(r), 0)) + '.';
      $('revWarn').innerHTML = fyOnly ? '<div class="ld-warn">Revenue exists only on the Plan Approval sheets. The <b>' + nf(fyOnly) +
        '</b> FY-only clients in view have no revenue figures, so this table covers the ' + nf(fromPA) + ' with an approved plan.</div>' : '';
      const revSum = arr => arr.reduce((a, r) => a + revOf(r), 0);
      const mcell = v => '<td class="num" title="' + moneyFull(v) + '">' + money(v) + '</td>';
      $('revTbl').innerHTML = crossHead(present, 'Tier') + '<tbody>' +
        tiersP.map(v => { const cr = revCells.filter(r => r.tier === v);
          return '<tr><td>' + esc(v) + '</td>' + present.map(x => mcell(revSum(cr.filter(r => r.status === x.k)))).join('') +
            mcell(revSum(cr.filter(r => r.matched))) + mcell(revSum(cr.filter(r => !r.matched))).replace('class="num"', 'class="num muted-col"') + '</tr>'; }).join('') +
        '<tr class="totrow"><td>All tiers</td>' + present.map(x => mcell(revSum(revCells.filter(r => r.status === x.k)))).join('') +
        mcell(revSum(revCells.filter(r => r.matched))) + mcell(revSum(revCells.filter(r => !r.matched))) + '</tr></tbody>';

      // 11 client list
      const cols = [{ k: 'm', t: 'Month' }, { k: 'name', t: 'Client' }, { k: 'email', t: 'Email id' }, { k: 'status', t: 'Lead status' },
        { k: 'tier', t: 'Tier' }, { k: 'tenure', t: 'Tenure' }, { k: 'team', t: 'Team' }, { k: 'rm', t: 'RM' },
        { k: 'advisor', t: 'Advisor' }, { k: 'platform', t: 'Platform' }, { k: 'src', t: 'Lead source' }];
      const listRows = sel.filter(statusVisible).slice().sort((a, b) => {
        const k = state.sort.key, d = state.sort.dir;
        const av = String(a[k] == null ? '' : a[k]).toLowerCase(), bv = String(b[k] == null ? '' : b[k]).toLowerCase();
        return av < bv ? -d : av > bv ? d : 0;
      });
      $('listCap').innerHTML = 'Showing <b>' + nf(listRows.length) + '</b> clients — one row per email id. <b>#</b> is how many tickets ' +
        'that client has across every L&amp;D tab. Click a column header to sort.';
      $('clientTbl').innerHTML = '<thead><tr>' + cols.map(c => '<th data-key="' + c.k + '">' + c.t +
        (state.sort.key === c.k ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '<th>Subjects</th><th class="num">#</th></tr></thead><tbody>' +
        listRows.map(r => '<tr>' + cols.map(c => {
          if(c.k === 'status'){ const x = sInfo(r.status);
            return '<td><span class="ld-pill" style="--c:' + x.c + '"><i class="dot"></i>' + esc(x.label) + '</span></td>'; }
          if(c.k === 'name') return '<td class="wrapcell">' + esc(r.name) + '</td>';
          return '<td>' + esc(r[c.k] || '–') + '</td>';
        }).join('') + '<td class="wrapcell muted-col">' + esc(r.subjects.join(', ') || '–') + '</td><td class="num">' + r.nTickets + '</td></tr>').join('') + '</tbody>';
      $('downloadCap').innerHTML = 'Every field on the client record for the <b>' + nf(sel.filter(statusVisible).length) +
        '</b> clients in the current view — respects every filter above, including team/RM and the ticket subject picker.';

      $('statusChips').innerHTML = ANALYZE_STATUS.filter(x => CLIENTS.some(c => c.status === x.k)).map(x =>
        '<button class="ld-chip" type="button" data-status="' + esc(x.k) + '" data-off="' + (state.off.has(x.k) ? 1 : 0) +
        '" aria-pressed="' + (!state.off.has(x.k)) + '" style="--c:' + x.c + '"><i class="dot"></i>' + esc(x.label) + '</button>').join('');
      renderLists();
      updateHead();
    }

    // ---------- data-flag lists (Unmapped / Date issues / Missing emails) ----------
    const subjOk = r => !r.subject || !SUBJECTS_SET.has(r.subject) || state.subjects.has(r.subject);
    const unmappedFiltered = () => (DATA.unmapped || []).filter(r =>
      (!state.month || r.months.includes(state.month)) && (!state.tier || r.tier === state.tier) &&
      (!state.tenure || r.tenure === state.tenure) && (!state.advisor || r.advisor === state.advisor) &&
      (r.inPA || subjectsInScope(r).some(x => state.subjects.has(x))));
    function listTable(id, cols, rows, emptyText){
      $(id).innerHTML = '<thead><tr>' + cols.map(c => '<th>' + c.t + '</th>').join('') + '</tr></thead><tbody>' +
        (rows.length ? rows.map(r => '<tr>' + cols.map(c => {
          const v = c.k === 'subjects' ? r.subjects.join(', ') : r[c.k];
          return '<td' + (c.wrap ? ' class="wrapcell"' : c.k === 'row' ? ' class="num"' : '') + '>' + esc(v || '–') + '</td>';
        }).join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '">' + emptyText + '</td></tr>') + '</tbody>';
    }
    const UCOLS = [{ k: 'date', t: 'Date' }, { k: 'ticket', t: 'Ticket ID' }, { k: 'tier', t: 'Tier' }, { k: 'tenure', t: 'Tenure' },
      { k: 'name', t: 'Client name', wrap: 1 }, { k: 'email', t: 'Client mail ID' }, { k: 'advisor', t: 'Advisor / RM' },
      { k: 'subjects', t: 'Ticket subjects', wrap: 1 }, { k: 'locations', t: 'Sheet / Row', wrap: 1 }];
    const DCOLS = [{ k: 'sheet', t: 'Sheet' }, { k: 'row', t: 'Row' }, { k: 'column', t: 'Column' }, { k: 'raw', t: 'Value as typed' },
      { k: 'ticket', t: 'Ticket' }, { k: 'name', t: 'Client name', wrap: 1 }, { k: 'email', t: 'Client mail ID' },
      { k: 'subject', t: 'Ticket subject' }, { k: 'issue', t: 'Problem', wrap: 1 }];
    const NCOLS = [{ k: 'sheet', t: 'Sheet' }, { k: 'row', t: 'Row' }, { k: 'ticket', t: 'Ticket' }, { k: 'name', t: 'Client name', wrap: 1 },
      { k: 'month', t: 'Month' }, { k: 'date', t: 'Date as typed' }, { k: 'subject', t: 'Ticket subject' }];
    function renderLists(){
      const un = unmappedFiltered();
      $('unmappedBadge').textContent = nf(un.length);
      $('unmappedCap').innerHTML = 'Showing <b>' + nf(un.length) + '</b> client' + (un.length === 1 ? '' : 's') + ' whose email has no ' +
        'match in the lead data (the daily B2C upload, or the hard-coded values for older leads). Create or correct their lead record. ' +
        'The month, tier, tenure, advisor and ticket-subject filters under L&amp;D Details apply here.';
      listTable('unmappedTbl', UCOLS, un, 'Every client in this selection mapped to a lead record.');
      const di = (DATA.dateIssues || []).filter(subjOk);
      $('dateIssuesBadge').textContent = nf(di.length);
      $('dateIssuesCap').innerHTML = di.length ? 'Found <b>' + nf(di.length) + '</b> row' + (di.length === 1 ? '' : 's') + ' where a date ' +
        'cell could not be trusted — it does not parse as a date, or parses to a year outside ' + FY_LABEL + ' (a likely typo, e.g. ' +
        '11.06.<b>2926</b>). Each is bucketed by its Month column instead, but the sheet still needs correcting at the row shown. ' +
        'The ticket-subject filter applies; a Plan Approval row has no subject and always shows.' : 'No date issues in the current subject selection.';
      listTable('dateIssuesTbl', DCOLS, di, 'Nothing to show.');
      const ne = (DATA.noEmailRows || []).filter(subjOk);
      $('noEmailBadge').textContent = nf(ne.length);
      $('noEmailCap').innerHTML = ne.length ? 'Found <b>' + nf(ne.length) + '</b> row' + (ne.length === 1 ? '' : 's') + ' with a client ' +
        'name but no email address. These cannot be matched to the lead data or de-duplicated, so they take no part in the dashboard — ' +
        'add the email at the row shown to bring them in. The ticket-subject filter applies; a Plan Approval row always shows.'
        : 'No rows are missing a client email in the current subject selection.';
      listTable('noEmailTbl', NCOLS, ne, 'Nothing to show.');

      // Summary cards: the all-sheets count is the headline, with how many the list shows after the
      // Details filters; each count keeps its own unit (clients vs rows) and is never added to another.
      const cur = (root.querySelector('[data-dq][aria-selected="true"]') || {}).dataset;
      const card = (tab, k, total, unit, listed) => '<button type="button" class="ld-dq-card' + (cur && cur.dq === tab ? ' active' : '') +
        '" data-tab="' + tab + '"><div class="k">' + k + '</div><div class="v">' + nf(total) + '</div><div class="s">' + unit +
        ' across all sheets · ' + nf(listed) + ' listed below after the L&amp;D Details filters</div></button>';
      $('dqSummary').innerHTML =
        card('unmapped', 'Unmapped clients', (DATA.unmapped || []).length, 'clients', un.length) +
        card('dateissues', 'Date issues', (DATA.dateIssues || []).length, 'date cells', di.length) +
        card('noemail', 'Missing emails', (DATA.noEmailRows || []).length, 'rows', ne.length);
    }

    // ---------- L&D Flow ----------
    // Leads created -> leads L&D touched -> in process / converted, with its own Month / Ticket
    // subjects / L&D employee / Team filters. A lead is touched if it has a Plan Approval row, or an
    // FY ticket under one of the ticked subjects — in the selected month when one is picked. A
    // touched lead with ANY FY ticket in that period counts as "via ticket subject", even when it is
    // on a Plan Approval sheet too; "via plan approval only" is the rest.
    const LD_DEFAULT_SUBJECTS = (META.ldSubjects || []).filter(x => SUBJECTS_SET.has(x));
    const LD_PEOPLE = META.ldPeople || [];
    const LEADS_CREATED = META.leadsCreated || {};
    const flowState = { month: '', team: '', emp: '', subjects: new Set(LD_DEFAULT_SUBJECTS) };
    let flowPeriod = FY_LABEL;   // the page heading's period indicator on Flow / Employee View
    const subjOn = x => flowState.subjects.has(x);
    const FLOW_MONTHS = [...new Set(Object.keys(LEADS_CREATED).concat(MONTHS.map(m => m.mk)))].filter(mk => /^\d{4}-\d{2}$/.test(mk)).sort();
    const monthLabel = mk => MONTH_LABELS[mk] || (MONTHS_3[+mk.slice(5, 7) - 1] + ' ' + mk.slice(0, 4));
    // An employee's own work: plans they approved, and tickets assigned to them under a ticked subject.
    const empTouch = t => t[2] === 'approved' || (t[2] === 'created' && subjOn(t[3]));
    function ldTouch(c, mk){
      let pa, sub, anyTicket;
      if(flowState.emp){
        const ts = c.ldTouches.filter(t => t[1] === flowState.emp && (!mk || t[0] === mk));
        pa = ts.some(t => t[2] === 'approved');
        sub = ts.some(t => t[2] === 'created' && subjOn(t[3]));
        anyTicket = ts.some(t => t[2] === 'created');
      } else {
        pa = mk ? c.paMonths.includes(mk) : c.inPA;
        sub = (mk ? (c.monthSubjects[mk] || []) : c.subjects).some(subjOn);
        anyTicket = mk ? c.fyMonths.includes(mk) : c.fyMonths.length > 0;
      }
      return (pa || sub) ? { pa, sub, via: anyTicket ? 'ticket' : 'pa' } : null;
    }
    const flowTouched = () => CLIENTS.filter(c => (!flowState.team || c.team === flowState.team) && ldTouch(c, flowState.month));
    // Team cannot apply to an unmapped client (team comes from the lead's RM).
    const flowUnmapped = () => CLIENTS.filter(c => !c.matched && ldTouch(c, flowState.month));
    const flagRowInView = r => (r.pa || subjOn(r.subject)) && (!flowState.month || r.mk === flowState.month) &&
      (!flowState.emp || (r.emps || []).includes(flowState.emp));
    const ldPeopleOf = (c, mk) => [...new Set(c.ldTouches.filter(t => (!mk || t[0] === mk) && LD_PEOPLE.includes(t[1]) && empTouch(t))
      .map(t => t[1]))].sort().join('; ');
    // "the 4 L&D plan subjects" / "All 18 subjects" / the picked names, for captions and the toggle.
    function subjectsLabel(short){
      const n = flowState.subjects.size;
      const isDefault = n === LD_DEFAULT_SUBJECTS.length && LD_DEFAULT_SUBJECTS.every(subjOn);
      if(isDefault) return short ? 'L&D plan subjects (' + n + ')' : 'the L&D plan subjects (' + LD_DEFAULT_SUBJECTS.join(', ') + ')';
      if(n === SUBJECTS.length) return 'All ' + n + ' subjects';
      if(!n) return short ? 'No subjects' : 'no ticket subject';
      const picked = SUBJECTS.filter(subjOn);
      return short ? (n === 1 ? picked[0] : n + ' subjects') : (n <= 4 ? picked.join(', ') : n + ' subjects');
    }
    function renderFlowSubjects(){
      const counts = {};
      CLIENTS.forEach(c => c.subjects.forEach(x => { counts[x] = (counts[x] || 0) + 1; }));
      $('flowSubjLabel').textContent = subjectsLabel(true);
      $('flowSubjChips').innerHTML = '<div class="ld-subj-actions"><button type="button" data-act="ld">L&amp;D plan subjects</button>' +
        '<button type="button" data-act="all">Select all</button><button type="button" data-act="none">Clear all</button></div>' +
        SUBJECTS.map(x => '<button class="subjchip" type="button" data-subj="' + esc(x) + '" aria-pressed="' + subjOn(x) + '">' +
          esc(x) + '<span class="n">' + nf(counts[x] || 0) + '</span></button>').join('');
    }
    function createdBucket(c){
      const d = c.created || '';
      if(!d) return 'unknown';
      if(flowState.month && d.slice(0, 7) === flowState.month) return 'month';
      return d >= FY_START ? 'fy' : 'prev';
    }
    const statusGroup = x => x === 'IN PROCESS' ? 'inprocess' : x === 'CONVERTED' ? 'converted' : 'other';

    function renderFlow(){
      const mk = flowState.month, team = flowState.team, emp = flowState.emp;
      const windowLabel = mk ? monthLabel(mk) : FY_LABEL;
      const created = (mk ? [mk] : Object.keys(LEADS_CREATED)).reduce((a, m) => {
        const byTeam = LEADS_CREATED[m] || {};
        return a + (team ? (byTeam[team] || 0) : Object.values(byTeam).reduce((x, y) => x + y, 0));
      }, 0);
      const touched = flowTouched().filter(c => c.matched);
      const unmapped = flowUnmapped();
      const n = touched.length;
      const by = f => touched.reduce((o, c) => { const k = f(c); o[k] = (o[k] || 0) + 1; return o; }, {});
      const bucket = by(createdBucket), group = by(c => statusGroup(c.status));
      const routes = by(c => ldTouch(c, mk).via);
      const inWindow = mk ? (bucket.month || 0) : (bucket.fy || 0);

      // Period indicator in the page heading (Flow / Employee View).
      flowPeriod = windowLabel + (team ? ' · ' + team : '') + (emp ? ' · ' + emp : '');

      // KPI cards: touched, then its three Workpoint status groups (which add up to it).
      const ip = group.inprocess || 0, cv = group.converted || 0, ot = group.other || 0;
      const kpi = (label, v, note, primary) => '<div class="ld-kpi' + (primary ? ' ld-kpi-primary' : '') + '"><div class="ld-kpi-label">' +
        label + '</div><div class="ld-kpi-value">' + nf(v) + '</div><div class="ld-kpi-note">' + note + '</div></div>';
      $('flowKpis').innerHTML =
        kpi('Leads touched by L&amp;D', n, 'Matched to Workpoint · ' + esc(windowLabel), true) +
        kpi('In process', ip, '<b>' + pct(ip, n) + '</b> of touched leads') +
        kpi('Converted', cv, '<b>' + pct(cv, n) + '</b> of touched leads') +
        kpi('Other statuses', ot, '<b>' + pct(ot, n) + '</b> of touched leads');

      // Current lead status: a labelled bar per group, count and share beside each label.
      $('statusSub').textContent = 'Current Workpoint status of the ' + nf(n) + ' touched leads. Shares are of touched leads.';
      $('statusBars').innerHTML = [['In process', ip, 'var(--ld-primary)'], ['Converted', cv, 'var(--ld-success)'],
        ['Other statuses', ot, 'var(--ld-other)']].map(([label, v, c]) =>
        '<div class="ld-bar"><div class="ld-bar-top"><span>' + label + '</span><span><span class="v">' + nf(v) + '</span><span class="p">' +
        pct(v, n) + '</span></span></div><div class="ld-bar-track" aria-hidden="true"><div class="ld-bar-fill" style="--c:' + c +
        ';width:' + (n ? v / n * 100 : 0) + '%"></div></div></div>').join('');

      // How L&D reached them: two independent breakdowns of the same leads, kept visually apart.
      const kv = rs => '<dl class="ld-kv">' + rs.map(r => '<dt>' + esc(r[0]) + '</dt><dd>' + nf(r[1] || 0) + '</dd><dd class="p">' +
        pct(r[1] || 0, n) + '</dd>').join('') + '</dl>';
      const cohort = mk
        ? [['Created in ' + windowLabel, bucket.month], ['Created in other months of ' + FY_LABEL, bucket.fy], ['Created before ' + FY_LABEL, bucket.prev]]
        : [['Created in ' + FY_LABEL, bucket.fy], ['Created in previous financial years', bucket.prev]];
      if(bucket.unknown) cohort.push(['No created date in lead data', bucket.unknown]);
      $('reach').innerHTML =
        '<div class="ld-group"><h3 class="ld-group-title">Entry route</h3><p class="ld-group-note">A lead with any FY ticket counts under ' +
          'ticket subject, even when it is on a Plan Approval sheet too.</p>' +
          kv([['Via ticket subject', routes.ticket], ['Via plan approval only (no FY ticket)', routes.pa]]) + '</div>' +
        '<div class="ld-group"><h3 class="ld-group-title">Lead creation cohort</h3><p class="ld-group-note">When the lead was created ' +
          'in Workpoint.</p>' + kv(cohort) + '</div>';

      // Lead-creation context — a share, not a funnel: touched leads also include older leads.
      const prevTouched = n - inWindow - (bucket.unknown || 0);
      $('flowContext').innerHTML = created
        ? 'Of the <b>' + nf(created) + '</b> leads created in ' + esc(windowLabel) + (team ? ' for ' + esc(team) : '') + ', <b>' + nf(inWindow) +
          '</b> (' + pct(inWindow, created) + ') were touched by L&amp;D' + (mk ? ' in that month' : '') + '.' +
          '<span class="ld-context-note">The ' + nf(n) + ' touched leads also include ' + nf(prevTouched) + ' created ' +
          (mk ? 'outside ' + esc(windowLabel) : 'in earlier financial years') + ', so this is a share of new leads, not a funnel.' +
          (emp ? ' Leads created is not split by L&amp;D employee.' : '') + '</span>'
        : 'No leads were created in ' + esc(windowLabel) + (team ? ' for ' + esc(team) : '') + ' in the lead data.';

      // The full scope sentence lives in "Definitions & source notes".
      renderFlowSubjects();
      $('flowCap').innerHTML = '<b>Current L&amp;D Flow view.</b> ' +
        (mk ? 'Showing <b>' + esc(windowLabel) + '</b>' : 'Showing the whole of <b>' + esc(FY_LABEL) + '</b>') +
        (team ? ' for <b>' + esc(team) + '</b>' : ' across all teams') + (emp ? ', handled by <b>' + esc(emp) + '</b>' : '') +
        '. A lead is <b>touched by L&amp;D</b> if it has a Plan Approval row, or an FY ticket under ' + esc(subjectsLabel(false)) +
        (mk ? ', in that month' : '') + ', and is found in Workpoint. A lead that has any FY ticket is counted <i>via ticket subject</i>, even ' +
        'when it is on a Plan Approval sheet too' + (emp ? ' — counting only plans ' + esc(emp) + ' approved, and tickets assigned to ' + esc(emp) +
          '. <i>Leads created</i> is not split by L&amp;D employee, since L&amp;D does not own leads' : '') + '.' +
        (unmapped.length ? ' <b>' + nf(unmapped.length) + '</b> more clients L&amp;D worked with' + (team ? ' (any team)' : '') +
          ' are not in the lead data and are left out (Data Quality → Unmapped clients).' : '') +
        (mk && !MONTHS.some(m => m.mk === mk) ? ' <b>No ticket rows are loaded for this month</b> (' + esc(META.excludedMonths.join(', ')) +
          ' is excluded by request).' : '');

      // status by client tier
      const tierRows = TIERS.map(t => {
        const rs = touched.filter(c => c.tier === t);
        const gk = k => rs.filter(c => statusGroup(c.status) === k).length;
        const other = {};
        rs.filter(c => statusGroup(c.status) === 'other').forEach(c => { other[c.status] = (other[c.status] || 0) + 1; });
        return { t, total: rs.length, ip: gk('inprocess'), cv: gk('converted'), ot: gk('other'), other };
      }).filter(r => r.total);
      const cell = (v, tot) => '<td class="num">' + nf(v) + ' <span class="sub-pct">' + pct(v, tot) + '</span></td>';
      const otherTip = o => Object.keys(o).sort((a, b) => o[b] - o[a]).map(k => sInfo(k).label + ': ' + o[k]).join(', ');
      const sum = k => tierRows.reduce((a, r) => a + r[k], 0);
      const allOther = {};
      tierRows.forEach(r => Object.keys(r.other).forEach(k => { allOther[k] = (allOther[k] || 0) + r.other[k]; }));
      $('flowTierCap').innerHTML = 'The <b>' + nf(n) + '</b> touched leads, split by client tier. Percentages are of the row total. ' +
        TIER_SOURCE_NOTE + (tierRows.some(r => r.t === BLANK) ? ' <b>' + esc(BLANK) + '</b> means neither source has a grade for the client.' : '');
      // "Other statuses" spelled out per tier, so the breakdown doesn't depend on hovering.
      const otherList = (label, o) => '<li><b>' + esc(label) + '</b> — ' + (Object.keys(o).length ? esc(otherTip(o)) : 'none') + '</li>';
      $('otherBreakdown').innerHTML = tierRows.map(r => otherList(r.t, r.other)).join('') + otherList('All tiers', allOther);
      $('flowTierTbl').innerHTML = '<thead><tr><th>Client tier</th><th class="num">In process</th><th class="num">Converted</th>' +
        '<th class="num">Other statuses</th><th class="num">Total</th></tr></thead><tbody>' +
        tierRows.map(r => '<tr><td>' + esc(r.t) + '</td>' + cell(r.ip, r.total) + cell(r.cv, r.total) + '<td class="num" title="' +
          esc(otherTip(r.other)) + '">' + nf(r.ot) + ' <span class="sub-pct">' + pct(r.ot, r.total) + '</span></td><td class="num">' + nf(r.total) + '</td></tr>').join('') +
        '<tr class="totrow"><td>Total</td>' + cell(sum('ip'), n) + cell(sum('cv'), n) + '<td class="num" title="' + esc(otherTip(allOther)) + '">' +
        nf(sum('ot')) + ' <span class="sub-pct">' + pct(sum('ot'), n) + '</span></td><td class="num">' + nf(n) + '</td></tr></tbody>';

      renderFlags(unmapped);
      renderEmpTable();
      updateHead();
    }

    // Compact strip on the Flow: the three checks for the CURRENT Flow view, each opening its report.
    // (All-sheet totals are on the Data Quality view, labelled as such — the two scopes are never mixed.)
    function renderFlags(unmapped){
      const di = DATA.dateIssues || [], ne = DATA.noEmailRows || [];
      const items = [
        { tab: 'unmapped', v: unmapped.length, k: 'unmapped clients', t: 'L&D clients whose email has no lead record, left out of the flow' },
        { tab: 'dateissues', v: di.filter(flagRowInView).length, k: 'date issues', t: 'Rows with a date that cannot be read, or falls outside ' + FY_LABEL },
        { tab: 'noemail', v: ne.filter(flagRowInView).length, k: 'missing-email rows', t: 'Rows with a client name but no email, so they cannot be counted' }
      ];
      $('flowFlags').innerHTML = '<span class="ld-dq-title">Data quality in this view:</span>' + items.map(f =>
        '<button type="button" class="ld-dq-item" data-tab="' + f.tab + '" title="' + esc(f.t) + '" aria-label="' + nf(f.v) + ' ' + f.k +
        ' in the current view — open the report"><b>' + nf(f.v) + '</b> ' + f.k + '</button>').join('') +
        '<span class="ld-dq-hint">Click one to open its report under Data Quality.</span>';
    }

    // Plans per source row; clients once per employee (so the Total row counts distinct clients).
    function empRows(){
      const mk = flowState.month, team = flowState.team;
      const pool = CLIENTS.filter(c => !team || c.team === team);
      return LD_PEOPLE.map(p => {
        const cnt = { created: 0, approved: 0 }, cl = [];
        pool.forEach(c => {
          const ts = c.ldTouches.filter(t => t[1] === p && (!mk || t[0] === mk) && empTouch(t));
          if(!ts.length) return;
          ts.forEach(t => { cnt[t[2]]++; });
          cl.push({ c, cnt: ts.reduce((o, t) => { o[t[2]] = (o[t[2]] || 0) + 1; return o; }, {}) });
        });
        return { p, cnt, cl };
      });
    }
    function renderEmpTable(){
      const rows = empRows();
      const present = ANALYZE_STATUS.filter(x => rows.some(r => r.cl.some(y => y.c.matched && y.c.status === x.k)));
      const statusCells = clients => {
        const mapped = clients.filter(c => c.matched);
        return present.map(x => { const v = mapped.filter(c => c.status === x.k).length;
          return '<td class="num">' + (v ? nf(v) + ' <span class="sub-pct">' + pct(v, mapped.length) + '</span>' : '–') + '</td>'; }).join('') +
          '<td class="num muted-col">' + (clients.length - mapped.length || '–') + '</td>';
      };
      const line = (label, cnt, clients, attrs) => '<tr' + (attrs || '') + '><td>' + label + '</td><td class="num grp-edge">' + nf(cnt.created) +
        '</td><td class="num">' + nf(cnt.approved) + '</td><td class="num grp-edge">' + nf(clients.length) + '</td>' + statusCells(clients) + '</tr>';
      const uniq = [...new Map(rows.flatMap(r => r.cl.map(y => [y.c.cid, y.c]))).values()];
      const tot = rows.reduce((o, r) => { Object.keys(o).forEach(k => { o[k] += r.cnt[k]; }); return o; }, { created: 0, approved: 0 });
      $('flowEmpCap').innerHTML = '<b>Created</b> = FY tickets under ' + esc(subjectsLabel(false)) + ' assigned to that person. ' +
        '<b>Approved</b> = Plan Approval rows with that person in <i>Approved By</i>. Client outcome columns are the current Workpoint lead ' +
        'status of the clients behind those plans; percentages are of the row\'s clients found in Workpoint. Follows the Month, Ticket ' +
        'subjects and Team filters. Select a row (click, or Enter) to filter L&amp;D Flow and this view by that employee; select it again to clear.';
      $('flowEmpTbl').innerHTML = '<thead><tr><th class="grp"></th><th class="grp grp-edge" colspan="2">Plan activity</th>' +
        '<th class="grp grp-edge" colspan="' + (present.length + 2) + '">Client outcomes (current Workpoint status)</th></tr>' +
        '<tr><th>L&amp;D employee</th><th class="num grp-edge">Created</th><th class="num">Approved</th><th class="num grp-edge">Clients</th>' +
        present.map(x => '<th class="num">' + esc(x.label) + '</th>').join('') + '<th class="num muted-col">Not in lead data</th></tr></thead><tbody>' +
        rows.map(r => line(esc(r.p), r.cnt, r.cl.map(y => y.c), ' data-emp="' + esc(r.p) + '" data-on="' + (r.p === flowState.emp ? 1 : 0) +
          '" tabindex="0" aria-selected="' + (r.p === flowState.emp) + '"')).join('') +
        line('Total (distinct clients)', tot, uniq, ' class="totrow"') + '</tbody>';
    }

    function renderFoot(){
      $('foot').innerHTML = '<b>Sources.</b> L&amp;D workbook (' + nf(META.ldRows) + ' rows from ' +
        META.tabs.map(t => '<code>' + esc(t) + '</code>').join(' + ') + '), de-duplicated on client email. Workpoint lead status, RM, ' +
        'team, created date and tier: the daily B2C upload (' + nf(META.leadRows) + ' leads; ' + nf(META.leadsFromLive) + ' L&amp;D clients ' +
        'found there) and, for older leads it does not carry, hard-coded values from <code>' + esc(META.snapshotFile || 'ld_leads_snapshot.js') +
        '</code>' + (META.snapshotGenerated ? ' (generated ' + esc(META.snapshotGenerated) + ')' : '') + ' — ' + nf(META.leadsFromSnapshot) +
        ' clients.<br><b>Excluded.</b> ' + esc(META.excludedMonths.join(', ')) + ' by request' + (META.noEmailRows ? '; a further ' +
        nf(META.noEmailRows) + ' rows carry a client name but no email, so they cannot be matched or de-duplicated' : '') + '.';
    }

    // ---------- CSV downloads ----------
    function downloadCsv(filename, head, lines){
      const csv = [head].concat(lines).map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = filename; a.click(); URL.revokeObjectURL(a.href);
    }
    const CLIENT_COLS = ['m', 'name', 'email', 'ticket', 'status', 'tier', 'tierSrc', 'tenure', 'team', 'rm', 'advisor', 'appr',
                         'platform', 'src', 'leadSrc', 'created', 'converted', 'locations'];
    const CLIENT_HEAD = ['Month', 'Client Name', 'Email Id', 'Ticket ID', 'Lead Status', 'Tier', 'Tier Source', 'Tenure', 'Team', 'RM',
                         'Advisor', 'Approved By', 'Platform', 'Lead Source', 'Lead Data From', 'Lead Created', 'Converted On', 'Sheet / Row'];
    const csvHandlers = {
      clientCsvBtn: () => {
        const head = CLIENT_HEAD.concat(['Matched to Lead Data', 'On Plan Approval Sheet', '# Plan Approvals', '# FY Tickets', '# Tickets Total',
          'Ticket Subjects'], PRODUCTS.map(p => p.label), ['Total Revenue (all products)']);
        downloadCsv('ld-financial-planning-client-details.csv', head, selected().filter(statusVisible).map(r => CLIENT_COLS.map(c => r[c]).concat(
          [r.matched ? 'Yes' : 'No', r.inPA ? 'Yes' : 'No', r.nPA, r.nFY, r.nTickets, r.subjects.join('; ')],
          PRODUCTS.map(p => r.rev[p.k] || 0), [PRODUCTS.reduce((a, p) => a + (r.rev[p.k] || 0), 0)])));
      },
      tierStatusCsvBtn: () => {
        const rows = selected().filter(c => c.matched && !state.off.has(c.status)).slice().sort((a, b) =>
          (TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) || (STATUS.findIndex(x => x.k === a.status) - STATUS.findIndex(x => x.k === b.status)) ||
          a.name.localeCompare(b.name));
        downloadCsv('tier-status-client-details.csv', CLIENT_HEAD, rows.map(r => CLIENT_COLS.map(c => r[c])));
      },
      unmappedCsvBtn: () => downloadCsv('unmapped-clients.csv', UCOLS.map(c => c.t),
        unmappedFiltered().map(r => UCOLS.map(c => c.k === 'subjects' ? r.subjects.join('; ') : r[c.k]))),
      dateIssuesCsvBtn: () => downloadCsv('date-issues.csv', DCOLS.map(c => c.t), (DATA.dateIssues || []).filter(subjOk).map(r => DCOLS.map(c => r[c.k]))),
      noEmailCsvBtn: () => downloadCsv('missing-emails.csv', NCOLS.map(c => c.t), (DATA.noEmailRows || []).filter(subjOk).map(r => NCOLS.map(c => r[c.k]))),
      flowTierCsvBtn: () => {
        const mk = flowState.month;
        const groupLabel = { inprocess: 'In process', converted: 'Converted', other: 'Other' };
        const bucketLabel = { month: 'Selected month', fy: mk ? 'Other month this FY' : 'This FY', prev: 'Previous FY', unknown: 'Unknown' };
        const rows = flowTouched().filter(c => c.matched).sort((a, b) => (TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) ||
          a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
        downloadCsv('ld-flow-touched-leads' + (mk ? '-' + mk : '') + '.csv',
          ['Tier', 'Tier Source', 'Status Group', 'Lead Status', 'Touched Via', 'L&D Employees', 'Lead Created', 'Created When', 'Client Name',
           'Email Id', 'Team', 'RM', 'Advisor', 'Platform', 'Lead Source', 'Lead Data From', 'L&D Ticket Subjects', 'Converted On', 'Sheet / Row'],
          rows.map(c => { const t = ldTouch(c, mk);
            const subs = (mk ? (c.monthSubjects[mk] || []) : c.subjects).filter(subjOn);
            return [c.tier, c.tierSrc, groupLabel[statusGroup(c.status)], c.status,
              t.via === 'ticket' ? 'Ticket subject' : 'Plan approval only', ldPeopleOf(c, mk), c.created,
              bucketLabel[createdBucket(c)], c.name, c.email, c.team, c.rm, c.advisor, c.platform, c.src, c.leadSrc, subs.join('; '),
              c.converted, c.locations]; }));
      },
      flowEmpCsvBtn: () => {
        const out = [];
        empRows().forEach(r => r.cl.forEach(y => { const c = y.c;
          out.push([r.p, y.cnt.created || 0, y.cnt.approved || 0, c.name, c.email, c.status, c.tier, c.tierSrc, c.team,
            c.rm, c.advisor, c.created, c.converted, c.matched ? 'Yes' : 'No', c.locations]); }));
        downloadCsv('ld-employee-plans' + (flowState.month ? '-' + flowState.month : '') + '.csv',
          ['L&D Employee', 'Plans Created', 'Plans Approved', 'Client Name', 'Email Id', 'Workpoint Lead Status', 'Tier',
           'Tier Source', 'Team', 'RM', 'Advisor', 'Lead Created', 'Converted On', 'Matched to Lead Data', 'Sheet / Row'], out);
      },
    };

    // ---------- tooltip (status chart) ----------
    const tip = $('tip');
    const hideTip = () => { tip.style.opacity = 0; };
    function showTip(html, e){
      tip.innerHTML = html; tip.style.opacity = 1;
      const r = tip.getBoundingClientRect();
      let x = e.clientX + 14, y = e.clientY + 14;
      if(x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
      if(y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }

    // ---------- wiring ----------
    // The panel's DOM persists across rebuilds (only innerHTML changes), so a rebuilt model (e.g.
    // after an EMPLOYEE_REF edit) aborts the previous mount's listeners before adding its own.
    if(LD._wiring) LD._wiring.abort();
    const wiring = LD._wiring = new AbortController();
    const root = document.getElementById('tab-ld');
    // The four views. Flow and Employee View share one filter bar (and its state); Details and
    // Data Quality have their own, so the shared bar is hidden there.
    const VIEWS = {
      flow:     { title: 'L&D at a glance', filters: true,
                  sub: 'How many leads L&D reached, where they stand in Workpoint now, and who worked on them.' },
      employee: { title: 'Employee view', filters: true,
                  sub: 'Plans each L&D employee created and approved, and where those clients stand in Workpoint now.' },
      details:  { title: 'L&D details', filters: false,
                  sub: 'Every client on the L&D tabs, with its own filters — a broader scope than the Flow.' },
      quality:  { title: 'Data quality', filters: false,
                  sub: 'Rows the dashboard cannot count, and where to fix them in the L&D workbook.' },
    };
    let currentView = 'flow';
    const mirror = sel => root.querySelectorAll(sel + ' .table-wrap').forEach(w => { if(typeof attachMirrorScroll === 'function') attachMirrorScroll(w); });
    function updateHead(){
      const v = VIEWS[currentView];
      el('viewTitle').textContent = v.title;
      el('viewSub').textContent = v.sub;
      el('period').textContent = v.filters ? flowPeriod
        : currentView === 'details' ? (state.month ? monthLabel(state.month) : 'All months') + ' · Details filters' : 'All L&D tabs';
    }
    function activateSub(id, report){
      currentView = VIEWS[id] ? id : 'flow';
      root.querySelectorAll('[data-ldsub]').forEach(b => {
        const isOn = b.dataset.ldsub === currentView;
        b.classList.toggle('active', isOn);
        if(isOn) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      root.querySelectorAll('.ld-subpanel').forEach(p => p.classList.toggle('active', p.id === 'ld-sub-' + currentView));
      $('flowFilters').hidden = !VIEWS[currentView].filters;
      if(report) activateDq(report);
      updateHead();
      mirror('#ld-sub-' + currentView);
    }
    // Local tabs: Details sections and Data Quality reports.
    function selectTab(attr, id, panelPrefix, panelClass){
      root.querySelectorAll('[data-' + attr + ']').forEach(b => {
        if(b.classList.contains('ld-localtab')) b.setAttribute('aria-selected', String(b.dataset[attr] === id));
      });
      root.querySelectorAll('.' + panelClass).forEach(p => p.classList.toggle('active', p.id === panelPrefix + id));
      mirror('#' + panelPrefix + id);
    }
    const activateDsec = id => selectTab('dsec', id, 'ld-dsec-', 'ld-dsec');
    function activateDq(id){
      selectTab('dq', id, 'ld-dq-', 'ld-dqsec');
      root.querySelectorAll('.ld-dq-card').forEach(c => c.classList.toggle('active', c.dataset.tab === id));
    }
    root.querySelectorAll('[data-ldsub]').forEach(b =>
      b.addEventListener('click', () => activateSub(b.dataset.ldsub), { signal: wiring.signal }));
    root.querySelectorAll('.ld-localtab[data-dsec]').forEach(b =>
      b.addEventListener('click', () => activateDsec(b.dataset.dsec), { signal: wiring.signal }));
    root.querySelectorAll('.ld-localtab[data-dq]').forEach(b =>
      b.addEventListener('click', () => activateDq(b.dataset.dq), { signal: wiring.signal }));
    // Arrow keys move between tabs in a tab strip, as in any tablist.
    root.querySelectorAll('.ld-localtabs').forEach(list => list.addEventListener('keydown', e => {
      if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...list.querySelectorAll('.ld-localtab')], at = tabs.indexOf(document.activeElement);
      if(at < 0) return;
      const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus(); next.click(); e.preventDefault();
    }, { signal: wiring.signal }));
    const on = (id, ev, fn) => $(id).addEventListener(ev, fn, { signal: wiring.signal });

    const FILTER_IDS = { fMonth: 'month', fTier: 'tier', fTenure: 'tenure', fTeam: 'team', fPlatform: 'platform', fAdvisor: 'advisor', fSource: 'source' };
    const fill = (id, values, labels) => { $(id).innerHTML = $(id).options[0].outerHTML +
      values.map((v, i) => '<option value="' + esc(v) + '">' + esc(labels ? labels[i] : v) + '</option>').join(''); };
    fill('fMonth', MONTHS.map(m => m.mk), MONTHS.map(m => m.m));
    fill('fTier', TIERS); fill('fTenure', TENURES);
    fill('fTeam', [...new Set(CLIENTS.map(c => c.team).filter(Boolean))].sort());
    fill('fPlatform', [...new Set(CLIENTS.map(c => c.platform).filter(Boolean))].sort());
    fill('fAdvisor', [...new Set(CLIENTS.map(c => c.advisor).filter(Boolean))].sort());
    fill('fSource', [...new Set(CLIENTS.map(c => c.src).filter(Boolean))].sort());
    fill('fFlowMonth', FLOW_MONTHS, FLOW_MONTHS.map(monthLabel));
    fill('fFlowEmp', LD_PEOPLE);
    fill('fFlowTeam', [...new Set(Object.values(LEADS_CREATED).flatMap(Object.keys).concat(CLIENTS.filter(c => c.matched).map(c => c.team)))].filter(Boolean).sort());
    $('fProduct').innerHTML = '<option value="all">All products (sum)</option>' + PRODUCTS.map(p => '<option value="' + esc(p.k) + '">' + esc(p.label) + '</option>').join('');

    Object.keys(FILTER_IDS).forEach(id => on(id, 'change', e => { state[FILTER_IDS[id]] = e.target.value; renderDetails(); }));
    on('fProduct', 'change', e => { state.product = e.target.value; renderDetails(); });
    on('fSearch', 'input', e => { state.q = e.target.value; renderDetails(); });
    on('statusChips', 'click', e => { const c = e.target.closest('.ld-chip'); if(!c) return;
      const k = c.dataset.status; state.off.has(k) ? state.off.delete(k) : state.off.add(k); renderDetails(); });
    on('statusChart', 'click', e => { const col = e.target.closest('.vcol'); if(!col) return;
      const k = col.dataset.key; state.off.has(k) ? state.off.delete(k) : state.off.add(k); renderDetails(); });
    on('statusChart', 'mousemove', e => {
      const col = e.target.closest('.vcol'); if(!col){ hideTip(); return; }
      const mapped = selected().filter(c => c.matched), st = col.dataset.key, x = sInfo(st);
      const n = mapped.filter(r => r.status === st).length;
      showTip('<div class="t">' + esc(x.label) + '</div><div class="r" style="--c:' + x.c + '"><i class="dot"></i>Clients<span class="v">' + n +
        '</span></div><div class="m">' + pct(n, mapped.length) + ' of mapped · click to ' + (state.off.has(st) ? 'include' : 'exclude') + '</div>', e);
    });
    on('statusChart', 'mouseleave', hideTip);
    on('clientTbl', 'click', e => { const th = e.target.closest('th[data-key]'); if(!th) return;
      const k = th.dataset.key; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 }; renderDetails(); });
    on('resetBtn', 'click', () => {
      Object.assign(state, { month: '', tier: '', tenure: '', team: '', platform: '', advisor: '', source: '', q: '' });
      state.off.clear(); state.subjects = new Set(SUBJECTS);
      Object.keys(FILTER_IDS).forEach(id => { $(id).value = ''; }); $('fSearch').value = '';
      renderDetails();
    });
    on('subjChips', 'click', e => { const c = e.target.closest('.subjchip'); if(!c) return;
      const x = c.dataset.subj; state.subjects.has(x) ? state.subjects.delete(x) : state.subjects.add(x); renderDetails(); });
    on('subjAll', 'click', () => { state.subjects = new Set(SUBJECTS); renderDetails(); });
    on('subjNone', 'click', () => { state.subjects = new Set(); renderDetails(); });
    on('subjFP', 'click', () => { state.subjects = new Set(FP_SUBJECTS); renderDetails(); });
    const subjDd = $('subjDd');
    on('subjDdToggle', 'click', e => { e.stopPropagation(); const open = subjDd.dataset.open !== '1';
      subjDd.dataset.open = open ? '1' : '0'; $('subjDdToggle').setAttribute('aria-expanded', String(open)); });
    const flowSubjDd = $('flowSubjDd');
    on('flowSubjToggle', 'click', e => { e.stopPropagation(); const open = flowSubjDd.dataset.open !== '1';
      flowSubjDd.dataset.open = open ? '1' : '0'; $('flowSubjToggle').setAttribute('aria-expanded', String(open)); });
    // Picking subjects keeps the panel open, so several can be toggled in one go.
    on('flowSubjChips', 'click', e => {
      const act = e.target.closest('[data-act]'), chip = e.target.closest('.subjchip');
      if(act) flowState.subjects = new Set(act.dataset.act === 'ld' ? LD_DEFAULT_SUBJECTS : act.dataset.act === 'all' ? SUBJECTS : []);
      else if(chip){ const x = chip.dataset.subj; flowState.subjects.has(x) ? flowState.subjects.delete(x) : flowState.subjects.add(x); }
      else return;
      renderFlow();
    });
    // A click outside an open subject dropdown closes it; so does Escape (focus returns to its toggle).
    const DROPDOWNS = [[subjDd, 'subjDdToggle'], [flowSubjDd, 'flowSubjToggle']];
    document.addEventListener('click', e => {
      DROPDOWNS.forEach(([dd, toggle]) => {
        if(dd.dataset.open === '1' && !dd.contains(e.target)){ dd.dataset.open = '0'; $(toggle).setAttribute('aria-expanded', 'false'); }
      });
    }, { signal: wiring.signal });
    root.addEventListener('keydown', e => {
      if(e.key !== 'Escape') return;
      DROPDOWNS.forEach(([dd, toggle]) => {
        if(dd.dataset.open === '1'){ dd.dataset.open = '0'; $(toggle).setAttribute('aria-expanded', 'false'); $(toggle).focus(); }
      });
    }, { signal: wiring.signal });
    Object.keys(csvHandlers).forEach(id => on(id, 'click', e => { e.preventDefault(); csvHandlers[id](); }));

    on('fFlowMonth', 'change', e => { flowState.month = e.target.value; renderFlow(); });
    on('fFlowTeam', 'change', e => { flowState.team = e.target.value; renderFlow(); });
    on('fFlowEmp', 'change', e => { flowState.emp = e.target.value; renderFlow(); });
    on('flowResetBtn', 'click', () => { flowState.month = flowState.team = flowState.emp = '';
      flowState.subjects = new Set(LD_DEFAULT_SUBJECTS);
      $('fFlowMonth').value = $('fFlowTeam').value = $('fFlowEmp').value = ''; renderFlow(); });
    // Selecting an employee row (click, Enter or Space) filters Flow + Employee View by that person.
    const pickEmp = tr => {
      flowState.emp = flowState.emp === tr.dataset.emp ? '' : tr.dataset.emp; $('fFlowEmp').value = flowState.emp; renderFlow();
      const again = $('flowEmpTbl').querySelector('tr[data-emp="' + CSS.escape(tr.dataset.emp) + '"]');
      if(again) again.focus();
    };
    on('flowEmpTbl', 'click', e => { const tr = e.target.closest('tr[data-emp]'); if(tr) pickEmp(tr); });
    on('flowEmpTbl', 'keydown', e => {
      const tr = e.target.closest('tr[data-emp]');
      if(tr && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); pickEmp(tr); }
    });
    // Data-quality strip (Flow) and summary cards (Data Quality) open their report.
    on('flowFlags', 'click', e => { const f = e.target.closest('.ld-dq-item'); if(!f) return;
      activateSub('quality', f.dataset.tab); root.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    on('dqSummary', 'click', e => { const c = e.target.closest('.ld-dq-card'); if(c) activateDq(c.dataset.tab); });

    return {
      renderAll(){
        renderFlow(); renderDetails(); renderFoot();
        el('stamp').textContent = (META.dataGenerated ? 'Data last updated ' + META.dataGenerated : 'Data loaded') + ' · L&D workbook ' +
          nf(META.ldRows) + ' rows';
        const cur = root.querySelector('[data-ldsub].active');
        activateSub(cur ? cur.dataset.ldsub : 'flow');
      }
    };
  }

  return { render, build, _wiring: null };
})();

function renderLD(){
  LD.render().catch(e => {
    console.error('[MIS] L&D Dashboard failed to render', e);
    const box = document.getElementById('ld-empty');
    if(box){ box.hidden = false; box.textContent = 'The L&D Dashboard could not be built: ' + (e && e.message || e); }
  });
}
