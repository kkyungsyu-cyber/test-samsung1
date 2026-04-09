/* ══════════════════════════════════════════════
   Samsung Sales Dashboard — JavaScript
   dashboard.js
══════════════════════════════════════════════ */

/* ── Chart defaults ── */
Chart.defaults.color        = '#6b7280';
Chart.defaults.borderColor  = '#252a38';
Chart.defaults.font.family  = "'Noto Sans KR', sans-serif";

/* ── Palette ── */
const PAL   = ['#1428A0','#00B4D8','#e8b84b','#22c55e','#ef4444','#a78bfa','#fb923c','#38bdf8','#f472b6','#4ade80','#facc15','#f87171','#818cf8','#34d399'];
const CHCOL = ['#1428A0','#0ea5e9','#64748b','#7c3aed','#16a34a'];

/* ── State ── */
let allRows        = [];
let K              = {};
let filterDefs     = [];
let filterState    = {};
let globalDateMin  = null;
let globalDateMax  = null;
let charts         = {};
let dbTimer        = null;
let currentTab     = 'overview';
let tblData        = [];
let tblSort        = { col: null, dir: 1 };
let tblPage        = 0;
let aiCache        = {};

/* ══════════════════════════════
   FORMATTERS
══════════════════════════════ */
function fmtKr(n) {
  if (n >= 100000000) return (Math.round(n / 100000000 * 10) / 10).toFixed(1) + '억';
  if (n >= 10000)     return Math.round(n / 10000) + '만';
  return n.toLocaleString();
}

function fmtKrFull(n) {
  if (n >= 100000000) return (Math.round(n / 100000000 * 10) / 10).toFixed(1) + '억원';
  if (n >= 10000)     return Math.round(n / 10000) + '만원';
  return n.toLocaleString() + '원';
}

function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date)                    return isNaN(raw) ? null : raw;
  if (typeof raw === 'string' && raw.length >= 7) { const d = new Date(raw);              return isNaN(d) ? null : d; }
  if (typeof raw === 'number')                    { const d = new Date((raw - 25569) * 86400000); return isNaN(d) ? null : d; }
  return null;
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

/* ══════════════════════════════
   UPLOAD
══════════════════════════════ */
function initUpload() {
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop',      e => { e.preventDefault(); dz.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });
  dz.addEventListener('click',     () => document.getElementById('file-input').click());
}

function handleFile(file) {
  if (!file) return;
  document.getElementById('upload-section').style.display = 'none';
  document.getElementById('loading').style.display = 'flex';
  const reader = new FileReader();
  reader.onload = e => {
    const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    allRows    = XLSX.utils.sheet_to_json(ws, { defval: null });
    setTimeout(initDashboard, 80);
  };
  reader.readAsArrayBuffer(file);
}

/* ══════════════════════════════
   INIT
══════════════════════════════ */
function findCol(...hints) {
  const keys = Object.keys(allRows[0] || {});
  return keys.find(k => hints.some(h => k.includes(h))) || null;
}

function initDashboard() {
  K = {
    date:    findCol('주문일자', '날짜'),
    bizDate: findCol('영업일자'),
    sales:   findCol('실매출액', '매출액'),
    disc:    findCol('할인액', '할인'),
    qty:     findCol('수량'),
    cat:     findCol('카테고리'),
    channel: findCol('채널'),
    store:   findCol('통합매장명', '매장명', '매장'),
    member:  findCol('회원구분', '회원'),
    gender:  findCol('성별'),
    age:     findCol('연령대', '연령'),
    product: findCol('상품명', '상품'),
    region:  findCol('거주지역'),
    premium: findCol('프리미엄'),
    custId:  findCol('고객ID', '고객id'),
  };

  /* Date range */
  let mn = Infinity, mx = -Infinity;
  allRows.forEach(r => {
    const d = parseDate(r[K.bizDate]) || parseDate(r[K.date]);
    if (d) { const t = d.getTime(); if (t < mn) mn = t; if (t > mx) mx = t; }
  });
  globalDateMin = mn ===  Infinity ? null : new Date(mn);
  globalDateMax = mx === -Infinity ? null : new Date(mx);

  const ds = document.getElementById('date-start');
  const de = document.getElementById('date-end');
  if (globalDateMin) { ds.value = isoDate(globalDateMin); ds.min = isoDate(globalDateMin); }
  if (globalDateMax) { de.value = isoDate(globalDateMax); de.max = isoDate(globalDateMax); }

  const pb = document.getElementById('period-badge');
  if (globalDateMin && globalDateMax) {
    pb.textContent = `${globalDateMin.getFullYear()}.${globalDateMin.getMonth()+1} ~ ${globalDateMax.getFullYear()}.${globalDateMax.getMonth()+1}`;
    pb.style.display = 'block';
  }

  /* Filter definitions */
  filterDefs = [
    { id: 'gender',  label: '성별',     key: K.gender  },
    { id: 'age',     label: '연령대',   key: K.age     },
    { id: 'channel', label: '채널',     key: K.channel },
    { id: 'cat',     label: '카테고리', key: K.cat     },
    { id: 'region',  label: '거주지역', key: K.region  },
    { id: 'premium', label: '프리미엄', key: K.premium },
  ].filter(f => f.key);

  filterDefs.forEach(f => {
    const vals = [...new Set(allRows.map(r => r[f.key]).filter(v => v != null && v !== ''))]
      .sort((a, b) => String(a).localeCompare(String(b), 'ko'));
    f.values = vals.map(String);
    filterState[f.id] = new Set(f.values);
  });

  buildFilterUI();
  document.getElementById('dashboard').style.display = 'flex';
  document.getElementById('loading').style.display   = 'none';
  updateDashboard();
}

/* ══════════════════════════════
   FILTER UI
══════════════════════════════ */
function buildFilterUI() {
  const bar    = document.getElementById('fbar');
  const anchor = document.getElementById('fsep1');
  bar.querySelectorAll('.fg').forEach(el => el.remove());

  [...filterDefs].reverse().forEach(f => {
    const grp = document.createElement('div');
    grp.className = 'fg';
    grp.innerHTML = `
      <button class="ft" id="ft-${f.id}" onclick="toggleDD('${f.id}')">
        ${f.label}
        <span class="bdg" id="fb-${f.id}" style="display:none"></span>
        <span class="arr">▾</span>
      </button>
      <div class="dd" id="dd-${f.id}">
        <div class="dd-act-row">
          <button class="da" onclick="selAll('${f.id}')">전체 선택</button>
          <button class="da" onclick="clrAll('${f.id}')">전체 해제</button>
        </div>
        <div class="di-wrap" id="ddi-${f.id}">
          ${f.values.map(v => `
            <label class="di">
              <input type="checkbox" value="${v.replace(/"/g, '&quot;')}" checked onchange="onChk('${f.id}')">
              <span>${v}</span>
            </label>`).join('')}
        </div>
      </div>`;
    bar.insertBefore(grp, anchor.nextSibling);
  });

  document.addEventListener('click', e => { if (!e.target.closest('.fg')) closeAllDD(); });
}

function toggleDD(id) {
  const dd      = document.getElementById(`dd-${id}`);
  const ft      = document.getElementById(`ft-${id}`);
  const wasOpen = dd.classList.contains('open');
  closeAllDD();
  if (!wasOpen) { dd.classList.add('open'); ft.classList.add('open'); }
}
function closeAllDD() {
  document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.ft.open').forEach(t => t.classList.remove('open'));
}

function onChk(id) {
  filterState[id] = new Set([...document.querySelectorAll(`#ddi-${id} input:checked`)].map(i => i.value));
  updateBadge(id);
  aiCache = {};
  debouncedUpdate();
}
function selAll(id) {
  document.querySelectorAll(`#ddi-${id} input`).forEach(i => i.checked = true);
  filterState[id] = new Set(filterDefs.find(f => f.id === id).values);
  updateBadge(id);
  aiCache = {};
  debouncedUpdate();
}
function clrAll(id) {
  document.querySelectorAll(`#ddi-${id} input`).forEach(i => i.checked = false);
  filterState[id] = new Set();
  updateBadge(id);
  aiCache = {};
  debouncedUpdate();
}
function updateBadge(id) {
  const f    = filterDefs.find(x => x.id === id);
  const bdg  = document.getElementById(`fb-${id}`);
  const trig = document.getElementById(`ft-${id}`);
  const sel  = filterState[id].size;
  const tot  = f.values.length;
  if (sel < tot) { bdg.textContent = sel; bdg.style.display = 'inline-block'; trig.classList.add('active'); }
  else           { bdg.style.display = 'none'; trig.classList.remove('active'); }
}

function resetFilters() {
  filterDefs.forEach(f => {
    filterState[f.id] = new Set(f.values);
    document.querySelectorAll(`#ddi-${f.id} input`).forEach(i => i.checked = true);
    updateBadge(f.id);
  });
  if (globalDateMin) document.getElementById('date-start').value = isoDate(globalDateMin);
  if (globalDateMax) document.getElementById('date-end').value   = isoDate(globalDateMax);
  aiCache = {};
  debouncedUpdate();
}

function getCondText() {
  const parts = [];
  filterDefs.forEach(f => {
    const sel = filterState[f.id].size, tot = f.values.length;
    if (sel < tot) {
      const arr = [...filterState[f.id]];
      parts.push(`${f.label}=${arr.length <= 2 ? arr.join('·') : arr.slice(0,2).join('·') + ' 외 ' + (arr.length-2) + '개'}`);
    }
  });
  const ds = document.getElementById('date-start').value;
  const de = document.getElementById('date-end').value;
  if (globalDateMin && globalDateMax) {
    if (ds !== isoDate(globalDateMin) || de !== isoDate(globalDateMax)) parts.push(`기간 ${ds}~${de}`);
  }
  return parts.join(' / ');
}

function getFilteredRows() {
  const dsVal = document.getElementById('date-start').value;
  const deVal = document.getElementById('date-end').value;
  const ds    = dsVal ? new Date(dsVal) : null;
  const de    = deVal ? new Date(deVal + 'T23:59:59') : null;
  return allRows.filter(r => {
    if (ds || de) {
      const d = parseDate(r[K.bizDate]) || parseDate(r[K.date]);
      if (d) { if (ds && d < ds) return false; if (de && d > de) return false; }
    }
    for (const f of filterDefs) {
      const v = r[f.key];
      if (v == null || v === '') continue;
      if (!filterState[f.id].has(String(v))) return false;
    }
    return true;
  });
}

/* ══════════════════════════════
   DEBOUNCE / UPDATE
══════════════════════════════ */
function debouncedUpdate() {
  clearTimeout(dbTimer);
  dbTimer = setTimeout(updateDashboard, 150);
}

function updateDashboard() {
  const rows  = getFilteredRows();
  const ct    = getCondText();
  const fsEl  = document.getElementById('fsum');
  fsEl.textContent = ct ? '필터: ' + ct : '';
  fsEl.style.display = ct ? 'inline-block' : 'none';
  renderTab(currentTab, rows);
}

/* ══════════════════════════════
   TAB SWITCH
══════════════════════════════ */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  renderTab(tab, getFilteredRows());
}

function renderTab(tab, rows) {
  if      (tab === 'overview')  renderOverview(rows);
  else if (tab === 'channel')   renderChannel(rows);
  else if (tab === 'customer')  renderCustomer(rows);
  else if (tab === 'product')   renderProduct(rows);
  else if (tab === 'detail')    renderDetail(rows);
}

/* ══════════════════════════════
   CHART HELPERS
══════════════════════════════ */
function upChart(id, cfg) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const inst = charts[id];
  if (inst) { inst.data = cfg.data; inst.options = cfg.options; inst.update('none'); }
  else      { charts[id] = new Chart(canvas, cfg); }
}
function rkCls(i) { return i === 0 ? 'g' : i === 1 ? 's' : i === 2 ? 'b' : ''; }

/* ══════════════════════════════
   ① OVERVIEW
══════════════════════════════ */
function renderOverview(rows) {
  let tSales = 0, tDisc = 0, tQty = 0;
  const daily   = {};
  const custSet = new Set();

  rows.forEach(r => {
    const s = Number(r[K.sales] || 0);
    const d = Number(r[K.disc]  || 0);
    const q = Number(r[K.qty]   || 1);
    tSales += s; tDisc += d; tQty += q;
    if (r[K.custId]) custSet.add(r[K.custId]);
    const dt = parseDate(r[K.bizDate]) || parseDate(r[K.date]);
    if (dt) { const ymd = isoDate(dt); daily[ymd] = (daily[ymd] || 0) + s; }
  });

  const discRate = tSales + tDisc > 0 ? (tDisc / (tSales + tDisc) * 100) : 0;
  const avgOrd   = rows.length > 0 ? tSales / rows.length : 0;

  document.getElementById('kpi-grid').innerHTML = [
    { l: '총 실매출액',   v: fmtKrFull(tSales),              s: `총 ${rows.length.toLocaleString()}건` },
    { l: '평균 주문금액', v: fmtKrFull(Math.round(avgOrd)),   s: '건당 평균' },
    { l: '평균 할인율',   v: discRate.toFixed(1) + '%',       s: `할인액 ${fmtKrFull(Math.round(tDisc))}` },
    { l: '총 판매 수량',  v: tQty.toLocaleString() + '개',    s: '수량 합계' },
    { l: '고객 수',      v: custSet.size.toLocaleString() + '명', s: '고유 고객' },
  ].map(k => `<div class="kpi"><div class="kpi-l">${k.l}</div><div class="kpi-v">${k.v}</div><div class="kpi-s">${k.s}</div></div>`).join('');

  /* Monthly line chart (grouped for readability) */
  const monthly = {};
  Object.keys(daily).sort().forEach(d => { const ym = d.slice(0,7); monthly[ym] = (monthly[ym]||0) + daily[d]; });
  const mKeys = Object.keys(monthly).sort();
  document.getElementById('daily-meta').textContent = `${mKeys.length}개월`;

  upChart('dailyChart', {
    type: 'line',
    data: {
      labels: mKeys.map(m => m.replace('-', '.')),
      datasets: [{
        label: '실매출액(억원)',
        data: mKeys.map(m => Math.round(monthly[m] / 100000000 * 10) / 10),
        borderColor: '#00B4D8',
        backgroundColor: 'rgba(0,180,216,0.08)',
        fill: true, tension: 0.4,
        pointRadius: 3, pointBackgroundColor: '#00B4D8', borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.raw}억원` } } },
      scales: {
        x: { ticks: { font: { size: 10 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 18 }, grid: { display: false } },
        y: { ticks: { callback: v => v + '억', font: { size: 11 } }, grid: { color: '#252a38' } }
      }
    }
  });

  triggerAI('overview', rows, tSales, tDisc, rows.length, {});
}

/* ══════════════════════════════
   ② CHANNEL
══════════════════════════════ */
function renderChannel(rows) {
  const chMap = {}, storeMap = {};
  let tSales = 0;
  rows.forEach(r => {
    const s     = Number(r[K.sales]   || 0);
    const ch    = String(r[K.channel] || '기타');
    const store = String(r[K.store]   || '알 수 없음');
    tSales += s;
    chMap[ch]     = (chMap[ch]    || 0) + s;
    storeMap[store] = (storeMap[store] || 0) + s;
  });

  const chSorted = Object.entries(chMap).sort((a, b) => b[1] - a[1]);
  upChart('chDonutChart', {
    type: 'doughnut',
    data: {
      labels: chSorted.map(e => e[0]),
      datasets: [{ data: chSorted.map(e => Math.round(e[1] / 100000000 * 10) / 10), backgroundColor: CHCOL, borderWidth: 0, hoverOffset: 8 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.label}: ${v.raw}억원` } } }
    }
  });
  document.getElementById('ch-leg').innerHTML = chSorted.map(([n, v], i) => {
    const pct = tSales > 0 ? Math.round(v / tSales * 1000) / 10 : 0;
    return `<span class="li"><span class="ld" style="background:${CHCOL[i] || '#888'}"></span>${n} ${pct}%</span>`;
  }).join('');

  const stSorted = Object.entries(storeMap).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const stH      = Math.max(stSorted.length * 32 + 60, 260);
  document.getElementById('storeChart').parentElement.style.height = stH + 'px';
  upChart('storeChart', {
    type: 'bar',
    data: {
      labels: stSorted.map(e => e[0].replace('삼성스토어 ','').replace('삼성 ','').replace('디지털프라자','DP')),
      datasets: [{ label: '실매출액', data: stSorted.map(e => Math.round(e[1] / 100000000 * 10) / 10), backgroundColor: PAL[0], borderRadius: 4, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.raw}억원` } } },
      scales: {
        x: { ticks: { callback: v => v + '억', font: { size: 10 } }, grid: { color: '#252a38' } },
        y: { ticks: { font: { size: 10 } }, grid: { display: false } }
      }
    }
  });

  triggerAI('channel', rows, tSales, 0, rows.length, {
    topCh:    chSorted.slice(0,3).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
    topStore: stSorted.slice(0,3).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
  });
}

/* ══════════════════════════════
   ③ CUSTOMER
══════════════════════════════ */
function renderCustomer(rows) {
  const gMap = {}, ageMap = {}, regMap = {};
  rows.forEach(r => {
    const s  = Number(r[K.sales]  || 0);
    const g  = String(r[K.gender] || '기타');
    const a  = String(r[K.age]    || '기타');
    const rg = String(r[K.region] || '기타');
    gMap[g]   = (gMap[g]   || 0) + s;
    ageMap[a] = (ageMap[a] || 0) + s;
    regMap[rg]= (regMap[rg]|| 0) + s;
  });

  const gSorted  = Object.entries(gMap).sort((a, b) => b[1] - a[1]);
  const gColors  = ['#f472b6', '#38bdf8', '#a78bfa'];
  upChart('genderChart', {
    type: 'doughnut',
    data: {
      labels: gSorted.map(e => e[0]),
      datasets: [{ data: gSorted.map(e => Math.round(e[1]/100000000*10)/10), backgroundColor: gColors, borderWidth: 0, hoverOffset: 7 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.label}: ${v.raw}억원` } } }
    }
  });
  const tG = gSorted.reduce((a, e) => a + e[1], 0);
  document.getElementById('gender-leg').innerHTML = gSorted.map(([n, v], i) =>
    `<span class="li"><span class="ld" style="background:${gColors[i]}"></span>${n} ${tG > 0 ? Math.round(v/tG*1000)/10 : 0}%</span>`
  ).join('');

  const ageSorted = Object.entries(ageMap).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  upChart('ageChart', {
    type: 'bar',
    data: {
      labels: ageSorted.map(e => e[0]),
      datasets: [{ label: '매출액', data: ageSorted.map(e => Math.round(e[1]/100000000*10)/10), backgroundColor: PAL[1], borderRadius: 5, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.raw}억원` } } },
      scales: { x: { ticks: { font: { size: 11 } }, grid: { display: false } }, y: { ticks: { callback: v => v+'억', font:{size:10} }, grid: { color: '#252a38' } } }
    }
  });

  const regSorted = Object.entries(regMap).sort((a, b) => b[1] - a[1]).slice(0, 12);
  upChart('regionChart', {
    type: 'bar',
    data: {
      labels: regSorted.map(e => e[0]),
      datasets: [{ label: '매출액', data: regSorted.map(e => Math.round(e[1]/100000000*10)/10), backgroundColor: PAL[2], borderRadius: 5, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.raw}억원` } } },
      scales: { x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { display: false } }, y: { ticks: { callback: v => v+'억', font:{size:10} }, grid: { color: '#252a38' } } }
    }
  });

  const tSales = gSorted.reduce((a, e) => a + e[1], 0);
  triggerAI('customer', rows, tSales, 0, rows.length, {
    topGender: gSorted.slice(0,2).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
    topAge:    [...ageSorted].sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
    topRegion: regSorted.slice(0,3).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
  });
}

/* ══════════════════════════════
   ④ PRODUCT
══════════════════════════════ */
function renderProduct(rows) {
  const catMap = {}, premMap = {}, prodMap = {};
  rows.forEach(r => {
    const s = Number(r[K.sales] || 0);
    catMap[String(r[K.cat]     || '기타')] = (catMap[String(r[K.cat]     || '기타')] || 0) + s;
    premMap[String(r[K.premium]|| '기타')] = (premMap[String(r[K.premium]|| '기타')] || 0) + s;
    prodMap[String(r[K.product]|| '기타')] = (prodMap[String(r[K.product]|| '기타')] || 0) + s;
  });

  const catSorted  = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  upChart('catChart', {
    type: 'doughnut',
    data: {
      labels: catSorted.map(e => e[0]),
      datasets: [{ data: catSorted.map(e => Math.round(e[1]/100000000*10)/10), backgroundColor: PAL.slice(0, catSorted.length), borderWidth: 0, hoverOffset: 7 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.label}: ${v.raw}억원` } } }
    }
  });
  document.getElementById('cat-leg').innerHTML = catSorted.slice(0, 10).map(([l], i) =>
    `<span class="li"><span class="ld" style="background:${PAL[i]}"></span>${l}</span>`).join('');

  const premSorted = Object.entries(premMap).sort((a, b) => b[1] - a[1]);
  const pH = Math.max(premSorted.length * 36 + 60, 220);
  document.getElementById('premChart').parentElement.style.height = pH + 'px';
  upChart('premChart', {
    type: 'bar',
    data: {
      labels: premSorted.map(e => e[0]),
      datasets: [{ label: '매출액', data: premSorted.map(e => Math.round(e[1]/100000000*10)/10), backgroundColor: PAL.slice(0, premSorted.length), borderRadius: 5, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => `${v.raw}억원` } } },
      scales: { x: { ticks: { callback: v => v+'억', font:{size:10} }, grid:{color:'#252a38'} }, y: { ticks:{font:{size:11}}, grid:{display:false} } }
    }
  });

  const topP = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxS = topP[0]?.[1] || 1;
  document.getElementById('top-table').innerHTML = topP.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:24px">데이터 없음</td></tr>'
    : `<thead><tr><th style="width:28px">#</th><th>상품명</th><th style="text-align:right;width:80px">실매출액</th><th style="width:90px"></th></tr></thead>
       <tbody>${topP.map(([name, sale], i) => `
        <tr>
          <td><span class="rk ${rkCls(i)}">${i+1}</span></td>
          <td style="color:#e8eaf2">${name}</td>
          <td style="text-align:right;color:#e8b84b;font-weight:500">${fmtKrFull(sale)}</td>
          <td><div class="barm" style="width:${Math.round(sale/maxS*100)}%"></div></td>
        </tr>`).join('')}
       </tbody>`;

  const tSales = catSorted.reduce((a, e) => a + e[1], 0);
  triggerAI('product', rows, tSales, 0, rows.length, {
    topCat:  catSorted.slice(0,3).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
    topPrem: premSorted.slice(0,3).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
    topProd: topP.slice(0,3).map(([k,v]) => `${k}(${Math.round(v/100000000*10)/10}억)`).join(', '),
  });
}

/* ══════════════════════════════
   ⑤ DETAIL TABLE
══════════════════════════════ */
function renderDetail(rows) {
  tblData = rows;
  tblPage = 0;
  tblSort = { col: null, dir: 1 };

  const colKeys = Object.keys(allRows[0] || {}).slice(0, 15);
  document.getElementById('dtbl-head').innerHTML =
    '<tr>' + colKeys.map((k, i) => `<th onclick="sortTable(${i},'${k.replace(/'/g, "\\'")}')"><span>${k}</span></th>`).join('') + '</tr>';

  renderTable();
}

function renderTable() {
  const q     = document.getElementById('tbl-search').value.toLowerCase();
  const pgSz  = parseInt(document.getElementById('tbl-pgsz').value);
  const colKeys = Object.keys(allRows[0] || {}).slice(0, 15);

  let filtered = q
    ? tblData.filter(r => colKeys.some(k => String(r[k] || '').toLowerCase().includes(q)))
    : [...tblData];

  if (tblSort.col !== null) {
    filtered.sort((a, b) => {
      const va = a[tblSort.col] ?? '';
      const vb = b[tblSort.col] ?? '';
      return typeof va === 'number'
        ? (va - vb) * tblSort.dir
        : String(va).localeCompare(String(vb), 'ko') * tblSort.dir;
    });
  }

  const total   = filtered.length;
  const maxPage = Math.max(0, Math.ceil(total / pgSz) - 1);
  if (tblPage > maxPage) tblPage = maxPage;

  const slice = filtered.slice(tblPage * pgSz, tblPage * pgSz + pgSz);
  document.getElementById('tbl-info').textContent =
    `총 ${total.toLocaleString()}건 중 ${Math.min((tblPage + 1) * pgSz, total)}건 표시`;

  document.getElementById('dtbl-body').innerHTML = slice.map(r =>
    '<tr>' + colKeys.map(k => {
      const v = r[k];
      return v instanceof Date ? `<td>${isoDate(v)}</td>` : `<td>${v ?? ''}</td>`;
    }).join('') + '</tr>'
  ).join('');

  /* Pagination */
  const totalPages = Math.ceil(total / pgSz);
  const pg = document.getElementById('tbl-pg');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }

  const pages = [];
  pages.push(`<button class="pg-btn" onclick="goPage(0)" ${tblPage===0?'disabled':''}>«</button>`);
  pages.push(`<button class="pg-btn" onclick="goPage(${tblPage-1})" ${tblPage===0?'disabled':''}>‹</button>`);
  const start = Math.max(0, tblPage - 2), end = Math.min(totalPages - 1, tblPage + 2);
  for (let i = start; i <= end; i++) {
    pages.push(`<button class="pg-btn ${i===tblPage?'active':''}" onclick="goPage(${i})">${i+1}</button>`);
  }
  pages.push(`<button class="pg-btn" onclick="goPage(${tblPage+1})" ${tblPage===totalPages-1?'disabled':''}>›</button>`);
  pages.push(`<button class="pg-btn" onclick="goPage(${totalPages-1})" ${tblPage===totalPages-1?'disabled':''}>»</button>`);
  pg.innerHTML = pages.join('');
}

function goPage(p)  { tblPage = p; renderTable(); }

function sortTable(idx, colKey) {
  if (tblSort.col === colKey) tblSort.dir *= -1;
  else { tblSort.col = colKey; tblSort.dir = 1; }
  document.querySelectorAll('.dtbl th').forEach((th, i) => {
    th.className = '';
    if (i === idx) th.className = tblSort.dir === 1 ? 'sort-asc' : 'sort-desc';
  });
  tblPage = 0;
  renderTable();
}

/* ══════════════════════════════
   AI COMMENTS
══════════════════════════════ */
const AI_PROMPTS = {
  overview: d => `삼성 판매 데이터 애널리스트입니다. 전체 현황: 주문 ${d.cnt}건, 실매출 ${fmtKrFull(d.sales)}, 할인율 ${d.disc}%. 종합 인사이트 1~2문장.`,
  channel:  d => `삼성 판매 데이터 애널리스트입니다. 채널 분석: 주문 ${d.cnt}건, 실매출 ${fmtKrFull(d.sales)}, 채널별: ${d.extra?.topCh||''}, 매장 Top: ${d.extra?.topStore||''}. 채널 인사이트 1~2문장.`,
  customer: d => `삼성 판매 데이터 애널리스트입니다. 고객 분석: 주문 ${d.cnt}건, 실매출 ${fmtKrFull(d.sales)}, 성별: ${d.extra?.topGender||''}, 연령: ${d.extra?.topAge||''}, 지역: ${d.extra?.topRegion||''}. 고객 세그먼트 특징 1~2문장.`,
  product:  d => `삼성 판매 데이터 애널리스트입니다. 상품 분석: 주문 ${d.cnt}건, 실매출 ${fmtKrFull(d.sales)}, 카테고리: ${d.extra?.topCat||''}, 프리미엄: ${d.extra?.topPrem||''}, 상품: ${d.extra?.topProd||''}. 상품 성과 인사이트 1~2문장.`,
};

function triggerAI(tab, rows, sales, disc, cnt, extra = {}) {
  const cacheKey = `${tab}|${getCondText()}|${cnt}`;
  if (aiCache[tab] === cacheKey) return;
  aiCache[tab] = cacheKey;

  const txtEl  = document.getElementById(`txt-${tab}`);
  const condEl = document.getElementById(`cond-${tab}`);
  const btnEl  = document.getElementById(`btn-${tab}`);

  condEl.textContent = getCondText() || '전체';
  txtEl.innerHTML    = '<div class="ai-loading"><div class="spin sm"></div> AI 분석 중...</div>';
  if (btnEl) btnEl.disabled = true;

  const discRate = sales + disc > 0 ? (disc / (sales + disc) * 100).toFixed(1) : '0';
  const promptFn = AI_PROMPTS[tab];
  if (!promptFn) return;
  const prompt = promptFn({ cnt, sales, disc: discRate, extra }) + ' 인사말 없이 한국어로 바로 작성.';

  fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
  })
  .then(r  => r.json())
  .then(data => {
    const txt = data.content?.map(c => c.text || '').join('') || '결과를 가져오지 못했습니다.';
    txtEl.className   = 'ai-txt';
    txtEl.textContent = txt;
  })
  .catch(() => { txtEl.innerHTML = '<span style="color:#ef4444">AI 분석 중 오류가 발생했습니다.</span>'; })
  .finally(() => { if (btnEl) btnEl.disabled = false; });
}

function runAI(tab) {
  aiCache[tab] = null;
  updateDashboard();
}

/* ══════════════════════════════
   BOOT
══════════════════════════════ */
document.addEventListener('DOMContentLoaded', initUpload);
