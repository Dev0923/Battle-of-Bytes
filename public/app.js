// ------- Enquiry form -------
const form = document.getElementById('enquiryForm');
const statusEl = document.getElementById('formStatus');

async function submitEnquiry(e){
  e.preventDefault();
  statusEl.textContent = 'Sending…';
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  try{
    const res = await fetch('/api/enquiry',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(!res.ok) throw new Error((data && (data.errors||data.error))?.toString() || 'Failed');
    statusEl.textContent = data.message || 'Thanks for your enquiry!';
    statusEl.style.color = '#5be9b9';
    form.reset();
  }catch(err){
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = '#ffd166';
  }
}
// Attach AJAX handler only if we can show inline status; otherwise let native POST proceed
if(form && statusEl){ form.addEventListener('submit', submitEnquiry); }

// ------- Auction Simulation -------
const playersEl = document.getElementById('players');
const auctionCountdownEl = document.getElementById('auctionCountdown');
const bidForm = document.getElementById('bidForm');
const bidStatus = document.getElementById('bidStatus');
const playerSelect = document.getElementById('playerId');
// Auctioneer UI
const aiSpeech = document.getElementById('aiSpeech');
const aiWave = document.getElementById('aiWave');
const aiMuteBtn = document.getElementById('aiMute');
const aiGlitch = document.getElementById('aiGlitch');

let auctionState = null;

function renderPlayers(){
  if(!playersEl || !auctionState) return;
  playersEl.innerHTML = '';
  playerSelect.innerHTML = '';
  for(const p of auctionState.players){
    const art = document.createElement('article');
    art.className = 'card player';
    art.innerHTML = `
      <h3>${p.name}</h3>
      <div class="meta">Current bid: <strong>₹${p.currentBid ?? 0}</strong> ${p.lastBidder ? `by ${p.lastBidder}`: ''}</div>
    `;
    playersEl.appendChild(art);
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    playerSelect.appendChild(opt);
  }
}

function renderCountdown(){
  if(!auctionState || !auctionCountdownEl) return;
  const end = new Date(auctionState.endTime).getTime();
  const now = Date.now();
  const diff = end - now;
  if(diff <= 0){ auctionCountdownEl.textContent = 'Auction ended'; return; }
  const d = Math.floor(diff/86400000);
  const h = Math.floor((diff%86400000)/3600000);
  const m = Math.floor((diff%3600000)/60000);
  const s = Math.floor((diff%60000)/1000);
  auctionCountdownEl.textContent = `Time left: ${d}d ${h}h ${m}m ${s}s`;
}

async function fetchAuction(){
  const res = await fetch('/api/auction/state');
  const data = await res.json();
  if(data.ok){ auctionState = data.state; renderPlayers(); renderCountdown(); }
}

function connectAuctionStream(){
  if(!window.EventSource) return; // fallback handled by polling
  const es = new EventSource('/api/auction/stream');
  es.addEventListener('init', (e)=>{
    auctionState = JSON.parse(e.data); renderPlayers(); renderCountdown();
  });
  es.addEventListener('bid', (e)=>{
    const { player } = JSON.parse(e.data);
    if(auctionState){
      const i = auctionState.players.findIndex(p=>p.id===player.id);
      if(i>=0) auctionState.players[i] = player;
      renderPlayers();
    }
    Auctioneer.maybeNarrateBid(player);
  });
}

async function submitBid(e){
  e.preventDefault();
  bidStatus.textContent = 'Placing bid…';
  const fd = new FormData(bidForm);
  const payload = Object.fromEntries(fd.entries());
  payload.amount = Number(payload.amount);
  try{
    const res = await fetch('/api/auction/bid',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed');
    bidStatus.textContent = `Bid placed on ${data.player.name} for ₹${data.player.currentBid}`;
    bidStatus.style.color = '#5be9b9';
    Auctioneer.speak(`Bid placed on ${data.player.name} for rupees ${data.player.currentBid}.`);
  }catch(err){
    bidStatus.textContent = `Error: ${err.message}`;
    bidStatus.style.color = '#ffd166';
  }
}
bidForm?.addEventListener('submit', submitBid);

if(playersEl){
  fetchAuction();
  connectAuctionStream();
  setInterval(renderCountdown, 1000);
}

// ------- Poll Feature -------
const pollForm = document.getElementById('pollForm');
const pollResults = document.getElementById('pollResults');
const voteTicker = document.getElementById('voteTicker');
let TICKER_LINES = [];
let PREV_POLL_COUNTS = null; // { key: count }
let POLL_LABELS = {};
if(pollResults){
  try{
    POLL_LABELS = JSON.parse(pollResults.dataset.labels || '{}');
  }catch{ POLL_LABELS = {}; }
}

function todayKey(name){ return name+':'+new Date().toISOString().slice(0,10); }
function getSelected(){ try{ return localStorage.getItem(todayKey('poll.selected')); }catch{ return null; } }
function setSelected(option){
  try{ localStorage.setItem(todayKey('poll.selected'), option); }catch{}
  if(!pollForm) return;
  const tiles = pollForm.querySelectorAll('.poll-tile');
  tiles.forEach(t =>{
    const on = t.dataset.option === option;
    t.classList.toggle('active', !!on);
    t.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderPoll(results){
  if(!pollResults || !results || !results.options) return;
  const total = Object.values(results.options).reduce((a,b)=>a+b,0) || 1;
  pollResults.innerHTML = '';
  for(const [key,val] of Object.entries(results.options)){
    if(!(key in POLL_LABELS)) continue; // ignore legacy/non-team keys
    const pct = Math.round((val/total)*100);
    const label = POLL_LABELS[key] || key;

    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'pr-line';
    const spanLabel = document.createElement('span'); spanLabel.className = 'pr-label'; spanLabel.textContent = label+': ';
    const spanCount = document.createElement('span'); spanCount.className = 'pr-count'; spanCount.dataset.key = key; spanCount.dataset.value = String(val); spanCount.textContent = String(val);
    const spanPct = document.createElement('span'); spanPct.className = 'pr-pct'; spanPct.textContent = ` (${pct}%)`;
    title.appendChild(spanLabel); title.appendChild(spanCount); title.appendChild(spanPct);

    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('span'); fill.style.width = pct + '%'; bar.appendChild(fill);
    wrap.appendChild(title); wrap.appendChild(bar);
    pollResults.appendChild(wrap);
  }

  // Animate numeric counters with a brief scramble
  scrambleAllCounts();
  // Save prev counts snapshot
  PREV_POLL_COUNTS = Object.fromEntries(Object.entries(results.options));
}

function scrambleAllCounts(){
  if(!pollResults) return;
  const nodes = pollResults.querySelectorAll('.pr-count');
  nodes.forEach(node=> scrambleNumber(node, Number(node.dataset.value||'0')));
}

function scrambleNumber(el, finalVal){
  const DURATION = 650; // ms
  const start = performance.now();
  const prev = Number(el.textContent||'0') || 0;
  function randDigit(){ return String(Math.floor(Math.random()*10)); }
  function step(now){
    const t = Math.min(1, (now - start)/DURATION);
    if(t < 0.8){
      // mostly scramble
      const len = String(Math.max(prev, finalVal)).length;
      el.textContent = Array.from({length:len}, randDigit).join('');
    }else{
      const cur = Math.round(prev + (finalVal - prev) * ((t-0.8)/0.2));
      el.textContent = String(Math.max(0, cur));
    }
    if(t < 1) requestAnimationFrame(step); else el.textContent = String(finalVal);
  }
  requestAnimationFrame(step);
}

function addTickerLine(text){
  if(!voteTicker) return;
  const time = new Date();
  const hh = String(time.getHours()).padStart(2,'0');
  const mm = String(time.getMinutes()).padStart(2,'0');
  const item = `[${hh}:${mm}] ${text}`;
  TICKER_LINES.push(item);
  if(TICKER_LINES.length > 20) TICKER_LINES.shift();
  let line = voteTicker.querySelector('.line');
  if(!line){ line = document.createElement('div'); line.className = 'line'; voteTicker.appendChild(line); }
  line.textContent = TICKER_LINES.join('   •   ');
  // restart CSS animation
  line.style.animation = 'none'; // reset
  // force reflow
  // eslint-disable-next-line no-unused-expressions
  void line.offsetWidth;
  line.style.animation = '';
}

async function fetchPoll(){
  const res = await fetch('/api/poll/results');
  const data = await res.json();
  if(data.ok) renderPoll(data.results);
}

function connectPollStream(){
  if(!window.EventSource) return; 
  const es = new EventSource('/api/poll/stream');
  es.addEventListener('init', e=>{ const d = JSON.parse(e.data); renderPoll(d.results); });
  es.addEventListener('vote', e=>{
    const d = JSON.parse(e.data);
    // infer which option increased to populate ticker
    try{
      if(PREV_POLL_COUNTS){
        for(const [k,v] of Object.entries(d.results.options||{})){
          if(PREV_POLL_COUNTS[k] != null && v > PREV_POLL_COUNTS[k]){
            const label = POLL_LABELS[k] || k; addTickerLine(`New vote: ${label}`);
          }
        }
      }
    }catch{}
    renderPoll(d.results);
  });
}

function setVotedToday(){
  const key = 'voted:'+new Date().toISOString().slice(0,10);
  localStorage.setItem(key,'1');
}
function hasVotedToday(){
  const key = 'voted:'+new Date().toISOString().slice(0,10);
  return !!localStorage.getItem(key);
}

pollForm?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-option]');
  if(!btn) return;
  if(hasVotedToday()) {
    // Briefly pulse the stored selection if trying to re-vote
    const sel = getSelected();
    if(sel){
      const t = [...pollForm.querySelectorAll('.poll-tile')].find(el=> el.dataset.option===sel);
      if(t){ t.classList.add('active'); setTimeout(()=> t.classList.remove('active'), 360); }
    }
    alert('You already voted today.');
    return;
  }
  // Immediate visual activation
  setSelected(btn.dataset.option);
  btn.disabled = true;
  try{
    const res = await fetch('/api/poll/vote',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ option: btn.dataset.option }) });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Failed');
    setVotedToday();
    const label = POLL_LABELS[btn.dataset.option] || btn.dataset.option; addTickerLine(`You voted: ${label}`);
    renderPoll(data.results);
  }catch(err){
    alert('Vote failed: '+err.message);
  }finally{ btn.disabled = false; }
});

if(pollForm){
  // Render server-provided initial snapshot if present (faster contentful paint)
  try{
    const initial = JSON.parse(pollResults?.dataset.initial || 'null');
    if(initial) renderPoll(initial);
  }catch{}
  // Restore selection highlight (if any) for today
  const initSel = getSelected();
  if(initSel){ setSelected(initSel); }
  fetchPoll();
  connectPollStream();
}

// ------- Teams hologram title animation -------
function enhanceTeamTitles(){
  const titles = document.querySelectorAll('.team-title');
  titles.forEach(title => {
    if(title.dataset.enhanced) return;
    const text = title.textContent.trim();
    title.textContent = '';
    [...text].forEach((ch, i) => {
      const span = document.createElement('span');
      span.style.setProperty('--i', i);
      span.textContent = ch;
      title.appendChild(span);
    });
    title.dataset.enhanced = '1';
  });
}

document.addEventListener('DOMContentLoaded', enhanceTeamTitles);

// ------- Teams 3D tilt + reflection -------
function setupTeamTilt(){
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supportsPointer = 'PointerEvent' in window;
  if(reduced) return; // respect user preference
  const cards = document.querySelectorAll('.team-card.holo .team-media');
  const MAX_TILT = 10; // degrees
  const IMG_Z = 12; // px parallax

  cards.forEach(el => {
    let raf = null;
    let cur = {x:0.5, y:0.5, active:false};
    const onMove = (ev)=>{
      const rect = el.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width; // 0..1
      const y = (ev.clientY - rect.top) / rect.height; // 0..1
      cur.x = Math.max(0, Math.min(1, x));
      cur.y = Math.max(0, Math.min(1, y));
      if(!raf) raf = requestAnimationFrame(apply);
    };
    const apply = ()=>{
      raf = null;
      const tiltX = (0.5 - cur.y) * (MAX_TILT*2); // invert Y
      const tiltY = (cur.x - 0.5) * (MAX_TILT*2);
      el.style.setProperty('--tiltX', tiltX.toFixed(2)+'deg');
      el.style.setProperty('--tiltY', tiltY.toFixed(2)+'deg');
      el.style.setProperty('--imgZ', (cur.active? IMG_Z : 0)+'px');
      el.style.setProperty('--glossX', (cur.x*100)+'%');
      el.style.setProperty('--glossY', (cur.y*100)+'%');
      el.style.setProperty('--glossO', cur.active? .35 : 0);
    };
    const onEnter = ()=>{ cur.active = true; if(!raf) raf = requestAnimationFrame(apply); };
    const onLeave = ()=>{
      cur.active = false; cur.x = .5; cur.y = .5; if(!raf) raf = requestAnimationFrame(apply);
    };
    if(supportsPointer){
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerenter', onEnter);
      el.addEventListener('pointerleave', onLeave);
    }else{
      el.addEventListener('mousemove', onMove);
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onLeave);
    }
  });
}

document.addEventListener('DOMContentLoaded', setupTeamTilt);

// ------- Neon cursor trail + click ripples -------
function setupNeonFx(){
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'neonFx';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w=0, h=0, dpr=1;
  function resize(){
    dpr = Math.min(window.devicePixelRatio||1, 2);
    w = canvas.width = Math.floor(innerWidth*dpr);
    h = canvas.height = Math.floor(innerHeight*dpr);
    canvas.style.width = innerWidth+'px';
    canvas.style.height = innerHeight+'px';
    ctx.globalCompositeOperation = 'lighter';
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = [];
  const ripples = [];
  const MAX_P = 160;
  let lastX = w/2, lastY = h/2;
  function spawn(x,y){
    for(let i=0;i<4;i++){
      particles.push({
        x,y,
        vx:(Math.random()-.5)*2,
        vy:(Math.random()-.5)*2,
        life:1,
        hue: Math.random()<.5?180:310
      });
    }
    if(particles.length>MAX_P) particles.splice(0, particles.length-MAX_P);
  }
  function onMove(e){
    const x=(e.clientX)*dpr, y=(e.clientY)*dpr;
    lastX=x; lastY=y; spawn(x,y);
  }
  function onClick(e){
    const x=(e.clientX)*dpr, y=(e.clientY)*dpr;
    ripples.push({x,y,r:0,life:1});
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('click', onClick);

  function step(){
    ctx.clearRect(0,0,w,h);
    // particles
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i];
      p.x+=p.vx; p.y+=p.vy; p.life-=0.018;
      if(p.life<=0){ particles.splice(i,1); continue; }
      const grd = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,18);
      const c1 = `hsla(${p.hue},100%,60%,${0.35*p.life})`;
      const c2 = `hsla(${p.hue},100%,50%,0)`;
      grd.addColorStop(0,c1); grd.addColorStop(1,c2);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x,p.y,18,0,Math.PI*2); ctx.fill();
    }
    // ripples
    for(let i=ripples.length-1;i>=0;i--){
      const r=ripples[i];
      r.r += 8; r.life -= 0.02;
      if(r.life<=0){ ripples.splice(i,1); continue; }
      ctx.strokeStyle = `hsla(190,100%,60%,${0.25*r.life})`;
      ctx.lineWidth = 2*dpr;
      ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,Math.PI*2); ctx.stroke();
    }
    requestAnimationFrame(step);
  }
  step();
}

document.addEventListener('DOMContentLoaded', setupNeonFx);

// ------- Ambience (low synth hum) -------
function setupAmbience(){
  const btn = document.getElementById('ambienceToggle');
  const stopBtn = document.getElementById('ambienceStop');
  if(!btn) return;
  let ctx=null, osc=null, gain=null, filt=null, analyser=null, playing=false;
  let osc2=null;
  let vizCanvas=null, vizCtx=null, vizRAF=null;

  function ensureNodes(){
    if(ctx) return true;
    try{
      ctx = new (window.AudioContext||window.webkitAudioContext)();
      // Primary tone: gentle sawtooth at 110 Hz for audibility on laptop speakers
      osc = ctx.createOscillator(); osc.type='sawtooth'; osc.frequency.value=110;
      // Secondary tone: triangle at 165 Hz for a subtle harmonic shimmer
      osc2 = ctx.createOscillator(); osc2.type='triangle'; osc2.frequency.value=165;
      // Filter: lowpass to keep it soft
      filt = ctx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=320; filt.Q.value=0.7;
      gain = ctx.createGain(); gain.gain.value=0.0;
      analyser = ctx.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.85;
      // subtle slow LFO for life
      const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=0.12;
      const lfoGain = ctx.createGain(); lfoGain.gain.value=8;
      lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
      lfo.start();
      osc.connect(filt); osc2.connect(filt);
      filt.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination);
      osc.start(); osc2.start();
      return true;
    }catch{ return false; }
  }

  function setPlaying(on){
    if(!ctx && !ensureNodes()) return;
    // On some browsers the context starts suspended; resume on gesture-triggered calls
    try{ ctx.resume?.(); }catch{}
    playing = !!on;
    btn.textContent = playing ? 'Pause Ambience' : 'Toggle Ambience';
    const target = playing ? 0.035 : 0.0; // subtle but audible
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.linearRampToValueAtTime(target, now+0.25);
    if(playing) startViz(); else stopViz();
    try{ localStorage.setItem('ambience.enabled', playing ? '1':'0'); }catch{}
  }

  btn.addEventListener('click', ()=> setPlaying(!playing));
  stopBtn?.addEventListener('click', ()=> setPlaying(false));

  // Quick keyboard control (Ctrl+M to toggle, Shift+M or Esc to stop)
  window.addEventListener('keydown', (e)=>{
    if(e.ctrlKey && (e.key==='m' || e.key==='M')){ e.preventDefault(); setPlaying(!playing); }
    if(e.key==='Escape' || (e.shiftKey && (e.key==='m' || e.key==='M'))){ setPlaying(false); }
  });

  // Auto-stop on window blur to be polite
  window.addEventListener('blur', ()=> setPlaying(false));

  // Respect user preference + start on first interaction
  function wantAuto(){
    try{
      const v = localStorage.getItem('ambience.enabled');
      return (v === null) ? true : v === '1';
    }catch{ return true; }
  }
  if(wantAuto()){
    const startOnGesture = ()=>{ try{ ctx?.resume?.(); }catch{} setPlaying(true); window.removeEventListener('pointerdown', startOnGesture); window.removeEventListener('keydown', startOnGesture); };
    window.addEventListener('pointerdown', startOnGesture, { once:true });
    window.addEventListener('keydown', startOnGesture, { once:true });
  }

  // Battery awareness: if on battery and not charging, stop and disable
  if('getBattery' in navigator){
    navigator.getBattery().then(b=>{
      function check(){
        const onBattery = !b.charging;
        const low = b.level <= 0.2;
        if(onBattery && low){ setPlaying(false); btn.disabled = true; stopBtn && (stopBtn.disabled = true); btn.title = 'Disabled on low battery'; }
        else { btn.disabled = false; stopBtn && (stopBtn.disabled = false); btn.title = ''; }
      }
      check();
      b.addEventListener('chargingchange', check);
      b.addEventListener('levelchange', check);
    }).catch(()=>{});
  }

  // Hover SFX (zap/ping)
  function playZap(){
    if(!ensureNodes()) return;
    try{
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type='square'; o.frequency.setValueAtTime(880, ctx.currentTime);
      g.gain.value=0.0; o.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      o.frequency.exponentialRampToValueAtTime(220, now+0.12);
      g.gain.linearRampToValueAtTime(0.06, now+0.005);
      g.gain.linearRampToValueAtTime(0.0, now+0.14);
      o.start(now); o.stop(now+0.16);
    }catch{}
  }
  function playPing(){
    if(!ensureNodes()) return;
    try{
      const o = ctx.createOscillator(); const g = ctx.createGain(); const f = ctx.createBiquadFilter();
      o.type='sine'; o.frequency.value=660; f.type='bandpass'; f.frequency.value=1000; f.Q.value=6; g.gain.value=0.0;
      o.connect(f); f.connect(g); g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.linearRampToValueAtTime(0.05, now+0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now+0.25);
      o.start(now); o.stop(now+0.28);
    }catch{}
  }
  // Attach to buttons (mouseenter)
  document.querySelectorAll('.btn').forEach(b=>{
    b.addEventListener('mouseenter', ()=>{ if(playing) (Math.random()<.5? playZap : playPing)(); });
  });

  // Visualizer
  function ensureViz(){
    if(vizCanvas) return;
    vizCanvas = document.createElement('canvas'); vizCanvas.id='ambienceViz';
    document.body.appendChild(vizCanvas);
    vizCtx = vizCanvas.getContext('2d');
    resizeViz();
    window.addEventListener('resize', resizeViz);
  }
  function resizeViz(){
    if(!vizCanvas) return;
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const cssW = 160, cssH = 64;
    vizCanvas.width = Math.floor(cssW*dpr); vizCanvas.height = Math.floor(cssH*dpr);
    vizCanvas.style.width = cssW+'px'; vizCanvas.style.height = cssH+'px';
    if(vizCtx){ vizCtx.setTransform(dpr,0,0,dpr,0,0); }
  }
  function startViz(){ ensureViz(); if(vizRAF) return; drawViz(); }
  function stopViz(){ if(vizRAF){ cancelAnimationFrame(vizRAF); vizRAF=null; } if(vizCtx){ vizCtx.clearRect(0,0,vizCanvas.width, vizCanvas.height);} }
  function drawViz(){
    if(!vizCtx || !analyser) return;
    const w = vizCanvas.width / (window.devicePixelRatio||1); const h = vizCanvas.height / (window.devicePixelRatio||1);
    vizCtx.clearRect(0,0,w,h);
    // Pulsing circle based on low frequencies + waveform line
    const data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data);
    const low = data.slice(0, 12).reduce((a,b)=>a+b,0)/12/255; // 0..1
    const r = 10 + low*14;
    // Circle
    const cx = 18, cy = h-18;
    const grd = vizCtx.createRadialGradient(cx,cy,1,cx,cy,r);
    grd.addColorStop(0,'rgba(0,240,255,.55)'); grd.addColorStop(1,'rgba(255,43,208,.0)');
    vizCtx.fillStyle = grd; vizCtx.beginPath(); vizCtx.arc(cx,cy,r,0,Math.PI*2); vizCtx.fill();
    // Line
    const tdata = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(tdata);
    vizCtx.beginPath(); vizCtx.moveTo(40, h/2);
    const step = (w-50)/tdata.length; let x = 40;
    for(let i=0;i<tdata.length;i++){ const y = (tdata[i]/255 - 0.5)*26; vizCtx.lineTo(x, h/2 + y); x += step; }
    const lg = vizCtx.createLinearGradient(40,0,w,0); lg.addColorStop(0,'#00f0ff'); lg.addColorStop(1,'#ff2bd0');
    vizCtx.strokeStyle = lg; vizCtx.lineWidth = 2; vizCtx.stroke();
    vizRAF = requestAnimationFrame(drawViz);
  }
}

document.addEventListener('DOMContentLoaded', setupAmbience);

// ------- AI Auctioneer (Speech + Waveform + Glitch) -------
const Auctioneer = (()=>{
  const synth = ('speechSynthesis' in window) ? window.speechSynthesis : null;
  let muted = false;
  let speaking = false;
  let lastNarration = 0;
  let raf = null;
  const ctx = aiWave ? aiWave.getContext('2d') : null;

  function loadMute(){
    try{ muted = localStorage.getItem('ai.muted') === '1'; }catch{}
    if(aiMuteBtn) aiMuteBtn.textContent = muted ? 'Unmute' : 'Mute';
  }
  function saveMute(){ try{ localStorage.setItem('ai.muted', muted ? '1':'0'); }catch{} }

  function drawWave(){
    if(!ctx || !aiWave){ speaking=false; return; }
    const {width:w,height:h} = aiWave;
    ctx.clearRect(0,0,w,h);
    const bars = 36; const t = performance.now()/240;
    for(let i=0;i<bars;i++){
      const x = (i+0.5)*w/bars;
      const amp = (Math.sin(t + i*0.6)*0.5+0.5);
      const hh = 8 + amp* (h*0.7);
      const grd = ctx.createLinearGradient(x, (h-hh)/2, x, (h+hh)/2);
      grd.addColorStop(0, 'rgba(0,240,255,.75)');
      grd.addColorStop(1, 'rgba(255,43,208,.65)');
      ctx.fillStyle = grd;
      ctx.fillRect(x-3,(h-hh)/2,6,hh);
    }
    if(speaking) raf = requestAnimationFrame(drawWave); else ctx.clearRect(0,0,w,h);
  }

  function speak(text){
    if(!aiSpeech) return;
    aiSpeech.textContent = text;
    lastNarration = Date.now();
    if(muted || !synth){
      // Visual-only animation
      speaking = true; drawWave(); setTimeout(()=>{ speaking=false; }, 1600);
      return;
    }
    try{
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1.1; u.volume = 0.9;
      speaking = true; drawWave();
      u.onend = ()=>{ speaking=false; };
      synth.cancel(); synth.speak(u);
    }catch{ speaking=false; }
  }

  function maybeNarrateBid(player){
    // Throttle to avoid chatter from SSE storms
    if(Date.now() - lastNarration < 15000) return; // 15s
    speak(`New bid on ${player.name}. Current bid rupees ${player.currentBid}.`);
  }

  function setup(){
    if(!aiSpeech) return;
    loadMute();
    // Welcome line shortly after load
    setTimeout(()=> speak('Welcome to the Battle of Bytes Auction Arena. Let the bidding commence!'), 400);
    // Glitch occasionally
    if(aiGlitch){
      setInterval(()=>{
        if(Math.random()<0.25){
          aiGlitch.hidden = false;
          speak('Signal lost. Recalibrating. Auction resumed.');
          setTimeout(()=>{ aiGlitch.hidden = true; }, 1800);
        }
      }, 25000);
    }
    // Mute button
    aiMuteBtn?.addEventListener('click', ()=>{
      muted = !muted; saveMute(); if(aiMuteBtn) aiMuteBtn.textContent = muted ? 'Unmute' : 'Mute';
      if(muted && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    });
  }

  return { setup, speak, maybeNarrateBid };
})();

document.addEventListener('DOMContentLoaded', ()=> Auctioneer.setup());

// ------- Arena (interactive story experience) -------
function speakText(line){
  try{
    if(!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(line);
    u.rate = 1.02; u.pitch = 1.05; u.volume = 0.9;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }catch{}
}

function setupArena(){
  const scene = document.getElementById('arenaScene');
  const cam = document.getElementById('arenaCamera');
  const grid = document.getElementById('arenaGrid');
  const intro = document.getElementById('arenaIntro');
  const panel = document.getElementById('arenaPanel');
  const panelName = document.getElementById('panelName');
  const panelTag = document.getElementById('panelTag');
  const panelImg = document.getElementById('panelImg');
  const panelClose = document.getElementById('panelClose');
  const panelBid = document.getElementById('panelBid');
  if(!scene || !cam || !grid) return;

  // Cinematic: Access Granted + voice
  setTimeout(()=>{ if(intro) intro.style.display = 'none'; }, 1700);
  setTimeout(()=>{ speakText('Welcome to the Arena of Algorithms. The auction begins now.'); }, 600);

  // Mouse move parallax glow on tiles
  grid.addEventListener('pointermove', (e)=>{
    const r = grid.getBoundingClientRect();
    const x = (e.clientX - r.left)/r.width*100;
    const y = (e.clientY - r.top)/r.height*100;
    grid.style.setProperty('--mx', x+'%');
    grid.style.setProperty('--my', y+'%');
  });

  function focusTile(btn){
    const name = btn.dataset.name || 'Unknown';
    const tag = btn.dataset.tag || 'Elite coders forging the future.';
    panelName.textContent = name;
    panelTag.textContent = tag;
    if(panelImg){ panelImg.src = btn.dataset.img || ''; panelImg.alt = name + ' emblem'; }
    panel.hidden = false;
    // Camera center on tile + push-in
    try{
      const gr = grid.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const dx = ((br.left + br.width/2) - (gr.left + gr.width/2)) / gr.width; // -0.5..0.5
      const dy = ((br.top + br.height/2) - (gr.top + gr.height/2)) / gr.height;
      const moveX = (-dx * 140).toFixed(2); // px
      const moveY = (-dy * 100).toFixed(2);
      cam.style.transform = `translateX(${moveX}px) translateY(${moveY}px) translateZ(0) rotateX(6deg) scale(1.08)`;
    }catch{
      cam.style.transform = 'translateZ(0) rotateX(6deg) scale(1.08)';
    }
    // Voice line
    speakText(`${name}. Entering zone.`);
  }
  function defocus(){
    panel.hidden = true;
    cam.style.transform = 'translateZ(0) rotateX(12deg) scale(1)';
  }

  grid.querySelectorAll('.holo-tile').forEach((btn)=>{
    btn.addEventListener('click', ()=> focusTile(btn));
  });
  panelClose?.addEventListener('click', defocus);
  panel.addEventListener('click', (e)=>{ if(e.target === panel) defocus(); });

  // Per-tile hologram tilt + depth + pulse
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tiles = Array.from(grid.querySelectorAll('.holo-tile'));
  tiles.forEach((tile, idx)=>{
    // Randomize scan speed/delay for variety
    tile.style.setProperty('--scanDur', (2.6 + Math.random()*1.6).toFixed(2) + 's');
    tile.style.setProperty('--scanDelay', (Math.random()*2.0).toFixed(2) + 's');

    if(reduce) return; // respect reduced motion

    const MAX_TILT = 10; // deg
    const LIFT = 18; // px
    const IMGZ = 42; // px
    let raf = null;
    const st = { x:.5, y:.5, tx:.5, ty:.5, active:false };

    function apply(){
      raf = null;
      // smooth towards target
      st.x += (st.tx - st.x) * 0.15;
      st.y += (st.ty - st.y) * 0.15;
      const tiltX = (0.5 - st.y) * (MAX_TILT*2);
      const tiltY = (st.x - 0.5) * (MAX_TILT*2);
      tile.style.setProperty('--tiltX', tiltX.toFixed(2)+'deg');
      tile.style.setProperty('--tiltY', tiltY.toFixed(2)+'deg');
      tile.style.setProperty('--lift', (st.active? LIFT : 0)+'px');
      tile.style.setProperty('--tx', (st.x*100).toFixed(2)+'%');
      tile.style.setProperty('--ty', (st.y*100).toFixed(2)+'%');
      tile.style.setProperty('--imgZ', (st.active? IMGZ : 30)+'px');
    }
    function onMove(e){
      const r = tile.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      st.tx = Math.max(0, Math.min(1, x));
      st.ty = Math.max(0, Math.min(1, y));
      if(!raf) raf = requestAnimationFrame(apply);
    }
    function onEnter(){ st.active = true; if(!raf) raf = requestAnimationFrame(apply); }
    function onLeave(){ st.active = false; st.tx=.5; st.ty=.5; if(!raf) raf = requestAnimationFrame(apply); }

    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerenter', onEnter);
    tile.addEventListener('pointerleave', onLeave);
  });

  // Ambient pulses: occasionally brighten a random tile
  if(!reduce && tiles.length){
    setInterval(()=>{
      const t = tiles[Math.floor(Math.random()*tiles.length)];
      if(!t) return;
      t.classList.add('pulse');
      setTimeout(()=> t.classList.remove('pulse'), 420);
    }, 3000 + Math.random()*2000);
  }
}

document.addEventListener('DOMContentLoaded', setupArena);

// ------- Home Ambient Background (particles + data rain + bursts) -------
function setupHomeAmbient(){
  const isHome = document.body.classList.contains('page-home');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!isHome || reduce) return;
  // Canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'homeBgFx';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w=0,h=0,dpr=1;
  function resize(){
    dpr = Math.min(window.devicePixelRatio||1, 2);
    w = canvas.width = Math.floor(innerWidth*dpr);
    h = canvas.height = Math.floor(innerHeight*dpr);
    canvas.style.width = innerWidth+'px';
    canvas.style.height = innerHeight+'px';
  }
  resize();
  window.addEventListener('resize', resize);

  // Particles (data packets)
  const dots = [];
  const DOTS_MAX = 120;
  for(let i=0;i<DOTS_MAX;i++){
    dots.push({
      x: Math.random()*w,
      y: Math.random()*h,
      vx: (Math.random()-.5)*0.2,
      vy: (Math.random()-.5)*0.2,
      hue: Math.random()<.5? 185: 305,
      size: 1 + Math.random()*1.5
    });
  }
  let cursor={x:w/2,y:h/2,active:false};
  window.addEventListener('pointermove', (e)=>{
    cursor.x = (e.clientX)*dpr; cursor.y = (e.clientY)*dpr; cursor.active=true;
  });
  window.addEventListener('pointerleave', ()=>{ cursor.active=false; });

  // Data rain (faint neon trails)
  const rain = [];
  const RAIN_MAX = 80;
  function spawnDrop(){
    rain.push({ x: Math.random()*w, y: -20, len: 20+Math.random()*60, spd: 0.6+Math.random()*1.2, alpha: 0.05+Math.random()*0.08 });
    if(rain.length>RAIN_MAX) rain.shift();
  }
  for(let i=0;i<RAIN_MAX;i++) spawnDrop();

  // Energy bursts on .btn hover
  const bursts = [];
  function addBurst(x,y){
    for(let i=0;i<28;i++){
      const ang = Math.random()*Math.PI*2;
      const spd = 0.8 + Math.random()*2.4;
      bursts.push({ x,y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life: 1, hue: Math.random()<.5? 190: 320 });
    }
  }
  document.querySelectorAll('.btn').forEach(btn=>{
    btn.addEventListener('mouseenter', (e)=>{
      const r = btn.getBoundingClientRect();
      const x = (r.left + r.width/2)*dpr;
      const y = (r.top + r.height/2)*dpr;
      addBurst(x,y);
    });
  });
  // Occasional ambient bursts
  setInterval(()=> addBurst(Math.random()*w, Math.random()*h*0.7+ h*0.15), 12000);

  function step(){
    ctx.clearRect(0,0,w,h);
    // Data rain
    for(let i=0;i<rain.length;i++){
      const d = rain[i];
      d.y += d.spd*2; if(d.y - d.len > h) { rain[i] = { x: Math.random()*w, y: -20, len: 20+Math.random()*60, spd: 0.6+Math.random()*1.2, alpha: d.alpha }; continue; }
      const grad = ctx.createLinearGradient(d.x, d.y-d.len, d.x, d.y);
      grad.addColorStop(0, `hsla(185,100%,60%,0)`);
      grad.addColorStop(1, `hsla(185,100%,60%,${d.alpha})`);
      ctx.strokeStyle = grad; ctx.lineWidth = 1*dpr;
      ctx.beginPath(); ctx.moveTo(d.x, d.y-d.len); ctx.lineTo(d.x, d.y); ctx.stroke();
    }

    // Dots (data packets)
    for(const p of dots){
      // gentle attraction to cursor
      if(cursor.active){
        const dx = cursor.x - p.x, dy = cursor.y - p.y;
        const dist2 = dx*dx + dy*dy + 1;
        const f = Math.min(0.12, 60/dist2); // smaller far away
        p.vx += dx * f * 0.0006; p.vy += dy * f * 0.0006;
      }
      // soft noise drift
      p.vx += (Math.random()-.5)*0.02; p.vy += (Math.random()-.5)*0.02;
      // dampen and move
      p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy;
      if(p.x< -10) p.x = w+10; if(p.x> w+10) p.x = -10; if(p.y< -10) p.y = h+10; if(p.y> h+10) p.y = -10;
      const glow = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,12*p.size);
      glow.addColorStop(0, `hsla(${p.hue},100%,60%,.22)`);
      glow.addColorStop(1, `hsla(${p.hue},100%,50%,0)`);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x,p.y,12*p.size,0,Math.PI*2); ctx.fill();
    }

    // Bursts
    for(let i=bursts.length-1;i>=0;i--){
      const b = bursts[i];
      b.x += b.vx; b.y += b.vy; b.life -= 0.02;
      if(b.life<=0){ bursts.splice(i,1); continue; }
      ctx.fillStyle = `hsla(${b.hue},100%,60%,${0.25*b.life})`;
      ctx.beginPath(); ctx.arc(b.x,b.y,2.5*dpr,0,Math.PI*2); ctx.fill();
    }

    requestAnimationFrame(step);
  }
  step();
}

document.addEventListener('DOMContentLoaded', setupHomeAmbient);

// ------- Home Title FX (glitch + chroma split + laser reveal + hum) -------
function setupHomeTitleFX(){
  const isHome = document.body.classList.contains('page-home');
  if(!isHome) return;
  const title = document.querySelector('.holo-title');
  if(!title) return;
  // Trigger reveal on load
  requestAnimationFrame(()=> title.classList.add('reveal'));

  // Optional tiny hum synced to flicker
  let audioOk = false; let ac = null;
  function tryEnableAudio(){
    try{
      ac = ac || new (window.AudioContext||window.webkitAudioContext)();
      ac.resume?.();
      audioOk = true;
    }catch{ audioOk = false; }
  }
  ['pointerdown','keydown'].forEach(evt=> window.addEventListener(evt, tryEnableAudio, { once: true }));

  function playHum(){
    if(!audioOk){ tryEnableAudio(); if(!audioOk) return; }
    try{
      const osc = ac.createOscillator(); const g = ac.createGain();
      osc.type = 'sine'; osc.frequency.value = 220 + Math.random()*40; g.gain.value = 0;
      osc.connect(g); g.connect(ac.destination);
      const now = ac.currentTime;
      g.gain.linearRampToValueAtTime(0.035, now + 0.02);
      g.gain.linearRampToValueAtTime(0.0, now + 0.22);
      osc.start(now); osc.stop(now + 0.25);
    }catch{}
  }

  // Randomized glitch pulses
  function pulse(){
    title.classList.add('glitch');
    playHum();
    setTimeout(()=> title.classList.remove('glitch'), 150);
    const next = 1200 + Math.random()*1800; // faster: 1.2s - 3.0s
    setTimeout(pulse, next);
  }
  setTimeout(pulse, 1200 + Math.random()*1200);
}

document.addEventListener('DOMContentLoaded', setupHomeTitleFX);

// ------- Startup Sequence (Home) -------
function setupStartupSequence(){
  const isHome = document.body.classList.contains('page-home');
  if(!isHome) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // If reduced motion, skip and reveal immediately
  if(reduce){ document.body.classList.add('boot-complete'); return; }

  // Build overlay in DOM
  const overlay = document.createElement('div'); overlay.className = 'startup-overlay'; overlay.id = 'startupOverlay';
  overlay.innerHTML = `
    <div class="startup-inner">
      <div class="startup-lines" id="startupLines"></div>
      <div class="startup-flash"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const linesEl = overlay.querySelector('#startupLines');
  const steps = [
    'Initializing Battle of Bytes interface...',
    'Loading data circuits...',
    'Calibrating holograms...',
    'Access granted ✅'
  ];

  let cancelled = false;
  const failSafe = setTimeout(()=>{ if(!cancelled) finish(true); }, 7000);

  function typeLine(text){
    return new Promise(resolve=>{
      const line = document.createElement('div'); line.className = 'startup-line';
      const span = document.createElement('span');
      const cursor = document.createElement('span'); cursor.className = 'cursor';
      line.appendChild(span); line.appendChild(cursor); linesEl.appendChild(line);
      let i=0; const speed = 24;
      const t = setInterval(()=>{
        span.textContent = text.slice(0, ++i);
        if(i >= text.length){ clearInterval(t); resolve(); }
      }, speed);
    });
  }

  async function run(){
    try{
      for(const s of steps){
        // eslint-disable-next-line no-await-in-loop
        await typeLine(s);
        await new Promise(r=> setTimeout(r, 220));
      }
      powerOn();
    }catch{ finish(true); }
  }

  function powerOn(){
    try{ playStartupHum(); }catch{}
    overlay.classList.add('power-on');
    setTimeout(()=> finish(false), 450);
  }
  function finish(force){
    cancelled = true; clearTimeout(failSafe);
    document.body.classList.add('boot-complete');
    overlay.style.transition = 'opacity .5s ease'; overlay.style.opacity = '0';
    setTimeout(()=> overlay.remove(), 520);
  }

  // Startup hum + flash helper
  function playStartupHum(){
    const AC = (window.AudioContext||window.webkitAudioContext);
    if(!AC) return;
    const ac = new AC();
    const osc = ac.createOscillator(); const gain = ac.createGain();
    const noise = ac.createBufferSource();
    const buf = ac.createBuffer(1, ac.sampleRate*0.2, ac.sampleRate);
    const data = buf.getChannelData(0); for(let i=0;i<data.length;i++){ data[i] = (Math.random()*2-1) * (1 - i/data.length); }
    noise.buffer = buf; noise.loop = false;
    osc.type='sawtooth'; osc.frequency.value = 110; gain.gain.value = 0.0;
    osc.connect(gain); noise.connect(gain); gain.connect(ac.destination);
    const now = ac.currentTime;
    osc.frequency.exponentialRampToValueAtTime(440, now+0.4);
    gain.gain.linearRampToValueAtTime(0.08, now+0.04);
    gain.gain.linearRampToValueAtTime(0.0, now+0.6);
    noise.start(now+0.02); osc.start(now); osc.stop(now+0.62); noise.stop(now+0.24);
  }

  run();
}

// Disable the loading animation and mark the page as ready immediately
document.addEventListener('DOMContentLoaded', ()=>{
  try{ document.body.classList.add('boot-complete'); }catch{}
});

// ------- Mobile Nav Toggle -------
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('navToggle');
  const nav = document.getElementById('siteNav');
  if(!btn || !nav) return;
  function set(open){ nav.classList.toggle('open', open); btn.setAttribute('aria-expanded', open? 'true':'false'); }
  btn.addEventListener('click', ()=> set(!nav.classList.contains('open')));
  // Close on navigation click (for single-page feel)
  nav.addEventListener('click', (e)=>{ if(e.target.tagName==='A') set(false); });
});

// ------- Arena Challenge: Memory / Code Guessing + Energy -------
function setupArenaChallenge(){
  const wrap = document.getElementById('arenaChallenge');
  if(!wrap) return;
  const startBtn = document.getElementById('startRound');
  const input = document.getElementById('codeInput');
  const submit = document.getElementById('codeSubmit');
  const display = document.getElementById('codeDisplay');
  const bar = document.getElementById('energyBar');
  const energyVal = document.getElementById('energyVal');
  const status = document.getElementById('challengeStatus');

  let energy = 50; // start
  let round = 1;
  let current = '';
  let accepting = false;

  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

  function setEnergy(v){
    energy = clamp(v, 0, 100);
    energyVal.textContent = String(energy);
    const pct = energy + '%';
    const fill = bar.querySelector('span');
    if(fill){ fill.style.width = pct; }
    bar.classList.add('pulse'); setTimeout(()=> bar.classList.remove('pulse'), 200);
  }

  function randHex(len){
    const chars = '0123456789ABCDEF';
    let s='';
    for(let i=0;i<len;i++){ s += chars[Math.floor(Math.random()*chars.length)]; }
    return s;
  }

  function revealCode(code){
    display.textContent = code;
    const fx = document.createElement('div'); fx.className='code-reveal'; display.parentElement.appendChild(fx);
    setTimeout(()=> fx.remove(), 900);
    // hide after a moment
    setTimeout(()=>{ display.textContent = '••••'; accepting=true; input.disabled=false; input.value=''; input.focus(); }, 1100);
  }

  function nextRound(){
    accepting = false; input.disabled = true; status.textContent='';
    const len = Math.min(3 + round, 10);
    current = randHex(len);
    revealCode(current);
  }

  function gameOver(msg){
    accepting = false; input.disabled = true; status.style.color='#ffd166'; status.textContent = msg || 'Game over. Energy depleted.';
  }

  function victory(){ accepting=false; input.disabled=true; status.style.color='#5be9b9'; status.textContent='Core fully energized. Victory!'; }

  function submitGuess(){
    if(!accepting) return;
    const guess = (input.value||'').trim().toUpperCase();
    if(!guess) return;
    if(guess === current){
      setEnergy(energy + 10);
      round++;
      status.style.color='#5be9b9'; status.textContent = `Correct! Round ${round} ready.`;
      if(energy >= 100){ victory(); return; }
      setTimeout(nextRound, 600);
    }else{
      setEnergy(energy - 15);
      status.style.color='#ffd166'; status.textContent = `Wrong. Code was ${current}. Try again: Round ${round}.`;
      if(energy <= 0){ gameOver(); return; }
      setTimeout(nextRound, 900);
    }
  }

  startBtn?.addEventListener('click', nextRound);
  submit?.addEventListener('click', submitGuess);
  input?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') submitGuess(); });

  // initialize visuals
  setEnergy(energy);
  display.textContent = '';
}

document.addEventListener('DOMContentLoaded', setupArenaChallenge);

// ------- Logic Rush (Socket.IO client) -------
function setupLogicRush(){
  const root = document.getElementById('logicRush');
  if(!root) return;
  // Ensure socket.io client script is available (served by server)
  const ioGlobal = window.io;
  if(!ioGlobal){
    // inject script then init
    const s = document.createElement('script'); s.src = '/socket.io/socket.io.js'; s.onload = init; document.head.appendChild(s);
  }else{ init(); }

  function init(){
    const socket = window.io();
    const qEl = document.getElementById('lrQuestion');
    const optEl = document.getElementById('lrOptions');
    const fbEl = document.getElementById('lrFeedback');
    const ring = document.getElementById('lrRing');
    const timeEl = document.getElementById('lrTime');
    const boardEl = document.getElementById('lrBoard');
    const startPanel = document.getElementById('lrStartPanel');
    const startBtn = document.getElementById('lrStart');
    const nameInput = document.getElementById('lrName');
    const resultPanel = document.getElementById('lrResult');
    const summary = document.getElementById('lrSummary');
    const restartBtn = document.getElementById('lrRestart');
    let deadline = 0; let raf=null;
    let started = false; let attempts = 0; let correct = 0;

    function renderBoard(board){
      if(!boardEl) return;
      boardEl.innerHTML = '';
      for(const row of (board||[])){
        const li = document.createElement('li');
        li.innerHTML = `<span>${row.name}</span><strong>${row.score} ⚡</strong>`;
        boardEl.appendChild(li);
      }
    }

    function tick(){
      raf = null;
      const now = Date.now();
      const remain = Math.max(0, deadline - now);
      const secs = Math.ceil(remain/1000);
      timeEl.textContent = String(secs);
      const pct = remain / 5000; // 5s window
      ring.style.setProperty('--pct', Math.max(0, Math.min(1, pct))*100);
      if(remain>0) raf = requestAnimationFrame(tick);
    }

    function renderState(state){
      if(state?.current){
        qEl.textContent = state.current.q;
        optEl.innerHTML = '';
        state.current.opts.forEach((t,idx)=>{
          const b = document.createElement('button');
          b.className = 'btn-ghost'; b.textContent = t; b.addEventListener('click', ()=> submit(idx));
          b.disabled = !started; optEl.appendChild(b);
        });
        deadline = state.current.deadline || 0; if(raf) cancelAnimationFrame(raf); tick();
      }else{
        qEl.textContent = 'Waiting for next question…'; optEl.innerHTML = '';
        timeEl.textContent = '0'; ring.style.setProperty('--pct', 0);
      }
      renderBoard(state?.board);
    }

    function submit(idx){
      if(!started) return;
      // disable buttons after click
      optEl.querySelectorAll('button').forEach(b=> b.disabled = true);
      socket.emit('lr:answer', idx);
      attempts++;
      if(attempts >= 5){ // lock until result
        started = false;
        setTimeout(()=> showResult(), 600); // small delay to allow feedback
      }
    }

    socket.on('lr:hello', (_me)=>{});
    socket.on('lr:state', renderState);
    socket.on('lr:leaderboard', (p)=> renderBoard(p.board));
    socket.on('lr:reveal', (p)=>{
      // highlight correct locally
      const idx = Number(p.a);
      const btns = [...optEl.querySelectorAll('button')];
      btns.forEach((b,i)=> b.style.outline = (i===idx)? '2px solid var(--brand)': '');
    });
    socket.on('lr:feedback', (p)=>{
      fbEl.textContent = p.ok? `+50 Energy` : `-20 HP`;
      fbEl.classList.toggle('good', !!p.ok); fbEl.classList.toggle('bad', !p.ok);
      if(p.ok) correct++;
      setTimeout(()=>{ fbEl.textContent=''; fbEl.classList.remove('good','bad'); }, 1000);
    });

    function showResult(){
      summary.textContent = `You scored ${correct}/5.`;
      resultPanel.hidden = false;
      startPanel.style.display = 'none';
      // keep options disabled until restart
      optEl.querySelectorAll('button').forEach(b=> b.disabled = true);
    }

    function resetSession(){
      attempts = 0; correct = 0; started = false;
      resultPanel.hidden = true;
      startPanel.style.display = '';
      if(nameInput) nameInput.focus();
    }

    startBtn?.addEventListener('click', ()=>{
      const nm = (nameInput?.value||'').trim();
      if(nm.length >= 2){ try{ socket.emit('lr:setName', nm); }catch{} }
      started = true; attempts = 0; correct = 0; resultPanel.hidden = true; startPanel.style.display = 'none';
      // enable current buttons if a round is active
      optEl.querySelectorAll('button').forEach(b=> b.disabled = false);
    });
    restartBtn?.addEventListener('click', resetSession);
  }
}

document.addEventListener('DOMContentLoaded', setupLogicRush);

// ------- Home Dynamic Lighting (cursor-driven reflections) -------
function setupHomeLighting(){
  const isHome = document.body.classList.contains('page-home');
  if(!isHome) return;
  const layer = document.querySelector('.lighting-vfx');
  if(!layer) return;
  let raf = null; let target = {x:0.5, y:0.35}; let cur = {x:0.5, y:0.35};
  function onMove(e){
    const root = document.querySelector('.landing') || document.body;
    const r = root.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height;
    target.x = Math.max(0, Math.min(1, x));
    target.y = Math.max(0, Math.min(1, y));
    if(!raf) raf = requestAnimationFrame(apply);
  }
  function apply(){
    raf = null;
    // smooth towards target
    cur.x += (target.x - cur.x) * 0.12; cur.y += (target.y - cur.y) * 0.12;
    const lx = (cur.x*100).toFixed(2)+'%'; const ly = (cur.y*100).toFixed(2)+'%';
    layer.style.setProperty('--lx', lx); layer.style.setProperty('--ly', ly);
  }
  window.addEventListener('pointermove', onMove);
  // initial set
  apply();
}

document.addEventListener('DOMContentLoaded', setupHomeLighting);

// ------- AI Eye (global: subtle tracking + pulse on button clicks) -------
function setupAIEye(){
  const eye = document.getElementById('aiEye');
  if(!eye) return;
  eye.classList.add('idle');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = null; let target={x:.0, y:.0}; let cur={x:0,y:0}; const RANGE=8; // px
  function onMove(e){
    const cx = (e.clientX / window.innerWidth - 0.5) * 2; // -1..1
    const cy = (e.clientY / window.innerHeight - 0.5) * 2;
    target.x = Math.max(-1, Math.min(1, cx));
    target.y = Math.max(-1, Math.min(1, cy));
    if(!raf) raf = requestAnimationFrame(apply);
  }
  function apply(){
    raf = null; if(reduce) return;
    cur.x += (target.x - cur.x) * 0.12; cur.y += (target.y - cur.y) * 0.12;
    eye.style.setProperty('--eyeTx', (cur.x*RANGE).toFixed(2)+'px');
    eye.style.setProperty('--eyeTy', (cur.y*RANGE).toFixed(2)+'px');
  }
  window.addEventListener('pointermove', onMove);

  // Pulse on button click/enter
  function pulse(){
    eye.classList.remove('pulse'); // restart animation
    // force reflow
    // eslint-disable-next-line no-unused-expressions
    void eye.offsetWidth;
    eye.classList.add('pulse');
    setTimeout(()=> eye.classList.remove('pulse'), 340);
  }
  document.addEventListener('click', (e)=>{ if(e.target.closest('.btn')) pulse(); });
  document.addEventListener('keydown', (e)=>{ if((e.key==='Enter'||e.key===' ') && document.activeElement?.classList?.contains('btn')) pulse(); });

  // Initial small nudge
  apply();
}

document.addEventListener('DOMContentLoaded', setupAIEye);

// ------- Home Background Video controls (reduced-motion aware) -------
(function(){
  document.addEventListener('DOMContentLoaded', ()=>{
    const video = document.getElementById('homeBgVideo');
    const layer = video?.closest('.home-video-layer');
    if(!video || !layer) return;
    const mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches:false, addEventListener:()=>{} };
    function applyPref(){
      if(mql.matches){
        try{ video.pause(); }catch{}
        layer.classList.add('hidden');
      }else{
        layer.classList.remove('hidden');
        video.play?.().catch(()=>{});
      }
    }
    if(mql.addEventListener) mql.addEventListener('change', applyPref);
    applyPref();

    // Resume on first interaction (mobile autoplay guard)
    const resume = ()=>{ video.play?.().catch(()=>{}); window.removeEventListener('pointerdown', resume); };
    window.addEventListener('pointerdown', resume, { once:true });

    // Pause when tab hidden, resume when visible (if allowed)
    document.addEventListener('visibilitychange', ()=>{
      if(document.hidden){ try{ video.pause(); }catch{} }
      else if(!mql.matches){ video.play?.().catch(()=>{}); }
    });
  });
})();

// ------- Coordinators hero interactive tilt (optional) -------
document.addEventListener('DOMContentLoaded', ()=>{
  const card = document.querySelector('.coord-card');
  if(!card) return;
  let raf=null; const target={x:0.5,y:0.5}; const cur={x:0.5,y:0.5}; const MAX=3; // degrees
  function apply(){
    raf=null;
    cur.x += (target.x - cur.x) * 0.12; cur.y += (target.y - cur.y) * 0.12;
    const ry = (cur.x - 0.5) * (MAX*2);
    const rx = (0.5 - cur.y) * (MAX*2);
    card.style.transform = `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg)`;
  }
  function onMove(e){
    const r = card.getBoundingClientRect();
    target.x = (e.clientX - r.left)/r.width; target.y = (e.clientY - r.top)/r.height;
    target.x = Math.max(0, Math.min(1, target.x)); target.y = Math.max(0, Math.min(1, target.y));
    if(!raf) raf = requestAnimationFrame(apply);
  }
  function onLeave(){ target.x=.5; target.y=.5; if(!raf) raf = requestAnimationFrame(apply); }
  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerleave', onLeave);
});

// ------- Team Rules Modal (Create your team page) -------
document.addEventListener('DOMContentLoaded', ()=>{
  const overlay = document.getElementById('teamRulesOverlay');
  if(!overlay) return; // not on this page
  const ok = document.getElementById('rulesOkBtn');
  ok?.addEventListener('click', ()=>{
    // Remove the notification overlay when user acknowledges
    overlay.remove();
  });
});

// ------- Team name picker (Create your team page) -------
document.addEventListener('DOMContentLoaded', ()=>{
  const section = document.getElementById('teamNameSection');
  if(!section) return;
  const select = document.getElementById('teamNameSelect');
  const saveBtn = document.getElementById('saveTeamName');
  const status = document.getElementById('teamNameStatus');
  const current = document.getElementById('currentTeamName');
  const currentStrong = current?.querySelector('strong');
  const year4Section = document.getElementById('year4Section');

  function keyName(){ return 'myteam.name.' + (new Date().toISOString().slice(0,10)); }
  function saveSelection(){
    if(!select?.value) { status.textContent = 'Please select a name.'; return; }
    const opt = select.options[select.selectedIndex];
    const payload = { slug: select.value, label: opt?.textContent || select.value };
    try{ localStorage.setItem('myteam.name', JSON.stringify(payload)); localStorage.setItem(keyName(), JSON.stringify(payload)); }catch{}
    if(currentStrong){ currentStrong.textContent = payload.label; current.hidden = false; }
    status.textContent = 'Saved';
    setTimeout(()=> status.textContent = '', 1200);
    // Reveal 4th year section after choosing team name
    if(year4Section) year4Section.hidden = false;
  }
  function restore(){
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem('myteam.name')||'null'); }catch{}
    if(saved && select){
      const opt = [...select.options].find(o=> o.value===saved.slug);
      if(opt){ select.value = saved.slug; if(currentStrong){ currentStrong.textContent = opt.textContent; current.hidden = false; } }
    }
    // If we already have a name, show 4th year section
    if(saved && year4Section) year4Section.hidden = false;
  }

  saveBtn?.addEventListener('click', saveSelection);
  restore();
});

// ------- 4th Year selection + credits -------
document.addEventListener('DOMContentLoaded', ()=>{
  const grid = document.getElementById('year4Grid');
  const remEl = document.getElementById('creditsRemaining');
  const help = document.getElementById('year4Help');
  const nextBtn = document.getElementById('year4Next');
  const START = 4500;
  if(!grid || !remEl) return;

  function recalc(){
    const cards = [...grid.querySelectorAll('.yt-card.selected')];
    let spend = 0;
    let validBids = true;
    cards.forEach(card => {
      const input = card.querySelector('.price-input');
      const v = Number(input?.value || 0);
      if(!(Number.isFinite(v) && v > 0)) validBids = false;
      if(Number.isFinite(v)) spend += v;
    });
    const remaining = Math.max(0, START - spend);
    remEl.textContent = String(START - spend);
    // Validation messaging
    if(cards.length !== 2){ help.textContent = 'Choose exactly 2 cards and enter their bids.'; help.style.color = ''; }
    else if(!validBids){ help.textContent = 'Enter a positive bid (creds) for each selected member.'; help.style.color = '#ffd166'; }
    else if(START - spend < 0){ help.textContent = 'Over budget. Reduce bids to stay within 4500 creds.'; help.style.color = '#ffd166'; }
    else { help.textContent = 'Looks good. You can proceed.'; help.style.color = '#5be9b9'; }

    const canProceed = cards.length === 2 && validBids && (START - spend >= 0);
    if(nextBtn) nextBtn.disabled = !canProceed;
    try{ updateCreateTeamVisibility(); }catch{}
  }

  function toggleCard(card){
    const selected = grid.querySelectorAll('.yt-card.selected').length;
    if(card.classList.contains('selected')){
      card.classList.remove('selected');
      const input = card.querySelector('.price-input'); if(input){ input.value=''; }
      recalc();
      return;
    }
    if(selected >= 2){
      help.textContent = 'You can only select 2 cards.'; help.style.color = '#ffd166';
      return;
    }
    card.classList.add('selected');
    const input = card.querySelector('.price-input'); const label = card.querySelector('.price-label');
    if(label) label.hidden = false;
    if(input){ input.focus(); }
    recalc();
  }

  grid.addEventListener('click', (e)=>{
    const btn = e.target.closest('.select-btn');
    const card = e.target.closest('.yt-card');
    if(btn && card){ toggleCard(card); }
  });
  grid.addEventListener('input', (e)=>{
    if(e.target.classList?.contains('price-input')) recalc();
  });

  nextBtn?.addEventListener('click', ()=>{
    // Persist 4th year selection locally
    const picks = [...grid.querySelectorAll('.yt-card.selected')].map(card=>{
      const id = card.getAttribute('data-id');
      const input = card.querySelector('.price-input');
      const bid = Number(input?.value || 0);
      const img = card.querySelector('img')?.getAttribute('src');
      return { id, img, bid };
    });
    const spend = picks.reduce((a,p)=> a + (Number.isFinite(p.bid)? p.bid:0), 0);
    const remaining = START - spend;
    try{ localStorage.setItem('myteam.year4', JSON.stringify({ picks, spend, remaining })); }catch{}
    help.textContent = '4th year saved. You can proceed to the next step.'; help.style.color = '#5be9b9';
    // Reveal 3rd-year section
    const sec3 = document.getElementById('year3Section');
    const start3 = document.getElementById('startingCredits3');
    const rem3 = document.getElementById('creditsRemaining3');
    if(sec3){
      sec3.hidden = false;
      if(start3) start3.textContent = String(remaining);
      if(rem3) rem3.textContent = String(remaining);
      sec3.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  });

  recalc();
});

// ------- 3rd Year selection + credits -------
document.addEventListener('DOMContentLoaded', ()=>{
  const sec = document.getElementById('year3Section');
  const grid = document.getElementById('year3Grid');
  const remEl = document.getElementById('creditsRemaining3');
  const startEl = document.getElementById('startingCredits3');
  const help = document.getElementById('year3Help');
  const nextBtn = document.getElementById('year3Next');
  if(!grid || !remEl) return;
  // START for year3 is what's left after year4, else 4500
  let START = 4500;
  try{
    const y4 = JSON.parse(localStorage.getItem('myteam.year4')||'null');
    if(y4 && typeof y4.remaining === 'number') START = y4.remaining;
  }catch{}
  if(startEl) startEl.textContent = String(START);
  if(sec && localStorage.getItem('myteam.year4')) sec.hidden = false;

  function recalc(){
    const cards = [...grid.querySelectorAll('.yt-card.selected')];
    let spend = 0; let validBids = true;
    cards.forEach(card => {
      const input = card.querySelector('.price-input');
      const v = Number(input?.value || 0);
      if(!(Number.isFinite(v) && v > 0)) validBids = false;
      if(Number.isFinite(v)) spend += v;
    });
    const remaining = Math.max(0, START - spend);
    remEl.textContent = String(START - spend);
    if(cards.length !== 2){ help.textContent = 'Choose exactly 2 cards and enter their bids.'; help.style.color = ''; }
    else if(!validBids){ help.textContent = 'Enter a positive bid (creds) for each selected member.'; help.style.color = '#ffd166'; }
    else if(START - spend < 0){ help.textContent = 'Over budget. Reduce bids to stay within your remaining creds.'; help.style.color = '#ffd166'; }
    else { help.textContent = 'Looks good. You can proceed.'; help.style.color = '#5be9b9'; }
    const canProceed = cards.length === 2 && validBids && (START - spend >= 0);
    if(nextBtn) nextBtn.disabled = !canProceed;
    try{ updateCreateTeamVisibility(); }catch{}
  }

  function toggleCard(card){
    const selected = grid.querySelectorAll('.yt-card.selected').length;
    if(card.classList.contains('selected')){
      card.classList.remove('selected');
      const input = card.querySelector('.price-input'); if(input){ input.value=''; }
      recalc(); return;
    }
    if(selected >= 2){ help.textContent = 'You can only select 2 cards.'; help.style.color = '#ffd166'; return; }
    card.classList.add('selected');
    const input = card.querySelector('.price-input'); const label = card.querySelector('.price-label');
    if(label) label.hidden = false; if(input){ input.focus(); }
    recalc();
  }

  grid.addEventListener('click', (e)=>{
    const btn = e.target.closest('.select-btn');
    const card = e.target.closest('.yt-card');
    if(btn && card){ toggleCard(card); }
  });
  grid.addEventListener('input', (e)=>{
    if(e.target.classList?.contains('price-input')) recalc();
  });

  nextBtn?.addEventListener('click', ()=>{
    const picks = [...grid.querySelectorAll('.yt-card.selected')].map(card=>{
      const id = card.getAttribute('data-id');
      const input = card.querySelector('.price-input');
      const bid = Number(input?.value || 0);
      const img = card.querySelector('img')?.getAttribute('src');
      return { id, img, bid };
    });
    const spend = picks.reduce((a,p)=> a + (Number.isFinite(p.bid)? p.bid:0), 0);
    const remaining = START - spend;
    try{ localStorage.setItem('myteam.year3', JSON.stringify({ picks, spend, remaining })); }catch{}
    help.textContent = '3rd year saved. You can proceed to the next step.'; help.style.color = '#5be9b9';
    // Reveal 2nd year
    const sec2 = document.getElementById('year2Section');
    const start2 = document.getElementById('startingCredits2');
    const rem2 = document.getElementById('creditsRemaining2');
    if(sec2){
      sec2.hidden = false;
      if(start2) start2.textContent = String(remaining);
      if(rem2) rem2.textContent = String(remaining);
      sec2.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  });

  recalc();
});

// ------- 2nd Year selection + credits -------
document.addEventListener('DOMContentLoaded', ()=>{
  const sec = document.getElementById('year2Section');
  const grid = document.getElementById('year2Grid');
  const remEl = document.getElementById('creditsRemaining2');
  const startEl = document.getElementById('startingCredits2');
  const help = document.getElementById('year2Help');
  const nextBtn = document.getElementById('year2Next');
  if(!grid || !remEl) return;
  let START = 4500;
  try{
    const y3 = JSON.parse(localStorage.getItem('myteam.year3')||'null');
    if(y3 && typeof y3.remaining === 'number') START = y3.remaining;
  }catch{}
  if(startEl) startEl.textContent = String(START);
  if(sec && localStorage.getItem('myteam.year3')) sec.hidden = false;

  function recalc(){
    const cards = [...grid.querySelectorAll('.yt-card.selected')];
    let spend = 0; let validBids = true;
    cards.forEach(card => {
      const input = card.querySelector('.price-input');
      const v = Number(input?.value || 0);
      if(!(Number.isFinite(v) && v > 0)) validBids = false;
      if(Number.isFinite(v)) spend += v;
    });
    const remaining = Math.max(0, START - spend);
    remEl.textContent = String(START - spend);
    if(cards.length !== 2){ help.textContent = 'Choose exactly 2 cards and enter their bids.'; help.style.color = ''; }
    else if(!validBids){ help.textContent = 'Enter a positive bid (creds) for each selected member.'; help.style.color = '#ffd166'; }
    else if(START - spend < 0){ help.textContent = 'Over budget. Reduce bids to stay within your remaining creds.'; help.style.color = '#ffd166'; }
    else { help.textContent = 'Looks good. You can proceed.'; help.style.color = '#5be9b9'; }
    const canProceed = cards.length === 2 && validBids && (START - spend >= 0);
    if(nextBtn) nextBtn.disabled = !canProceed;
    try{ updateCreateTeamVisibility(); }catch{}
  }

  function toggleCard(card){
    const selected = grid.querySelectorAll('.yt-card.selected').length;
    if(card.classList.contains('selected')){
      card.classList.remove('selected');
      const input = card.querySelector('.price-input'); if(input){ input.value=''; }
      recalc(); return;
    }
    if(selected >= 2){ help.textContent = 'You can only select 2 cards.'; help.style.color = '#ffd166'; return; }
    card.classList.add('selected');
    const input = card.querySelector('.price-input'); const label = card.querySelector('.price-label');
    if(label) label.hidden = false; if(input){ input.focus(); }
    recalc();
  }

  grid.addEventListener('click', (e)=>{
    const btn = e.target.closest('.select-btn');
    const card = e.target.closest('.yt-card');
    if(btn && card){ toggleCard(card); }
  });
  grid.addEventListener('input', (e)=>{
    if(e.target.classList?.contains('price-input')) recalc();
  });

  nextBtn?.addEventListener('click', ()=>{
    const picks = [...grid.querySelectorAll('.yt-card.selected')].map(card=>{
      const id = card.getAttribute('data-id');
      const input = card.querySelector('.price-input');
      const bid = Number(input?.value || 0);
      const img = card.querySelector('img')?.getAttribute('src');
      return { id, img, bid };
    });
    const spend = picks.reduce((a,p)=> a + (Number.isFinite(p.bid)? p.bid:0), 0);
    const remaining = START - spend;
    try{ localStorage.setItem('myteam.year2', JSON.stringify({ picks, spend, remaining })); }catch{}
    help.textContent = '2nd year saved. Team selection complete for these tiers.'; help.style.color = '#5be9b9';
  });

  recalc();
});

// ------- Final: Create Team visibility + submit -------
function getSelectionInfo(gridId){
  const grid = document.getElementById(gridId);
  if(!grid) return { count:0, spend:0, valid:false };
  const sel = [...grid.querySelectorAll('.yt-card.selected')];
  let spend = 0, validBids = true;
  sel.forEach(card=>{
    const v = Number(card.querySelector('.price-input')?.value || 0);
    if(!(Number.isFinite(v) && v > 0)) validBids = false;
    if(Number.isFinite(v)) spend += v;
  });
  return { count: sel.length, spend, valid: (sel.length===2 && validBids) };
}

function updateCreateTeamVisibility(){
  const actions = document.getElementById('createTeamSection');
  if(!actions) return;
  const y4 = getSelectionInfo('year4Grid');
  const y3 = getSelectionInfo('year3Grid');
  const y2 = getSelectionInfo('year2Grid');
  const totalSpend = y4.spend + y3.spend + y2.spend;
  const withinBudget = (4500 - totalSpend) >= 0;
  const ready = y4.valid && y3.valid && y2.valid && withinBudget;
  actions.hidden = !ready;
}

document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('createTeamBtn');
  const status = document.getElementById('createTeamStatus');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    function collect(gridId, year){
      const grid = document.getElementById(gridId);
      if(!grid) return [];
      return [...grid.querySelectorAll('.yt-card.selected')].map(card=>{
        const id = card.getAttribute('data-id');
        const img = card.querySelector('img')?.getAttribute('src');
        const bid = Number(card.querySelector('.price-input')?.value || 0);
        return { id, img, bid, year };
      });
    }
    const picks4 = collect('year4Grid','4th');
    const picks3 = collect('year3Grid','3rd');
    const picks2 = collect('year2Grid','2nd');
    const all = [...picks4, ...picks3, ...picks2];
    const spend = all.reduce((a,p)=> a + (Number.isFinite(p.bid)? p.bid:0), 0);
    const remaining = 4500 - spend;
    let teamName = null;
    try{ teamName = JSON.parse(localStorage.getItem('myteam.name')||'null')?.label || null; }catch{}
    const final = { teamName, picks:{ y4:picks4, y3:picks3, y2:picks2 }, spend, remaining, createdAt: new Date().toISOString() };
    try{ localStorage.setItem('myteam.final', JSON.stringify(final)); }catch{}
    if(status){ status.textContent = 'Team created! Total spend: '+spend+' • Remaining: '+Math.max(0,remaining); status.style.color = '#5be9b9'; }
    // Build and show preview overlay
    const overlay = document.getElementById('teamPreview');
    const title = document.getElementById('tpTitle');
    const meta = document.getElementById('tpMeta');
    const grid = document.getElementById('tpGrid');
    if(overlay && title && meta && grid){
      title.textContent = 'Team: ' + (teamName || 'Unnamed Team');
      meta.textContent = 'Total spend: ' + spend + ' • Remaining: ' + Math.max(0,remaining);
      grid.innerHTML = '';
      function addCards(arr, label){
        arr.forEach(p=>{
          const card = document.createElement('div'); card.className = 'team-preview-card';
          card.innerHTML = `
            <figure><img src="${p.img}" alt="${label} member"/></figure>
            <div class="tp-cap"><span>${label}</span><span>Bid: ${p.bid}</span></div>
          `;
          grid.appendChild(card);
        });
      }
      addCards(picks4, '4th Year'); addCards(picks3, '3rd Year'); addCards(picks2, '2nd Year');
      overlay.hidden = false; requestAnimationFrame(()=> overlay.classList.add('visible'));
      const closeBtn = document.getElementById('tpClose');
      const onClose = ()=>{ overlay.classList.remove('visible'); setTimeout(()=> overlay.hidden = true, 180); };
      closeBtn?.addEventListener('click', onClose, { once:true });
      overlay.addEventListener('click', (e)=>{ if(e.target === overlay) onClose(); }, { once:true });
    }
  });
});
