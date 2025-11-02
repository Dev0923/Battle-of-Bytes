import express from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BASE_PORT = Number(process.env.PORT) || 3000;

// Security & basics
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limit for API
const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30 });
app.use('/api/', limiter);

// Static files (disable automatic index.html so EJS home renders at "/")
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Views (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Ensure data directory/file exist
const dataDir = path.join(__dirname, 'data');
const enquiriesFile = path.join(dataDir, 'enquiries.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(enquiriesFile)) fs.writeFileSync(enquiriesFile, '[]', 'utf8');

// Auction & Poll data files
const auctionFile = path.join(dataDir, 'auction.json');
const pollFile = path.join(dataDir, 'poll.json');
if (!fs.existsSync(auctionFile)) {
  const now = Date.now();
  const AUCTION_DURATION_MS = 72 * 60 * 60 * 1000; // 72 hours
  const initialAuction = {
    startTime: new Date(now).toISOString(),
    endTime: new Date(now + AUCTION_DURATION_MS).toISOString(),
    players: [
      { id: 'p1', name: 'Player Alpha', currentBid: 0, lastBidder: null, lastUpdated: null },
      { id: 'p2', name: 'Player Beta', currentBid: 0, lastBidder: null, lastUpdated: null },
      { id: 'p3', name: 'Player Gamma', currentBid: 0, lastBidder: null, lastUpdated: null }
    ]
  };
  fs.writeFileSync(auctionFile, JSON.stringify(initialAuction, null, 2));
}
if (!fs.existsSync(pollFile)) {
  const today = new Date().toISOString().slice(0, 10);
  const initialPoll = {
    days: {
      [today]: { options: { TeamA: 0, TeamB: 0, TeamC: 0 }, lastUpdated: new Date().toISOString() }
    }
  };
  fs.writeFileSync(pollFile, JSON.stringify(initialPoll, null, 2));
}

// Simple healthcheck
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Enquiry endpoint
app.post('/api/enquiry', (req, res) => {
  const { name, email, message } = req.body || {};

  // Basic validation
  const errors = [];
  if (!name || String(name).trim().length < 2) errors.push('Name is required.');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRe.test(String(email))) errors.push('Valid email is required.');
  if (!message || String(message).trim().length < 5) errors.push('Message must be at least 5 characters.');

  if (errors.length) return res.status(400).json({ ok: false, errors });

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message).trim(),
    createdAt: new Date().toISOString(),
    ip: req.ip
  };

  try {
    const raw = fs.readFileSync(enquiriesFile, 'utf8');
    const list = JSON.parse(raw);
    list.push(entry);
    fs.writeFileSync(enquiriesFile, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('Failed to persist enquiry', err);
    return res.status(500).json({ ok: false, error: 'Failed to save enquiry' });
  }

  res.json({ ok: true, message: 'Thanks for your enquiry! We\'ll get back to you shortly.' });
});

// Enquiry (form POST that redirects)
app.post('/enquiry', (req, res) => {
  // Reuse API logic by simulating a call
  const { name, email, message } = req.body || {};
  const errors = [];
  if (!name || String(name).trim().length < 2) errors.push('Name is required.');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRe.test(String(email))) errors.push('Valid email is required.');
  if (!message || String(message).trim().length < 5) errors.push('Message must be at least 5 characters.');
  if (errors.length) return res.redirect('/enquiry?error=' + encodeURIComponent(errors.join(' ')));

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message).trim(),
    createdAt: new Date().toISOString(),
    ip: req.ip
  };
  try {
    const raw = fs.readFileSync(enquiriesFile, 'utf8');
    const list = JSON.parse(raw);
    list.push(entry);
    fs.writeFileSync(enquiriesFile, JSON.stringify(list, null, 2));
  } catch {
    return res.redirect('/enquiry?error=' + encodeURIComponent('Failed to save enquiry'));
  }
  return res.redirect('/?success=' + encodeURIComponent("Thanks for your enquiry!"));
});

// ------------ Auction Simulation -------------
const AUCTION_MIN_INCREMENT = 1;
// Lazy in-memory subscribers for SSE
const auctionClients = new Set();

function readAuction() {
  const raw = fs.readFileSync(auctionFile, 'utf8');
  const state = JSON.parse(raw);
  // If auction elapsed, keep state as-is; caller may show ended flag
  return state;
}
function writeAuction(state) {
  fs.writeFileSync(auctionFile, JSON.stringify(state, null, 2));
}
function broadcastAuction(event, payload) {
  const data = `event: ${event}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of auctionClients) {
    try { res.write(data); } catch { /* ignore broken pipes */ }
  }
}

app.get('/api/auction/state', (_req, res) => {
  const state = readAuction();
  res.json({ ok: true, state });
});

app.get('/api/auction/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  auctionClients.add(res);
  // Send initial state
  res.write(`event: init\n` + `data: ${JSON.stringify(readAuction())}\n\n`);
  req.on('close', () => auctionClients.delete(res));
});

app.post('/api/auction/bid', (req, res) => {
  const { playerId, bidderName, amount } = req.body || {};
  const amt = Number(amount);
  if (!playerId || !bidderName || !Number.isFinite(amt)) {
    return res.status(400).json({ ok: false, error: 'playerId, bidderName, amount required' });
  }
  const state = readAuction();
  const now = Date.now();
  const end = Date.parse(state.endTime);
  if (now > end) return res.status(400).json({ ok: false, error: 'Auction ended' });
  const player = state.players.find(p => p.id === playerId);
  if (!player) return res.status(404).json({ ok: false, error: 'Player not found' });
  const minAcceptable = (player.currentBid || 0) + AUCTION_MIN_INCREMENT;
  if (amt < minAcceptable) {
    return res.status(400).json({ ok: false, error: `Bid must be at least ${minAcceptable}` });
  }
  player.currentBid = Math.round(amt * 100) / 100;
  player.lastBidder = String(bidderName).trim();
  player.lastUpdated = new Date().toISOString();
  writeAuction(state);
  broadcastAuction('bid', { player });
  res.json({ ok: true, player });
});

// Form POST for bid and redirect home
app.post('/auction/bid', (req, res) => {
  const { playerId, bidderName, amount } = req.body || {};
  const amt = Number(amount);
  if (!playerId || !bidderName || !Number.isFinite(amt)) {
    return res.redirect('/auction?error=' + encodeURIComponent('All fields are required.'));
  }
  const state = readAuction();
  const now = Date.now();
  const end = Date.parse(state.endTime);
  if (now > end) return res.redirect('/auction?error=' + encodeURIComponent('Auction ended'));
  const player = state.players.find(p => p.id === playerId);
  if (!player) return res.redirect('/auction?error=' + encodeURIComponent('Player not found'));
  const minAcceptable = (player.currentBid || 0) + AUCTION_MIN_INCREMENT;
  if (amt < minAcceptable) {
    return res.redirect('/auction?error=' + encodeURIComponent(`Bid must be at least ${minAcceptable}`));
  }
  player.currentBid = Math.round(amt * 100) / 100;
  player.lastBidder = String(bidderName).trim();
  player.lastUpdated = new Date().toISOString();
  writeAuction(state);
  broadcastAuction('bid', { player });
  return res.redirect('/?success=' + encodeURIComponent(`Bid placed on ${player.name} for ₹${player.currentBid}`));
});

// ------------ Poll Feature (daily reset by design) -------------
const pollClients = new Set();
function todayKey() { return new Date().toISOString().slice(0, 10); }
function pollTemplateOptions(){
  // Use team slugs as keys so we can map to display names on the client
  return Object.fromEntries(TEAMS.map(t => [t.slug, 0]));
}
function normalizePollDay(p){
  const day = todayKey();
  if (!p.days) p.days = {};
  if (!p.days[day]) {
    p.days[day] = { options: pollTemplateOptions(), lastUpdated: new Date().toISOString() };
    return day;
  }
  const allowed = new Set(TEAMS.map(t => t.slug));
  const opts = p.days[day].options || {};
  // remove legacy/non-team keys
  for (const k of Object.keys(opts)) {
    if (!allowed.has(k)) delete opts[k];
  }
  // add any missing teams
  for (const t of TEAMS) {
    if (!(t.slug in opts)) opts[t.slug] = 0;
  }
  p.days[day].options = opts;
  p.days[day].lastUpdated = p.days[day].lastUpdated || new Date().toISOString();
  return day;
}
function readPoll() {
  const raw = fs.readFileSync(pollFile, 'utf8');
  return JSON.parse(raw);
}
function writePoll(p) { fs.writeFileSync(pollFile, JSON.stringify(p, null, 2)); }

app.get('/api/poll/results', (_req, res) => {
  const p = readPoll();
  const day = normalizePollDay(p);
  writePoll(p);
  res.json({ ok: true, day, results: p.days[day] });
});

app.get('/api/poll/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  pollClients.add(res);
  const p = readPoll();
  const day = normalizePollDay(p);
  writePoll(p);
  res.write(`event: init\n` + `data: ${JSON.stringify({ day, results: p.days[day] })}\n\n`);
  req.on('close', () => pollClients.delete(res));
});

app.post('/api/poll/vote', (req, res) => {
  const { option } = req.body || {};
  const p = readPoll();
  const day = normalizePollDay(p);
  if (!(option in p.days[day].options)) return res.status(400).json({ ok: false, error: 'Invalid option' });
  p.days[day].options[option]++;
  p.days[day].lastUpdated = new Date().toISOString();
  writePoll(p);
  const payload = { day, results: p.days[day] };
  const data = `event: vote\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const resClient of pollClients) {
    try { resClient.write(data); } catch { }
  }
  res.json({ ok: true, ...payload });
});

// Form POST for poll vote and redirect
app.post('/poll/vote', (req, res) => {
  const { option } = req.body || {};
  const p = readPoll();
  const day = normalizePollDay(p);
  if (!(option in p.days[day].options)) return res.redirect('/poll?error=' + encodeURIComponent('Invalid option'));
  p.days[day].options[option]++;
  p.days[day].lastUpdated = new Date().toISOString();
  writePoll(p);
  // broadcast
  const payload = { day, results: p.days[day] };
  const data = `event: vote\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const resClient of pollClients) { try { resClient.write(data); } catch {} }
  return res.redirect('/?success=' + encodeURIComponent('Thanks for voting!'));
});

// --------- Teams Page Data ---------
const TEAMS = [
  { slug: 'logic-luminaries',   name: 'Logic Luminaries',  initials: 'LL', coordinators: 'Mr. Vishambhar Pathak & Mr. Shubhash',              tagline: 'Enlightening the Path of Innovation' },
  { slug: 'code-commanders',    name: 'Code Commanders',   initials: 'CC', coordinators: 'Mr. Puneet Sharma & Mr. Deepak Chaturvedi',         tagline: 'Silent, Swift, and Supreme' },
  { slug: 'data-mavericks',     name: 'Data Mavericks',    initials: 'DM', coordinators: 'Mr. B. Pathak',                                    tagline: 'Defying Limits, Defining Data' },
  { slug: 'code-trail',         name: 'Code Trail',        initials: 'CT', coordinators: 'Dr. Gurminder Singh',                               tagline: 'Leading the Way in Innovation' },
  { slug: 'quantum-coders',     name: 'Quantum Coders',    initials: 'QC', coordinators: 'Mr. Pankaj Sharma',                                  tagline: 'Breaking Limits, Building Futures' },
  { slug: 'python-pioneers',    name: 'Python Pioneers',   initials: 'PP', coordinators: 'Dr. Seema Gaur & Dr. Archana Bhatnagar',            tagline: 'Innovate, Automate, Dominate' },
  { slug: 'java-jesters',       name: 'Java Jesters',      initials: 'JJ', coordinators: 'Mr. Santosh Sharma',                                 tagline: 'Powerful Code, Limitless Impact' },
  { slug: 'ruby-renegades',     name: 'Ruby Renegades',    initials: 'RR', coordinators: 'Mr. Abhishek & Mr. Santosh Kumar Agarwal',          tagline: 'Rewriting the Rules of Code' },
  { slug: 'syntax-samurai',     name: 'Syntax Samurai',    initials: 'SS', coordinators: 'Dr. Vivek Gaur & Mr. Madan Mohan Agarwal',          tagline: 'Precision in Every Command' },
  { slug: 'byte-busters',       name: 'Byte Busters',      initials: 'BB', coordinators: 'Dr. Anju Sharma',                                    tagline: 'Smashing Errors, Delivering Perfection' }
];

app.get('/teams', (_req, res) => {
  res.render('teams', { teams: TEAMS });
});

// Team detail pages: render per-team EJS files if present
app.get('/teams/:slug', (req, res) => {
  const slug = req.params.slug;
  const viewPath = path.join(app.get('views'), 'teams', `${slug}.ejs`);
  if (fs.existsSync(viewPath)) {
    return res.render(`teams/${slug}`);
  }
  return res.status(404).send('Team not found');
});

// Ensure auction players reflect team list (ids = team slugs)
function syncAuctionPlayersToTeams() {
  try {
    const raw = fs.readFileSync(auctionFile, 'utf8');
    const state = JSON.parse(raw);
    const wantIds = new Set(TEAMS.map(t => t.slug));
    const haveIds = new Set((state.players || []).map(p => p.id));
    const needsSync = (state.players || []).length !== TEAMS.length || [...wantIds].some(id => !haveIds.has(id));
    if (needsSync) {
      state.players = TEAMS.map(t => {
        const existing = (state.players || []).find(p => p.id === t.slug || p.name === t.name);
        return {
          id: t.slug,
          name: t.name,
          currentBid: existing?.currentBid || 0,
          lastBidder: existing?.lastBidder || null,
          lastUpdated: existing?.lastUpdated || null
        };
      });
      if (!state.startTime || !state.endTime) {
        const now = Date.now();
        const AUCTION_DURATION_MS = 72 * 60 * 60 * 1000;
        state.startTime = new Date(now).toISOString();
        state.endTime = new Date(now + AUCTION_DURATION_MS).toISOString();
      }
      writeAuction(state);
    }
  } catch { /* ignore */ }
}

// Perform one-time sync on server start
syncAuctionPlayersToTeams();

// -------- Coordinators Page Data ---------
const COORDINATORS = {
  faculty: [
    { name: 'Dr. Piyush Gupta', img: '/images/piyushsir.jpg' },
    { name: 'Mr. Santosh Kumar Sharma', img: '/images/santoshsir.jpg' }
  ],
  senior: [
    { name: 'Harpreet Singh', phone: '8384900013' },
    { name: 'Sanchi Malhotra', phone: '7300016373' }
  ],
  students: [
    { name: 'Ashank Agrawal', phone: '8209789396' },
    { name: 'Hiya Arya', phone: '9664006534' },
    { name: 'Manalika Agarwal', phone: '9875101571' },
    { name: 'Sarthak Sinha', phone: '6376353389' },
    { name: 'Somya Upadhyay', phone: '9358164038' }
  ]
};

app.get('/coordinators', (_req, res) => {
  res.render('coordinators', { coordinators: COORDINATORS });
});

// -------- Pages (EJS) ---------
app.get('/', (req, res) => {
  res.render('home', { query: req.query });
});
app.get('/auction', (_req, res) => {
  const state = readAuction();
  // Load 4th-year candidate images from public/images/your team/4th year
  const year4Dir = path.join(__dirname, 'public', 'images', 'your team', '4th year');
  let year4 = [];
  try{
    if (fs.existsSync(year4Dir)){
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const files = fs.readdirSync(year4Dir).filter(f => allowed.has(path.extname(f).toLowerCase()));
      // Encode spaces in URL path segments (folder names and filenames)
      const base = '/images/' + encodeURIComponent('your team') + '/' + encodeURIComponent('4th year') + '/';
      year4 = files.map(f => base + encodeURIComponent(f));
    }
  }catch{}
  // Load 3rd-year candidate images from public/images/your team/3rd year
  const year3Dir = path.join(__dirname, 'public', 'images', 'your team', '3rd year');
  let year3 = [];
  try{
    if (fs.existsSync(year3Dir)){
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const files = fs.readdirSync(year3Dir).filter(f => allowed.has(path.extname(f).toLowerCase()));
      const base3 = '/images/' + encodeURIComponent('your team') + '/' + encodeURIComponent('3rd year') + '/';
      year3 = files.map(f => base3 + encodeURIComponent(f));
    }
  }catch{}
  // Load 2nd-year candidate images from public/images/your team/2nd year
  const year2Dir = path.join(__dirname, 'public', 'images', 'your team', '2nd year');
  let year2 = [];
  try{
    if (fs.existsSync(year2Dir)){
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const files = fs.readdirSync(year2Dir).filter(f => allowed.has(path.extname(f).toLowerCase()));
      const base2 = '/images/' + encodeURIComponent('your team') + '/' + encodeURIComponent('2nd year') + '/';
      year2 = files.map(f => base2 + encodeURIComponent(f));
    }
  }catch{}
  res.render('auction', { state, teams: TEAMS, year4, year3, year2 });
});
app.get('/arena', (_req, res) => {
  res.render('arena', { teams: TEAMS });
});
app.get('/poll', (_req, res) => {
  const p = readPoll();
  const day = normalizePollDay(p);
  writePoll(p);
  res.render('poll', { day, results: p.days[day], teams: TEAMS });
});
app.get('/enquiry', (req, res) => {
  res.render('enquiry', { query: req.query });
});

// About Auction page
app.get('/auction/about', (_req, res) => {
  // Bidders mapped to their associated team names
  const bidders = [
    { team: 'Java Jesters',        name: 'Santosh Kumar Sharma' },
    { team: 'Syntax Samurai',      name: 'Vivek Gaur' },
    { team: 'Quantum Coders',      name: 'Pankaj Gupta' },
    { team: 'Ruby Renegades',      name: 'Santosh Agarwal Sir' },
    { team: 'Data Mavericks',      name: 'Biplendu Pathak' },
    { team: 'Logic Luminaries',    name: 'Dr. Vishwambhar Pathak' },
    { team: 'Code Commanders',     name: 'Mr. Puneet Sharma' },
    { team: 'Byte Busters',        name: 'Ms. Anju Sharma' },
    { team: 'Python Pioneers',     name: 'Gurminder Sir, Seema Mam & Archana mam' }
  ];
  // Glimpse images from public/images/auction
  const galleryDir = path.join(__dirname, 'public', 'images', 'auction');
  let gallery = [];
  try{
    if (fs.existsSync(galleryDir)) {
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const files = fs.readdirSync(galleryDir).filter(f => allowed.has(path.extname(f).toLowerCase()));
      gallery = files.map(f => '/images/auction/' + f);
    }
  }catch{}
  // Participants from public/images/Participants (primary source)
  const participantsDir = path.join(__dirname, 'public', 'images', 'Participants');
  let participants = [];
  try{
    if (fs.existsSync(participantsDir)){
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const files = fs.readdirSync(participantsDir).filter(f => allowed.has(path.extname(f).toLowerCase()));
      participants = files.map(f => {
        const name = path.parse(f).name.replace(/[_.-]+/g,' ').replace(/\s+/g,' ').trim()
          .split(' ').map(s=> s? (s[0].toUpperCase()+s.slice(1)) : '').join(' ');
        return { src: '/images/Participants/' + f, name };
      });
    }
  }catch{}
  // All participants from public/images/Participants (for 'View All' toggle)
  const allParticipantsDir = path.join(__dirname, 'public', 'images', 'Participants');
  let allParticipants = [];
  try{
    if (fs.existsSync(allParticipantsDir)){
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
      const files = fs.readdirSync(allParticipantsDir).filter(f => allowed.has(path.extname(f).toLowerCase()));
      allParticipants = files.map(f => {
        const name = path.parse(f).name.replace(/[_.-]+/g,' ').replace(/\s+/g,' ').trim()
          .split(' ').map(s=> s? (s[0].toUpperCase()+s.slice(1)) : '').join(' ');
        return { src: '/images/Participants/' + f, name };
      });
    }
  }catch{}
  res.render('auction-about', { bidders, participants, allParticipants, gallery });
});

// Fallback to index.html for root
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.redirect('/');
});

// Logic Rush (live quiz via Socket.IO)
function attachLogicRush(io){
  // Simple question bank (DSA/logic)
  const QUESTIONS = [
    { q:'Which data structure works on FIFO?', opts:['Stack','Queue','Tree','Graph'], a:1 },
    { q:'Time complexity of binary search?', opts:['O(n)','O(log n)','O(n log n)','O(1)'], a:1 },
    { q:'Which uses LIFO?', opts:['Queue','Heap','Stack','Trie'], a:2 },
    { q:'Best DS for BFS?', opts:['Stack','Queue','Set','Priority Queue'], a:1 },
    { q:'Which sorting is stable?', opts:['Merge Sort','Quick Sort','Heap Sort','Selection Sort'], a:0 },
    { q:'Hash table expected lookup?', opts:['O(1)','O(n)','O(log n)','O(n log n)'], a:0 },
  ];
  const ROUND_MS = 7000; // total round length
  const ANSWER_MS = 5000; // answer window
  let round = 0;
  let current = null; // {id,q,opts,a,deadline}
  const board = new Map(); // socketId -> { name, score, hp }
  const answered = new Map(); // round -> Set(socketId)

  function pick(){ return QUESTIONS[Math.floor(Math.random()*QUESTIONS.length)]; }
  function broadcastState(){ io.emit('lr:state', { round, current: current? { q:current.q, opts: current.opts, deadline: current.deadline }: null, board: getBoard() }); }
  function getBoard(){
    const arr = [...board.entries()].map(([id,v])=>({ id, name:v.name, score:v.score, hp:v.hp }));
    arr.sort((a,b)=> b.score - a.score);
    return arr.slice(0, 10);
  }

  function startRound(){
    round++;
    const base = pick();
    current = { q: base.q, opts: base.opts, a: base.a, deadline: Date.now() + ANSWER_MS };
    answered.set(round, new Set());
    broadcastState();
    setTimeout(()=>{ endRound(); }, ANSWER_MS);
    setTimeout(()=>{ // small gap before next round
      startRound();
    }, ROUND_MS);
  }
  function endRound(){
    if(!current) return;
    io.emit('lr:reveal', { a: current.a });
    current = null;
    broadcastState();
  }

  io.on('connection', (socket)=>{
    const name = `Player-${socket.id.slice(-4)}`;
    if(!board.has(socket.id)) board.set(socket.id, { name, score:0, hp:100 });
    socket.emit('lr:hello', { id: socket.id, name: board.get(socket.id).name });
    broadcastState();

    socket.on('lr:setName', (n)=>{
      try{
        const nm = String(n||'').trim().slice(0,24);
        if(nm.length>=2){ const p = board.get(socket.id) || { name, score:0, hp:100 }; p.name = nm; board.set(socket.id, p); io.emit('lr:leaderboard', { board: getBoard() }); }
      }catch{}
    });

    socket.on('lr:answer', (idx)=>{
      if(!current) return;
      const now = Date.now();
      if(now > current.deadline) return; // too late
      const seen = answered.get(round) || new Set();
      if(seen.has(socket.id)) return; // one answer per round
      seen.add(socket.id); answered.set(round, seen);
      const p = board.get(socket.id) || { name:`Player-${socket.id.slice(-4)}`, score:0, hp:100 };
      const correct = Number(idx) === Number(current.a);
      if(correct){ p.score += 50; }
      else { p.hp = Math.max(0, p.hp - 20); }
      board.set(socket.id, p);
      // feedback to the player
      socket.emit('lr:feedback', { ok: correct, delta: correct? '+50 Energy' : '-20 HP' });
      // update board for everyone
      io.emit('lr:leaderboard', { board: getBoard() });
    });

    socket.on('disconnect', ()=>{
      // keep their score; could prune if needed
    });
  });

  // kick off loop if not running
  setTimeout(startRound, 1200);
}

function startServer(port, attempts = 0){
  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: '*' } });
  attachLogicRush(io);
  server.listen(port, () => {
    console.log(`Auction site running at http://localhost:${port}`);
  });
  server.on('error', (err)=>{
    if(err && err.code === 'EADDRINUSE' && attempts < 10){
      const next = port + 1;
      console.warn(`Port ${port} in use. Trying ${next}...`);
      setTimeout(()=> startServer(next, attempts+1), 150);
    }else{
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

startServer(BASE_PORT);
