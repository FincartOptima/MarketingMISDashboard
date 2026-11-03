// app-insights.js — the insight layer: turns a table of numbers into a finding
// stated in words, with the entity named and the comparison made explicit.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// WHY THIS EXISTS
// Every table on this dashboard was already arithmetically correct and still
// did not tell anyone what to do. "On Hold: 9,162" is a fact; "Anmol G leaves
// 64% of its in-process book sitting, against 33% for Yash T" is a decision.
// These helpers are the shared rules for getting from the first to the second,
// so every section phrases a finding the same way and none of them can quietly
// invent one.
//
// THREE RULES — these are the whole point of the file
//
//  1. RANK BY RATE, NEVER BY COUNT.
//     The biggest group has the most of everything. "Most stalled leads are in
//     the SV pool" is a statement about SV's size, not its behaviour, and it
//     is true of every single column. A finding is always a rate measured
//     against a stated benchmark.
//
//  2. A GROUP TOO SMALL TO JUDGE IS NOT A FINDING.
//     One RM with two leads, both stalled, is "100%" and means nothing. Groups
//     under INSIGHT_MIN_BASE are withheld from the ranking and *counted* in
//     the basis line, so they are visibly excluded rather than silently
//     dropped.
//
//  3. SAY "NOTHING TO FLAG" WHEN THAT IS THE ANSWER.
//     An invented finding costs more than a blank one. insightRank returns
//     nulls and every renderer here is expected to print the honest version.
//
// The unassigned SV pool gets its own treatment for the same reason as rule 1:
// it is not a team anyone manages, it is where unmapped RMs land, and it is
// large enough to win every ranking it is allowed into. It is reported as a
// separate line, never as "the worst team".

// A group smaller than this is noise. 30 is the conventional floor for
// treating a proportion as stable; it is also big enough that no single RM's
// quiet fortnight tops the table.
const INSIGHT_MIN_BASE = 30;

// Labels that are a bucket rather than an owner. These are never ranked as
// teams or RMs; the worst of them is surfaced separately.
const INSIGHT_POOL_LABELS = ['SV', '(no RM)', '(unassigned)', '(blank)', '(Blank)', '—', ''];
const insightIsPool = label => INSIGHT_POOL_LABELS.includes(String(label == null ? '' : label).trim());

// How far above the benchmark a rate has to sit before it is worth a colour.
const INSIGHT_BAD_INDEX  = 1.5;   // half again the average — a real outlier
const INSIGHT_WARN_INDEX = 1.2;   // a fifth above — worth watching

/**
 * Rank groups by rate against the pooled benchmark, applying rules 1 and 2.
 *
 * @param {Array<{label:string, base:number, hits:number, extra?:*}>} groups
 *        `base` is the group's own denominator (its cohort), `hits` the events.
 * @param {{minBase?:number, includePool?:boolean, higherIsBetter?:boolean}} opts
 * @returns {{
 *   ranked:Array, benchmark:number, totalBase:number, totalHits:number,
 *   pool:Object|null, worst:Object|null, best:Object|null,
 *   held:{groups:number, base:number, hits:number, minBase:number}
 * }}
 *   `worst` is the group whose rate is furthest in the bad direction and
 *   `best` the opposite end — but only when at least two groups survive the
 *   base filter, because "worst of one" is not a comparison. `benchmark` is
 *   computed over EVERY group including the held-back and pooled ones, so it
 *   is the true average and not an average of the survivors.
 */
function insightRank(groups, opts){
  const o = opts || {};
  const min = o.minBase == null ? INSIGHT_MIN_BASE : o.minBase;
  const ranked = [];
  let pool = null, heldGroups = 0, heldBase = 0, heldHits = 0;
  let totalBase = 0, totalHits = 0;

  for(const g of groups || []){
    const base = Number(g.base) || 0;
    const hits = Number(g.hits) || 0;
    if(base <= 0) continue;
    totalBase += base;
    totalHits += hits;
    const rec = { label: g.label, base, hits, rate: hits / base, extra: g.extra };
    if(!o.includePool && insightIsPool(g.label)){
      if(!pool || rec.base > pool.base) pool = rec;
      continue;
    }
    if(base < min){ heldGroups++; heldBase += base; heldHits += hits; continue; }
    ranked.push(rec);
  }

  // Descending by rate, then by size so a tie reads as the bigger book first.
  ranked.sort((a, b) => b.rate - a.rate || b.base - a.base);
  const benchmark = totalBase ? totalHits / totalBase : 0;
  const ends = ranked.length > 1
    ? { hi: ranked[0], lo: ranked[ranked.length - 1] }
    : { hi: null, lo: null };

  return {
    ranked, benchmark, totalBase, totalHits, pool,
    worst: o.higherIsBetter ? ends.lo : ends.hi,
    best:  o.higherIsBetter ? ends.hi : ends.lo,
    held: { groups: heldGroups, base: heldBase, hits: heldHits, minBase: min },
  };
}

/** A rate as a multiple of the benchmark. null when there is no benchmark. */
const insightIndex = (rate, benchmark) => (benchmark > 0 ? rate / benchmark : null);

/** "1.9×" — the multiple between two numbers, for "4.8× more per conversion". */
const insightTimes = (a, b) => (b > 0 && a > 0 ? (a / b).toFixed(1).replace(/\.0$/, '') + '×' : null);

/**
 * Tone for an index: how far above the benchmark it sits.
 *
 * Compared at the SAME precision insightTimes() prints, because otherwise the
 * tint and the number disagree in the cell they share: an index of 1.157
 * renders as "1.2x" and would go untinted against a 1.2 threshold, which
 * reads as a bug to anyone who trusts what the cell says.
 */
function insightSeverity(index){
  if(index == null) return 'info';
  const shown = Math.round(index * 10) / 10;
  if(shown >= INSIGHT_BAD_INDEX) return 'bad';
  if(shown >= INSIGHT_WARN_INDEX) return 'warn';
  return 'good';
}

/** Wrap a table cell so an over-indexing value is visible in the grid too. */
function insightCell(html, index){
  const tone = insightSeverity(index);
  return (tone === 'bad' || tone === 'warn')
    ? `<span class="in-hot in-hot-${tone}">${html}</span>`
    : html;
}

/**
 * Render a finding above a table or chart.
 *
 * `verdict`, `points[]` and `action` are HTML — callers build them so the
 * numbers can carry <strong>; every piece of DATA inside them must already be
 * escHtml'd by the caller. Passing a falsy spec clears the host, which is how
 * a section with nothing to say says nothing.
 *
 * @param {string} hostSel
 * @param {{tone?:string, head?:string, verdict:string, points?:string[],
 *          action?:string, basis?:string, onAction?:Function}|null} spec
 */
function insightCard(hostSel, spec){
  const el = $(hostSel);
  if(!el) return;
  if(!spec || !spec.verdict){ el.innerHTML = ''; return; }
  const tone = spec.tone || 'info';
  const icon = { bad: '&#9888;', warn: '&#9888;', good: '&#10003;', info: '&#8505;' }[tone] || '&#8505;';
  const points = (spec.points || []).filter(Boolean);
  el.innerHTML =
    `<div class="insight insight-${tone}">
       <div class="in-head">${icon} ${escHtml(spec.head || 'What this says')}</div>
       <div class="in-verdict">${spec.verdict}</div>
       ${points.length ? `<ul class="in-points">${points.map(p => `<li>${p}</li>`).join('')}</ul>` : ''}
       ${spec.action ? `<div class="in-action">${spec.action}</div>` : ''}
       ${spec.basis ? `<div class="in-basis">${spec.basis}</div>` : ''}
     </div>`;
  if(spec.onAction){
    el.querySelectorAll('.in-act-btn').forEach(btn => {
      btn.onclick = e => { e.preventDefault(); spec.onAction(); };
    });
  }
}

/** The honest blank: why there is no finding, rather than an empty box. */
function insightNone(hostSel, why){
  insightCard(hostSel, { tone: 'info', head: 'Nothing to flag', verdict: why });
}

/**
 * The standard "worst vs best vs average" sentence, used by every section so
 * the comparison is always spelled out the same way.
 * @returns {string|null} HTML, or null when there is no honest comparison.
 */
function insightSpread(rank, opts){
  const o = opts || {};
  const noun = o.noun || 'book';
  const verb = o.verb || 'at';
  if(!rank.worst) return null;
  const idx = insightIndex(rank.worst.rate, rank.benchmark);
  const vs = (rank.best && rank.best.label !== rank.worst.label)
    ? ` — against <strong>${fmtPct(rank.best.rate)}</strong> for ${escHtml(rank.best.label)}`
      + (insightTimes(rank.worst.rate, rank.best.rate) ? `, ${insightTimes(rank.worst.rate, rank.best.rate)} as often` : '')
    : '';
  return `Worst ${escHtml(noun)}: <strong>${escHtml(rank.worst.label)}</strong> ${escHtml(verb)} `
    + `<strong>${fmtPct(rank.worst.rate)}</strong> (${fmtIN(rank.worst.hits)} of ${fmtIN(rank.worst.base)})${vs}. `
    + (idx ? `That is ${insightTimes(rank.worst.rate, rank.benchmark)} the ${fmtPct(rank.benchmark)} average.` : '');
}

/** "…and 4 group(s) under 30 leads are not ranked." — rule 2, made visible. */
function insightHeldNote(rank, unit){
  const h = rank.held;
  if(!h.groups) return '';
  return `${fmtIN(h.groups)} group(s) holding ${fmtIN(h.base)} ${escHtml(unit || 'lead(s)')} `
    + `are below the ${fmtIN(h.minBase)}-${escHtml((unit || 'lead').replace(/\(s\)$/, ''))} floor and are not ranked.`;
}
