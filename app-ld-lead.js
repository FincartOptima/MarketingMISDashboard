// app-ld-lead.js — how the L&D Dashboard ties a client to a lead record. Pure functions (no DOM, no STATE),
// so tests/ld.test.js can run them without a browser; app-ld.js and app-health.js are the only callers.
//   - the status rule: a converted date makes a lead CONVERTED, as everywhere else in this dashboard;
//   - the date of the hard-coded lead snapshot (ld_leads_snapshot.js), which can be older than its file stamp;
//   - near-match suggestions for emails that find no lead. They are only ever shown: nothing is joined on
//     them, because a similar address can belong to a different person.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

const LD_ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/;
const LD_EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;
const LD_NOT_AN_EMAIL = 'Not an email address';
// Shorter than this, a one-letter difference is as likely to be another person as a typo.
const LD_MIN_SUGGEST_LOCAL = 6;
const LD_GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/** A lead's status for the L&D tabs: CONVERTED whenever it has a converted date, else the written status. */
function ldStatusOf(writtenStatus, hasConvertedDate){
  if(hasConvertedDate) return 'CONVERTED';
  return writtenStatus || 'BLANK';
}

/** The date ("YYYY-MM-DD") the snapshot's lead values are from: its own `asOf`, else the date in the export's file name. */
function ldSnapshotAsOf(snapshot){
  if(!snapshot) return '';
  const own = LD_ISO_DATE.exec(snapshot.asOf || '');
  if(own) return own[0];
  const named = LD_ISO_DATE.exec(snapshot.leadFile || '');
  return named ? named[0] : '';
}

/** "2026-08-07" -> "7 Aug 2026" (empty for anything that is not an ISO date). */
function ldFriendlyDate(iso){
  const m = LD_ISO_DATE.exec(iso || '');
  if(!m) return '';
  return Number(m[3]) + ' ' + MONTHS_3[Number(m[2]) - 1] + ' ' + m[1];
}

/** True when `a` and `b` differ by one inserted, dropped, replaced or swapped (adjacent) character. */
function ldOneEditApart(a, b){
  if(a === b) return false;
  const gap = a.length - b.length;
  if(Math.abs(gap) > 1) return false;
  const [long, short] = gap >= 0 ? [a, b] : [b, a];
  let i = 0;
  while(i < short.length && long[i] === short[i]) i++;
  if(gap !== 0) return long.slice(i + 1) === short.slice(i);
  if(long.slice(i + 1) === short.slice(i + 1)) return true;
  return long[i] === short[i + 1] && long[i + 1] === short[i] && long.slice(i + 2) === short.slice(i + 2);
}

const ldSplitEmail = key => { const at = key.lastIndexOf('@'); return [key.slice(0, at), key.slice(at + 1)]; };
const ldDotless = local => local.replace(/\./g, '');

function ldIndexKnownEmails(knownKeys){
  const byLocal = new Map(), byDotless = new Map(), byLength = new Map();
  const push = (map, k, v) => { const list = map.get(k); if(list) list.push(v); else map.set(k, [v]); };
  for(const key of knownKeys){
    if(!LD_EMAIL_SHAPE.test(key)) continue;
    const [local, domain] = ldSplitEmail(key);
    push(byLocal, local, key);
    if(LD_GMAIL_DOMAINS.has(domain)) push(byDotless, ldDotless(local), key);
    push(byLength, key.length, key);
  }
  return { byLocal, byDotless, byLength };
}

/** The known addresses `key` starts with, for a cell where a second address was pasted straight after the first. */
function ldPastedPrefix(key, knownKeys){
  return [...knownKeys].filter(k => k.length >= 8 && key.length > k.length && key.startsWith(k));
}

function ldCandidates(key, index, knownKeys){
  if(!LD_EMAIL_SHAPE.test(key)) return ldPastedPrefix(key, knownKeys);
  const [local, domain] = ldSplitEmail(key);
  if(local.length < LD_MIN_SUGGEST_LOCAL) return [];
  const sameLocal = (index.byLocal.get(local) || []).filter(k => k !== key);
  if(sameLocal.length) return sameLocal;
  if(LD_GMAIL_DOMAINS.has(domain)){
    const dots = (index.byDotless.get(ldDotless(local)) || []).filter(k => k !== key);
    if(dots.length) return dots;
  }
  const near = [];
  for(const len of [key.length - 1, key.length, key.length + 1]){
    for(const k of index.byLength.get(len) || []) if(ldOneEditApart(key, k)) near.push(k);
  }
  return near;
}

/**
 * For each of `unmatchedKeys` (client emails with no lead), a hint for the person fixing the sheet:
 * the one known lead email it probably meant, or "Not an email address". Keys with no single
 * candidate get no entry. Returns a Map(key -> hint).
 */
function ldSuggestEmails(unmatchedKeys, knownKeys){
  const known = knownKeys instanceof Set ? knownKeys : new Set(knownKeys);
  const index = ldIndexKnownEmails(known);
  const out = new Map();
  for(const key of unmatchedKeys){
    const found = ldCandidates(key, index, known);
    if(found.length === 1) out.set(key, found[0]);
    else if(!found.length && !LD_EMAIL_SHAPE.test(key)) out.set(key, LD_NOT_AN_EMAIL);
  }
  return out;
}
