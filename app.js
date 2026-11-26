/* Holdings v5 - Autocomplete, Privacy Mode, Center-Text Donut, Sorting & DCA History */
const $ = (s) => document.querySelector(s);

const assetsDiv = $("#assets");
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
const curLabel = $("#curLabel");

const searchInp = $("#search");
const dropdown = $("#dropdown");
const amountInp = $("#amount");
const avgCostInp = $("#avgCost");

let pieChart;
let deferredPrompt;
let searchTimer;
let selectedCoin = null; // { id, symbol, name, thumb }

let state = {
  fiat: 'eur',
  refreshMins: 5,
  showSpark: true,
  showBadges: true,
  privacy: false,
  sortBy: 'value',
  lastUpdated: null,
  items: []
};

function save() {
  localStorage.setItem('holdings.v4', JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem('holdings.v4');
  if (raw) {
    try { state = Object.assign(state, JSON.parse(raw)); } catch {}
  }
  fiatSel.value = state.fiat || 'eur';
  curLabel.textContent = (state.fiat || 'eur').toUpperCase();
  refreshInp.value = state.refreshMins || 5;
  toggleSpark.checked = state.showSpark !== false;
  toggleBadges.checked = state.showBadges !== false;
  sortSel.value = state.sortBy || 'value';
  document.body.classList.toggle('blur-mode', !!state.privacy);
}
load();

// -------- UI Helpers
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
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

function pieColorForSymbol(sym, fallbackSeed) {
  const s = (sym || '').toUpperCase();
  const map = {
    'BTC': '#f7931a',
    'ETH': '#627eea',
    'SOL': '#14f195',
    'ADA': '#3b82f6',
    'ENJ': '#8b5cf6',
    'XRP': '#00aae4',
    'DOT': '#e6007a'
  };
  return map[s] || seedColor(fallbackSeed || s || 'coin');
}

// -------- CoinGecko API
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
  } catch {
    return [];
  }
}

async function geckoMarketsBatch(ids, vs) {
  if (!ids.length) return [];
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${encodeURIComponent(vs)}&ids=${encodeURIComponent(ids.join(','))}&sparkline=true&price_change_percentage=24h,7d`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fxRateEURUSD() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
    if (!r.ok) return null;
    const j = await r.json();
    const usd = j.bitcoin?.usd || 0, eur = j.bitcoin?.eur || 0;
    return (usd && eur) ? (usd / eur) : null;
  } catch {
    return null;
  }
}

// -------- Sorting & Metrics
function getSortedItems() {
  const list = [...state.items];
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
  let total = 0, invested = 0;
  state.items.forEach(it => {
    total += (it.price || 0) * (it.amount || 0);
    invested += (it.avgCost || 0) * (it.amount || 0);
  });
  const pl = total - invested;
  const plPct = invested > 0 ? (pl / invested * 100) : 0;

  heroTotal.textContent = money(total);
  heroInvested.textContent = money(invested);
  heroPlBadge.className = `pill sensitive ${pl >= 0 ? 'gain' : 'loss'}`;
  heroPlBadge.textContent = `${pl >= 0 ? '+' : ''}${money(pl)} (${pl >= 0 ? '+' : ''}${fmt(plPct)}%)`;

  let best = null, worst = null;
  state.items.forEach(it => {
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
  const color = isPositive ? '#10b981' : '#f43f5e';

  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + (w - 2 * pad) * (i / (data.length - 1));
    const y = h - pad - ((v - min) / (max - min || 1)) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}

function renderAssets(portfolioTotal) {
  assetsDiv.innerHTML = '';
  const sorted = getSortedItems();

  if (!sorted.length) {
    assetsDiv.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--muted)">Nog geen munten toegevoegd. Zoek hierboven een munt om te starten.</div>`;
    return;
  }

  sorted.forEach((it, idx) => {
    const val = (it.price || 0) * (it.amount || 0);
    const inv = (it.avgCost || 0) * (it.amount || 0);
    const pl = val - inv;
    const plPct = inv > 0 ? (pl / inv) * 100 : 0;
    const weight = portfolioTotal > 0 ? (val / portfolioTotal) * 100 : 0;
    const ch24 = it.change24h || 0;
    const ch7 = it.change7d || 0;

    const card = document.createElement('div');
    card.className = 'asset';
    card.innerHTML = `
      <div class="asset-top">
        <div class="asset-id">
          <div class="coin-icon">
            ${it.icon ? `<img src="${it.icon}" alt="${it.symbol}">` : (it.symbol?.[0] || '?')}
          </div>
          <div>
            <div class="coin-name">${it.name} <span class="weight-tag">${fmt(weight)}%</span></div>
            <div style="font-size:12px;color:var(--muted)">Koers: ${money(it.price)}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700;font-size:15px" class="sensitive">${money(val)}</div>
          <div style="font-size:12px;color:var(--muted)" class="sensitive">${fmtQty(it.amount)} ${it.symbol}</div>
        </div>
      </div>

      <div class="asset-mid">
        <div style="font-size:12px;color:var(--muted)">GAK: <span class="sensitive">${money(it.avgCost)}</span></div>
        <div class="sensitive" style="font-size:13px;font-weight:700;color:${pl >= 0 ? 'var(--good)' : 'var(--bad)'}">
          ${pl >= 0 ? '+' : ''}${money(pl)} (${pl >= 0 ? '+' : ''}${fmt(plPct)}%)
        </div>
      </div>

      <div class="asset-bot">
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${state.showBadges ? `
            <span class="pill ${ch24 >= 0 ? 'gain' : 'loss'}">24u ${ch24 >= 0 ? '+' : ''}${fmt(ch24)}%</span>
            <span class="pill ${ch7 >= 0 ? 'gain' : 'loss'}">7d ${ch7 >= 0 ? '+' : ''}${fmt(ch7)}%</span>
          ` : ''}
        </div>
        ${state.showSpark ? `<canvas class="spark" id="spark-${idx}"></canvas>` : ''}
      </div>

      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:10px">
        <button data-action="edit" data-id="${it.id}" class="ghost icon-btn" style="padding:5px 10px;font-size:12px">Bewerk</button>
        <button data-action="remove" data-id="${it.id}" class="danger icon-btn" style="padding:5px 10px;font-size:12px">Verwijder</button>
      </div>
    `;
    assetsDiv.appendChild(card);

    if (state.showSpark) {
      const can = document.getElementById(`spark-${idx}`);
      const lastUp = it.spark7d?.length ? it.spark7d[it.spark7d.length - 1] : 0;
      const first = it.spark7d?.length ? it.spark7d[0] : 0;
      sparkline(can, it.spark7d || [], lastUp >= first);
    }
  });
}

function renderPie(portfolioTotal) {
  const sorted = [...state.items].sort((a, b) => ((b.price || 0) * b.amount) - ((a.price || 0) * a.amount));
  const labels = sorted.map(it => it.symbol);
  const data = sorted.map(it => (it.price || 0) * (it.amount || 0));
  const colors = sorted.map(it => pieColorForSymbol(it.symbol, it.id));

  if (pieChart) pieChart.destroy();
  if (!sorted.length) return;

  // Plugin voor tekst in het midden van de donut
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
      ctx.fillText('ACTIVA', cx, cy - 8);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 15px system-ui';
      ctx.fillText(`${sorted.length} munten`, cx, cy + 12);
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

// -------- Autocomplete Search
searchInp.addEventListener('input', () => {
  clearTimeout(searchTimer);
  selectedCoin = null;
  const q = searchInp.value.trim();
  if (q.length < 2) {
    dropdown.classList.remove('open');
    return;
  }
  searchTimer = setTimeout(async () => {
    const list = await geckoSearch(q);
    if (!list.length) {
      dropdown.innerHTML = `<div class="drop-item" style="color:var(--muted)">Geen resultaten</div>`;
    } else {
      dropdown.innerHTML = list.map(c => `
        <div class="drop-item" data-id="${c.id}" data-symbol="${c.symbol}" data-name="${c.name}" data-thumb="${c.thumb}">
          <img src="${c.thumb}" alt="">
          <div><strong>${c.name}</strong> <span style="color:var(--muted);font-size:12px">${c.symbol}</span></div>
        </div>
      `).join('');
    }
    dropdown.classList.add('open');
  }, 380);
});

dropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.drop-item[data-id]');
  if (!item) return;
  selectedCoin = {
    id: item.dataset.id,
    symbol: item.dataset.symbol,
    name: item.dataset.name,
    thumb: item.dataset.thumb
  };
  searchInp.value = `${selectedCoin.name} (${selectedCoin.symbol})`;
  dropdown.classList.remove('open');
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.field')) dropdown.classList.remove('open');
});

// -------- CRUD & DCA
async function saveCoin(isDca = false) {
  if (!selectedCoin) {
    toast('⚠️ Kies eerst een munt uit de zoeklijst');
    searchInp.focus();
    return;
  }
  const amount = parseFloat(amountInp.value || '0');
  const avgCost = parseFloat(avgCostInp.value || '0');
  if (!amount || amount <= 0) {
    toast('⚠️ Vul een geldige hoeveelheid in');
    amountInp.focus();
    return;
  }

  let it = state.items.find(x => x.id === selectedCoin.id);
  if (!it) {
    it = {
      id: selectedCoin.id,
      symbol: selectedCoin.symbol,
      name: selectedCoin.name,
      amount,
      avgCost: avgCost || 0,
      price: 0,
      icon: selectedCoin.thumb || '',
      change24h: 0,
      change7d: 0,
      spark7d: [],
      history: [{ date: new Date().toISOString().slice(0, 10), amount, price: avgCost || 0 }]
    };
    state.items.push(it);
    toast(`✅ ${it.symbol} toegevoegd`);
  } else if (isDca) {
    const totalAmount = (it.amount || 0) + amount;
    const totalInvested = ((it.amount || 0) * (it.avgCost || 0)) + (amount * (avgCost || 0));
    it.amount = totalAmount;
    it.avgCost = totalAmount > 0 ? (totalInvested / totalAmount) : 0;
    it.history = it.history || [];
    it.history.push({ date: new Date().toISOString().slice(0, 10), amount, price: avgCost || 0 });
    toast(`📈 Bijkoop verwerkt! Nieuwe GAK: ${money(it.avgCost)}`);
  } else {
    it.amount = amount;
    it.avgCost = avgCost || 0;
    toast(`✅ ${it.symbol} bijgewerkt`);
  }

  selectedCoin = null;
  searchInp.value = '';
  amountInp.value = '';
  avgCostInp.value = '';
  save();
  await refreshPrices();
}

assetsDiv.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'remove') {
    state.items = state.items.filter(x => x.id !== id);
    save();
    renderAll();
    toast('🗑️ Positie verwijderd');
  } else if (btn.dataset.action === 'edit') {
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    selectedCoin = { id: it.id, symbol: it.symbol, name: it.name, thumb: it.icon };
    searchInp.value = `${it.name} (${it.symbol})`;
    amountInp.value = it.amount;
    avgCostInp.value = it.avgCost || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`✏️ ${it.symbol} geladen om te bewerken`);
  }
});

$("#addBtn").addEventListener('click', () => saveCoin(false));
$("#dcaBtn").addEventListener('click', () => saveCoin(true));
$("#sortSel").addEventListener('change', () => {
  state.sortBy = sortSel.value;
  save();
  renderAll();
});

$("#privacyBtn").addEventListener('click', () => {
  state.privacy = !state.privacy;
  document.body.classList.toggle('blur-mode', state.privacy);
  save();
  renderPie(state.items.reduce((acc, it) => acc + (it.price || 0) * (it.amount || 0), 0));
});

// -------- Instellingen & Backup
$("#saveSettings").addEventListener('click', async () => {
  const prev = state.fiat;
  state.fiat = fiatSel.value;
  curLabel.textContent = state.fiat.toUpperCase();
  state.refreshMins = Math.max(1, parseInt(refreshInp.value || '5', 10));
  state.showSpark = toggleSpark.checked;
  state.showBadges = toggleBadges.checked;
  save();

  if (prev !== state.fiat) {
    const fx = await fxRateEURUSD();
    if (fx) {
      const factor = (prev === 'eur' && state.fiat === 'usd') ? fx : (1 / fx);
      state.items.forEach(it => it.avgCost = (it.avgCost || 0) * factor);
      save();
    }
  }
  toast('⚙️ Instellingen opgeslagen');
  refreshPrices();
});

$("#refreshNow").addEventListener('click', () => {
  toast('↻ Koersen verversen...');
  refreshPrices();
});

$("#exportBtn").addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `holdings-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      } else {
        toast('⚠️ Ongeldig bestand');
      }
    } catch {
      toast('⚠️ Kon JSON niet lezen');
    }
  };
  reader.readAsText(f);
});

$("#clearBtn").addEventListener('click', () => {
  if (confirm('Weet je zeker dat je alle posities wilt wissen?')) {
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

$("#loadSample").addEventListener('click', async () => {
  state.items = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', amount: 0.02598515, avgCost: 82000, price: 0, icon: '', change24h: 0, change7d: 0, spark7d: [] },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', amount: 0.2464598, avgCost: 2600, price: 0, icon: '', change24h: 0, change7d: 0, spark7d: [] },
    { id: 'cardano', symbol: 'ADA', name: 'Cardano', amount: 406.047, avgCost: 0.78, price: 0, icon: '', change24h: 0, change7d: 0, spark7d: [] },
    { id: 'solana', symbol: 'SOL', name: 'Solana', amount: 1.1452, avgCost: 128, price: 0, icon: '', change24h: 0, change7d: 0, spark7d: [] },
    { id: 'enjincoin', symbol: 'ENJ', name: 'Enjin', amount: 1729.2, avgCost: 0.20, price: 0, icon: '', change24h: 0, change7d: 0, spark7d: [] }
  ];
  save();
  await refreshPrices();
  toast('🧪 Voorbeeldportfolio geladen');
});

// -------- Live Prices Refresh
async function refreshPrices() {
  if (state.items.length === 0) {
    renderAll();
    if (pieChart) pieChart.destroy();
    statusNote.textContent = 'Geen actieve posities';
    return;
  }

  pieWrap.classList.add('shimmer');
  statusNote.textContent = 'Koersen ophalen...';

  try {
    const ids = state.items.map(it => it.id);
    const markets = await geckoMarketsBatch(ids, state.fiat);
    const map = new Map(markets.map(m => [m.id, m]));

    state.items.forEach(it => {
      const m = map.get(it.id);
      if (m) {
        it.price = m.current_price ?? it.price;
        it.icon = m.image || it.icon;
        it.change24h = m.price_change_percentage_24h ?? it.change24h;
        it.change7d = m.price_change_percentage_7d_in_currency ?? it.change7d;
        it.spark7d = m.sparkline_in_7d?.price || it.spark7d;
      }
    });

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
