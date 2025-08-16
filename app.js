/* Holdings v4 - dynamic colors, FX conversion, sparklines, badges, force refresh */
const $ = (s)=>document.querySelector(s);
const assetsDiv = $("#assets");
const totalsDiv = $("#totals");
const bestEl = $("#best");
const worstEl = $("#worst");
const fxNote = $("#fxNote");
const pieWrap = $("#pieWrap");
const pieCtx = document.getElementById('pie').getContext('2d');

const fiatSel = $("#fiat");
const refreshInp = $("#refresh");
const toggleSpark = $("#toggleSpark");
const toggleBadges = $("#toggleBadges");

const amountInp = $("#amount");
const avgCostInp = $("#avgCost");
const searchInp = $("#search");
const searchRes = $("#searchResult");

let pieChart;
let deferredPrompt;

let state = {
  fiat: 'eur',
  refreshMins: 5,
  showSpark: true,
  showBadges: true,
  items: [] // {id, symbol, name, amount, avgCost, price, value, invested, color, icon, change24h, change7d, spark7d}
};

function save(){ localStorage.setItem('holdings.v4', JSON.stringify(state)); }
function load(){
  const raw = localStorage.getItem('holdings.v4');
  if(raw){ try{ state = JSON.parse(raw);}catch{} }
  fiatSel.value = state.fiat || 'eur';
  refreshInp.value = state.refreshMins || 5;
  toggleSpark.checked = state.showSpark !== false;
  toggleBadges.checked = state.showBadges !== false;
}
load();

// -------- Utils
function fmt(n){ return new Intl.NumberFormat('nl-BE', {maximumFractionDigits: n<1?8:4}).format(n||0); }
function money(n){ const cur = state.fiat==='eur'?'EUR':'USD'; return new Intl.NumberFormat('nl-BE', {style:'currency',currency:cur}).format(n||0); }
function signClass(x){ return (x||0) >= 0 ? 'gain' : 'loss'; }
function seedPastel(seed){
  // generate deterministic pastel from seed string
  let h = 0;
  for(let i=0;i<seed.length;i++) h = (h*31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue},70%,60%)`;
}

// -------- CoinGecko helpers
async function geckoSearch(q){
  const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
  if(!r.ok) return [];
  const j = await r.json();
  return j.coins?.map(c=>({id:c.id, symbol:c.symbol.toUpperCase(), name:c.name})) || [];
}

async function geckoDetails(id){
  // includes sparkline; color not officially provided => we create pastel color from id/name
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`);
  if(!r.ok) return null;
  const j = await r.json();
  return {
    icon: j.image?.small || j.image?.thumb || '',
    spark: j.market_data?.sparkline_7d?.price || [],
    change24h: j.market_data?.price_change_percentage_24h ?? 0,
    change7d: j.market_data?.price_change_percentage_7d ?? 0,
    color: seedPastel(j.id || j.name || 'coin')
  };
}

async function geckoPrices(ids, vs){
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`;
  const r = await fetch(url);
  if(!r.ok) return {};
  return r.json();
}

async function fxRateEURUSD(){
  // derive FX via BTC price in USD/EUR
  const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur');
  if(!r.ok) return null;
  const j = await r.json();
  const usd = j.bitcoin?.usd || 0, eur = j.bitcoin?.eur || 0;
  if(!usd || !eur) return null;
  return usd/eur; // 1 EUR = X USD
}

// -------- Rendering
function renderTotals(){
  let total = 0, invested = 0;
  state.items.forEach(it=>{ total += it.value||0; invested += (it.avgCost||0)*(it.amount||0); });
  const pl = total - invested;
  const plPct = invested>0 ? (pl/invested*100) : 0;
  totalsDiv.innerHTML = `
    <div class="box"><div class="muted">Totaal waarde</div><div class="big">${money(total)}</div></div>
    <div class="box"><div class="muted">Geïnvesteerd</div><div class="big">${money(invested)}</div></div>
    <div class="box"><div class="muted">P/L</div><div class="big ${signClass(pl)}">${money(pl)} <span class="badg">${fmt(plPct)}%</span></div></div>
  `;
  // best/worst by personal P/L
  let best = null, worst = null;
  state.items.forEach(it=>{
    const plIt = (it.price||0)*(it.amount||0) - (it.avgCost||0)*(it.amount||0);
    if(best==null || plIt > best.pl) best = {name:it.symbol, pl:plIt};
    if(worst==null || plIt < worst.pl) worst = {name:it.symbol, pl:plIt};
  });
  bestEl.textContent = best ? `🏆 Best: ${best.name} ${money(best.pl)}` : '🏆 Best: —';
  worstEl.textContent = worst ? `📉 Worst: ${worst.name} ${money(worst.pl)}` : '📉 Worst: —';
}

function sparkline(canvas, data, color){
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.offsetWidth;
  const h = canvas.height = 40;
  ctx.clearRect(0,0,w,h);
  if(!data || data.length<2){ ctx.strokeStyle = '#3b3b3b'; ctx.strokeRect(0,0,w,h); return; }
  const min = Math.min(...data), max = Math.max(...data);
  const pad = 4;
  ctx.beginPath();
  data.forEach((v,i)=>{
    const x = pad + (w-2*pad) * (i/(data.length-1));
    const y = h - pad - ( (v-min) / (max-min||1) ) * (h-2*pad);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function renderAssets(){
  assetsDiv.innerHTML = '';
  state.items.forEach((it, idx)=>{
    const card = document.createElement('div');
    card.className = 'asset';
    const icon = document.createElement('div');
    icon.className = 'icon shimmer';
    if(it.icon){
      const img = document.createElement('img'); img.src = it.icon; img.alt = it.symbol; img.style="width:100%;height:100%;object-fit:cover";
      img.onload = ()=> icon.classList.remove('shimmer');
      icon.appendChild(img);
    }else{
      icon.textContent = it.symbol?.[0]||'?';
    }
    const right = document.createElement('div');
    const pl = (it.price||0)*(it.amount||0) - (it.avgCost||0)*(it.amount||0);
    const ch24 = it.change24h || 0;
    const ch7 = it.change7d || 0;
    right.innerHTML = `
      <div class="flex" style="justify-content:space-between">
        <div class="name">${it.name} <span class="muted">${it.symbol}</span></div>
        <div class="muted">${money(it.price)}</div>
      </div>
      <div class="flex" style="justify-content:space-between">
        <div class="muted">Aantal: ${fmt(it.amount)} • Waarde: ${money((it.price||0)*(it.amount||0))}</div>
        <div class="${pl>=0?'gain':'loss'}">P/L: ${money(pl)}</div>
      </div>
      <div class="flex" style="justify-content:space-between;margin-top:4px">
        <div id="badges-${idx}" class="flex">
          ${state.showBadges? `<span class="badg ${ch24>=0?'gain':'loss'}">24h ${fmt(ch24)}%</span>
          <span class="badg ${ch7>=0?'gain':'loss'}">7d ${fmt(ch7)}%</span>` : ''}
        </div>
        <div style="width:120px"><canvas class="spark" id="spark-${idx}"></canvas></div>
      </div>
      <div class="flex" style="justify-content:flex-end;margin-top:6px">
        <button onclick="editCoin('${it.id}')" class="ghost">Bewerk</button>
        <button onclick="removeCoin('${it.id}')" class="bad">Verwijder</button>
      </div>
    `;
    card.appendChild(icon);
    card.appendChild(right);
    assetsDiv.appendChild(card);

    if(state.showSpark){
      const can = document.getElementById(`spark-${idx}`);
      const lastUp = (it.spark7d?.length? it.spark7d[it.spark7d.length-1] : 0);
      const first = (it.spark7d?.length? it.spark7d[0] : 0);
      const col = lastUp>=first ? '#16a34a' : '#ef4444';
      sparkline(can, it.spark7d||[], col);
    } else {
      const b = document.getElementById(`badges-${idx}`);
      if(b) b.style.marginRight = 'auto';
    }
  });
}

function renderPie(){
  const labels = state.items.map(it=>it.symbol);
  const data = state.items.map(it=> (it.price||0)*(it.amount||0) );
  const colors = state.items.map(it=> it.color || seedPastel(it.id) );
  if(pieChart) pieChart.destroy();
  pieChart = new Chart(pieCtx, {
    type: 'pie',
    data: { labels, datasets: [{ data, backgroundColor: colors }]},
    options: { plugins: { legend: { position:'bottom' } } }
  });
}

// -------- CRUD
async function addOrUpdate(){
  const opt = searchRes.value;
  if(!opt){ alert('Zoek eerst een munt en kies in de dropdown.'); return; }
  const [id, symbol, name] = opt.split('|');
  const amount = parseFloat(amountInp.value||'0');
  const avgCost = parseFloat(avgCostInp.value||'0');
  if(!amount || amount<=0){ alert('Geef een geldige hoeveelheid.'); return; }

  let it = state.items.find(x=>x.id===id);
  if(!it){
    const det = await geckoDetails(id);
    it = { id, symbol, name, amount, avgCost: avgCost||0, price:0, value:0, invested:0,
           color: det?.color || seedPastel(id), icon: det?.icon || '', change24h: det?.change24h||0, change7d: det?.change7d||0, spark7d: det?.spark||[] };
    state.items.push(it);
  }else{
    it.amount = amount;
    it.avgCost = avgCost||0;
  }
  save();
  await refreshPrices();
}

function removeCoin(id){
  state.items = state.items.filter(x=>x.id!==id);
  save(); renderAll();
}
function editCoin(id){
  const it = state.items.find(x=>x.id===id);
  if(!it) return;
  searchInp.value = it.name;
  searchRes.innerHTML = `<option value="${it.id}|${it.symbol}|${it.name}">${it.name} (${it.symbol})</option>`;
  amountInp.value = it.amount;
  avgCostInp.value = it.avgCost || '';
  window.scrollTo({top:0, behavior:'smooth'});
}

// -------- Search wiring
searchInp.addEventListener('input', async ()=>{
  const q = searchInp.value.trim();
  if(q.length<2) return;
  const list = await geckoSearch(q);
  searchRes.innerHTML = list.map(c=> `<option value="${c.id}|${c.symbol}|${c.name}">${c.name} (${c.symbol})</option>` ).join('');
});

$("#addBtn").addEventListener('click', addOrUpdate);
$("#clearBtn").addEventListener('click', ()=>{
  if(confirm('Alles wissen?')){ state.items = []; save(); renderAll(); }
});

// -------- Settings
$("#saveSettings").addEventListener('click', async ()=>{
  const prev = state.fiat;
  state.fiat = fiatSel.value;
  state.refreshMins = parseInt(refreshInp.value||'5',10);
  state.showSpark = toggleSpark.checked;
  state.showBadges = toggleBadges.checked;
  save();

  if(prev !== state.fiat){
    // Convert avgCost and show FX note
    const fx = await fxRateEURUSD();
    if(fx){
      if(prev==='eur' && state.fiat==='usd'){
        state.items.forEach(it=> it.avgCost = (it.avgCost||0) * fx );
        fxNote.textContent = `💱 Omgerekend met 1 EUR = ${fmt(fx)} USD`;
      }else if(prev==='usd' && state.fiat==='eur'){
        state.items.forEach(it=> it.avgCost = (it.avgCost||0) / fx );
        fxNote.textContent = `💱 Omgerekend met 1 USD = ${fmt(1/fx)} EUR`;
      }
      save();
    }
  }
  refreshPrices();
});

$("#refreshNow").addEventListener('click', refreshPrices);

// Export/Import
$("#exportBtn").addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='holdings-v4-export.json'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
});
$("#importFile").addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if(data.items){ state = Object.assign(state, data); save(); renderAll(); refreshPrices(); }
      else alert('Ongeldige export.');
    }catch{ alert('Kon JSON niet lezen.'); }
  };
  reader.readAsText(f);
});

// Force refresh
$("#forceBtn").addEventListener('click', async ()=>{
  if('caches' in window){
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('holdings-')).map(k=>caches.delete(k)));
  }
  if('serviceWorker' in navigator){
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r=>r.unregister()));
  }
  location.reload(true);
});

// Install prompt
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt = e;
  const btn = $("#installBtn");
  btn.onclick = async ()=>{ deferredPrompt?.prompt(); await deferredPrompt?.userChoice; deferredPrompt=null; };
});

// Sample
$("#loadSample").addEventListener('click', async ()=>{
  const sample = [
    {id:'bitcoin', symbol:'BTC', name:'Bitcoin', amount:0.00915495, avgCost:100000},
    {id:'ethereum', symbol:'ETH', name:'Ethereum', amount:0.10216061, avgCost:3000},
    {id:'cardano', symbol:'ADA', name:'Cardano', amount:951.00100085, avgCost:0.5},
    {id:'solana', symbol:'SOL', name:'Solana', amount:1.13101, avgCost:100},
    {id:'enjincoin', symbol:'ENJ', name:'Enjin', amount:1729.2, avgCost:0.2},
  ];
  state.items = [];
  for(const s of sample){
    const det = await geckoDetails(s.id);
    state.items.push({ ...s, price:0, value:0, invested:0, color: det?.color || seedPastel(s.id), icon: det?.icon || '', change24h: det?.change24h||0, change7d: det?.change7d||0, spark7d: det?.spark||[] });
  }
  save(); renderAll(); refreshPrices();
});

async function refreshPrices(){
  if(state.items.length===0){ renderTotals(); renderAssets(); if(pieChart) pieChart.destroy(); return; }
  pieWrap.classList.add('shimmer');
  const ids = state.items.map(it=>it.id).join(',');
  const prices = await geckoPrices(ids, state.fiat);
  // update details for change and spark every few refreshes or if missing
  for(let i=0;i<state.items.length;i++){
    const it = state.items[i];
    const p = prices[it.id]?.[state.fiat] ?? it.price ?? 0;
    it.price = p;
    it.value = p * (it.amount||0);
    if(prices[it.id]?.[`${state.fiat}_24h_change`] !== undefined) it.change24h = prices[it.id][`${state.fiat}_24h_change`];
    if(!it.spark7d || it.spark7d.length===0 || Math.random()<0.1){
      const det = await geckoDetails(it.id);
      if(det){
        it.icon = det.icon || it.icon;
        it.spark7d = det.spark || it.spark7d;
        it.change7d = det.change7d ?? it.change7d;
        it.color = det.color || it.color || seedPastel(it.id);
      }
    }
  }
  save();
  pieWrap.classList.remove('shimmer');
  renderAll();
}

function renderAll(){
  renderTotals();
  renderAssets();
  renderPie();
}

renderAll();
refreshPrices();
setInterval(refreshPrices, Math.max(1,(state.refreshMins||5))*60*1000);
