// app-tables.js — Generic table renderer, heat-tier coloring, sortable tables,
// and the shared breakdown-chart wrapper.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

/* ============================================================
   BREAKDOWN CHARTS
   Shared Chart.js wrapper for the dashboard's cross-tab sections. Callers pass
   the SAME already-aggregated rows that feed the table beside them, so a chart
   can never silently disagree with its own table.
   ============================================================ */

// Warm categorical palette, ordered so adjacent series stay distinguishable.
const CHART_COLORS = [
  '#C85A32','#3F7D5C','#3A6B8A','#B87333','#A85572','#6B5B8A',
  '#A97C1E','#3A7D8A','#B3402F','#5C7D3F','#7A5C3F','#8A857D',
];
const CHART_MUTED = '#8A857D';
const CHART_GRID  = 'rgba(28,29,27,.07)';
const CHART_LINE  = '#E5E0D8';

/**
 * Render (or re-render) a stacked/grouped bar chart.
 * @param {string} canvasSel  CSS selector for the <canvas>
 * @param {string} key        STATE.charts registry key — prevents instance leaks
 * @param {object} opts
 * @param {string[]} opts.labels      category-axis labels
 * @param {{label:string,data:number[]}[]} opts.series  one entry per segment
 * @param {boolean} [opts.horizontal] horizontal bars — use for long labels
 * @param {boolean} [opts.stacked]    stack segments (default true)
 */
function renderBreakdownChart(canvasSel, key, opts){
  const canvas = $(canvasSel);
  if(!canvas || !window.Chart) return;
  if(!STATE.charts) STATE.charts = {};
  if(STATE.charts[key]){ STATE.charts[key].destroy(); delete STATE.charts[key]; }

  const {labels, series, horizontal=false, stacked=true} = opts;
  if(!labels.length || !series.length) return;

  STATE.charts[key] = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels,
      datasets: series.map((s,i) => ({
        label: s.label,
        data: s.data,
        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
        borderWidth: 0,
        borderRadius: 0,
        maxBarThickness: horizontal ? 20 : 44,
      })),
    },
    options:{
      indexAxis: horizontal ? 'y' : 'x',
      responsive:true,
      maintainAspectRatio:false,
      // Six charts re-animating on every filter change is visible jank on a
      // page that already renders thousands of table rows synchronously.
      animation:false,
      interaction:{mode:'index', intersect:false},
      layout:{padding:{top:6,right:10,left:2,bottom:0}},
      plugins:{
        // Datalabels collide badly inside stacked segments, and the exact
        // figures are already one glance away in the table below — so the
        // chart stays clean and the tooltip carries the detail.
        datalabels:{display:false},
        legend:{
          display: series.length > 1,
          position:'bottom',
          labels:{boxWidth:9,boxHeight:9,padding:11,color:CHART_MUTED,font:{size:10.5}},
        },
        tooltip:{
          backgroundColor:'#211F1C',padding:10,cornerRadius:0,
          titleFont:{size:11.5},bodyFont:{size:11.5},
          callbacks:{label: c => `${c.dataset.label}: ${fmtIN(c.raw)}`},
        },
      },
      scales:{
        x:{
          stacked,
          ticks:{
            color:CHART_MUTED,font:{size:10.5},maxRotation:0,autoSkip:true,
            callback: horizontal
              ? (v => fmtIN(v))
              : function(v){ const l=this.getLabelForValue(v); return l.length>14 ? l.slice(0,13)+'…' : l; },
          },
          grid:{display:horizontal,color:CHART_GRID,drawTicks:false},
          border:{color:CHART_LINE},
        },
        y:{
          stacked,
          beginAtZero:true,
          ticks:{
            color:CHART_MUTED,font:{size:10.5},
            callback: horizontal
              ? function(v){ const l=this.getLabelForValue(v); return l.length>22 ? l.slice(0,21)+'…' : l; }
              : (v => fmtIN(v)),
          },
          grid:{display:!horizontal,color:CHART_GRID,drawTicks:false},
          border:{color:CHART_LINE},
        },
      },
    },
  });
}

/**
 * Reshape cross-tab rows into {labels, series} for renderBreakdownChart.
 * Always drops the Grand Total row — charting it would dwarf every real bar.
 * @param {object[]} rows          the table's own row objects
 * @param {string} labelField      field holding the category name
 * @param {string[]} seriesKeys    fields to plot as stacked segments
 * @param {object} [opts]
 * @param {number} [opts.topN]     keep only the N largest categories
 * @param {string} [opts.sortKey]  field to rank by when topN is set
 */
function crossTabToSeries(rows, labelField, seriesKeys, opts={}){
  let body = rows.filter(r => !r._tot);
  if(opts.topN && opts.sortKey && body.length > opts.topN){
    body = [...body]
      .sort((a,b) => (Number(b[opts.sortKey])||0) - (Number(a[opts.sortKey])||0))
      .slice(0, opts.topN);
  }
  return {
    labels: body.map(r => String(r[labelField] ?? '')),
    series: seriesKeys.map(k => ({
      label: String(k),
      data: body.map(r => Number(r[k])||0),
    })),
  };
}

// ---- table renderer ----
function renderTable(host, headers, rows, opts={}){
  const fmt = opts.fmt || ((v)=>v);
  const rowClass = r => {
    const parts = [];
    if(r._tot) parts.push('grand');
    if(r._heat) parts.push('heat-'+r._heat);
    return parts.join(' ');
  };
  const html = `<table class="data ${opts.cls||''}">
    <thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${rowClass(r)}">${headers.map(h=>`<td>${fmt(r[h],h,r)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
  if(typeof host==='string') $(host).innerHTML = html; else host.innerHTML = html;
}

// ---- heat tiers (quartile-based row highlighting) ----
function numFromCell(v){
  if(v==null) return 0;
  if(typeof v==='number') return v;
  const s = String(v).replace(/[^\d.-]/g,'');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
function applyHeat(rows, heatBy, opts={}){
  const invert = !!opts.invert; // invert=true → lower number gets 'high' tier (e.g. CPL)
  const valid = rows.filter(r => !r._tot);
  const vals = valid.map(r => numFromCell(r[heatBy])).slice().sort((a,b)=>a-b);
  if(vals.length < 2){ return rows; }
  const pick = q => vals[Math.min(vals.length-1, Math.max(0, Math.floor(vals.length*q)))];
  const q25 = pick(0.25), q50 = pick(0.50), q75 = pick(0.75);
  for(const r of valid){
    const v = numFromCell(r[heatBy]);
    let tier;
    if(v >= q75) tier = 'high';
    else if(v >= q50) tier = 'mid';
    else if(v >= q25) tier = 'low';
    else tier = 'vlow';
    if(invert){
      // flip the scale: best becomes worst
      tier = {high:'vlow', mid:'low', low:'mid', vlow:'high'}[tier];
    }
    r._heat = tier;
  }
  return rows;
}
// Every heated table applies the quartile heat tiers to its rows, then
// renders the matching legend, immediately before rendering the table
// itself. Consolidates that 2-call idiom (13 call sites).
function applyHeatAndLegend(rows, heatByField, legendSelector, legendLabel, invert=false){
  applyHeat(rows, heatByField, {invert});
  renderHeatLegend(legendSelector, legendLabel, invert);
}

function renderHeatLegend(host, metricLabel, invert){
  const el = typeof host==='string' ? $(host) : host;
  if(!el) return;
  const tiers = invert
    ? [['hl-high','Best (lowest 25%)'],['hl-mid','Good'],['hl-low','Below median'],['hl-vlow','Worst (top 25%)']]
    : [['hl-high','Top 25%'],['hl-mid','Above median'],['hl-low','Below median'],['hl-vlow','Bottom 25%']];
  el.innerHTML = '<div class="heat-legend">'
    + `<span class="hl-item" style="color:var(--text)">${escHtml(metricLabel)}:</span>`
    + tiers.map(([cls,lbl]) => `<span class="hl-item"><i class="hl-sw ${cls}"></i>${lbl}</span>`).join('')
    + '</div>';
}
function filterSummary(extra=''){
  const parts = ['Month: '+STATE.filterMonth, 'Ref+Cold: '+STATE.filterRefCold];
  if(extra) parts.push(extra);
  return '('+parts.join(' | ')+')';
}

// ---- sortable tables ----
const SORT_STATE = {};
function sortVal(v){
  if(v == null || v === '' || v === '—') return typeof v === 'string' ? '' : 0;
  const s = String(v).replace(/[₹,\s%]/g,'');
  const n = parseFloat(s);
  return isNaN(n) ? String(v).toLowerCase() : n;
}
function makeSortableTable(host, headers, rows, rerenderFn, opts={}){
  const id = typeof host==='string' ? host : '#el';
  if(!SORT_STATE[id]) SORT_STATE[id] = {col:null, dir:'desc'};
  const ss = SORT_STATE[id];
  let body = rows.filter(r=>!r._tot);
  const tots = rows.filter(r=>r._tot);
  if(ss.col){
    body = [...body].sort((a,b)=>{
      const av = sortVal(a[ss.col]), bv = sortVal(b[ss.col]);
      if(typeof av==='string'&&typeof bv==='string') return ss.dir==='asc'?av.localeCompare(bv):bv.localeCompare(av);
      return ss.dir==='asc' ? av-bv : bv-av;
    });
  }
  const sorted = [...body, ...tots];
  const rowClass = r => [r._tot?'grand':'', r._heat?'heat-'+r._heat:''].filter(Boolean).join(' ');
  const thHtml = headers.map(h=>{
    const icon = ss.col===h ? (ss.dir==='asc'?'▲':'▼') : '⇅';
    return `<th class="srt-th" data-col="${escHtml(h)}" style="cursor:pointer;user-select:none;white-space:nowrap">${escHtml(h)} <span style="opacity:0.45;font-size:10px">${icon}</span></th>`;
  }).join('');
  const bodyHtml = sorted.map(r=>`<tr class="${rowClass(r)}">${headers.map(h=>`<td>${r[h]??''}</td>`).join('')}</tr>`).join('');
  const el = typeof host==='string' ? $(host) : host;
  el.innerHTML = `<table class="data ${opts.cls||''}"><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  el.querySelectorAll('th.srt-th').forEach(th=>{
    th.onclick=()=>{
      const col=th.dataset.col;
      ss.col===col ? (ss.dir=ss.dir==='desc'?'asc':'desc') : (ss.col=col, ss.dir='desc');
      rerenderFn();
    };
  });
}
function updateDashboardHeaderFilters(){
  const summary = filterSummary();
  [
    '#hdr-platform-month',
    '#hdr-status-month',
    '#hdr-team',
    '#hdr-campaign-team',
    '#hdr-income',
    '#hdr-cost-summary',
    '#hdr-cpl-rm',
  ].forEach(sel => { const el = $(sel); if(el) el.textContent = summary; });
  const ps = $('#hdr-platform-status');
  if(ps) ps.textContent = filterSummary('Table: '+STATE.filterTable);
}

