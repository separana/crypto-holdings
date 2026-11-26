/* Family Net Worth v6.1 - Multi-Owner, Live ETF Search & Quotes, Crypto & Manual Assets */
const $ = (s) => document.querySelector(s);

const assetsDiv = $("#assets");
const heroTitle = $("#heroTitle");
const heroTotal = $("#heroTotal");
const heroInvested = $("#heroInvested");
const heroPlBadge = $("#heroPlBadge");
const bestEl = $("#best");
const worstEl = $("#worst");
const statusNote = $("#statusNote");
const pieWrap = $("#pieWrap");
const pieCtx = document.getElementById('pie').getContext('2d');

const fiatSel = $("#fiat");
const refreshInp = $("#refresh");
const toggleSpark = $("#toggleSpark");
const toggleBadges = $("#toggleBadges");
const sortSel = $("#sortSel");
const typeFilter = $("#typeFilter");

const assetTypeSel = $("#assetType");
const assetOwnerSel = $("#assetOwner");
const searchInp = $("#search");
const dropdown = $("#dropdown");
const etfSearchInp = $("#etfSearch");
const etfDropdown = $("#etfDropdown");
const manualNameInp = $("#manualName");
const manualValueInp = $("#manualValue");
const amountInp = $("#amount");
const avgCostInp = $("#avgCost");

let pieChart;
let deferredPrompt;
let searchTimer;
let etfTimer;
let selectedCrypto = null;
let selectedEtf = null;
let editingId = null;

const OWNER_LABELS = {
  all: 'Totale Gezinswaarde',
  mine: 'Mijn Vermogen',
  leo: 'Portefeuille Léo',
  cesar: 'Portefeuille César'
};

const OWNER_BADGES = {
  mine: '👤 Niké',
  leo: '👧 Léo',
  cesar: '👶 César'
};

const TYPE_LABELS = {
  etf: 'ETF / Aandeel',
  crypto: 'Crypto',
  manual: 'Cash / Overig'
};

let state = {
  fiat: 'eur',
  refreshMins: 5,
  showSpark: true,
  showBadges: true,
  privacy: false,
  activeOwner: 'all',
  chartMode: 'category',
  sortBy: 'value',
  typeFilter: 'all',
  lastUpdated: null,
  items: []
};

function save() {
  localStorage.setItem('holdings.v6', JSON.stringify(state));
}

function load() {
  let raw = localStorage.getItem('holdings.v6');
  if (!raw) {
    const oldRaw = localStorage.getItem('holdings.v4');
    if (oldRaw) {
      try {
        const oldData = JSON.parse(oldRaw);
        if (Array.isArray(oldData.items)) {
          state.fiat = oldData.fiat || 'eur';
          state.items = oldData.items.map(it => ({
            ...it,
            uid: `crypto_${it.id}_mine`,
            type: 'crypto',
            owner: 'mine'
          }));
          save();
        }
      } catch {}
    }
  } else {
    try { state = Object.assign(state, JSON.parse(raw)); } catch {}
  }

  fiatSel.value = state.fiat || 'eur';
  document.querySelectorAll('.curLabel').forEach(el => el.textContent = (state.fiat || 'eur').toUpperCase());
  refreshInp.value = state.refreshMins || 5;
  toggleSpark.checked = state.showSpark !== false;
  toggleBadges.checked = state.showBadges !== false;
  sortSel.value = state.sortBy || 'value';
  typeFilter.value = state.typeFilter || 'all';
  document.body.classList.toggle('blur-mode', !!state.privacy);

  document.querySelectorAll('#ownerTabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.owner === state.activeOwner);
  });
  document.querySelectorAll('#chartModeToggle button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.chartMode);
  });
}
load();

// -------- UI Helpers
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function fmt(n) {
  return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: Math.abs(n) < 1 ? 4 : 2 }).format(n || 0);
}
function fmtQty(n) {
  return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: Math.abs(n) < 1 ? 8 : 4 }).format(n || 0);
}
function money(n) {
  const cur = state.fiat === 'eur' ? 'EUR' : 'USD';
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: cur }).format(n || 0);
}
function seedColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 68%, 55%)`;
}

function colorForItem(it) {
  const s = (it.symbol || '').toUpperCase();
  const map = {
    'BTC': '#f7931a',
    'ETH': '#627eea',
    'SOL': '#14f195',
    'ADA': '#3b82f6',
    'ENJ': '#8b5cf6',
    'VWCE': '#10b981',
    'VWCE.DE': '#10b981',
    'SPYI.DE': '#06b6d4',
    'EXUS.DE': '#6366f1'
  };
  return map[s] || seedColor(it.uid || s || 'asset');
}

// -------- Formulier wisselen op basis van Type Actief
function syncFormFields() {
  const t = assetTypeSel.value;
  $("#etfWrap").style.display = t === 'etf' ? 'block' : 'none';
  $("#cryptoSearchWrap").style.display = t === 'crypto' ? 'block' : 'none';
  $("#manualWrap").style.display = t === 'manual' ? 'grid' : 'none';
  $("#qtyField").style.display = t === 'manual' ? 'none' : 'block';
  $("#costLabel").innerHTML = t === 'manual'
    ? `Totale inleg / kostprijs (<span class="curLabel">${state.fiat.toUpperCase()}</span>)`
    : `Aankoopprijs per stuk (<span class="curLabel">${state.fiat.toUpperCase()}</span>)`;
}
assetTypeSel.addEventListener('change', () => {
  editingId = null;
  syncFormFields();
});
syncFormFields();

// -------- APIs: CoinGecko (Crypto) & Yahoo Finance (ETF / Aandelen)
async function geckoSearch(q) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    const j = await r.json();
    return j.coins?.slice(0, 10).map(c => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      thumb: c.thumb
    })) || [];
  } catch { return []; }
}

async function geckoMarketsBatch(ids, vs) {
  if (!ids.length) return [];
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${encodeURIComponent(vs)}&ids=${encodeURIComponent(ids.join(','))}&sparkline=true&price_change_percentage=24h,7d`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`CoinGecko HTTP ${r.status}`);
  return r.json();
}

async function fetchProxiedJson(targetUrl) {
  const proxies = [
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
  ];
  for (const url of proxies) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const text = await r.text();
      return JSON.parse(text);
    } catch {}
  }
  return null;
}

async function yahooSearch(q) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
  const j = await fetchProxiedJson(url);
  if (!j?.quotes?.length) return [];
  return j.quotes
    .filter(x => x.quoteType === 'ETF' || x.quoteType === 'EQUITY' || x.quoteType === 'MUTUALFUND')
    .map(x => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      exch: x.exchDisp || x.exchange || ''
    }));
}

async function fetchYahooQuote(ticker, targetFiat) {
  const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=7d`;
  const j = await fetchProxiedJson(targetUrl);
  const res = j?.chart?.result?.[0];
  if (!res) return null;

  const meta = res.meta;
  const closes = (res.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  let price = meta.regularMarketPrice || closes[closes.length - 1] || 0;
  const prevClose = meta.chartPreviousClose || closes[0] || price;
  const change24h = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  const first7d = closes[0] || price;
  const change7d = first7d > 0 ? ((price - first7d) / first7d) * 100 : 0;

  const quoteCur = (meta.currency || 'EUR').toLowerCase();
  if (quoteCur !== targetFiat && (quoteCur === 'eur' || quoteCur === 'usd')) {
    const fx = await fxRateEURUSD();
    if (fx) {
      price = (quoteCur === 'usd' && targetFiat === 'eur') ? (price / fx) : (price * fx);
    }
  }

  return { price, change24h, change7d, spark7d: closes };
}

async function fxRateEURUSD() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
    if (!r.ok) return null;
    const j = await r.json();
    const usd = j.bitcoin?.usd || 0, eur = j.bitcoin?.eur || 0;
    return (usd && eur) ? (usd / eur) : null;
  } catch { return null; }
}

// -------- Filtering & Sorting
function getVisibleItems() {
  let list = state.items.filter(it => {
    if (state.activeOwner !== 'all' && it.owner !== state.activeOwner) return false;
    if (state.typeFilter !== 'all' && it.type !== state.typeFilter) return false;
    return true;
  });

  if (state.sortBy === 'plPct') {
    return list.sort((a, b) => {
      const pctA = a.avgCost > 0 ? ((a.price - a.avgCost) / a.avgCost) : -999;
      const pctB = b.avgCost > 0 ? ((b.price - b.avgCost) / b.avgCost) : -999;
      return pctB - pctA;
    });
  }
  if (state.sortBy === 'change24h') {
    return list.sort((a, b) => (b.change24h || 0) - (a.change24h || 0));
  }
  return list.sort((a, b) => ((b.price || 0) * b.amount) - ((a.price || 0) * a.amount));
}

// -------- Rendering
function renderTotals() {
  const ownerItems = state.items.filter(it => state.activeOwner === 'all' || it.owner === state.activeOwner);

  let total = 0, invested = 0;
  ownerItems.forEach(it => {
    total += (it.price || 0) * (it.amount || 0);
    invested += (it.avgCost || 0) * (it.amount || 0);
  });
  const pl = total - invested;
  const plPct = invested > 0 ? (pl / invested * 100) : 0;

  heroTitle.textContent = OWNER_LABELS[state.activeOwner] || 'Totale Waarde';
  heroTotal.textContent = money(total);
  heroInvested.textContent = money(invested);
  heroPlBadge.className = `pill sensitive ${pl >= 0 ? 'gain' : 'loss'}`;
  heroPlBadge.textContent = `${pl >= 0 ? '+' : ''}${money(pl)} (${pl >= 0 ? '+' : ''}${fmt(plPct)}%)`;

  let best = null, worst = null;
  ownerItems.forEach(it => {
    const inv = (it.avgCost || 0) * (it.amount || 0);
    const plIt = ((it.price || 0) * (it.amount || 0)) - inv;
    const pct = inv > 0 ? (plIt / inv) * 100 : (it.change24h || 0);
    if (best === null || pct > best.pct) best = { name: it.symbol, pct };
    if (worst === null || pct < worst.pct) worst = { name: it.symbol, pct };
  });

  bestEl.className = `pill ${best && best.pct >= 0 ? 'gain' : 'neutral'}`;
  worstEl.className = `pill ${worst && worst.pct < 0 ? 'loss' : 'neutral'}`;
  bestEl.textContent = best ? `🏆 ${best.name} ${best.pct >= 0 ? '+' : ''}${fmt(best.pct)}%` : '🏆 —';
  worstEl.textContent = worst ? `📉 ${worst.name} ${worst.pct >= 0 ? '+' : ''}${fmt(worst.pct)}%` : '📉 —';

  return total;
}

function sparkline(canvas, data, isPositive) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = 190;
  const h = canvas.height = 64;
  ctx.clearRect(0, 0, w, h);
  if (!data || data.length < 2) return;

  const min = Math.min(...data), max = Math.max(...data);
  const pad = 6;
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + (w - 2 * pad) * (i / (data.length - 1));
    const y = h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = isPositive ? '#10b981' : '#f43f5e';
  ctx.stroke();
}

function renderAssets(portfolioTotal) {
  assetsDiv.innerHTML = '';
  const visible = getVisibleItems();
  $("#listTitle").textContent = `${OWNER_LABELS[state.activeOwner]} (${visible.length})`;

  if (!visible.length) {
    assetsDiv.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted)">Geen posities in deze weergave. Voeg hierboven een ETF, crypto of spaarrekening toe.</div>`;
    return;
  }

  visible.forEach((it, idx) => {
    const val = (it.price || 0) * (it.amount || 0);
    const inv = (it.avgCost || 0) * (it.amount || 0);
    const pl = val - inv;
    const plPct = inv > 0 ? (pl / inv) * 100 : 0;
    const weight = portfolioTotal > 0 ? (val / portfolioTotal) * 100 : 0;
    const ch24 = it.change24h || 0;
    const ch7 = it.change7d || 0;

    const fallbackEmoji = it.type === 'etf' ? '📈' : (it.type === 'manual' ? '🏦' : (it.symbol?.[0] || '?'));

    const card = document.createElement('div');
    card.className = 'asset';
    card.innerHTML = `
      <div class="asset-top">
        <div class="asset-id">
          <div class="coin-icon">
            ${it.icon ? `<img src="${it.icon}" alt="${it.symbol}">` : fallbackEmoji}
          </div>
          <div>
            <div class="coin-name">
              ${it.name}
              <span class="tag">${fmt(weight)}%</span>
              ${state.activeOwner === 'all' ? `<span class="tag owner">${OWNER_BADGES[it.owner] || ''}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--muted)">
              ${it.type === 'manual' ? 'Manuele waardering' : `Koers: ${money(it.price)}`}
            </div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;font-size:15px" class="sensitive">${money(val)}</div>
          <div style="font-size:12px;color:var(--muted)" class="sensitive">
            ${it.type === 'manual' ? '' : `${fmtQty(it.amount)} ${it.symbol}`}
          </div>
        </div>
      </div>

      <div class="asset-mid">
        <div style="font-size:12px;color:var(--muted)">
          ${it.type === 'manual' ? `Inleg: <span class="sensitive">${money(inv)}</span>` : `GAK: <span class="sensitive">${money(it.avgCost)}</span>`}
        </div>
        <div class="sensitive" style="font-size:13px;font-weight:700;color:${pl >= 0 ? 'var(--good)' : 'var(--bad)'}">
          ${pl >= 0 ? '+' : ''}${money(pl)} (${pl >= 0 ? '+' : ''}${fmt(plPct)}%)
        </div>
      </div>

      <div class="asset-bot">
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${(state.showBadges && it.type !== 'manual') ? `
            <span class="pill ${ch24 >= 0 ? 'gain' : 'loss'}">24u ${ch24 >= 0 ? '+' : ''}${fmt(ch24)}%</span>
            <span class="pill ${ch7 >= 0 ? 'gain' : 'loss'}">7d ${ch7 >= 0 ? '+' : ''}${fmt(ch7)}%</span>
          ` : `<span class="tag">${TYPE_LABELS[it.type]}</span>`}
        </div>
        ${(state.showSpark && it.type !== 'manual' && it.spark7d?.length > 1) ? `<canvas class="spark" id="spark-${idx}"></canvas>` : ''}
      </div>

      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px">
        <button data-action="edit" data-uid="${it.uid}" class="ghost icon-btn" style="padding:5px 10px;font-size:12px">Bewerk</button>
        <button data-action="remove" data-uid="${it.uid}" class="danger icon-btn" style="padding:5px 10px;font-size:12px">Verwijder</button>
      </div>
    `;
    assetsDiv.appendChild(card);

    if (state.showSpark && it.type !== 'manual' && it.spark7d?.length > 1) {
      const can = document.getElementById(`spark-${idx}`);
      const lastUp = it.spark7d[it.spark7d.length - 1];
      const first = it.spark7d[0];
      sparkline(can, it.spark7d, lastUp >= first);
    }
  });
}

function renderPie(portfolioTotal) {
  const ownerItems = state.items.filter(it => state.activeOwner === 'all' || it.owner === state.activeOwner);
  if (pieChart) pieChart.destroy();
  if (!ownerItems.length) return;

  let labels = [], data = [], colors = [];

  if (state.chartMode === 'category') {
    const groups = { etf: 0, crypto: 0, manual: 0 };
    ownerItems.forEach(it => {
      groups[it.type] = (groups[it.type] || 0) + ((it.price || 0) * (it.amount || 0));
    });
    const catMeta = [
      { key: 'etf', label: "ETF's & Aandelen", color: '#10b981' },
      { key: 'crypto', label: 'Crypto', color: '#f7931a' },
      { key: 'manual', label: 'Cash & Overig', color: '#3b82f6' }
    ].filter(c => groups[c.key] > 0);

    labels = catMeta.map(c => c.label);
    data = catMeta.map(c => groups[c.key]);
    colors = catMeta.map(c => c.color);
  } else {
    const sorted = [...ownerItems].sort((a, b) => ((b.price || 0) * b.amount) - ((a.price || 0) * a.amount));
    labels = sorted.map(it => state.activeOwner === 'all' ? `${it.symbol} (${OWNER_BADGES[it.owner].split(' ')[1]})` : it.symbol);
    data = sorted.map(it => (it.price || 0) * (it.amount || 0));
    colors = sorted.map(it => colorForItem(it));
  }

  const centerTextPlugin = {
    id: 'centerText',
    afterDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom } } = chart;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 11px system-ui';
      ctx.fillText(state.chartMode === 'category' ? 'CATEGORIEËN' : 'POSITIES', cx, cy - 8);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 15px system-ui';
      ctx.fillText(`${ownerItems.length} items`, cx, cy + 12);
      ctx.restore();
    }
  };

  pieChart = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#111827', hoverOffset: 6 }]
    },
    options: {
      cutout: '68%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#f8fafc', boxWidth: 12, padding: 14, font: { size: 12, weight: '600' } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw || 0;
              const pct = portfolioTotal > 0 ? ((v / portfolioTotal) * 100).toFixed(1) : 0;
              return state.privacy ? ` ${ctx.label}: ${pct}%` : ` ${ctx.label}: ${money(v)} (${pct}%)`;
            }
          }
        }
      }
    },
    plugins: [centerTextPlugin]
  });
}

// -------- Autocomplete Search: Crypto
searchInp.addEventListener('input', () => {
  clearTimeout(searchTimer);
  selectedCrypto = null;
  const q = searchInp.value.trim();
  if (q.length < 2) { dropdown.classList.remove('open'); return; }
  searchTimer = setTimeout(async () => {
    const list = await geckoSearch(q);
    dropdown.innerHTML = list.length
      ? list.map(c => `
          <div class="drop-item" data-id="${c.id}" data-symbol="${c.symbol}" data-name="${c.name}" data-thumb="${c.thumb}">
            <div style="display:flex;align-items:center;gap:10px">
              <img src="${c.thumb}" alt="">
              <div><strong>${c.name}</strong> <span style="color:var(--muted);font-size:12px">${c.symbol}</span></div>
            </div>
          </div>`).join('')
      : `<div class="drop-item" style="color:var(--muted)">Geen resultaten</div>`;
    dropdown.classList.add('open');
  }, 380);
});

dropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.drop-item[data-id]');
  if (!item) return;
  selectedCrypto = {
    id: item.dataset.id,
    symbol: item.dataset.symbol,
    name: item.dataset.name,
    thumb: item.dataset.thumb
  };
  searchInp.value = `${selectedCrypto.name} (${selectedCrypto.symbol})`;
  dropdown.classList.remove('open');
});

// -------- Autocomplete Search: ETF / Aandeel
etfSearchInp.addEventListener('input', () => {
  clearTimeout(etfTimer);
  selectedEtf = null;
  const q = etfSearchInp.value.trim();
  if (q.length < 2) { etfDropdown.classList.remove('open'); return; }
  etfDropdown.innerHTML = `<div class="drop-item" style="color:var(--muted)">Zoeken op beurs...</div>`;
  etfDropdown.classList.add('open');

  etfTimer = setTimeout(async () => {
    const list = await yahooSearch(q);
    etfDropdown.innerHTML = list.length
      ? list.map(c => `
          <div class="drop-item" data-symbol="${c.symbol}" data-name="${c.name}">
            <div>
              <strong>${c.symbol}</strong> <span style="color:var(--muted);font-size:12px">${c.name}</span>
            </div>
            <span class="tag">${c.exch}</span>
          </div>`).join('')
      : `<div class="drop-item" style="color:var(--muted)">Geen resultaten — typ evt. exacte ticker (bv. VWCE.DE)</div>`;
  }, 420);
});

etfDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.drop-item[data-symbol]');
  if (!item) return;
  selectedEtf = {
    symbol: item.dataset.symbol,
    name: item.dataset.name
  };
  etfSearchInp.value = `${selectedEtf.symbol} — ${selectedEtf.name}`;
  etfDropdown.classList.remove('open');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.field')) {
    dropdown.classList.remove('open');
    etfDropdown.classList.remove('open');
  }
});

// -------- CRUD & DCA
async function savePosition(isDca = false) {
  const type = assetTypeSel.value;
  const owner = assetOwnerSel.value;
  const cost = parseFloat(avgCostInp.value || '0');

  let uid, id, symbol, name, amount, price = 0, icon = '';

  if (type === 'crypto') {
    if (!selectedCrypto) { toast('⚠️ Kies eerst een cryptomunt uit de lijst'); return; }
    amount = parseFloat(amountInp.value || '0');
    if (!amount || amount <= 0) { toast('⚠️ Vul een geldige hoeveelheid in'); return; }
    id = selectedCrypto.id;
    symbol = selectedCrypto.symbol;
    name = selectedCrypto.name;
    icon = selectedCrypto.thumb || '';
    uid = `crypto_${id}_${owner}`;
  } else if (type === 'etf') {
    const ticker = selectedEtf ? selectedEtf.symbol : etfSearchInp.value.trim().toUpperCase();
    if (!ticker) { toast('⚠️ Zoek en kies eerst een ETF of aandeel'); return; }
    amount = parseFloat(amountInp.value || '0');
    if (!amount || amount <= 0) { toast('⚠️ Vul een geldig aantal stuks in'); return; }
    id = ticker;
    symbol = ticker;
    name = selectedEtf ? selectedEtf.name : ticker;
    uid = `etf_${ticker}_${owner}`;
  } else {
    const mName = manualNameInp.value.trim();
    const mVal = parseFloat(manualValueInp.value || '0');
    if (!mName) { toast('⚠️ Geef deze bezitting een naam'); return; }
    id = mName.toLowerCase().replace(/\s+/g, '-');
    symbol = mName.slice(0, 6).toUpperCase();
    name = mName;
    amount = 1;
    price = mVal;
    uid = editingId || `manual_${id}_${owner}_${Date.now()}`;
  }

  let existing = state.items.find(x => x.uid === (editingId || uid));

  if (!existing) {
    state.items.push({
      uid, id, type, owner, symbol, name, amount,
      avgCost: cost || 0,
      price,
      icon,
      change24h: 0,
      change7d: 0,
      spark7d: [],
      history: [{ date: new Date().toISOString().slice(0, 10), amount, price: cost || 0 }]
    });
    toast(`✅ ${name} toegevoegd aan ${OWNER_BADGES[owner]}`);
  } else if (isDca) {
    if (type === 'manual') {
      existing.price = (existing.price || 0) + price;
      existing.avgCost = (existing.avgCost || 0) + (cost || 0);
    } else {
      const totalAmount = (existing.amount || 0) + amount;
      const totalInvested = ((existing.amount || 0) * (existing.avgCost || 0)) + (amount * (cost || 0));
      existing.amount = totalAmount;
      existing.avgCost = totalAmount > 0 ? (totalInvested / totalAmount) : 0;
    }
    existing.history = existing.history || [];
    existing.history.push({ date: new Date().toISOString().slice(0, 10), amount, price: cost || 0 });
    toast(`📈 Bijkoop verwerkt voor ${existing.name}!`);
  } else {
    existing.owner = owner;
    existing.name = name;
    existing.amount = amount;
    existing.avgCost = cost || 0;
    if (type === 'manual') existing.price = price;
    toast(`✅ ${existing.name} bijgewerkt`);
  }

  editingId = null;
  selectedCrypto = null;
  selectedEtf = null;
  searchInp.value = '';
  etfSearchInp.value = '';
  manualNameInp.value = '';
  manualValueInp.value = '';
  amountInp.value = '';
  avgCostInp.value = '';

  save();
  await refreshPrices();
}

assetsDiv.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const uid = btn.dataset.uid;
  if (btn.dataset.action === 'remove') {
    state.items = state.items.filter(x => x.uid !== uid);
    save();
    renderAll();
    toast('🗑️ Positie verwijderd');
  } else if (btn.dataset.action === 'edit') {
    const it = state.items.find(x => x.uid === uid);
    if (!it) return;
    editingId = it.uid;
    assetTypeSel.value = it.type;
    assetOwnerSel.value = it.owner;
    syncFormFields();

    if (it.type === 'crypto') {
      selectedCrypto = { id: it.id, symbol: it.symbol, name: it.name, thumb: it.icon };
      searchInp.value = `${it.name} (${it.symbol})`;
      amountInp.value = it.amount;
      avgCostInp.value = it.avgCost || '';
    } else if (it.type === 'etf') {
      selectedEtf = { symbol: it.id, name: it.name };
      etfSearchInp.value = `${it.id} — ${it.name}`;
      amountInp.value = it.amount;
      avgCostInp.value = it.avgCost || '';
    } else {
      manualNameInp.value = it.name;
      manualValueInp.value = it.price;
      avgCostInp.value = it.avgCost || '';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`✏️ ${it.name} geladen om te bewerken`);
  }
});

$("#addBtn").addEventListener('click', () => savePosition(false));
$("#dcaBtn").addEventListener('click', () => savePosition(true));

// Tabs & Filters
$("#ownerTabs").addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  state.activeOwner = tab.dataset.owner;
  if (state.activeOwner !== 'all') assetOwnerSel.value = state.activeOwner;
  document.querySelectorAll('#ownerTabs .tab').forEach(t => t.classList.toggle('active', t === tab));
  save();
  renderAll();
});

$("#chartModeToggle").addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  state.chartMode = btn.dataset.mode;
  document.querySelectorAll('#chartModeToggle button').forEach(b => b.classList.toggle('active', b === btn));
  save();
  renderAll();
});

sortSel.addEventListener('change', () => { state.sortBy = sortSel.value; save(); renderAll(); });
typeFilter.addEventListener('change', () => { state.typeFilter = typeFilter.value; save(); renderAll(); });

$("#privacyBtn").addEventListener('click', () => {
  state.privacy = !state.privacy;
  document.body.classList.toggle('blur-mode', state.privacy);
  save();
  renderAll();
});

// -------- Instellingen & Backup
$("#saveSettings").addEventListener('click', async () => {
  const prev = state.fiat;
  state.fiat = fiatSel.value;
  document.querySelectorAll('.curLabel').forEach(el => el.textContent = state.fiat.toUpperCase());
  state.refreshMins = Math.max(1, parseInt(refreshInp.value || '5', 10));
  state.showSpark = toggleSpark.checked;
  state.showBadges = toggleBadges.checked;
  save();

  if (prev !== state.fiat) {
    const fx = await fxRateEURUSD();
    if (fx) {
      const factor = (prev === 'eur' && state.fiat === 'usd') ? fx : (1 / fx);
      state.items.forEach(it => {
        it.avgCost = (it.avgCost || 0) * factor;
        if (it.type === 'manual') it.price = (it.price || 0) * factor;
      });
      save();
    }
  }
  toast('⚙️ Instellingen opgeslagen');
  refreshPrices();
});

$("#refreshNow").addEventListener('click', () => {
  toast('↻ Live koersen ophalen...');
  refreshPrices();
});

$("#exportBtn").addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `family-networth-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('💾 Back-up gedownload');
});

$("#importFile").addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.items)) {
        state = Object.assign(state, data);
        save();
        renderAll();
        refreshPrices();
        toast('✅ Back-up geïmporteerd');
      } else { toast('⚠️ Ongeldig bestand'); }
    } catch { toast('⚠️ Kon JSON niet lezen'); }
  };
  reader.readAsText(f);
});

$("#clearBtn").addEventListener('click', () => {
  if (confirm('Weet je zeker dat je alle gezinsdata wilt wissen?')) {
    state.items = [];
    save();
    renderAll();
    toast('🗑️ Alle data gewist');
  }
});

$("#forceBtn").addEventListener('click', async () => {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  location.reload();
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("#installBtn").onclick = async () => {
    deferredPrompt?.prompt();
    await deferredPrompt?.userChoice;
    deferredPrompt = null;
  };
});

// -------- Live Koersen Verversen (Crypto + ETF's)
async function refreshPrices() {
  const liveItems = state.items.filter(it => it.type === 'crypto' || it.type === 'etf');
  if (liveItems.length === 0) {
    renderAll();
    statusNote.textContent = state.items.length ? 'Manueel bijgewerkt' : 'Geen posities';
    return;
  }

  pieWrap.classList.add('shimmer');
  statusNote.textContent = 'Koersen ophalen...';

  try {
    const cryptoIds = [...new Set(state.items.filter(it => it.type === 'crypto').map(it => it.id))];
    if (cryptoIds.length) {
      const markets = await geckoMarketsBatch(cryptoIds, state.fiat);
      const map = new Map(markets.map(m => [m.id, m]));
      state.items.forEach(it => {
        if (it.type === 'crypto' && map.has(it.id)) {
          const m = map.get(it.id);
          it.price = m.current_price ?? it.price;
          it.icon = m.image || it.icon;
          it.change24h = m.price_change_percentage_24h ?? it.change24h;
          it.change7d = m.price_change_percentage_7d_in_currency ?? it.change7d;
          it.spark7d = m.sparkline_in_7d?.price || it.spark7d;
        }
      });
    }

    const etfTickers = [...new Set(state.items.filter(it => it.type === 'etf').map(it => it.id))];
    for (const ticker of etfTickers) {
      try {
        const q = await fetchYahooQuote(ticker, state.fiat);
        if (q && q.price > 0) {
          state.items.forEach(it => {
            if (it.type === 'etf' && it.id === ticker) {
              it.price = q.price;
              it.change24h = q.change24h;
              it.change7d = q.change7d;
              it.spark7d = q.spark7d;
            }
          });
        }
      } catch {}
    }

    const now = new Date();
    state.lastUpdated = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    statusNote.textContent = `Live • ${state.lastUpdated}`;
    save();
  } catch {
    statusNote.textContent = `Offline • Laatst: ${state.lastUpdated || 'onbekend'}`;
  } finally {
    pieWrap.classList.remove('shimmer');
    renderAll();
  }
}

function renderAll() {
  const total = renderTotals();
  renderAssets(total);
  renderPie(total);
}

renderAll();
refreshPrices();
setInterval(refreshPrices, Math.max(1, (state.refreshMins || 5)) * 60 * 1000);
