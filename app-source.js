// app-source.js — Source Quality & Cost Efficiency.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).
//
// THE QUESTION THIS SECTION ANSWERS
// Cost Summary by Campaign already reports spend, CPL and CAC per campaign.
// What it does not do is say which source is worth the money, because the one
// number that settles that — what share of a source's own leads actually
// converted — was not in it. Volume and quality point in opposite directions
// here, and only the rate shows it:
//
//   Google      1,203 leads -> 36 converted (2.99%) on Rs 37.5L -> Rs 1,04,040 each
//   Corporate     996 leads -> 30 converted (3.01%) on Rs  6.5L -> Rs   21,708 each
//
// Same conversion rate, nearly five times the price. That is the finding, and
// it is invisible in a table of absolute counts.
//
// HOW THE COHORT IS DEFINED, AND WHY IT DIFFERS FROM COST SUMMARY
// A source's quality is a property of the leads it GENERATED, so this section
// is created-cohort based: "of the leads created in the selected months, how
// many have converted, to date". Cost Summary by Campaign instead counts
// conversions whose Converted Month falls in the selected months — a different
// and equally valid question ("what landed this month"), but one that mixes
// cohorts, since a conversion in June can belong to a lead from February. The
// two tables will therefore disagree on the Converted column, on purpose, and
// each says which it is.
//
// WHICH HEADER FILTERS APPLY
// Month (on the lead's created month), Lead Head and Ref+Cold apply.
// **Status deliberately does not.** Filtering the cohort to CONVERTED would
// make the conversion rate 100% in every row and the section meaningless;
// the same reasoning the Activity Change Days section uses for its own
// exemptions. Stated on the page, not just here.

// A source below this many leads in the window is reported but never ranked
// or named in a finding — see rule 2 in app-insights.js.
const SOURCE_MIN_LEADS = 30;

// Costs are keyed on 'Campaign Name' in the Cost Per Campaign tab, which is
// the same field buildRawData() maps the export's Category Name onto. That is
// why this section groups by campaign/category ('Google', 'Social Media',
// 'Corporate', ...) rather than by platformName: it is the only grouping the
// cost figures can actually be joined to.
const SOURCE_FIELD = 'Campaign Name';

const sourceNameOf = r => (String(r[SOURCE_FIELD] || '').trim() || '(Blank)');

/**
 * The section's own row filter: Month + Lead Head + Ref/Cold, and NOT Status.
 * Deliberately not applyRefColdFilter(), which folds in dashboardRowMatch()
 * and with it the Status filter.
 */
function sourceRowMatch(r, months){
  if(!(months || []).includes(r.CTM)) return false;
  const lh = STATE.filterLeadHead;
  if(lh && lh !== 'All' && r.leadHead !== lh) return false;
  const mode = rcFilter(STATE.filterRefCold);
  const c = r[SOURCE_FIELD];
  if(mode === 'Exclude' && (c === 'Referral' || c === 'Cold Data')) return false;
  if(mode === 'Only Referral' && c !== 'Referral') return false;
  return true;
}

/**
 * Which of the selected months actually have spend recorded against them.
 *
 * THIS IS THE SUBTLE ONE, AND IT IS WORTH READING BEFORE CHANGING.
 * app-state.js normalises the Cost Per Campaign tab so it carries a column
 * for every month in STATE.months, padding the months nobody has filled in
 * with zeros. So "is there a column for this month" is almost always yes and
 * is the wrong question. Asking it cost real accuracy: leads were being
 * counted over eight months while money was counted over the three that have
 * figures, which put Social Media at Rs 45,896 per conversion when the costed
 * window says Rs 1,25,171 — out by a factor of nearly three, in the
 * flattering direction, on the number most likely to be quoted.
 *
 * A month whose spend is zero across *every* source has not been filled in.
 * (If a month genuinely had no marketing spend, "no cost recorded" is still
 * the honest label for it.) So `costed` is the selected months with recorded
 * spend, and `cohortMonths` restricts the whole section to them whenever any
 * spend exists — because a cost-per-conversion computed over mismatched
 * windows is not a weaker number, it is a wrong one.
 *
 * @returns {{cols:string[], selected:string[], costed:string[],
 *            uncosted:string[], cohortMonths:string[], restricted:boolean}}
 */
function sourceCostWindow(){
  const cpc = STATE.cost || [];
  const cols = ((cpc[0] || [])).slice(1).map(toMmmYyyy);
  const selected = effectiveMonths();
  const spendIn = m => {
    const idx = cols.indexOf(m);
    if(idx < 0) return 0;
    let t = 0;
    for(let i = 1; i < cpc.length; i++) t += Number((cpc[i] || [])[idx + 1]) || 0;
    return t;
  };
  const costed = selected.filter(m => spendIn(m) > 0);
  const uncosted = selected.filter(m => costed.indexOf(m) < 0);
  return {
    cols, selected, costed, uncosted,
    cohortMonths: costed.length ? costed : selected,
    restricted: costed.length > 0 && uncosted.length > 0,
  };
}

/**
 * Spend for one source over the costed months.
 * @returns {number|null} null when the tab has no row for this source at all
 *   — which is NOT the same as a row of zeros. A zero row means a genuinely
 *   free source (Referral, Branding); a missing row means nobody has told the
 *   dashboard what it costs, and the difference changes what CPL means.
 */
function sourceCostOf(name, win){
  const cpc = STATE.cost || [];
  const want = String(name).trim();
  for(let i = 1; i < cpc.length; i++){
    if(String((cpc[i] || [])[0] || '').trim() !== want) continue;
    return win.costed.reduce((s, m) => {
      const idx = win.cols.indexOf(m);
      return s + (idx >= 0 ? (Number(cpc[i][idx + 1]) || 0) : 0);
    }, 0);
  }
  return null;
}

/**
 * Leads, outcome-to-date and cost per source.
 * @returns {{rows:Array, win:Object, totals:Object}}
 */
function sourceQuality(){
  const win = sourceCostWindow();
  const pool = STATE.raw.filter(r => sourceRowMatch(r, win.cohortMonths));

  // Union of sources seen in the leads and sources named in the cost tab, so
  // a source with spend and no leads is still visible (the most expensive
  // possible finding) and a source with leads and no cost row is too.
  const names = new Set(pool.map(sourceNameOf));
  for(let i = 1; i < (STATE.cost || []).length; i++){
    const n = String(((STATE.cost || [])[i] || [])[0] || '').trim();
    if(n) names.add(n);
  }

  const agg = new Map([...names].map(n => [n, { source: n, leads: 0, conv: 0, ip: 0, hold: 0, dead: 0 }]));
  for(const r of pool){
    const g = agg.get(sourceNameOf(r));
    if(!g) continue;
    g.leads++;
    // CM-presence is the definitive conversion rule dashboard-wide; no month
    // argument, because this asks "has this lead ever converted", not "did it
    // convert inside the window".
    if(isConvertedLead(r)) g.conv++;
    else if(r.leadStatus === 'IN PROCESS') g.ip++;
    else if(r.leadStatus === 'ON HOLD') g.hold++;
    else if(r.leadStatus === 'DEAD') g.dead++;
  }

  const rows = [...agg.values()].map(g => {
    const cost = sourceCostOf(g.source, win);
    return Object.assign({}, g, {
      cost,
      convRate: g.leads ? g.conv / g.leads : 0,
      pipeline: g.conv + g.ip,
      pipelineRate: g.leads ? (g.conv + g.ip) / g.leads : 0,
      cpl: (cost != null && g.leads) ? cost / g.leads : null,
      cac: (cost != null && cost > 0 && g.conv) ? cost / g.conv : null,
    });
  });

  const totals = {
    leads: rows.reduce((s, r) => s + r.leads, 0),
    conv:  rows.reduce((s, r) => s + r.conv, 0),
    ip:    rows.reduce((s, r) => s + r.ip, 0),
    cost:  rows.reduce((s, r) => s + (r.cost || 0), 0),
  };
  totals.convRate = totals.leads ? totals.conv / totals.leads : 0;
  totals.pipelineRate = totals.leads ? (totals.conv + totals.ip) / totals.leads : 0;
  totals.cpl = totals.leads ? totals.cost / totals.leads : null;
  totals.cac = totals.conv ? totals.cost / totals.conv : null;

  rows.forEach(r => {
    r.leadShare  = totals.leads ? r.leads / totals.leads : 0;
    r.convShare  = totals.conv  ? r.conv  / totals.conv  : 0;
    r.spendShare = totals.cost  ? (r.cost || 0) / totals.cost : 0;
    // The gap that matters: paying 65% of the bill for 22% of the result.
    r.gap = r.spendShare - r.convShare;
  });
  rows.sort((a, b) => b.leads - a.leads || b.conv - a.conv);
  return { rows, win, totals };
}

// ---- the finding ----------------------------------------------------------

/**
 * Build the verdict for the table. Every claim here is a rate or a ratio with
 * both sides named, per app-insights.js rule 1, and no source under
 * SOURCE_MIN_LEADS is ever named.
 */
function sourceQualityInsight(q){
  const live = q.rows.filter(r => r.leads > 0);
  if(!live.length) return null;

  const big = live.filter(r => r.leads >= SOURCE_MIN_LEADS);
  // Paid = a cost row exists AND money was actually spent in the costed
  // months. A zero row is a free source, not a cheap one.
  const paid = big.filter(r => r.cost != null && r.cost > 0);
  const earning = paid.filter(r => r.conv > 0).sort((a, b) => a.cac - b.cac);

  const points = [];
  let verdict = null, tone = 'info';

  if(earning.length >= 2){
    const cheap = earning[0];
    // The comparison that decides a budget is "what the biggest line item
    // costs us against what the best one does", not "dearest against
    // cheapest" — the dearest is often a rounding error of a channel. Fall
    // back to the dearest only when the biggest spender IS the cheapest.
    const biggest = [...earning].sort((a, b) => b.cost - a.cost)[0];
    const dear = (biggest && biggest.source !== cheap.source) ? biggest : earning[earning.length - 1];
    const times = insightTimes(dear.cac, cheap.cac);
    // How the two compare on quality, so "dearer" is never mistaken for
    // "better". Within a tenth is called the same rate.
    const ratio = cheap.convRate > 0 ? dear.convRate / cheap.convRate : null;
    const quality = ratio == null ? ''
      : (ratio >= 1.1 ? ` It does convert better — <strong>${fmtPct(dear.convRate)}</strong> against `
                        + `<strong>${fmtPct(cheap.convRate)}</strong> — but nowhere near enough to cover the gap.`
      : (ratio <= 0.9 ? ` And it converts <em>worse</em>: <strong>${fmtPct(dear.convRate)}</strong> against `
                        + `<strong>${fmtPct(cheap.convRate)}</strong>.`
                      : ` At effectively the same conversion rate — <strong>${fmtPct(dear.convRate)}</strong> against `
                        + `<strong>${fmtPct(cheap.convRate)}</strong>.`));
    verdict =
      `<strong>${escHtml(cheap.source)}</strong> turns <strong>${fmtINR(cheap.cost)}</strong> into `
      + `<strong>${fmtIN(cheap.conv)}</strong> conversion(s) from <strong>${fmtIN(cheap.leads)}</strong> leads — `
      + `<strong>${fmtINR(cheap.cac)}</strong> each. <strong>${escHtml(dear.source)}</strong>, which takes `
      + `<strong>${fmtPct(dear.spendShare)}</strong> of the budget, spends `
      + `<strong>${fmtINR(dear.cost)}</strong> for <strong>${fmtIN(dear.conv)}</strong> — `
      + `<strong>${fmtINR(dear.cac)}</strong> each${times ? `, <strong>${times}</strong> more` : ''}.${quality}`;
    tone = (times && parseFloat(times) >= 2) ? 'bad' : 'warn';

    // Spend in, result out — the single most quotable line in the section.
    const worstGap = [...paid].sort((a, b) => b.gap - a.gap)[0];
    if(worstGap && worstGap.gap > 0.05){
      points.push(`<strong>${escHtml(worstGap.source)}</strong> takes `
        + `<strong>${fmtPct(worstGap.spendShare)}</strong> of the spend and returns `
        + `<strong>${fmtPct(worstGap.convShare)}</strong> of the conversions.`);
    }
    const bestGap = [...paid].sort((a, b) => a.gap - b.gap)[0];
    if(bestGap && (!worstGap || bestGap.source !== worstGap.source) && bestGap.gap < -0.02){
      points.push(`<strong>${escHtml(bestGap.source)}</strong> is the other way round: `
        + `<strong>${fmtPct(bestGap.spendShare)}</strong> of the spend, `
        + `<strong>${fmtPct(bestGap.convShare)}</strong> of the conversions. Spend moved here buys more.`);
    }
  } else if(paid.length){
    verdict = `Only ${fmtIN(earning.length)} paid source has converted a lead in this window, so there is no `
      + `cost comparison to make yet. Widen the month filter.`;
  } else {
    verdict = `No source in this window has a cost figure in the <strong>Cost Per Campaign</strong> tab, so only `
      + `the conversion rates below are meaningful.`;
  }

  // Volume against quality — the user's own framing, and worth stating
  // explicitly whenever the biggest source is also among the worst.
  const byVolume = [...big].sort((a, b) => b.leads - a.leads)[0];
  const byRate   = [...big].sort((a, b) => b.convRate - a.convRate);
  if(byVolume && byRate.length > 1 && byRate[byRate.length - 1].source === byVolume.source){
    points.push(`The biggest source by volume is also the worst by conversion: `
      + `<strong>${escHtml(byVolume.source)}</strong>, <strong>${fmtPct(byVolume.leadShare)}</strong> of all leads `
      + `at <strong>${fmtPct(byVolume.convRate)}</strong>`
      + (byVolume.cac ? ` and <strong>${fmtINR(byVolume.cac)}</strong> per conversion` : '')
      + `. Volume is not quality.`);
  }

  // Free sources that outperform paid ones: the cheapest finding available.
  const free = big.filter(r => r.cost === 0 && r.conv > 0).sort((a, b) => b.convRate - a.convRate)[0];
  const bestPaidRate = earning.length ? Math.max(...earning.map(r => r.convRate)) : 0;
  if(free && free.convRate > bestPaidRate){
    points.push(`<strong>${escHtml(free.source)}</strong> costs nothing and converts `
      + `<strong>${fmtPct(free.convRate)}</strong> (${fmtIN(free.conv)} of ${fmtIN(free.leads)}) — better than any `
      + `paid source here. Worth asking what it would take to get more of it.`);
  }

  // Money spent on a source that produced nothing.
  const dead = paid.filter(r => r.conv === 0);
  for(const d of dead){
    points.push(`<strong>${escHtml(d.source)}</strong> has spent <strong>${fmtINR(d.cost)}</strong> for `
      + `<strong>no</strong> conversion from ${fmtIN(d.leads)} lead(s) in this window.`);
  }

  const held = big.length < live.length
    ? `${fmtIN(live.length - big.length)} source(s) under ${SOURCE_MIN_LEADS} leads are shown in the table but not ranked here.`
    : '';
  const w = q.win;
  const costNote = w.restricted
    ? `<strong>Restricted to the ${fmtIN(w.costed.length)} month(s) with spend recorded against them</strong> `
      + `(${escHtml(w.costed.join(', '))}), out of the ${fmtIN(w.selected.length)} you selected. The Cost Per Campaign `
      + `tab has no figures for ${escHtml(w.uncosted.join(', '))}, and counting leads from a month whose spend is `
      + `missing would not make cost per conversion weaker — it would make it wrong, by however many leads those `
      + `months contributed. Fill those months into the tab and they join the comparison automatically.`
    : (w.costed.length
      ? `Cost and leads both cover ${fmtIN(w.costed.length)} month(s): ${escHtml(w.costed.join(', '))}.`
      : `<strong>No month in this selection has any spend recorded</strong>, so only the conversion rates are `
        + `meaningful — every cost column is empty. Fill the Cost Per Campaign tab for `
        + `${escHtml(w.selected.slice(0, 6).join(', '))}${w.selected.length > 6 ? ' and the rest' : ''}.`);

  return {
    tone, head: 'What this says',
    verdict, points,
    basis: `${costNote} Conversion is counted on the leads <em>created</em> in these months, whenever they converted, `
      + `so this disagrees with Cost Summary by Campaign — which counts conversions <em>landing</em> in these months — `
      + `on purpose. ${held}`,
  };
}

// ---- table ----------------------------------------------------------------

const SOURCE_HEADERS = ['Source', 'Leads', '% of Leads', 'In Process', 'Converted', 'Conv %',
  'In Pipeline %', 'Cost', '% of Spend', 'CPL', 'Cost / Conversion'];

const srcMoney = v => (v == null ? '—' : fmtINR(v));

function sourceQualityCells(r, benchmark){
  return {
    Source: escHtml(r.source),
    Leads: fmtIN(r.leads),
    '% of Leads': fmtPct(r.leadShare),
    'In Process': fmtIN(r.ip),
    Converted: fmtIN(r.conv),
    // Conversion rate is the point of the table, so it carries the only
    // in-grid flag — and it flags the BAD side only: a source converting at
    // less than 1/1.2 of the blended average is tinted, worse than 1/1.5 is
    // tinted harder. Hence benchmark/rate rather than rate/benchmark: the
    // index has to rise as the source gets worse. Sources too small to judge
    // are never tinted.
    'Conv %': (r.leads >= SOURCE_MIN_LEADS && benchmark > 0)
      ? insightCell(`<strong>${fmtPct(r.convRate)}</strong>`,
          r.convRate > 0 ? benchmark / r.convRate : INSIGHT_BAD_INDEX)
      : fmtPct(r.convRate),
    'In Pipeline %': fmtPct(r.pipelineRate),
    Cost: r.cost == null ? '<span title="No row in the Cost Per Campaign tab">n/a</span>' : fmtINR(r.cost),
    '% of Spend': r.cost == null ? '—' : fmtPct(r.spendShare),
    CPL: srcMoney(r.cpl),
    'Cost / Conversion': r.cac == null
      ? (r.cost ? '<span class="in-hot in-hot-bad" title="Money spent, nothing converted">never</span>' : '—')
      : srcMoney(r.cac),
  };
}

function renderSourceQuality(){
  if(!STATE.filesLoaded.fin23){
    setNotUploaded('#tbl-source-quality', 'fin23');
    insightCard('#source-insight', null);
    return;
  }
  const q = sourceQuality();
  const benchmark = q.totals.convRate;

  const rows = q.rows.map(r => sourceQualityCells(r, benchmark));
  rows.push(Object.assign(sourceQualityCells(
    Object.assign({ source: 'Grand Total', leadShare: 1, spendShare: q.totals.cost ? 1 : 0 }, q.totals,
      { convRate: q.totals.convRate, pipelineRate: q.totals.pipelineRate }), 0), { _tot: true }));

  renderTable('#tbl-source-quality', SOURCE_HEADERS, rows, { html: true });
  insightCard('#source-insight', sourceQualityInsight(q));
  renderSourceConvChart(q);
  renderSourceSpendChart(q);

  const note = $('#source-note');
  if(note){
    const w = q.win;
    note.innerHTML = `Cohort: leads <strong>created</strong> in `
      + `<strong>${escHtml(w.cohortMonths.length === 1 ? w.cohortMonths[0] : w.cohortMonths.join(', '))}</strong>, `
      + `counted against whether they have converted <em>since</em>. `
      + (w.restricted
        ? `<strong>Those are the month(s) with spend recorded</strong> &mdash; ${fmtIN(w.uncosted.length)} other `
          + `selected month(s) are held out so that cost and leads cover the same period. `
        : '')
      + `The header&rsquo;s <strong>Month</strong>, <strong>Lead Head</strong> and <strong>Ref+Cold</strong> filters `
      + `apply; the <strong>Status</strong> filter does not &mdash; restricting the cohort by status would force every `
      + `conversion rate to 0% or 100% and destroy the measure.`;
  }
}

// ---- charts ---------------------------------------------------------------

// Single hue, light to dark, over sources ordered by conversion rate: one
// series (a rate), colour reinforcing the order rather than encoding anything
// extra.
const SOURCE_RAMP = ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e3a8a'];
// Two series, both percentages of a whole, therefore ONE axis. Same validated
// pair the Activity section uses: adjacent ΔE 21.5 deutan / 22.8 normal on the
// light surface.
const SOURCE_SPEND_COLOR = '#0284c7';
const SOURCE_CONV_COLOR  = '#16a34a';

const SOURCE_PCT_AXIS = {
  x: { ticks: { color: '#475569', font: { size: 11, weight: '600' }, maxRotation: 0, minRotation: 0 },
       grid: { display: false }, border: { color: '#cbd5e1' } },
  y: { beginAtZero: true, ticks: { color: '#64748b', callback: v => (v * 100).toFixed(0) + '%' },
       grid: { color: 'rgba(148,163,184,.25)' }, border: { color: '#cbd5e1' } },
};

function sourceChart(key, canvasSel, config){
  if(!window.Chart) return;
  const canvas = $(canvasSel);
  if(!canvas) return;
  if(STATE[key]) STATE[key].destroy();
  STATE[key] = new Chart(canvas.getContext('2d'), config);
}

/** Conversion rate by source — the ranking the old cost table could not show. */
function renderSourceConvChart(q){
  const rows = q.rows.filter(r => r.leads >= SOURCE_MIN_LEADS).sort((a, b) => b.convRate - a.convRate);
  const hint = $('#source-conv-hint');
  if(hint){
    hint.innerHTML = `Share of each source&rsquo;s own leads that have converted. Sources under `
      + `${SOURCE_MIN_LEADS} leads in this window are left out — a 1-of-2 source reads 50% and means nothing. `
      + `The dashed line is the blended average, <strong>${fmtPct(q.totals.convRate)}</strong>.`;
  }
  sourceChart('sourceConvChart', '#source-conv-chart', {
    type: 'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: rows.map(r => r.source),
      datasets: [{
        label: 'Conversion rate', data: rows.map(r => r.convRate),
        backgroundColor: rows.map((r, i) => SOURCE_RAMP[Math.max(0, SOURCE_RAMP.length - 1 - i)]),
        borderColor: '#1e3a8a', borderWidth: 1, borderRadius: 4, maxBarThickness: 72,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 24, right: 8, left: 4, bottom: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => {
          const r = rows[c.dataIndex];
          return `${fmtPct(r.convRate)} — ${fmtIN(r.conv)} of ${fmtIN(r.leads)} leads`
            + (r.cac ? ` · ${fmtINR(r.cac)} per conversion` : '');
        } } },
        datalabels: { anchor: 'end', align: 'top', offset: 2, color: '#1f2937',
          font: { size: 11, weight: 'bold' }, formatter: v => fmtPct(v) },
      },
      scales: SOURCE_PCT_AXIS,
    },
  });
}

/**
 * Share of spend against share of conversions. Both series are percentages of
 * their own total, so they belong on one axis — a source whose blue bar towers
 * over its green one is losing money, and that reads at a glance.
 */
function renderSourceSpendChart(q){
  const rows = q.rows
    .filter(r => (r.cost || 0) > 0 || r.conv > 0)
    .sort((a, b) => b.spendShare - a.spendShare || b.convShare - a.convShare);
  const hint = $('#source-spend-hint');
  if(hint){
    hint.innerHTML = `Both bars are percentages of their own total — spend out of `
      + `<strong>${fmtINR(q.totals.cost)}</strong>, conversions out of <strong>${fmtIN(q.totals.conv)}</strong> — so `
      + `they share one axis. <strong>Blue taller than green means that source costs more than it returns.</strong> `
      + `A source with conversions and no bar for spend is free.`;
  }
  sourceChart('sourceSpendChart', '#source-spend-chart', {
    type: 'bar',
    plugins: window.ChartDataLabels ? [window.ChartDataLabels] : [],
    data: {
      labels: rows.map(r => r.source),
      datasets: [
        { label: '% of spend', data: rows.map(r => r.spendShare),
          backgroundColor: SOURCE_SPEND_COLOR, borderColor: '#075985', borderWidth: 1,
          borderRadius: 4, maxBarThickness: 46 },
        { label: '% of conversions', data: rows.map(r => r.convShare),
          backgroundColor: SOURCE_CONV_COLOR, borderColor: '#14532d', borderWidth: 1,
          borderRadius: 4, maxBarThickness: 46 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 24, right: 8, left: 4, bottom: 0 } },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11, weight: '600' }, color: '#475569' } },
        tooltip: { callbacks: { label: c => {
          const r = rows[c.dataIndex];
          return c.datasetIndex === 0
            ? `${fmtPct(r.spendShare)} of spend — ${fmtINR(r.cost || 0)}`
            : `${fmtPct(r.convShare)} of conversions — ${fmtIN(r.conv)}`;
        } } },
        datalabels: { anchor: 'end', align: 'top', offset: 2, color: '#1f2937',
          font: { size: 10, weight: 'bold' }, formatter: v => (v > 0.02 ? fmtPct(v) : '') },
      },
      scales: SOURCE_PCT_AXIS,
    },
  });
}
