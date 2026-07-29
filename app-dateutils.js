// app-dateutils.js — Date parsing and month-key helpers.
// Part of the app.js split (classic script, shares global scope with the other app-*.js files).

// ---- date parsing ----
function parseDateAny(v){
  if(v==null||v===''||v==='N/A') return null;
  if(v instanceof Date && !isNaN(v)){ const yr=v.getFullYear(); return (yr>=2000 && yr<=2099)?v:null; }
  if(typeof v==='number'){ const d=new Date(Date.UTC(1899,11,30)+v*86400000); if(isNaN(d)) return null; const yr=d.getFullYear(); return (yr>=2000 && yr<=2099)?d:null; }
  if(typeof v==='string'){
    const s = v.trim(); if(!s||s.toUpperCase()==='N/A') return null;
    let m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if(m){ const yr=+m[3]; if(yr<2000||yr>2099) return null; const d=new Date(yr, +m[2]-1, +m[1]); return isNaN(d)?null:d; }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(m){ const yr=+m[1]; if(yr<2000||yr>2099) return null; const d=new Date(yr, +m[2]-1, +m[3]); return isNaN(d)?null:d; }
    const d = new Date(s.replace(' ','T')); if(isNaN(d)) return null; const yr=d.getFullYear(); return (yr>=2000 && yr<=2099)?d:null;
  }
  return null;
}
const toMmmYyyy  = v => { const norm = normalizeMonthLabel(v); if(norm) return norm; const d=parseDateAny(v); return d ? MONTHS_3[d.getMonth()]+'-'+d.getFullYear() : 'N/A'; };
const toIsoDate  = v => { const d=parseDateAny(v); return d ? d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()) : ''; };
const monthKey   = mmm => {
  const norm = normalizeMonthLabel(mmm);
  if(!norm) return -1;
  const [m,y]=norm.split('-');
  return +y*100 + MONTHS_3.indexOf(m);
};
const sortMonths = arr => arr.filter(m=>m && m!=='N/A').sort((a,b)=>monthKey(a)-monthKey(b));
const pickField = (row, ...names) => {
  for(const name of names){
    if(row[name] != null && row[name] !== '') return row[name];
  }
  return '';
};
function normalizeMonthLabel(v){
  if(v==null || v==='' || v==='N/A') return '';
  if(v instanceof Date && !isNaN(v)){ const yr=v.getFullYear(); return (yr>=2000 && yr<=2099) ? MONTHS_3[v.getMonth()]+'-'+yr : ''; }
  const s = String(v).trim();
  const m = s.match(/^([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if(m){
    const mon = m[1].slice(0,1).toUpperCase()+m[1].slice(1,3).toLowerCase();
    const yr = m[2].length===2 ? '20'+m[2] : m[2];
    if(+yr<2000 || +yr>2099) return '';
    return MONTHS_3.includes(mon) ? mon+'-'+yr : '';
  }
  // Handle full month name: "April 2026", "April-2026"
  const FULL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const fm = s.match(/^([A-Za-z]+)[- ,]+(\d{4})$/);
  if(fm){
    const idx = FULL_MONTHS.findIndex(n=>n.toLowerCase()===fm[1].toLowerCase());
    if(idx>=0 && +fm[2]>=2000 && +fm[2]<=2099) return MONTHS_3[idx]+'-'+fm[2];
  }
  const d = parseDateAny(v);
  return d ? MONTHS_3[d.getMonth()]+'-'+d.getFullYear() : '';
}
function statusMonthCol(status){
  if(status === 'CONVERTED') return 'CM';
  if(status === 'IN PROCESS') return 'LPM';
  return 'CTM';
}

// Whether a lead should be counted as CONVERTED. Per business rule (2026-07-29),
// presence of a Converted Month (CM) is definitive — leadStatus is ignored. A
// lead with CM='May-2026' but leadStatus='FOLLOW UP' still counts as converted
// for May-2026. `monthMatchFn` is the caller's month predicate (monthFilter,
// rmPerfMonthMatch, etc.); omit to count all CM-present leads regardless of month.
function isConvertedLead(row, monthMatchFn){
  const cm = row.CM;
  if(!cm || cm === 'N/A') return false;
  return monthMatchFn ? monthMatchFn(cm) : true;
}
function dashboardStatusMonthCol(status){
  if(status === 'CONVERTED') return 'CM';
  if(status === 'IN PROCESS') return 'LPM';
  return 'FMONTH';
}
function anyMonthCol(status){
  if(status === 'CONVERTED') return 'CM';
  if(status === 'IN PROCESS') return 'LPM';
  return 'CTM';
}

