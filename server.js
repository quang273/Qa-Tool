const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const { authenticator } = require('otplib');
let ImapFlow = null;
let simpleParser = null;
try { ({ ImapFlow } = require('imapflow')); } catch {}
try { ({ simpleParser } = require('mailparser')); } catch {}

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const pub = path.join(__dirname, 'public');
const ENV_FILE = path.join(__dirname, '.env');
try {
  if (fs.existsSync(ENV_FILE)) {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
} catch {}
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(pub, { recursive: true });

const USE_SUPABASE = String(process.env.USE_SUPABASE || '').trim() === '1' && !!process.env.DATABASE_URL;
let dbPool = null;
let dbReady = false;
const memoryStore = {};
function deepClone(v){ return JSON.parse(JSON.stringify(v)); }
function fileReadJson(fp, fallback){ try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return deepClone(fallback); } }
function fileWriteJson(fp, value){ fs.writeFileSync(fp, JSON.stringify(value, null, 2), 'utf8'); }

app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(pub));

const files = {
  accounts: 'accounts.json', used: 'used-accounts.json', videos: 'videos.json', links: 'links.json',
  settings: 'settings.json', user2fa: 'user2fa.json', sim: 'sim-otp-settings.json', logs: 'logs.json', iphoneQueue: 'iphone-tool-queue.json', domainSettings: 'domain-settings.json', domainSim: 'domain-sim-settings.json', currentPicks: 'current-picks.json'
};
const defaults = {
  accounts: [], used: [], videos: [], links: [], user2fa: [], logs: [], iphoneQueue: [],
  settings: { mailMethod:'OAuth2', icloudEmail:'', icloudPassword:'', quickCopyText:'', withdrawEmailBase:'', showVideos:true, showAccount:true, showEmail:true, showIcloud:true, zaloUrl:'/zalo.jpg', iphoneToolUrl:'http://127.0.0.1:5799/api/rename-device', renameToolId:'default', passwordEnabled:false, accessPassword:'zx' },
  sim: { apiKey:'', service:'lf', country:'10', active: [], activeByClient: {} },
  domainSettings: {},
  domainSim: {},
  currentPicks: {}
};
function jpath(k){ return path.join(DATA_DIR, files[k]); }
function read(k){
  if (Object.prototype.hasOwnProperty.call(memoryStore, k)) return deepClone(memoryStore[k]);
  const value = fileReadJson(jpath(k), defaults[k]);
  memoryStore[k] = deepClone(value);
  return deepClone(value);
}
function saveToSupabase(k, v){
  if (!USE_SUPABASE || !dbReady || !dbPool) return;
  dbPool.query(
    `insert into qf_store (store_key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (store_key) do update set value = excluded.value, updated_at = now()`,
    [k, JSON.stringify(v)]
  ).catch(err => console.error('[Supabase] Save failed:', k, err.message));
}
function write(k,v){
  memoryStore[k] = deepClone(v);
  if (USE_SUPABASE && dbReady && dbPool) saveToSupabase(k, v);
  else fileWriteJson(jpath(k), v);
}
for (const k of Object.keys(files)) {
  if (!fs.existsSync(jpath(k))) fileWriteJson(jpath(k), defaults[k]);
  memoryStore[k] = fileReadJson(jpath(k), defaults[k]);
}
async function initStorage(){
  if (!USE_SUPABASE) {
    console.log('[Storage] Using local JSON files in data/*.json');
    return;
  }
  try {
    dbPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
    await dbPool.query(`create table if not exists qf_store (
      store_key text primary key,
      value jsonb not null,
      updated_at timestamptz not null default now()
    )`);
    for (const k of Object.keys(files)) {
      const row = await dbPool.query('select value from qf_store where store_key=$1', [k]);
      if (row.rows.length) {
        memoryStore[k] = row.rows[0].value;
      } else {
        const initial = fileReadJson(jpath(k), defaults[k]);
        memoryStore[k] = initial;
        await dbPool.query(
          'insert into qf_store (store_key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (store_key) do nothing',
          [k, JSON.stringify(initial)]
        );
      }
    }
    dbReady = true;
    console.log('[Storage] Supabase enabled: qf_store ready');
  } catch (err) {
    dbReady = false;
    console.error('[Storage] Supabase failed, falling back to local JSON:', err.message);
  }
}

function cloneDefault(k){ return JSON.parse(JSON.stringify(defaults[k])); }
function domainKey(req){
  return String((req.headers['x-forwarded-host'] || req.headers.host || 'default')).split(',')[0].split(':')[0].trim().toLowerCase() || 'default';
}
function readDomain(req, storeKey, defaultKey){
  const all = read(storeKey);
  const key = domainKey(req);
  const base = cloneDefault(defaultKey);
  return { ...base, ...(all[key] || {}) };
}
function writeDomain(req, storeKey, defaultKey, value){
  const all = read(storeKey);
  const key = domainKey(req);
  all[key] = { ...cloneDefault(defaultKey), ...(value || {}) };
  write(storeKey, all);
}
function domainSettings(req){ return readDomain(req, 'domainSettings', 'settings'); }
function writeDomainSettings(req, value){ writeDomain(req, 'domainSettings', 'settings', value); }
function domainSim(req){ return readDomain(req, 'domainSim', 'sim'); }
function writeDomainSim(req, value){ writeDomain(req, 'domainSim', 'sim', value); }

// v63: tách kho tài khoản / User|2FA / tài khoản vừa lấy theo từng domain.
// Không để qazx.fun và quanq88.fun dùng chung key Supabase nữa.
function readDomainValue(req, storeKey, fallback){
  const all = read(storeKey);
  const key = domainKey(req);
  if (!all || typeof all !== 'object' || Array.isArray(all)) return deepClone(fallback);
  return deepClone(Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback);
}
function writeDomainValue(req, storeKey, value){
  let all = read(storeKey);
  if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
  all[domainKey(req)] = deepClone(value);
  write(storeKey, all);
}
function readDomainArray(req, storeKey){
  const v = readDomainValue(req, storeKey, []);
  return Array.isArray(v) ? v : [];
}
function writeDomainArray(req, storeKey, value){
  writeDomainValue(req, storeKey, Array.isArray(value) ? value : []);
}
function readDomainObject(req, storeKey){
  const v = readDomainValue(req, storeKey, {});
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
function writeDomainObject(req, storeKey, value){
  writeDomainValue(req, storeKey, (value && typeof value === 'object' && !Array.isArray(value)) ? value : {});
}

function parseCookie(req){
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  });
  return out;
}

function safeClientId(v){ return /^[a-zA-Z0-9_-]{12,80}$/.test(String(v||'')); }
function getClientId(req, res){
  const ck = parseCookie(req);
  let id = ck.qf_client;
  if (!safeClientId(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2)));
    if (res) res.cookie('qf_client', id, { maxAge: 365*24*60*60*1000, httpOnly: true, sameSite: 'Lax' });
  }
  return id;
}

function cleanToolId(v){
  return String(v || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'default';
}
function currentToolId(req, res){
  // Tool ID không còn lưu theo domain nữa để tránh máy A đổi mã làm toàn bộ web/máy khác đổi theo.
  // Nếu cần gửi lệnh kiểu queue cũ, Tool ID chỉ lấy từ query/cookie của trình duyệt hiện tại.
  const ck = parseCookie(req);
  const fromQuery = req.query.toolId || req.query.tool || req.query.pc;
  if (fromQuery) {
    const id = cleanToolId(fromQuery);
    if (res) res.cookie('qf_tool_id', id, { maxAge: 365*24*60*60*1000, httpOnly: false, sameSite: 'Lax' });
    return id;
  }
  if (ck.qf_tool_id) return cleanToolId(ck.qf_tool_id);
  return 'default';
}
function cleanUdid(v){
  return String(v || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}
function currentTargetUdid(req, res){
  const ck = parseCookie(req);
  const fromQuery = req.query.udid || req.query.device || req.query.slot;
  if (fromQuery) {
    const id = cleanUdid(fromQuery);
    if (res && id) res.cookie('qf_rename_udid', id, { maxAge: 365*24*60*60*1000, httpOnly: false, sameSite: 'Lax' });
    return id;
  }
  return cleanUdid(ck.qf_rename_udid || '');
}
app.use((req,res,next)=>{
  if (req.query.toolId || req.query.tool || req.query.pc) currentToolId(req,res);
  if (req.query.udid || req.query.device || req.query.slot) currentTargetUdid(req,res);
  next();
});
function getClientActive(s, clientId){
  if (!s.activeByClient || typeof s.activeByClient !== 'object') s.activeByClient = {};
  return Array.isArray(s.activeByClient[clientId]) ? s.activeByClient[clientId] : [];
}
function setClientActive(s, clientId, list){
  if (!s.activeByClient || typeof s.activeByClient !== 'object') s.activeByClient = {};
  s.activeByClient[clientId] = Array.isArray(list) ? list : [];
  // Không dùng s.active chung nữa để tránh các máy cùng domain nhìn thấy số của nhau.
  s.active = [];
}
function isAuthed(req){
  const s = domainSettings(req);
  if (!s.passwordEnabled) return true;
  return parseCookie(req).qf_auth === '1';
}
app.use((req,res,next)=>{
  const s = domainSettings(req);
  // API/phím tắt video phải công khai để iPhone Shortcut gọi được dù domain bật mật khẩu.
  const publicPaths = [
    '/Login', '/Login/Logout', '/app.css', '/app.js', '/favicon.ico',
    '/api/otp', '/api/time', '/api/sim/status/', '/api/RandomTiktok', '/api/randomtiktok', '/api/text/',
    '/r/RandomTiktok', '/r/randomtiktok', '/Shortcut/', '/Auto/',
    // iPhone Tool cần đọc hàng chờ đổi tên ngay cả khi domain bật mật khẩu.
    '/IphoneTool/'
  ];
  const isPublic = publicPaths.some(x => req.path === x || req.path.startsWith(x));
  if (!s.passwordEnabled || isPublic) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/IphoneTool/')) return res.status(401).json({status:false,message:'Cần nhập mật khẩu truy cập'});
  if (isAuthed(req)) return next();
  return res.redirect('/Login');
});

function esc(s=''){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function urlEnc(v){ return encodeURIComponent(v || ''); }
function splitAccountLine(line){
  line = String(line || '').trim();
  if (!line) return [];
  // Hỗ trợ tài khoản bị trộn tab/khoảng trắng/dấu | trong cùng một dòng.
  // Ví dụ: user\t@handle email|pass|token|clientId
  return line
    .replace(/\|/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}
function is2faSecret(s){ const v=String(s||'').replace(/\s/g,'').trim(); return /^[A-Z0-9]{16,}$/i.test(v) || (v.length>=16 && /^[A-Za-z0-9]+$/.test(v)); }
function parseUser2faLoose(raw){
  const parts = String(raw||'').trim().includes('|')
    ? String(raw||'').split('|').map(x=>x.trim()).filter(Boolean)
    : String(raw||'').trim().split(/\s+/).map(x=>x.trim()).filter(Boolean);
  if (parts.length < 2) return { user: parts[0] || '', secret: '' };
  const secretIndex = parts.findIndex(is2faSecret);
  if (secretIndex >= 0) {
    const secret = String(parts[secretIndex] || '').replace(/\s/g,'').toUpperCase();
    const user = parts.find((x,i)=>i !== secretIndex && !is2faSecret(x)) || '';
    return { user, secret };
  }
  return { user: parts[0] || '', secret: parts[1] || '' };
}
function get2faSecret(parts){
  if (parts.length === 2 && is2faSecret(parts[1])) return parts[1];
  if (parts.length === 3 && is2faSecret(parts[2])) return parts[2];
  return '';
}
function isGmailMail(p){ return isEmailPart(p) && /@(gmail|googlemail)\./i.test(String(p||'')); }
function isMailFakeCandidate(p){ return isEmailPart(p) && !isMicrosoftMail(p) && !isGmailMail(p); }
function classify(parts){
  const joined = parts.join('|');
  const emails = parts.filter(p => /@/.test(p) && /\./.test(p));
  const lower = joined.toLowerCase();
  if (get2faSecret(parts)) return '2fa';
  if (emails.some(e => /hotmail|outlook|live|msn/i.test(e)) && parts.length >= 6) return 'hotmail-token';
  // v67: email không phải Microsoft/Gmail là mailfake; Emailfake@/Phan9999/Phat3479 => EmailFake, còn lại thử Mail.tm rồi EmailFake.
  if (emails.some(e => isMailFakeCandidate(e))) return 'mailfake-auto';
  return 'normal';
}
function isLongTokenPart(p){ return String(p || '').length > 80; }
function isUuidPart(p){ return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p || '')); }
function visibleParts(parts){
  const type = classify(parts);
  if (type === 'hotmail-token') {
    // Chỉ hiển thị phần đăng nhập: mã/user/handle/email/pass.
    // Ẩn refresh token dài và clientId/UUID phía sau.
    const tokenIndex = parts.findIndex(isLongTokenPart);
    const safe = tokenIndex >= 0 ? parts.slice(0, tokenIndex) : parts.filter(p => !isUuidPart(p));
    return safe.slice(0, Math.min(safe.length, 5));
  }
  return parts.filter(p => !isLongTokenPart(p) && !isUuidPart(p)).slice(0, Math.min(parts.length, 7));
}
function isEmailPart(p){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p||'')); }
function isMicrosoftMail(p){ return isEmailPart(p) && /@(hotmail|outlook|live|msn)\./i.test(String(p||'')); }
function findEmail(parts){
  // Ưu tiên email Microsoft chính để đọc code. Nếu cuối dòng có email phụ như fviainboxes thì bỏ qua.
  return parts.find(isMicrosoftMail) || parts.find(isEmailPart) || '';
}
function findToken(parts){
  // Refresh token Microsoft thường rất dài và hay bắt đầu bằng M.; không lấy email phụ/clientId làm token.
  return parts.find(p => {
    const v = String(p || '').trim();
    return v.length > 80 && !isEmailPart(v) && !isUuidPart(v);
  }) || '';
}
function findClientId(parts){
  // clientId là UUID; luôn tìm UUID ở bất kỳ vị trí nào, kể cả khi sau đó còn email phụ.
  return parts.find(isUuidPart) || '';
}

function parseHotmailOAuth(raw, parts){
  raw = String(raw || '').trim();
  parts = Array.isArray(parts) ? parts.map(x=>String(x||'').trim()).filter(Boolean) : splitAccountLine(raw);
  const emails = [];
  const emailRe = /[A-Za-z0-9._%+-]+@(hotmail|outlook|live|msn)\.[A-Za-z]{2,}/ig;
  let m;
  while ((m = emailRe.exec(raw))) emails.push(m[0]);
  const email = emails[0] || findEmail(parts);
  let token = '';
  let clientId = '';
  // Chuẩn OAuth2: ...|M.C516...$$|uuid|email_phu. Bắt token từ M. đến ngay trước UUID.
  const tokenUuidRe = /(M\.[^\s|]+)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const tm = raw.match(tokenUuidRe);
  if (tm) { token = tm[1]; clientId = tm[2]; }
  if (!token) token = findToken(parts);
  if (!clientId) clientId = findClientId(parts);
  // Nếu raw bị dán từ sheet có số thứ tự/user/handle ở trước, không dùng vị trí cố định.
  // PassMail chỉ để hiển thị/debug, refresh token không cần pass.
  let pass = '';
  const idx = parts.findIndex(p => String(p).toLowerCase() === String(email).toLowerCase());
  if (idx >= 0 && parts[idx+1] && !/^M\./i.test(parts[idx+1]) && !isUuidPart(parts[idx+1]) && !isEmailPart(parts[idx+1])) pass = parts[idx+1];
  return { email, pass, token, clientId };
}


function isMailFakeMarker(v){ return /^emailfake@?$/i.test(String(v||'').trim()); }
function isForcedEmailFakePass(v){ return /^(Phan9999|Phat3479)$/i.test(String(v||'').trim()); }
function isMailFakePassCandidate(v){
  const s = String(v||'').trim();
  if (!s) return false;
  if (isEmailPart(s) || isUuidPart(s) || /^M\./i.test(s) || s.length > 120) return false;
  if (/^@/.test(s)) return false;
  if (/^\d+$/.test(s)) return false;
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return false;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return false;
  if (isMailFakeMarker(s)) return false;
  return true;
}
function parseMailFakeAccount(raw, parts){
  raw = String(raw || '').trim();
  parts = Array.isArray(parts) ? parts.map(x=>String(x||'').trim()).filter(Boolean) : splitAccountLine(raw);
  const emailIndex = parts.findIndex(isMailFakeCandidate);
  if (emailIndex < 0) return { email:'', pass:'', forceEmailFake:false };
  const email = parts[emailIndex];
  let pass = '';

  // Dạng email|pass hoặc email|pass|gmail phụ.
  for (let i=emailIndex+1; i<parts.length; i++) {
    const v = String(parts[i] || '').trim();
    if (isMailFakePassCandidate(v)) { pass = v; break; }
  }
  // Dạng user pass email time Emailfake@, pass nằm trước email.
  if (!pass) {
    for (let i=emailIndex-1; i>=0; i--) {
      const v = String(parts[i] || '').trim();
      if (isMailFakePassCandidate(v)) { pass = v; break; }
    }
  }

  const forceEmailFake = parts.some(isMailFakeMarker) || parts.some(isForcedEmailFakePass) || isForcedEmailFakePass(pass);
  return { email, pass, forceEmailFake };
}
// Giữ alias cũ để không đụng các đoạn khác nếu còn gọi tên này.
const parseMailTmAccount = parseMailFakeAccount;

async function mailTmFetchJson(url, options={}){
  const r = await fetch(url, {
    ...options,
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'QuangFun-MailTM/1.0',
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const detail = (json && (json.message || json.detail || json.title)) || text || `HTTP ${r.status}`;
    const err = new Error(detail);
    err.status = r.status;
    throw err;
  }
  return json;
}

async function getMailTmToken(email, pass){
  if (!email || !pass) throw new Error('thiếu email hoặc mật khẩu mailfake');
  try {
    const tj = await mailTmFetchJson('https://api.mail.tm/token', {
      method:'POST',
      body: JSON.stringify({ address: email, password: pass })
    });
    if (!tj || !tj.token) throw new Error('Mail.tm không trả token');
    return tj.token;
  } catch (e) {
    // Một số mailfake theo chuẩn mail.tm cần tạo account trước nếu chưa tồn tại.
    // Nếu account đã tồn tại thì tạo sẽ lỗi, sau đó vẫn báo lỗi token rõ ràng.
    if (e.status === 404 || e.status === 401) {
      try {
        await mailTmFetchJson('https://api.mail.tm/accounts', {
          method:'POST',
          body: JSON.stringify({ address: email, password: pass })
        });
        const tj = await mailTmFetchJson('https://api.mail.tm/token', {
          method:'POST',
          body: JSON.stringify({ address: email, password: pass })
        });
        if (tj && tj.token) return tj.token;
      } catch {}
    }
    throw new Error('Mail.tm token lỗi: ' + (e.message || e));
  }
}

async function getMailTmTikTokCode(email, pass){
  const token = await getMailTmToken(email, pass);
  const auth = { authorization: `Bearer ${token}` };
  const list = await mailTmFetchJson('https://api.mail.tm/messages?page=1', { headers: auth });
  const items = Array.isArray(list?.['hydra:member']) ? list['hydra:member'] : (Array.isArray(list) ? list : []);
  for (const msg of items.slice(0, 30)) {
    const summary = [msg.from?.address, msg.from?.name, msg.subject, msg.intro].join(' ');
    // Chỉ lấy code TikTok, không lấy code dịch vụ khác.
    if (!isTikTokMailText(summary)) continue;
    let detail = msg;
    if (msg.id) {
      try { detail = await mailTmFetchJson(`https://api.mail.tm/messages/${encodeURIComponent(msg.id)}`, { headers: auth }); } catch {}
    }
    const text = [
      detail.from?.address, detail.from?.name, detail.subject, detail.intro,
      Array.isArray(detail.text) ? detail.text.join(' ') : detail.text,
      Array.isArray(detail.html) ? detail.html.join(' ') : detail.html
    ].filter(Boolean).join(' ');
    const code = extractTikTokCode(text || summary);
    if (code) return code;
  }
  return '';
}

async function fetchText(url, options={}){
  const r = await fetch(url, {
    ...options,
    headers: {
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text;
}

function stripHtmlText(html){
  return String(html||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)||32))
    .replace(/\s+/g,' ')
    .trim();
}

async function getEmailFakeTikTokCode(email){
  email = String(email||'').trim();
  if (!isEmailPart(email)) throw new Error('emailfake thiếu email');
  const [local, domain] = email.split('@');
  const candidates = [
    `https://emailfake.com/${encodeURIComponent(email)}`,
    `https://vi.emailfake.com/${encodeURIComponent(email)}`,
    `https://emailfake.com/?email=${encodeURIComponent(email)}`,
    `https://vi.emailfake.com/?email=${encodeURIComponent(email)}`,
    `https://emailfake.com/${encodeURIComponent(local)}/${encodeURIComponent(domain)}`,
    `https://vi.emailfake.com/${encodeURIComponent(local)}/${encodeURIComponent(domain)}`
  ];
  let lastErr = '';
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      const text = stripHtmlText(html);
      const code = extractTikTokCode(text);
      if (code) return { code, source:'emailfake', url };
    } catch(e) { lastErr = e.message || String(e); }
  }
  return { code:'', source:'emailfake', error:lastErr };
}

async function getMailFakeTikTokCode(email, pass, opts={}){
  const forceEmailFake = !!opts.forceEmailFake;

  // Rule v67:
  // - Có Emailfake@ hoặc pass Phan9999/Phat3479 => mặc định vi.emailfake.com / emailfake.
  // - Còn lại thử Mail.tm trước, nếu không được mới thử EmailFake.
  if (forceEmailFake) {
    const ef = await getEmailFakeTikTokCode(email);
    if (ef.code) return { ...ef, source:'emailfake' };
    const err = new Error('EmailFake chưa thấy mail TikTok hoặc chưa thấy mã 6 số');
    err.openUrl = ef.url || `https://vi.emailfake.com/${encodeURIComponent(email)}`;
    throw err;
  }

  let mtErr = '';
  try {
    const code = await getMailTmTikTokCode(email, pass);
    if (code) return { code, source:'mail.tm' };
  } catch(e) { mtErr = e.message || String(e); }

  const ef = await getEmailFakeTikTokCode(email);
  if (ef.code) return { ...ef, source:'emailfake' };

  const msg = [mtErr ? ('Mail.tm: ' + mtErr) : 'Mail.tm chưa thấy mã TikTok', 'EmailFake chưa thấy mã TikTok'].join(' | ');
  const err = new Error(msg);
  err.openUrl = ef.url || `https://vi.emailfake.com/${encodeURIComponent(email)}`;
  throw err;
}

function extractCode(text){ const m = String(text||'').match(/(?<!\d)(\d{6})(?!\d)/); return m ? m[1] : ''; }
function currentOtp(secret){
  try { return authenticator.generate(String(secret || '').replace(/\s/g,'')); } catch { return ''; }
}
function remain(){ return 30 - (Math.floor(Date.now()/1000) % 30); }
function accountQuery(parts){ return parts.map(p => 'accountData='+urlEnc(p)).join('&'); }

function likelyUserIndex(parts){
  if (!parts.length) return 0;
  if (/^\d+$/.test(parts[0]||'') && parts[1]) return 1;
  return 0;
}
function isPureNumber(v){ return /^\d+$/.test(String(v||'').trim()); }
function isAccountJunkPart(v){
  const s = String(v||'').trim();
  if (!s) return true;
  if (s.startsWith('@')) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  if (is2faSecret(s)) return true;
  if (s.length > 80 || /^M\./i.test(s)) return true;
  return false;
}
function accountRenameName(parts){
  parts = Array.isArray(parts) ? parts.map(x=>String(x||'').trim()).filter(Boolean) : splitAccountLine(parts);
  if (!parts.length) return '';
  // Đổi tên ALL chỉ lấy USER, không lấy pass.
  // Nếu dữ liệu 1 chỉ là số thứ tự thì bỏ qua và lấy dữ liệu 2 làm user.
  const uIdx = (isPureNumber(parts[0]) && parts[1]) ? 1 : 0;
  return parts[uIdx] || parts[0] || '';
}
function popFirstCurrentPick(req){
  const picks = readDomainObject(req, 'currentPicks');
  const keys = Object.keys(picks || {});
  if (!keys.length) return null;
  // ưu tiên bản lấy gần nhất nếu id sinh theo thời gian, nếu không thì lấy key cuối cùng
  const k = keys[keys.length - 1];
  const parts = Array.isArray(picks[k]) ? picks[k].map(String) : [];
  delete picks[k];
  writeDomainObject(req, 'currentPicks', picks);
  if (!parts.length) return null;
  return { raw: parts.join('|'), parts, name: accountRenameName(parts), accountId: k, source:'currentPick', domain: domainKey(req) };
}
function popFirstUser2fa(req){
  const list = readDomainArray(req, 'user2fa');
  if (!Array.isArray(list) || !list.length) return null;
  const x = list.shift();
  writeDomainArray(req, 'user2fa', list);
  const user = String(x.user || '').trim();
  const secret = String(x.secret || '').trim();
  if (!user) return popFirstUser2fa(req);
  // Nếu có secret thì đổi tên user|secret, nếu không có thì chỉ đổi tên user.
  const name = secret ? (user + '|' + secret) : user;
  return { raw: name, parts: secret ? [user, secret] : [user], name, source:'user2fa', remainingUser2fa:list.length, domain: domainKey(req) };
}
function userToolBox(parts){
  if (!parts.length) return '';
  const shown = visibleParts(parts);
  const idx = likelyUserIndex(shown);
  const quickUser = shown[idx] || shown[0] || '';
  const type = classify(parts);
  const secret = get2faSecret(parts);
  const user2fa = (type === '2fa' && parts[0] && secret) ? `${parts[0]}|${secret}` : '';
  const options = shown.map((p,i)=>`<option value="${esc(p)}" ${i===idx?'selected':''}>Dữ liệu ${i+1}: ${esc(p)}</option>`).join('');
  return `<section class="send-tool-box">
    <h3>📲 Gửi sang iPhone Tool</h3>
    <p class="muted">Dùng lúc đăng nhập lần đầu: gửi đúng dòng USER để tool đổi tên iPhone theo user.</p>
    <div class="btn-grid">
      <button class="btn primary" type="button" data-send-tool="${esc(quickUser)}">🚀 Gửi USER tự nhận</button>
      ${user2fa ? `<button class="btn soft" type="button" data-send-tool="${esc(user2fa)}">🔐 Gửi USER|2FA</button>` : ''}
    </div>
    <label>Chọn dữ liệu muốn gửi nếu tool nhận sai user</label>
    <div class="select-send-row">
      <select id="sendUserSelect">${options}</select>
      <button class="btn soft" type="button" id="sendSelectedUserBtn">Gửi dòng đã chọn</button>
    </div>
    <div id="toolSendResult"></div>
  </section>`;
}

function nav(active='home'){
  const items = [
    ['/', 'Trang chủ', '🏠','home'], ['/Settings','Cài đặt','⚙️','settings'], ['/otp','User | 2FA','🔐','otp'], ['/thue-otp-sim','Thuê SIM','📱','sim']
  ];
  return `<nav class="bottom-nav">${items.map(([href,label,ic,key])=>`<a class="${active===key?'on':''}" href="${href}"><b>${ic}</b><span>${label}</span></a>`).join('')}</nav>`;
}
function layout(title, body, active='home'){
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0f6bff"><title>${esc(title)}</title><link rel="stylesheet" href="/app.css"></head><body><div class="bg"></div><main class="app"><header class="hero"><div><p class="eyebrow" id="siteDomain">${esc(process.env.SITE_NAME || "")}</p><h1>${esc(title)}</h1></div><a class="pill" href="/">Online</a></header>${body}</main>${nav(active)}<script src="/app.js"></script></body></html>`;
}
function card(title, content, extra=''){ return `<section class="card ${extra}"><h2>${title}</h2>${content}</section>`; }
function btn(href, text, cls='primary'){ return `<a class="btn ${cls}" href="${href}">${text}</a>`; }


const VIDEO_TYPES = {
  tiktok60: { label:'TikTok thường 60p', env:'TIKTOK_60_SOURCE_URL' },
  tiktok180: { label:'TikTok thường 180p', env:'TIKTOK_180_SOURCE_URL' },
  tiktok10: { label:'TikTok thường 10p', env:'TIKTOK_10_SOURCE_URL' },
  lite60: { label:'TikTok Lite 60p', env:'TIKTOK_LITE_60_SOURCE_URL' },
  lite180: { label:'TikTok Lite 180p', env:'TIKTOK_LITE_180_SOURCE_URL' },
  lite10: { label:'TikTok Lite 10p', env:'TIKTOK_LITE_10_SOURCE_URL' }
};
function normalizeVideoStore(raw){
  const out = { tiktok60:[], tiktok180:[], tiktok10:[], lite60:[], lite180:[], lite10:[] };
  if (Array.isArray(raw)) { out.tiktok60 = raw.map(String).filter(Boolean); return out; }
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out)) out[k] = Array.isArray(raw[k]) ? raw[k].map(String).filter(Boolean) : [];
  }
  return out;
}
function readVideoStore(){ return normalizeVideoStore(read('videos')); }
function writeVideoStore(store){ write('videos', normalizeVideoStore(store)); }
function videoTypeFromEnvKey(envKey){
  if (/LITE/i.test(envKey) && /10/i.test(envKey)) return 'lite10';
  if (/LITE/i.test(envKey) && /180/i.test(envKey)) return 'lite180';
  if (/LITE/i.test(envKey)) return 'lite60';
  if (/10/i.test(envKey)) return 'tiktok10';
  if (/180/i.test(envKey)) return 'tiktok180';
  return 'tiktok60';
}
function uniqList(arr){ const seen=new Set(); const out=[]; for(const x of arr.map(normalizeVideoUrl).filter(Boolean)){ if(!seen.has(x)){ seen.add(x); out.push(x); } } return out; }

function renderWithdrawalMail(settings){
  const base = String(settings.withdrawEmailBase || '').trim();
  const disabled = base ? '' : 'disabled';
  const placeholder = base ? '' : 'Chưa cài mail rút tiền trong Cài đặt';
  return `<div class="field withdraw-mail-box"><label>Mail rút tiền</label><div class="input-action-row"><button class="input-paste" type="button" id="refreshWithdrawMail" title="Random mail mới" ${disabled}>🔄</button><input id="withdrawMailInput" readonly data-base="${esc(base)}" placeholder="${placeholder}"><button class="input-copy" type="button" data-copy-input="withdrawMailInput" title="Copy mail rút tiền" ${disabled}>📋</button></div><small class="hint">Mỗi lần tải trang hoặc bấm 🔄 sẽ tạo mail mới từ mail gốc trong Cài đặt.</small></div>`;
}

function renderAccount(parts){
  if (!parts.length) return `<div class="empty">Chưa có tài khoản nào được lấy.</div><div class="btn-grid">${btn('/Home/GetAccount','⬇️ Lấy tài khoản')}</div>`;
  const type = classify(parts);
  const shown = visibleParts(parts);
  const fields = shown.map((p,i)=>`<div class="field"><label>Dữ liệu ${i+1}</label><div class="copy-row"><input readonly value="${esc(p)}"><button class="mini-copy" onclick="copyValue(this)" title="Copy dòng này">📋</button></div></div>`).join('');
  const hidden = `<input type="hidden" id="accountRaw" value="${esc(parts.join('|'))}">`;
  const secret = get2faSecret(parts);
  const otp = secret ? `<div class="otpbox"><div><b>OTP 2FA</b><small class="otp-remain">${remain()}s</small></div><div class="otpcode" data-secret="${esc(secret)}">${currentOtp(secret)}</div><button onclick="copyText(document.querySelector('.otpcode').textContent)">📋</button></div>` : '';
  return `${hidden}${fields}${otp}<button class="btn primary wide" id="getCodeBtn">🔑 Get Code</button><div id="codeResult"></div>${btn('/Home/GetAccount','⬇️ Lấy tài khoản','soft')}`;
}

function makePickId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,10); }
function getAccountFromQuery(req){
  // Chỉ hiển thị tài khoản khi URL có accountId. Không đọc cookie nữa.
  // Nhờ vậy bấm tải lại/trở về trang chủ không giữ tài khoản vừa lấy trên màn hình.
  const picks = readDomainObject(req, 'currentPicks');
  const id = String(req.query.accountId || '').trim();
  if (id) {
    const item = picks[id] || null;
    return Array.isArray(item) ? item.map(String) : [];
  }
  // Hỗ trợ link cũ nếu còn đang mở tab cũ.
  let q = req.query.accountData;
  if (!q) return [];
  return Array.isArray(q) ? q.map(String) : [String(q)];
}

app.get('/', (req,res)=>{
  const settings = domainSettings(req);
  const acc = getAccountFromQuery(req);
  const videos = read('videos');
  const links = read('links');
  const installUrl = (!settings.zaloUrl || String(settings.zaloUrl).includes('auraesoftware.com/zalo.jpg')) ? '/zalo.jpg' : settings.zaloUrl;
  let body = `<div class="quick-grid"><a class="quick" href="${esc(installUrl)}" target="_blank">➕<span>Cài web mới</span></a><a class="quick" href="/Account/AddAccount">👤<span>Thêm tài khoản</span></a><a class="quick" href="/Settings">⚙️<span>Cài đặt</span></a><a class="quick danger" href="/Login/Logout">↪<span>Đăng xuất</span></a></div>`;
  if (req.query.noAccount === '1') body += `<div class="notice warn">⚠️ Không còn tài khoản mới để lấy. Hãy thêm tài khoản mới trong mục Thêm tài khoản.</div>`;
  if (settings.showAccount) body += card('👤 Tài khoản', renderAccount(acc) + renderWithdrawalMail(settings));
  if (settings.showVideos) body += card('🎬 Xem video', `<div class="btn-grid">${btn('/Shortcut/TikTok60','▶ Video TikTok 60p')}${btn('/Shortcut/TikTok180','⏱️ Video TikTok 180p','soft')}${btn('/r/RandomTiktok10','▶ Video TikTok 10p','soft')}${btn('/Shortcut/TikTokLite60','▶ Video Lite 60p')}${btn('/Shortcut/TikTokLite180','⏱️ Video Lite 180p','soft')}${btn('/r/RandomTiktokLite10','▶ Video Lite 10p','soft')}${btn('/Video/AddVideo','➕ Thêm video','soft')}</div>`);
  if (settings.showEmail) body += card('✉️ Link nhanh', links.length ? `<div class="list">${links.slice(0,5).map(l=>`<a class="list-item" target="_blank" href="${esc(l)}">${esc(l)}</a>`).join('')}</div>${btn('/Link/AddLink','Thêm link','soft')}` : `<div class="empty">Chưa có link.</div>${btn('/Link/AddLink','Thêm link','soft')}`);
  if (settings.showIcloud) body += card('☁️ iCloud', `<div class="field"><label>Tài khoản iCloud</label><div class="copy-row"><input readonly value="${esc(settings.icloudEmail||'Chưa cài')}"><button onclick="copyValue(this)">📋</button></div></div><div class="field"><label>Mật khẩu iCloud</label><div class="copy-row"><input readonly value="${esc(settings.icloudPassword||'')}"><button onclick="copyValue(this)">📋</button></div></div>`);
  if (req.query.accountId) {
    body += `<script>try{ history.replaceState(null,'','/'); }catch(e){}</script>`;
  }
  res.send(layout('Trang chủ', body, 'home'));
});

app.get('/Home/GetAccount', (req,res)=>{
  const accounts = readDomainArray(req, 'accounts').map(x=>String(x||'').trim()).filter(Boolean);
  const pick = accounts.shift();
  if (!pick) return res.redirect('/?noAccount=1');
  // v63: lấy và xóa dòng đầu tiên chỉ trong kho tài khoản của CHÍNH DOMAIN hiện tại.
  writeDomainArray(req, 'accounts', accounts);
  const parts = splitAccountLine(pick);
  const id = makePickId();
  const picks = readDomainObject(req, 'currentPicks');
  picks[id] = parts;
  // Giữ tối đa 100 tài khoản đang mở cho từng domain để store không phình to.
  const keys = Object.keys(picks);
  for (const k of keys.slice(0, Math.max(0, keys.length - 100))) delete picks[k];
  writeDomainObject(req, 'currentPicks', picks);
  res.clearCookie('qf_current_account_id');
  res.redirect('/?accountId=' + urlEnc(id));
});
app.get('/Home/MarkUsed', (req,res)=>{ res.redirect('/'); });

function popNextAccountForTool(req){
  // Ưu tiên 1: danh sách User|2FA. Có secret thì đổi user|secret, không có thì chỉ đổi user.
  const u2fa = popFirstUser2fa(req);
  if (u2fa) return u2fa;

  // Ưu tiên 2: chỉ lấy tài khoản đã bấm Lấy tài khoản trên trang chủ và đang hiển thị.
  // Không tự lấy tiếp từ danh sách tài khoản còn lại để tránh tool lấy nhầm account chưa chuẩn bị.
  const picked = popFirstCurrentPick(req);
  if (picked) return picked;

  return null;
}
app.post('/IphoneTool/GetAccount',(req,res)=>{
  const item = popNextAccountForTool(req);
  if (!item) return res.json({status:false,message:'Không còn User|2FA hoặc tài khoản đang hiển thị ở Trang chủ để lấy.'});
  return res.json({status:true,item});
});
app.post('/IphoneTool/GetAccounts',(req,res)=>{
  const count = Math.max(1, Math.min(100, parseInt(req.body.count || req.query.count || '1', 10) || 1));
  const items = [];
  for (let i=0;i<count;i++) {
    const item = popNextAccountForTool(req);
    if (!item) break;
    items.push(item);
  }
  return res.json({status:true,items,remaining:readDomainArray(req,'accounts').length,user2faRemaining:readDomainArray(req,'user2fa').length,message:items.length?`Đã lấy ${items.length} dữ liệu đổi tên.`:'Không còn User|2FA hoặc tài khoản đang hiển thị ở Trang chủ để lấy.'});
});

app.get('/Login', (req,res)=>{
  const s = domainSettings(req);
  if (!s.passwordEnabled) return res.redirect('/');
  const body = card('🔒 Nhập mật khẩu truy cập', `<form method="post"><label>Mật khẩu</label><input type="password" name="password" placeholder="Nhập mật khẩu"><button class="btn primary wide">🔓 Vào web</button></form>${req.query.err?' <div class="notice warn">Sai mật khẩu.</div>':''}`);
  res.send(layout('Đăng nhập', body, 'settings'));
});
app.post('/Login', (req,res)=>{
  const s = domainSettings(req);
  if (String(req.body.password || '') === String(s.accessPassword || 'zx')) {
    res.setHeader('Set-Cookie','qf_auth=1; Path=/; Max-Age=604800; SameSite=Lax');
    return res.redirect('/');
  }
  res.redirect('/Login?err=1');
});
app.get('/Login/Logout', (req,res)=>{ res.setHeader('Set-Cookie','qf_auth=; Path=/; Max-Age=0; SameSite=Lax'); res.redirect('/Login'); });
app.post('/Login/Logout', (req,res)=>{ res.setHeader('Set-Cookie','qf_auth=; Path=/; Max-Age=0; SameSite=Lax'); res.redirect('/Login'); });

app.post('/Home/GetCode', async (req,res)=>{
  const rawInput = String(req.body.raw || '');
  const parts = splitAccountLine(rawInput);
  const type = classify(parts);
  const hotmailOAuth = parseHotmailOAuth(rawInput, parts);
  const email = hotmailOAuth.email || findEmail(parts);
  if (type === '2fa') { const secret = get2faSecret(parts); return res.json({ status:true, code: currentOtp(secret), content:'Mã 2FA hiện tại của bạn' }); }
  if (type === 'mailfake-auto') {
    const mt = parseMailFakeAccount(rawInput, parts);
    try {
      const result = await getMailFakeTikTokCode(mt.email, mt.pass, { forceEmailFake: mt.forceEmailFake });
      if (result.code) return res.json({ status:true, code:result.code, content:`${result.code} là mã TikTok của bạn`, source: result.source });
      return res.json({ status:false, message:'Mailfake chưa có mail TikTok mới hoặc chưa thấy mã 6 số.' });
    } catch(e){ return res.json({ status:false, message:'Không lấy được Mailfake: ' + (e.message || e), openUrl:e.openUrl }); }
  }
  if (type === 'hotmail-token' || (hotmailOAuth.email && hotmailOAuth.token && hotmailOAuth.clientId)) {
    // Không dựa vào Dữ liệu 1/2/3/4 vì có thể có STT, user, handle hoặc email phụ.
    // Tự tìm email Microsoft + refresh token M.* + clientId UUID trong raw line.
    const token = hotmailOAuth.token;
    const clientId = hotmailOAuth.clientId;
    try {
      const code = await getMicrosoftTikTokCode(email, token, clientId);
      if (code) return res.json({ status:true, code, content:`${code} là mã gồm 6 chữ số của bạn` });
      return res.json({ status:false, message:'Không tìm thấy mã TikTok mới trong hộp thư hoặc token không còn hợp lệ.' });
    } catch (e) { return res.json({ status:false, message:'Không lấy được Hotmail: '+e.message }); }
  }
  return res.json({ status:false, message:'Dạng tài khoản này chưa có nguồn đọc code. Hotmail dùng OAuth2; mailfake dùng dạng email|pass; chỉ lấy code TikTok.' });
});
async function refreshMicrosoftAccessToken(refreshToken, clientId){
  // Access token cho Microsoft Graph. Một số token cũ không có quyền Graph,
  // khi đó hàm getMicrosoftTikTokCode sẽ tự fallback sang IMAP OAuth2.
  const tenants = ['common', 'consumers'];
  const scopes = ['', 'offline_access Mail.Read', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/.default'];
  let lastDetail = '';
  for (const tenant of tenants) {
    for (const scope of scopes) {
      const body = new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });
      if (scope) body.set('scope', scope);
      const tr = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: {'content-type':'application/x-www-form-urlencoded'},
        body
      });
      if (tr.ok) {
        const tj = await tr.json();
        if (tj && typeof tj.access_token === 'string' && tj.access_token.split('.').length >= 3) return tj;
        lastDetail = 'OAuth refresh trả về nhưng access_token Graph không hợp lệ';
        continue;
      }
      try {
        const ej = await tr.json();
        lastDetail = ej.error_description || ej.error || JSON.stringify(ej);
      } catch {
        lastDetail = await tr.text().catch(()=> '');
      }
      if (/invalid_grant|expired|revoked|AADSTS700082|AADSTS70000/i.test(lastDetail) && !/scope|scopes|unauthorized/i.test(lastDetail)) {
        throw new Error('refresh token lỗi: token đã hết hạn hoặc bị thu hồi');
      }
    }
  }
  throw new Error('refresh token lỗi' + (lastDetail ? ': ' + String(lastDetail).slice(0,220) : ''));
}

async function refreshMicrosoftImapAccessToken(refreshToken, clientId){
  // Ưu tiên OAuth2 kiểu legacy Live/Outlook giống các tool đọc mail OAuth2.
  // Nhiều token M.C516... không cấp Graph Mail.Read nhưng vẫn dùng được với IMAP XOAUTH2.
  let lastDetail = '';

  const liveScopes = ['', 'wl.imap wl.offline_access', 'offline_access wl.imap', 'service::outlook.office.com::MBI_SSL', 'service::outlook.office.com::MBI_SSL wl.offline_access', 'wl.offline_access service::outlook.office.com::MBI_SSL'];
  for (const scope of liveScopes) {
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    if (scope) body.set('scope', scope);
    try {
      const tr = await fetch('https://login.live.com/oauth20_token.srf', {
        method: 'POST',
        headers: {'content-type':'application/x-www-form-urlencoded'},
        body
      });
      const txt = await tr.text();
      let tj = null; try { tj = JSON.parse(txt); } catch {}
      if (tr.ok && tj && typeof tj.access_token === 'string' && tj.access_token.length > 20) return tj;
      lastDetail = (tj && (tj.error_description || tj.error)) || txt || lastDetail;
    } catch (e) { lastDetail = e.message || String(e); }
  }

  // Fallback endpoint Microsoft identity platform.
  const tenants = ['consumers', 'common'];
  const scopes = [
    'https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
    'offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
    ''
  ];
  for (const tenant of tenants) {
    for (const scope of scopes) {
      const body = new URLSearchParams({
        client_id: clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });
      if (scope) body.set('scope', scope);
      try {
        const tr = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: {'content-type':'application/x-www-form-urlencoded'},
          body
        });
        const txt = await tr.text();
        let tj = null; try { tj = JSON.parse(txt); } catch {}
        if (tr.ok && tj && typeof tj.access_token === 'string' && tj.access_token.length > 20) return tj;
        lastDetail = (tj && (tj.error_description || tj.error)) || txt || lastDetail;
      } catch (e) { lastDetail = e.message || String(e); }
    }
  }
  throw new Error('OAuth2 IMAP refresh lỗi' + (lastDetail ? ': ' + String(lastDetail).slice(0,220) : ''));
}


function isTikTokMailText(text){
  return /tiktok|account\.tiktok|@tiktok\.com|verification code|mã xác minh|is your verification code/i.test(String(text || ''));
}

function extractTikTokCode(text){
  const src = String(text || '');
  if (!isTikTokMailText(src)) return '';
  return extractCode(src) || '';
}


async function getMicrosoftTikTokCodeOutlookRest(email, refreshToken, clientId){
  // v71: fallback duy nhất đã chứng minh chạy nhanh trong log:
  // endpoint https://outlook.office.com/api/v2.0/me/messages với cùng access_token primary.
  const candidates = await getMicrosoftImapAccessTokenCandidates(refreshToken, clientId);
  const url = 'https://outlook.office.com/api/v2.0/me/messages?$top=15';
  const errors = [];
  for (const c of candidates) {
    const started = Date.now();
    const r = await fetch(url, { headers:{ authorization:`Bearer ${c.accessToken}`, accept:'application/json' } });
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const detail = (j && (j.error?.message || j.error_description || j.error)) || txt || `HTTP ${r.status}`;
      errors.push(`${c.label}: ${String(detail).slice(0,160)}`);
      continue;
    }
    let arr = Array.isArray(j?.value) ? j.value : [];
    arr.sort((a,b)=> new Date(b.ReceivedDateTime || b.DateTimeReceived || b.CreatedDateTime || 0) - new Date(a.ReceivedDateTime || a.DateTimeReceived || a.CreatedDateTime || 0));
    for (const m of arr) {
      const from = m.From?.EmailAddress?.Address || m.From?.EmailAddress?.Name || m.From?.EmailAddress?.address || '';
      const text = [from, m.Subject || m.subject, m.BodyPreview || m.bodyPreview, m.Body?.Content || m.body?.content].filter(Boolean).join(' ');
      const code = extractTikTokCode(text);
      if (code) return code;
    }
    // Không có code thì dừng, không thử endpoint phụ để giữ tốc độ.
    return '';
  }
  throw new Error('Outlook REST primary lỗi' + (errors.length ? ': ' + errors.join(' | ') : ''));
}

async function getMicrosoftTikTokCodeGraph(email, refreshToken, clientId){
  const tj = await refreshMicrosoftAccessToken(refreshToken, clientId);
  if (!tj || typeof tj.access_token !== 'string' || tj.access_token.split('.').length < 3) {
    throw new Error('OAuth không trả access_token hợp lệ cho Graph Mail.Read');
  }
  const mr = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=subject,bodyPreview,from,receivedDateTime&$orderby=receivedDateTime desc', { headers:{authorization:`Bearer ${tj.access_token}`} });
  if (!mr.ok) {
    let detail = '';
    try { const ej = await mr.json(); detail = ej.error?.message || ej.error || ''; } catch { detail = await mr.text().catch(()=> ''); }
    throw new Error('Graph Mail.Read lỗi' + (detail ? ': ' + String(detail).slice(0,220) : ''));
  }
  const mj = await mr.json();
  for (const m of (mj.value || [])) {
    const text = [m.subject, m.bodyPreview, m.from?.emailAddress?.address].join(' ');
    const code = extractTikTokCode(text);
    if (code) return code;
  }
  return '';
}

async function getMicrosoftImapAccessTokenCandidates(refreshToken, clientId){
  // v71 tối ưu tốc độ theo log thực tế:
  // Đường thành công ổn nhất là consumers + https://outlook.office.com/IMAP.AccessAsUser.All offline_access.
  // Không thử 7 candidate nữa để tránh chậm 30-40 giây khi một số scope fail.
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All offline_access'
  });
  const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: {'content-type':'application/x-www-form-urlencoded'},
    body
  });
  const txt = await tr.text();
  let tj = null; try { tj = JSON.parse(txt); } catch {}
  if (tr.ok && tj && typeof tj.access_token === 'string' && tj.access_token.length > 20) {
    return [{
      label: 'consumers https://outlook.office.com/IMAP.AccessAsUser.All offline_access',
      accessToken: tj.access_token
    }];
  }
  const detail = (tj && (tj.error_description || tj.error)) || txt || `HTTP ${tr.status}`;
  throw new Error('OAuth2 IMAP primary refresh lỗi: ' + String(detail).slice(0,220));
}

async function readTikTokCodeByImapAccessToken(email, accessToken){
  const client = new ImapFlow({
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    logger: false,
    auth: { user: email, accessToken, method: 'XOAUTH2' }
  });
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen('INBOX');
    const total = mailbox.exists || 0;
    if (!total) return '';
    const start = Math.max(1, total - 80);
    const messages = [];
    for await (const msg of client.fetch(`${start}:*`, { envelope: true, source: true, internalDate: true })) {
      messages.push(msg);
    }
    messages.sort((a,b)=> new Date(b.internalDate || 0) - new Date(a.internalDate || 0));
    for (const msg of messages) {
      let text = '';
      try {
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.text || '';
        const subject = parsed.subject || '';
        const body = [parsed.text, parsed.html].filter(Boolean).join(' ');
        text = [from, subject, body].join(' ');
      } catch {
        text = [msg.envelope?.from?.map(x=>x.address).join(' '), msg.envelope?.subject, String(msg.source || '')].join(' ');
      }
      const code = extractTikTokCode(text);
      if (code) return code;
    }
    return '';
  } finally {
    try { await client.logout(); } catch {}
  }
}

async function getMicrosoftTikTokCodeImap(email, refreshToken, clientId){
  if (!ImapFlow || !simpleParser) throw new Error('Thiếu thư viện imapflow/mailparser. Hãy chạy npm install sau khi cập nhật package.json.');
  const candidates = await getMicrosoftImapAccessTokenCandidates(refreshToken, clientId);
  const errors = [];
  for (const c of candidates) {
    try {
      const code = await readTikTokCodeByImapAccessToken(email, c.accessToken);
      if (code) return code;
    } catch (e) {
      errors.push(`${c.label}: ${e.message || e}`);
      continue;
    }
  }
  if (errors.length) throw new Error(errors.slice(0,4).join(' | '));
  return '';
}

async function getMicrosoftTikTokCode(email, refreshToken, clientId){
  if (!email || !refreshToken || !clientId) throw new Error('thiếu email/token/clientId');
  // v71 tối ưu tốc độ theo debug log:
  // 1) IMAP primary: consumers + outlook.office.com/IMAP.AccessAsUser.All offline_access
  // 2) Nếu IMAP fail: Outlook REST primary endpoint /me/messages
  // Bỏ Graph và các scope/endpoint phụ khỏi luồng chính để tránh chậm.
  let imapErr = '';
  try {
    const code = await getMicrosoftTikTokCodeImap(email, refreshToken, clientId);
    if (code) return code;
  } catch (e) {
    imapErr = e.message || String(e);
  }
  try {
    const code = await getMicrosoftTikTokCodeOutlookRest(email, refreshToken, clientId);
    if (code) return code;
    if (imapErr) throw new Error('Không thấy mail TikTok mới. IMAP primary: ' + imapErr);
    return '';
  } catch (e) {
    const restErr = e.message || String(e);
    throw new Error([imapErr && ('IMAP primary: ' + imapErr), 'Outlook REST primary: ' + restErr].filter(Boolean).join(' | '));
  }
}


app.post('/IphoneTool/SendName', async (req,res)=>{
  const name = String(req.body.name || '').trim();
  const mode = String(req.body.mode || 'user').trim();
  const slot = String(req.body.slot || req.query.slot || '').trim();
  const udid = cleanUdid(req.body.udid || req.query.udid || req.body.device || req.query.device || slot || currentTargetUdid(req, res));
  const toolId = cleanToolId(req.body.toolId || req.query.toolId || currentToolId(req, res));
  if (!name) return res.json({status:false, message:'Tên gửi sang iPhone Tool đang trống.'});

  // Mỗi iPhone Tool trên mỗi máy tính phải có toolId riêng.
  // Nếu cắm nhiều iPhone cùng một máy, phải gửi kèm UDID/slot để tool đổi đúng thiết bị.
  const payload = { name, mode, slot: udid || slot, udid, toolId, createdAt: new Date().toISOString() };
  const q = read('iphoneQueue');
  q.push(payload);
  write('iphoneQueue', q.slice(-500));
  return res.json({
    status:true,
    queued:true,
    toolId,
    message:`Đã gửi lệnh đổi tên vào iPhone Tool ${toolId}${udid ? ' • UDID: '+udid : ''}. Tên: ${name}`
  });
});
app.get('/IphoneTool/Queue',(req,res)=>res.json(read('iphoneQueue')));
app.post('/IphoneTool/PopQueue',(req,res)=>{
  const reqTool = cleanToolId(req.body.toolId || req.query.toolId || req.headers['x-tool-id'] || '');
  const q = read('iphoneQueue');
  let idx = -1;
  if (reqTool && reqTool !== 'default') {
    idx = q.findIndex(x => cleanToolId(x && x.toolId) === reqTool);
  } else {
    // Tool cũ/không có mã chỉ được lấy lệnh cũ không gắn toolId, không lấy nhầm lệnh của máy khác.
    idx = q.findIndex(x => !x || !x.toolId);
  }
  const item = idx >= 0 ? q.splice(idx, 1)[0] : null;
  write('iphoneQueue', q);
  res.json({status:true,item,toolId:reqTool || 'default'});
});

app.get('/Settings', (req,res)=>{
 const s=domainSettings(req);
 const body = `<div class="quick-grid"><a class="quick" href="/Video/AddVideo">🎬<span>Thêm Video</span></a><a class="quick" href="/Link/AddLink">🔗<span>Thêm Link</span></a><a class="quick" href="/Account/AddAccount">👤<span>Thêm Tài khoản</span></a><a class="quick" href="/otp">🔐<span>User | 2FA</span></a><a class="quick" href="/thue-otp-sim">📱<span>Thuê OTP SIM</span></a></div>`+
 card('📬 Cài đặt đọc mail', `<form method="post" action="/Settings/mail"><label>Phương thức đọc mail</label><select name="mailMethod"><option ${s.mailMethod==='OAuth2'?'selected':''}>OAuth2</option><option ${s.mailMethod==='Graph API'?'selected':''}>Graph API</option><option ${s.mailMethod==='Mail TM'?'selected':''}>Mail TM</option><option ${s.mailMethod==='FakeEmail'?'selected':''}>FakeEmail</option></select><button class="btn primary wide">💾 Lưu cài đặt Mail</button></form>`)+
 card('📲 iPhone Tool', `<div class="notice">Mã iPhone Tool giờ được tự sinh và lưu riêng trong phần mềm iPhone Tool trên từng máy tính. Web không lưu mã Tool theo domain nữa để tránh máy này đổi ảnh hưởng máy khác.</div>`)+
 card('⚡ Copy nhanh / Mail rút tiền', `<form method="post" action="/Settings/quick-copy"><label>Nội dung copy nhanh trong User | 2FA</label><textarea name="quickCopyText" rows="3" placeholder="Nhập bất kỳ nội dung nào cần copy nhanh">${esc(s.quickCopyText||'')}</textarea><label>Mail rút tiền gốc</label><input name="withdrawEmailBase" value="${esc(s.withdrawEmailBase||'')}" placeholder="zxcvb@gmail.com"><small class="muted">Ví dụ zxcvb@gmail.com sẽ random dạng z.xcvb+tiktoktool001@gmail.com.</small><button class="btn primary wide">💾 Lưu copy nhanh / mail rút tiền</button></form>`)+
 card('🔒 Bảo vệ bằng mật khẩu', `<form method="post" action="/Settings/security"><label class="switch"><span>Bật bảo vệ bằng mật khẩu</span><input type="checkbox" name="passwordEnabled" ${s.passwordEnabled?'checked':''}></label><label>Mật khẩu</label><input type="password" name="accessPassword" placeholder="Nhập mật khẩu mới (để trống để giữ nguyên)"><small class="muted">Mật khẩu hiện tại: ${esc(s.accessPassword || 'zx')}</small><button class="btn primary wide">💾 Lưu cài đặt bảo vệ</button></form>`)+
 card('☁️ Cài đặt iCloud', `<form method="post" action="/Settings/icloud"><label>Tài khoản iCloud</label><div class="copy-row"><input name="icloudEmail" value="${esc(s.icloudEmail)}"><button type="button" onclick="copyValue(this)">📋</button></div><label>Mật khẩu iCloud</label><div class="copy-row"><input name="icloudPassword" value="${esc(s.icloudPassword)}"><button type="button" onclick="copyValue(this)">📋</button></div><button class="btn primary wide">💾 Lưu thông tin iCloud</button></form>`)+
 card('👁️ Cài đặt hiển thị', `<form method="post" action="/Settings/display">${[['showVideos','Danh sách Video'],['showAccount','Thông tin Tài khoản'],['showEmail','Email/Link nhanh'],['showIcloud','Thông tin iCloud']].map(([k,l])=>`<label class="switch"><span>${l}</span><input type="checkbox" name="${k}" ${s[k]?'checked':''}></label>`).join('')}<button class="btn primary wide">💾 Lưu cài đặt hiển thị</button></form>`);
 res.send(layout('Cài đặt hệ thống', body, 'settings'));
});
app.post('/Settings/mail',(req,res)=>{ const s=domainSettings(req); s.mailMethod=req.body.mailMethod||s.mailMethod; writeDomainSettings(req,s); res.redirect('/Settings'); });
app.post('/Settings/iphone-tool',(req,res)=>{ const toolId=cleanToolId(req.body.renameToolId || req.query.toolId || req.query.tool || 'default'); const targetUdid=cleanUdid(req.body.targetUdid || ''); res.cookie('qf_tool_id', toolId, { maxAge: 365*24*60*60*1000, httpOnly:false, sameSite:'Lax' }); if(targetUdid) res.cookie('qf_rename_udid', targetUdid, { maxAge: 365*24*60*60*1000, httpOnly:false, sameSite:'Lax' }); else res.clearCookie('qf_rename_udid'); res.redirect('/Settings'); });
app.post('/Settings/quick-copy',(req,res)=>{ const s=domainSettings(req); s.quickCopyText=String(req.body.quickCopyText||''); s.withdrawEmailBase=String(req.body.withdrawEmailBase||'').replace(/\s+/g,'').trim(); writeDomainSettings(req,s); res.redirect('/Settings'); });
app.post('/Settings/security',(req,res)=>{ const s=domainSettings(req); s.passwordEnabled=!!req.body.passwordEnabled; const pw=String(req.body.accessPassword||'').trim(); if(pw) s.accessPassword=pw; if(!s.accessPassword) s.accessPassword='zx'; writeDomainSettings(req,s); if(!s.passwordEnabled){ res.setHeader('Set-Cookie','qf_auth=; Path=/; Max-Age=0; SameSite=Lax'); } res.redirect('/Settings'); });
app.post('/Settings/icloud',(req,res)=>{ const s=domainSettings(req); s.icloudEmail=req.body.icloudEmail||''; s.icloudPassword=req.body.icloudPassword||''; writeDomainSettings(req,s); res.redirect('/Settings'); });
app.post('/Settings/display',(req,res)=>{ const s=domainSettings(req); ['showVideos','showAccount','showEmail','showIcloud'].forEach(k=>s[k]=!!req.body[k]); writeDomainSettings(req,s); res.redirect('/Settings'); });

app.get('/Account/AddAccount',(req,res)=>{ const accounts=readDomainArray(req, 'accounts'); const body=card('👤 Thêm tài khoản', `<form method="post"><label>Nhập danh sách tài khoản, mỗi dòng một tài khoản</label><textarea name="accounts" rows="12" placeholder="Mỗi dòng một tài khoản
user|pass|secret2FA
401|user|@handle|hotmail|pass|refreshToken|clientId
user pass email time Emailfake@">${esc(accounts.join('\n'))}</textarea><small class="muted">Danh sách lưu riêng cho domain hiện tại. Lấy hết tài khoản thì trang chủ sẽ báo không còn tài khoản mới để lấy.</small><button class="btn primary wide">💾 Lưu tài khoản</button></form>`); res.send(layout('Thêm tài khoản',body,'settings')); });
app.post('/Account/AddAccount',(req,res)=>{
  const lines=String(req.body.accounts||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const clean=[];
  for(const l of lines){ if(!clean.includes(l)) clean.push(l); }
  // Lưu đúng nội dung trong ô nhập. Không dùng danh sách used nữa vì lấy dòng nào là xóa dòng đó khỏi kho.
  writeDomainArray(req, 'accounts', clean);
  writeDomainArray(req, 'used', []);
  res.redirect('/?saved=account');
});
app.get('/Account/Clear',(req,res)=>{ writeDomainArray(req, 'accounts', []); writeDomainArray(req, 'used', []); writeDomainObject(req, 'currentPicks', {}); res.redirect('/Account/AddAccount'); });



function shortcutInstallUrl(kind){
  // v76: hardcode link phím tắt 180p, không phụ thuộc biến môi trường Render nữa.
  const map = {
    tiktok180: 'https://www.icloud.com/shortcuts/c58c5d740984496a9027af8b37aedace',
    lite180: 'https://www.icloud.com/shortcuts/0571badcac4d4fc1bf42a3bc98c9f227',
    tiktok60: '',
    lite60: '',
    tiktok10: '',
    lite10: ''
  };
  return map[kind] || '';
}
function isAndroidReq(req){
  return /Android/i.test(String(req.headers['user-agent'] || ''));
}
function shortcutPage(req, res, title, apiPath, directPath, kind, autoPath){
  const base = `${req.protocol}://${req.get('host')}`;
  const install = shortcutInstallUrl(kind);
  const installBtn = install
    ? `<a class="btn primary wide huge-btn" href="${esc(install)}">📲 Thêm phím tắt iPhone</a>`
    : `<a class="btn primary wide huge-btn" href="shortcuts://">📲 Mở ứng dụng Phím tắt</a>`;
  const body = card('⏱️ '+esc(title), `
    ${installBtn}
    <div class="field"><label>API JSON dùng trong Phím tắt</label><div class="copy-row"><input readonly value="${esc(base+apiPath)}"><button onclick="copyValue(this)">📋</button></div></div>
    <div class="field"><label>Link mở ngẫu nhiên 1 video</label><div class="copy-row"><input readonly value="${esc(base+directPath)}"><button onclick="copyValue(this)">📋</button></div></div>
    <div class="shortcut-hero-box"><b>Android:</b> nếu bấm bằng Android sẽ tự chuyển sang chế độ mở link random 60 phút, tổng 3 lần cho gói 180p.</div>
    <a class="btn soft wide huge-btn" href="${esc(autoPath)}">🤖 Mở chế độ Android 180p</a>
    <a class="btn soft wide" href="/">← Quay lại trang chủ</a>
  `);
  res.send(layout(title, body, 'home'));
}
app.get('/Shortcut/TikTok180',(req,res)=>{
  if (isAndroidReq(req)) return autoAndroidPage(req,res,'TikTok 180p Android: tự mở 3 lần, mỗi 60 phút','/api/RandomTiktok60',3600,3);
  return shortcutPage(req,res,'Treo 180p TikTok','/api/RandomTiktok180','/r/RandomTiktok180','tiktok180','/Auto/TikTok180');
});
app.get('/Shortcut/TikTokLite180',(req,res)=>{
  if (isAndroidReq(req)) return autoAndroidPage(req,res,'TikTok Lite 180p Android: tự mở 3 lần, mỗi 60 phút','/api/RandomTiktokLite60',3600,3);
  return shortcutPage(req,res,'Treo 180p TikTok Lite','/api/RandomTiktokLite180','/r/RandomTiktokLite180','lite180','/Auto/TikTokLite180');
});
app.get('/Shortcut/TikTok60',(req,res)=> res.redirect('/r/RandomTiktok60'));
app.get('/Shortcut/TikTokLite60',(req,res)=> res.redirect('/r/RandomTiktokLite60'));
function autoAndroidPage(req,res,title,apiPath,waitSeconds,maxRuns=0){
  const runsText = maxRuns ? `Tổng ${maxRuns} lần. Sau mỗi lần sẽ chờ 60 phút rồi mở link tiếp theo.` : 'Trang này sẽ tiếp tục theo chu kỳ nếu trình duyệt còn giữ trang.';
  const body = card('🤖 '+esc(title), `
    <div class="notice ok"><b>Chế độ Android</b><br>${runsText}<br>Video 180p trên Android dùng link random 60p và chạy 3 lượt.</div>
    <div class="big-result" id="autoCount">Chuẩn bị mở lượt 1${maxRuns ? '/' + maxRuns : ''}...</div>
    <button class="btn primary wide huge-btn" id="openNowBtn">▶ Bắt đầu / mở ngay</button>
    <a class="btn soft wide" href="/">← Quay lại</a>
    <script>
      const API=${JSON.stringify(apiPath)};
      const WAIT=${Number(waitSeconds)||3600};
      const MAX_RUNS=${Number(maxRuns)||0};
      let next=3;
      let opened=0;
      let running=true;
      async function openRandom(){
        if(MAX_RUNS && opened>=MAX_RUNS){
          running=false;
          document.getElementById('autoCount').textContent='Đã hoàn tất '+opened+'/'+MAX_RUNS+' lượt.';
          return;
        }
        try{
          const r=await fetch(API);
          const d=await r.json();
          const url=d && (d.url||d.data);
          if(!url) throw new Error('API chưa trả link video');
          opened++;
          document.getElementById('autoCount').textContent='Đã mở lượt '+opened+(MAX_RUNS?'/'+MAX_RUNS:'')+'. Lượt tiếp theo sau '+WAIT+' giây.';
          const w=window.open(url, '_blank');
          if(!w){ location.href=url; return; }
          next=WAIT;
          if(MAX_RUNS && opened>=MAX_RUNS){
            running=false;
            document.getElementById('autoCount').textContent='Đã mở đủ '+opened+'/'+MAX_RUNS+' lượt.';
          }
        } catch(e){ document.getElementById('autoCount').textContent='Lỗi: '+e.message; }
      }
      document.getElementById('openNowBtn').onclick=function(){ next=0; openRandom(); };
      setInterval(()=>{
        if(!running) return;
        next--;
        document.getElementById('autoCount').textContent='Tự mở lượt '+(opened+1)+(MAX_RUNS?'/'+MAX_RUNS:'')+' sau '+Math.max(0,next)+' giây';
        if(next<=0) openRandom();
      },1000);
    </script>
  `);
  res.send(layout(title, body, 'home'));
}
app.get('/Auto/TikTok180',(req,res)=>autoAndroidPage(req,res,'TikTok 180p tự mở mỗi 60 phút','/api/RandomTiktok60',3600,3));
app.get('/Auto/TikTokLite180',(req,res)=>autoAndroidPage(req,res,'TikTok Lite 180p tự mở mỗi 60 phút','/api/RandomTiktokLite60',3600,3));
app.get('/Auto/TikTok60',(req,res)=>autoAndroidPage(req,res,'TikTok 60p tự mở mỗi 60 phút','/api/RandomTiktok60',3600,1));
app.get('/Auto/TikTokLite60',(req,res)=>autoAndroidPage(req,res,'TikTok Lite 60p tự mở mỗi 60 phút','/api/RandomTiktokLite60',3600,1));

app.get('/Video/AddVideo',(req,res)=>{
  const store=readVideoStore();
  const options=Object.entries(VIDEO_TYPES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('');
  const groups=Object.entries(VIDEO_TYPES).map(([k,v])=>{
    const list=store[k]||[];
    return `<h3>${esc(v.label)} <small class="muted">${list.length} link</small></h3><div class="list">${list.map((url,i)=>`<div class="list-item"><span>${esc(url)}</span><a href="/Video/Delete/${k}/${i}">🗑️</a></div>`).join('')||'<div class="empty">Chưa có video.</div>'}</div>`;
  }).join('');
  const body=card('🎬 Thêm video vào API', `<form method="post"><label>Loại video</label><select name="type">${options}</select><label>Danh sách link, mỗi link 1 dòng</label><textarea name="videos" rows="7" placeholder="Dán mỗi dòng 1 link. Nếu chọn TikTok Lite, hệ thống sẽ tự đổi các link TikTok thường đã có mapping sang lite.tiktok.com/t/..."></textarea><small class="muted">TikTok Lite: nếu link thường đã có short-link Lite trong hệ thống thì sẽ tự chuyển. Link chưa có mapping sẽ giữ làm fallback.</small><button class="btn primary wide">💾 Lưu vào API</button></form>`)+card('📋 Danh sách video theo API', groups);
  res.send(layout('Thêm Video',body,'settings'));
});
app.post('/Video/AddVideo',(req,res)=>{
  const type=VIDEO_TYPES[req.body.type] ? req.body.type : 'tiktok60';
  const vs=String(req.body.videos||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(normalizeVideoUrl).filter(Boolean);
  const store=readVideoStore();
  for(const v of vs) if(!store[type].includes(v)) store[type].push(v);
  writeVideoStore(store);
  res.redirect('/Video/AddVideo');
});
app.get('/Video/Delete/:type/:i',(req,res)=>{
  const store=readVideoStore();
  const type=VIDEO_TYPES[req.params.type] ? req.params.type : 'tiktok60';
  store[type].splice(Number(req.params.i),1);
  writeVideoStore(store);
  res.redirect('/Video/AddVideo');
});


const DEFAULT_TIKTOK_60_180_LINKS = [
  'https://www.tiktok.com/@acc.tiktok614/video/7641537801594408200',
  'https://www.tiktok.com/@acc.tiktok614/video/7641537021340601621',
  'https://www.tiktok.com/@acc.tiktok614/video/7641536907662396693',
  'https://www.tiktok.com/@acc.tiktok614/video/7641529211777223956',
  'https://www.tiktok.com/@acc.tiktok614/video/7641529133813583125',
  'https://www.tiktok.com/@acc.tiktok614/video/7641529055820516629',
  'https://www.tiktok.com/@acc.tiktok614/video/7641528893987458312',
  'https://www.tiktok.com/@acc.tiktok614/video/7641526131258068240',
  'https://www.tiktok.com/@acc.tiktok614/video/7641525895164890384',
  'https://www.tiktok.com/@acc.tiktok614/video/7641525753384832257',
  'https://www.tiktok.com/@acc.tiktok614/video/7641525681662201105',
  'https://www.tiktok.com/@acc.tiktok614/video/7641511698179951873',
  'https://www.tiktok.com/@acc.tiktok614/video/7641511580173208848',
  'https://www.tiktok.com/@acc.tiktok614/video/7641511305819475216',
  'https://www.tiktok.com/@acc.tiktok614/video/7641433858394770709',
  'https://www.tiktok.com/@acc.tiktok614/video/7641538045031779602',
  'https://www.tiktok.com/@acc.tiktok614/video/7641537972805881096',
  'https://www.tiktok.com/@acc.tiktok614/video/7641567213220007186',
  'https://www.tiktok.com/@acc.tiktok614/video/7641567168508841224',
  'https://www.tiktok.com/@acc.tiktok614/video/7641567085427969298',
  'https://www.tiktok.com/@acc.tiktok614/video/7641566922881944833'
];
const DEFAULT_TIKTOK_10_LINKS = [
  'https://www.tiktok.com/@acc.tiktok614/video/7641538045031779602',
  'https://www.tiktok.com/@acc.tiktok614/video/7641537972805881096',
  'https://www.tiktok.com/@acc.tiktok614/video/7641567213220007186',
  'https://www.tiktok.com/@acc.tiktok614/video/7641567168508841224',
  'https://www.tiktok.com/@acc.tiktok614/video/7641567085427969298',
  'https://www.tiktok.com/@acc.tiktok614/video/7641566922881944833'
];
const DEFAULT_TIKTOK_LITE_60_180_LINKS = [
  'https://lite.tiktok.com/t/ZSkAVFkcQ/',
  'https://lite.tiktok.com/t/ZSkA4vR7/',
  'https://lite.tiktok.com/t/ZSkA4vERA/',
  'https://lite.tiktok.com/t/ZSkA4791W/',
  'https://lite.tiktok.com/t/ZSkA4tBcN/',
  'https://lite.tiktok.com/t/ZSkAVJYn1/'
];
const DEFAULT_TIKTOK_LITE_10_LINKS = DEFAULT_TIKTOK_LITE_60_180_LINKS;

// Bảng quy đổi link TikTok thường → link TikTok Lite đã biết.
// Lưu ý: lite.tiktok.com/t/... là short-link riêng, không thể suy ra chính xác 100% chỉ từ video_id.
// Với các video đã có link Lite, hệ thống sẽ tự đổi. Link chưa có mapping sẽ giữ link gốc làm fallback.
const TIKTOK_TO_LITE_MAP = {
  '7641538045031779602': 'https://lite.tiktok.com/t/ZSkAVFkcQ/',
  '7641537972805881096': 'https://lite.tiktok.com/t/ZSkA4vR7/',
  '7641567213220007186': 'https://lite.tiktok.com/t/ZSkA4vERA/',
  '7641567168508841224': 'https://lite.tiktok.com/t/ZSkA4791W/',
  '7641567085427969298': 'https://lite.tiktok.com/t/ZSkA4tBcN/',
  '7641566922881944833': 'https://lite.tiktok.com/t/ZSkAVJYn1/'
};
function builtinVideoList(envKey){
  if (/LITE/i.test(envKey) && /10/i.test(envKey)) return DEFAULT_TIKTOK_LITE_10_LINKS;
  if (/LITE/i.test(envKey)) return DEFAULT_TIKTOK_LITE_60_180_LINKS;
  if (/10/i.test(envKey)) return DEFAULT_TIKTOK_10_LINKS;
  return DEFAULT_TIKTOK_60_180_LINKS;
}
function extractTikTokVideoId(url){
  const m = String(url || '').match(/\/video\/(\d+)/i);
  return m ? m[1] : '';
}
function applyTemplate(tpl, url){
  const id = extractTikTokVideoId(url);
  return String(tpl || '').replace(/\{id\}/g, id).replace(/\{url\}/g, encodeURIComponent(url));
}
function makeTikTokAppUrl(url){
  // TikTok thường. Web URL vẫn là fallback ổn nhất, nhưng có thể đổi bằng env nếu cần.
  const tpl = process.env.TIKTOK_APP_OPEN_TEMPLATE || '';
  return tpl ? applyTemplate(tpl, url) : url;
}
function makeLiteOpenUrl(url){
  // TikTok Lite dùng link lite.tiktok.com/t/... để iPhone mở đúng theo Universal Link.
  // Nếu cần thử scheme riêng thì đặt TIKTOK_LITE_OPEN_TEMPLATE trên Render.
  const tpl = process.env.TIKTOK_LITE_OPEN_TEMPLATE || '';
  return tpl ? applyTemplate(tpl, url) : url;
}

function normalizeVideoUrl(u){
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) return '';
  return u;
}
function normalizeVideoUrlForType(u, type){
  u = normalizeVideoUrl(u);
  if (!u) return '';
  const isLiteType = /^lite/i.test(String(type || ''));
  if (!isLiteType) return u;
  if (/lite\.tiktok\.com\/t\//i.test(u)) return u;
  const id = extractTikTokVideoId(u);
  if (id && TIKTOK_TO_LITE_MAP[id]) return TIKTOK_TO_LITE_MAP[id];
  // Không có short-link Lite tương ứng thì giữ fallback để không mất link.
  return u;
}
function parseVideoListText(text){
  text = String(text || '').trim();
  if (!text) return [];
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j.map(normalizeVideoUrl).filter(Boolean);
    if (j && Array.isArray(j.data)) return j.data.map(normalizeVideoUrl).filter(Boolean);
  } catch {}
  return text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#')).map(normalizeVideoUrl).filter(Boolean);
}
async function loadVideosFromSource(envKey, fallbackLocal = true){
  const type = videoTypeFromEnvKey(envKey);
  const local = fallbackLocal ? (readVideoStore()[type] || []).map(normalizeVideoUrl).filter(Boolean) : [];
  const builtin = builtinVideoList(envKey).map(normalizeVideoUrl).filter(Boolean);
  const source = process.env[envKey];
  if (source) {
    const r = await fetch(source, { headers: { 'user-agent':'QuangFunShortcut/1.0' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('Không đọc được nguồn video: '+r.status);
    const remote = parseVideoListText(await r.text());
    return uniqList([...local, ...remote, ...builtin]);
  }
  return uniqList([...local, ...builtin]);
}
async function randomVideoResponse(req,res,envKey,label){
  try {
    const list = await loadVideosFromSource(envKey, true);
    if (!list.length) return res.status(404).json({ status:false, message:'Chưa có link video cho '+label });
    const webUrl = list[Math.floor(Math.random()*list.length)];
    const appUrl = /lite/i.test(label) ? makeLiteOpenUrl(webUrl) : makeTikTokAppUrl(webUrl);
    // data là URL Shortcut sẽ mở. webUrl là link web fallback nếu app scheme không mở.
    return res.json({ status:'success', data:appUrl, url:appUrl, webUrl, fallback:webUrl, videoId:extractTikTokVideoId(webUrl), label, total:list.length });
  } catch(e) {
    return res.status(500).json({ status:false, message:e.message });
  }
}
async function randomVideoRedirect(req,res,envKey,label){
  try {
    const list = await loadVideosFromSource(envKey, true);
    if (!list.length) return res.redirect('/Video/AddVideo');
    const webUrl = list[Math.floor(Math.random()*list.length)];
    const appUrl = /lite/i.test(label) ? makeLiteOpenUrl(webUrl) : makeTikTokAppUrl(webUrl);
    return res.redirect(appUrl || webUrl);
  } catch(e) {
    return res.status(500).send('Không lấy được video: '+esc(e.message));
  }
}

// API cho iPhone Shortcut: chỉ gọi domain của bạn, không lộ raw GitHub trong phím tắt.
app.get('/api/RandomTiktok', (req,res)=>randomVideoResponse(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/api/RandomTiktok60', (req,res)=>randomVideoResponse(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/api/RandomTiktok180', (req,res)=>randomVideoResponse(req,res,'TIKTOK_180_SOURCE_URL','TikTok 180p'));
app.get('/api/RandomTiktok10', (req,res)=>randomVideoResponse(req,res,'TIKTOK_10_SOURCE_URL','TikTok 10p'));
app.get('/api/RandomTiktokLite', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/RandomTiktokLite60', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/RandomTiktokLite180', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/api/RandomTiktokLite10', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));
// Alias không phân biệt hoa/thường để Shortcut nhập nhầm vẫn chạy.
app.get('/api/RandomTiktoklite', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/RandomTiktoklite60', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/RandomTiktoklite180', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/api/RandomTiktoklite10', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));
app.get('/api/randomtiktoklite', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/randomtiktoklite60', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/randomtiktoklite180', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/api/randomtiktoklite10', (req,res)=>randomVideoResponse(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));

async function randomVideoText(req,res,envKey,label){
  try {
    const list = await loadVideosFromSource(envKey, true);
    if (!list.length) return res.status(404).type('text/plain').send('');
    const webUrl = list[Math.floor(Math.random()*list.length)];
    const appUrl = /lite/i.test(label) ? makeLiteOpenUrl(webUrl) : makeTikTokAppUrl(webUrl);
    return res.type('text/plain').send(appUrl || webUrl);
  } catch(e) {
    return res.status(500).type('text/plain').send('');
  }
}
app.get('/api/text/RandomTiktok', (req,res)=>randomVideoText(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/api/text/RandomTiktok60', (req,res)=>randomVideoText(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/api/text/RandomTiktok180', (req,res)=>randomVideoText(req,res,'TIKTOK_180_SOURCE_URL','TikTok 180p'));
app.get('/api/text/RandomTiktok10', (req,res)=>randomVideoText(req,res,'TIKTOK_10_SOURCE_URL','TikTok 10p'));
app.get('/api/text/RandomTiktokLite', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/text/RandomTiktokLite60', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/text/RandomTiktokLite180', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/api/text/RandomTiktokLite10', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));
app.get('/api/text/RandomTiktoklite', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/text/RandomTiktoklite60', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/api/text/RandomTiktoklite180', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/api/text/RandomTiktoklite10', (req,res)=>randomVideoText(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));

app.get('/r/RandomTiktok', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/r/RandomTiktok60', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/r/RandomTiktok180', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_180_SOURCE_URL','TikTok 180p'));
app.get('/r/RandomTiktok10', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_10_SOURCE_URL','TikTok 10p'));
app.get('/r/RandomTiktokLite', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/r/RandomTiktokLite60', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/r/RandomTiktokLite180', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/r/RandomTiktokLite10', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));
app.get('/r/RandomTiktoklite', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/r/RandomTiktoklite60', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/r/RandomTiktoklite180', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/r/RandomTiktoklite10', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));
app.get('/r/randomtiktoklite', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/r/randomtiktoklite60', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_60_SOURCE_URL','TikTok Lite 60p'));
app.get('/r/randomtiktoklite180', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_180_SOURCE_URL','TikTok Lite 180p'));
app.get('/r/randomtiktoklite10', (req,res)=>randomVideoRedirect(req,res,'TIKTOK_LITE_10_SOURCE_URL','TikTok Lite 10p'));

app.get('/Home/GetRandomVideo',(req,res)=>randomVideoRedirect(req,res,'TIKTOK_60_SOURCE_URL','TikTok 60p'));
app.get('/Home/GetRandomVideo10',(req,res)=>randomVideoRedirect(req,res,'TIKTOK_10_SOURCE_URL','TikTok 10p'));

app.get('/Link/AddLink',(req,res)=>{ const links=read('links'); const body=card('🔗 Thêm link', `<form method="post"><label>Link</label><input name="link" placeholder="Nhập link"><button class="btn primary wide">💾 Lưu link</button></form>`)+card('📋 Danh sách link', `<button class="btn soft wide" onclick="copyText(${JSON.stringify(links.join('\n'))})">📋 Copy tất cả</button><div class="list">${links.map((l,i)=>`<div class="list-item"><span>${esc(l)}</span><a href="/Link/Delete/${i}">🗑️</a></div>`).join('')||'<div class="empty">Chưa có link.</div>'}</div>${btn('/Link/Clear','🗑️ Xóa tất cả','danger')}`); res.send(layout('Thêm Link',body,'settings')); });
app.post('/Link/AddLink',(req,res)=>{ const links=read('links'); const l=String(req.body.link||'').trim(); if(l && !links.includes(l)) links.push(l); write('links',links); res.redirect('/Link/AddLink'); });
app.get('/Link/Delete/:i',(req,res)=>{ const l=read('links'); l.splice(Number(req.params.i),1); write('links',l); res.redirect('/Link/AddLink'); });
app.get('/Link/Clear',(req,res)=>{ write('links',[]); res.redirect('/Link/AddLink'); });

app.get('/otp',(req,res)=>{ const list=readDomainArray(req, 'user2fa'); const s=domainSettings(req); const quickCopyHtml = `<div class="field quick-copy-box"><label>Copy nhanh</label><div class="quick-copy-row"><input id="quickCopyText" readonly value="${esc(s.quickCopyText||'')}" placeholder="Chưa cài nội dung copy nhanh"><button class="input-copy" type="button" data-copy-input="quickCopyText" title="Copy nhanh">📋</button></div></div>`; const body=card('🔐 User | 2FA', quickCopyHtml + `<form method="post"><label>Nhập nhanh user|2FA</label><div class="input-action-row"><button class="input-clear" type="button" data-clear-input="u2faCombined" title="Xóa dòng nhập nhanh">✕</button><input id="u2faCombined" name="combined" placeholder="karissapaul0|3RFA... hoặc karissapaul0 3RFA..."><button class="input-paste" type="button" data-paste-input="u2faCombined" title="Dán vào dòng nhập nhanh">📥</button><button class="input-copy" type="button" data-copy-input="u2faCombined" title="Copy dòng nhập nhanh">📋</button></div><small class="hint">Dán định dạng user|2FA hoặc user 2FA, hệ thống tự tách xuống 2 dòng bên dưới.</small><label>User</label><div class="input-action-row"><button class="input-clear" type="button" data-clear-input="u2faUser" title="Xóa User">✕</button><input id="u2faUser" name="user" placeholder="username"><button class="input-paste" type="button" data-paste-input="u2faUser" title="Dán User">📥</button><button class="input-copy" type="button" data-copy-input="u2faUser" title="Copy User">📋</button></div><label>Secret 2FA</label><div class="input-action-row"><button class="input-clear" type="button" data-clear-input="u2faSecret" title="Xóa Secret 2FA">✕</button><input id="u2faSecret" name="secret" placeholder="JBSWY3DPEHPK3PXP"><button class="input-paste" type="button" data-paste-input="u2faSecret" title="Dán Secret 2FA">📥</button><button class="input-copy" type="button" data-copy-input="u2faSecret" title="Copy Secret 2FA">📋</button></div><div class="otpbox"><div><b>Mã 2FA</b><small class="otp-remain">${remain()}s</small></div><div class="otpcode" id="u2faLiveOtp">------</div><button type="button" onclick="copyText(document.getElementById('u2faLiveOtp').textContent)">📋</button></div><div class="btn-grid"><button class="btn primary" type="submit">💾 Lưu user|2FA</button></div></form>`)+card('📋 Danh sách', `<div class="btn-grid"><a class="btn soft" href="/otp/export">📤 Xuất TXT</a></div><div class="list">${list.map((x,i)=>{ const row = x.secret ? (x.user+'|'+x.secret) : x.user; const label = x.secret ? (esc(x.user)+' | '+esc(x.secret)) : esc(x.user); return `<div class="list-item compact"><a class="row-remove" href="/otp/delete/${i}" title="Xóa dòng này">✕</a><div class="row-value">${label}</div><div class="row-actions"><button class="row-copy" type="button" data-copy="${esc(row)}" title="Copy dòng này">📋</button></div></div>`; }).join('')||'<div class="empty">Chưa có dữ liệu.</div>'}</div>`); res.send(layout('User | 2FA',body,'otp')); });
app.post('/otp',(req,res)=>{ const list=readDomainArray(req, 'user2fa'); let user=String(req.body.user||'').trim(); let secret=String(req.body.secret||'').trim(); const combined=String(req.body.combined||'').trim(); if(combined){ const parsed=parseUser2faLoose(combined); if(!user && parsed.user) user=parsed.user; if(!secret && parsed.secret) secret=parsed.secret; } if(user){ secret=String(secret||'').replace(/\s/g,'').toUpperCase(); list.push({user, secret}); } writeDomainArray(req, 'user2fa', list); res.redirect('/otp'); });
app.get('/otp/export',(req,res)=>{ const list=readDomainArray(req, 'user2fa'); const txt=list.map(x=>x.secret?`${x.user}|${x.secret}`:String(x.user||'')).join('\n'); res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename="user-2fa.txt"'); res.send(txt); });
app.get('/otp/delete/:i',(req,res)=>{ const l=readDomainArray(req, 'user2fa'); l.splice(Number(req.params.i),1); writeDomainArray(req, 'user2fa', l); res.redirect('/otp'); });
app.get('/api/time',(req,res)=>{ const now=Date.now(); res.setHeader('Cache-Control','no-store'); res.json({now, remaining:remain(), slot:Math.floor(now/30000)}); });
app.get('/api/otp',(req,res)=>{ const now=Date.now(); res.setHeader('Cache-Control','no-store'); res.json({otp:currentOtp(req.query.secret), remaining:remain(), now, slot:Math.floor(now/30000)}); });


const GRIZZLY_API = 'https://api.grizzlysms.com/stubs/handler_api.php';
const FALLBACK_SERVICES = [
  ['lf','TikTok'], ['tk','TikTok / Alt'], ['tg','Telegram'], ['wa','WhatsApp'], ['ig','Instagram'], ['fb','Facebook'], ['go','Google'], ['ot','Other']
];
const FALLBACK_COUNTRIES = [
  ['10','Vietnam'], ['6','Indonesia'], ['187','USA'], ['16','England'], ['22','India'], ['73','Brazil'], ['0','Russia'], ['1','Ukraine']
];
const COUNTRY_META = {
  '0': {name:'Russia', dial:'+7'},
  '1': {name:'Ukraine', dial:'+380'},
  '2': {name:'Kazakhstan', dial:'+7'},
  '3': {name:'China', dial:'+86'},
  '4': {name:'Philippines', dial:'+63'},
  '5': {name:'Myanmar', dial:'+95'},
  '6': {name:'Indonesia', dial:'+62'},
  '7': {name:'Malaysia', dial:'+60'},
  '8': {name:'Kenya', dial:'+254'},
  '9': {name:'Tanzania', dial:'+255'},
  '10': {name:'Vietnam', dial:'+84'},
  '11': {name:'Kyrgyzstan', dial:'+996'},
  '12': {name:'United States', dial:'+1'},
  '13': {name:'Israel', dial:'+972'},
  '14': {name:'Hong Kong', dial:'+852'},
  '15': {name:'Poland', dial:'+48'},
  '16': {name:'England', dial:'+44'},
  '17': {name:'Madagascar', dial:'+261'},
  '18': {name:'DR Congo', dial:'+243'},
  '19': {name:'Nigeria', dial:'+234'},
  '20': {name:'Macao', dial:'+853'},
  '21': {name:'Egypt', dial:'+20'},
  '22': {name:'India', dial:'+91'},
  '23': {name:'Ireland', dial:'+353'},
  '24': {name:'Cambodia', dial:'+855'},
  '25': {name:'Laos', dial:'+856'},
  '26': {name:'Haiti', dial:'+509'},
  '27': {name:'Ivory Coast', dial:'+225'},
  '28': {name:'Gambia', dial:'+220'},
  '29': {name:'Serbia', dial:'+381'},
  '30': {name:'Yemen', dial:'+967'},
  '31': {name:'South Africa', dial:'+27'},
  '32': {name:'Romania', dial:'+40'},
  '33': {name:'Colombia', dial:'+57'},
  '34': {name:'Estonia', dial:'+372'},
  '35': {name:'Azerbaijan', dial:'+994'},
  '36': {name:'Canada', dial:'+1'},
  '37': {name:'Morocco', dial:'+212'},
  '38': {name:'Ghana', dial:'+233'},
  '39': {name:'Argentina', dial:'+54'},
  '40': {name:'Uzbekistan', dial:'+998'},
  '41': {name:'Cameroon', dial:'+237'},
  '42': {name:'Chad', dial:'+235'},
  '43': {name:'Germany', dial:'+49'},
  '44': {name:'Lithuania', dial:'+370'},
  '45': {name:'Croatia', dial:'+385'},
  '46': {name:'Sweden', dial:'+46'},
  '47': {name:'Iraq', dial:'+964'},
  '48': {name:'Netherlands', dial:'+31'},
  '49': {name:'Latvia', dial:'+371'},
  '50': {name:'Austria', dial:'+43'},
  '51': {name:'Belarus', dial:'+375'},
  '52': {name:'Thailand', dial:'+66'},
  '53': {name:'Saudi Arabia', dial:'+966'},
  '54': {name:'Mexico', dial:'+52'},
  '55': {name:'Taiwan', dial:'+886'},
  '56': {name:'Spain', dial:'+34'},
  '57': {name:'Iran', dial:'+98'},
  '58': {name:'Algeria', dial:'+213'},
  '59': {name:'Slovenia', dial:'+386'},
  '60': {name:'Bangladesh', dial:'+880'},
  '61': {name:'Senegal', dial:'+221'},
  '62': {name:'Turkey', dial:'+90'},
  '63': {name:'Czech Republic', dial:'+420'},
  '64': {name:'Sri Lanka', dial:'+94'},
  '65': {name:'Peru', dial:'+51'},
  '66': {name:'Pakistan', dial:'+92'},
  '67': {name:'New Zealand', dial:'+64'},
  '68': {name:'Guinea', dial:'+224'},
  '69': {name:'Mali', dial:'+223'},
  '70': {name:'Venezuela', dial:'+58'},
  '71': {name:'Ethiopia', dial:'+251'},
  '72': {name:'Mongolia', dial:'+976'},
  '73': {name:'Brazil', dial:'+55'},
  '74': {name:'Afghanistan', dial:'+93'},
  '75': {name:'Uganda', dial:'+256'},
  '76': {name:'Angola', dial:'+244'},
  '77': {name:'Cyprus', dial:'+357'},
  '78': {name:'France', dial:'+33'},
  '79': {name:'Papua New Guinea', dial:'+675'},
  '80': {name:'Mozambique', dial:'+258'},
  '81': {name:'Nepal', dial:'+977'},
  '82': {name:'Belgium', dial:'+32'},
  '83': {name:'Bulgaria', dial:'+359'},
  '84': {name:'Hungary', dial:'+36'},
  '85': {name:'Moldova', dial:'+373'},
  '86': {name:'Italy', dial:'+39'},
  '87': {name:'Paraguay', dial:'+595'},
  '88': {name:'Honduras', dial:'+504'},
  '89': {name:'Tunisia', dial:'+216'},
  '90': {name:'Nicaragua', dial:'+505'},
  '91': {name:'Timor-Leste', dial:'+670'},
  '92': {name:'Bolivia', dial:'+591'},
  '93': {name:'Costa Rica', dial:'+506'},
  '94': {name:'Guatemala', dial:'+502'},
  '95': {name:'United Arab Emirates', dial:'+971'},
  '96': {name:'Zimbabwe', dial:'+263'},
  '97': {name:'Puerto Rico', dial:'+1'},
  '98': {name:'Sudan', dial:'+249'},
  '99': {name:'Togo', dial:'+228'},
  '100': {name:'Kuwait', dial:'+965'},
  '101': {name:'El Salvador', dial:'+503'},
  '102': {name:'Libya', dial:'+218'},
  '103': {name:'Jamaica', dial:'+1'},
  '104': {name:'Trinidad and Tobago', dial:'+1'},
  '105': {name:'Ecuador', dial:'+593'},
  '106': {name:'Eswatini', dial:'+268'},
  '107': {name:'Oman', dial:'+968'},
  '108': {name:'Bosnia and Herzegovina', dial:'+387'},
  '109': {name:'Dominican Republic', dial:'+1'},
  '110': {name:'Syria', dial:'+963'},
  '111': {name:'Qatar', dial:'+974'},
  '112': {name:'Panama', dial:'+507'},
  '113': {name:'Cuba', dial:'+53'},
  '114': {name:'Mauritania', dial:'+222'},
  '115': {name:'Sierra Leone', dial:'+232'},
  '116': {name:'Jordan', dial:'+962'},
  '117': {name:'Portugal', dial:'+351'},
  '118': {name:'Barbados', dial:'+1'},
  '119': {name:'Burundi', dial:'+257'},
  '120': {name:'Benin', dial:'+229'},
  '121': {name:'Brunei', dial:'+673'},
  '122': {name:'Bahamas', dial:'+1'},
  '123': {name:'Botswana', dial:'+267'},
  '124': {name:'Belize', dial:'+501'},
  '125': {name:'Central African Republic', dial:'+236'},
  '126': {name:'Dominica', dial:'+1'},
  '127': {name:'Grenada', dial:'+1'},
  '128': {name:'Georgia', dial:'+995'},
  '129': {name:'Greece', dial:'+30'},
  '130': {name:'Guinea-Bissau', dial:'+245'},
  '131': {name:'Guyana', dial:'+592'},
  '132': {name:'Iceland', dial:'+354'},
  '133': {name:'Comoros', dial:'+269'},
  '134': {name:'Saint Kitts and Nevis', dial:'+1'},
  '135': {name:'Liberia', dial:'+231'},
  '136': {name:'Lesotho', dial:'+266'},
  '137': {name:'Malawi', dial:'+265'},
  '138': {name:'Namibia', dial:'+264'},
  '139': {name:'Niger', dial:'+227'},
  '140': {name:'Rwanda', dial:'+250'},
  '141': {name:'Slovakia', dial:'+421'},
  '142': {name:'Suriname', dial:'+597'},
  '143': {name:'Tajikistan', dial:'+992'},
  '144': {name:'Monaco', dial:'+377'},
  '145': {name:'Bahrain', dial:'+973'},
  '147': {name:'Zambia', dial:'+260'},
  '148': {name:'Armenia', dial:'+374'},
  '149': {name:'Somalia', dial:'+252'},
  '150': {name:'Republic of the Congo', dial:'+242'},
  '151': {name:'Chile', dial:'+56'},
  '152': {name:'Burkina Faso', dial:'+226'},
  '153': {name:'Lebanon', dial:'+961'},
  '154': {name:'Gabon', dial:'+241'},
  '155': {name:'Albania', dial:'+355'},
  '156': {name:'Uruguay', dial:'+598'},
  '157': {name:'Mauritius', dial:'+230'},
  '158': {name:'Bhutan', dial:'+975'},
  '159': {name:'Maldives', dial:'+960'},
  '161': {name:'Turkmenistan', dial:'+993'},
  '163': {name:'Finland', dial:'+358'},
  '165': {name:'Luxembourg', dial:'+352'},
  '167': {name:'Equatorial Guinea', dial:'+240'},
  '168': {name:'Djibouti', dial:'+253'},
  '169': {name:'Antigua and Barbuda', dial:'+1'},
  '170': {name:'Cayman Islands', dial:'+1'},
  '171': {name:'Montenegro', dial:'+382'},
  '172': {name:'Denmark', dial:'+45'},
  '173': {name:'Switzerland', dial:'+41'},
  '174': {name:'Norway', dial:'+47'},
  '175': {name:'Australia', dial:'+61'},
  '176': {name:'Eritrea', dial:'+291'},
  '177': {name:'South Sudan', dial:'+211'},
  '178': {name:'Sao Tome and Principe', dial:'+239'},
  '183': {name:'North Macedonia', dial:'+389'},
  '184': {name:'Seychelles', dial:'+248'},
  '186': {name:'Cape Verde', dial:'+238'},
  '187': {name:'United States', dial:'+1'},
  '188': {name:'Palestine', dial:'+970'},
  '189': {name:'Fiji', dial:'+679'},
  '190': {name:'South Korea', dial:'+82'},
  '191': {name:'Japan', dial:'+81'},
  '192': {name:'Singapore', dial:'+65'},
  '193': {name:'Malta', dial:'+356'},
  '194': {name:'Liechtenstein', dial:'+423'},
  '195': {name:'San Marino', dial:'+378'},
  '196': {name:'Vatican City', dial:'+379'},
  '197': {name:'Andorra', dial:'+376'},
  '198': {name:'Faroe Islands', dial:'+298'},
  '199': {name:'Kosovo', dial:'+383'},
  '200': {name:'Curacao', dial:'+599'},
  '201': {name:'Sint Maarten', dial:'+1'},
  '202': {name:'Turks and Caicos Islands', dial:'+1'},
  '203': {name:'British Virgin Islands', dial:'+1'},
  '204': {name:'US Virgin Islands', dial:'+1'},
  '205': {name:'Guam', dial:'+1'},
  '206': {name:'American Samoa', dial:'+1'},
  '207': {name:'Northern Mariana Islands', dial:'+1'},
  '208': {name:'Bermuda', dial:'+1'},
  '209': {name:'Greenland', dial:'+299'},
  '210': {name:'Gibraltar', dial:'+350'},
  '211': {name:'Isle of Man', dial:'+44'},
  '212': {name:'Jersey', dial:'+44'},
  '213': {name:'Guernsey', dial:'+44'},
};
const COUNTRY_DIAL = Object.fromEntries(Object.entries(COUNTRY_META).map(([k,v])=>[k,v.dial]));
function normalizeSimStore(req){
  const s = domainSim(req);
  if (!Array.isArray(s.active)) s.active = [];
  if (!s.activeByClient || typeof s.activeByClient !== 'object') s.activeByClient = {};
  if (!s.service) s.service = 'lf';
  if (!s.country) s.country = '10';
  writeDomainSim(req, s);
  return s;
}
async function grizzly(action, params = {}){
  const qs = new URLSearchParams({ action, ...params });
  const r = await fetch(`${GRIZZLY_API}?${qs.toString()}`, { headers:{ 'user-agent':'QuangFunLocal/1.0' } });
  const text = await r.text();
  try { return { text, json: JSON.parse(text) }; } catch { return { text, json: null }; }
}
function parseOptions(raw, fallback){
  const j = raw && raw.json;
  const out = [];
  if (Array.isArray(j)) {
    for (const item of j) {
      if (Array.isArray(item)) out.push([String(item[0]), String(item[1] || item[0])]);
      else if (item && typeof item === 'object') out.push([String(item.id || item.code || item.key || item.value), String(item.name || item.title || item.label || item.code || item.id)]);
    }
  } else if (j && typeof j === 'object') {
    for (const [k,v] of Object.entries(j)) {
      if (v && typeof v === 'object') out.push([String(v.id || v.code || k), String(v.name || v.title || v.label || k)]);
      else out.push([String(k), String(v)]);
    }
  } else if (raw && raw.text && /^[\s\S]*[:;]/.test(raw.text) && !/^BAD_KEY|NO_/.test(raw.text)) {
    for (const line of raw.text.split(/[\r\n]+/)) {
      const m = line.trim().match(/^([^:;=]+)[:;=](.+)$/);
      if (m) out.push([m[1].trim(), m[2].trim()]);
    }
  }
  const clean = out.filter(x => x[0] && x[1]);
  return clean.length ? clean : fallback;
}
function money(v){
  const n = Number(String(v || '').replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2) + '$';
}
function parsePrices(raw, service){
  const j = raw && raw.json;
  const prices = {};
  if (!j || typeof j !== 'object') return prices;
  for (const [country, val] of Object.entries(j)) {
    let node = val;
    if (node && typeof node === 'object' && service && node[service]) node = node[service];
    if (node && typeof node === 'object') {
      const cost = node.cost ?? node.price ?? node.rate ?? node.sum ?? node.Price;
      const count = node.count ?? node.qty ?? node.quantity ?? node.total ?? node.Count;
      prices[String(country)] = { cost, count };
    } else if (typeof node === 'number' || typeof node === 'string') {
      prices[String(country)] = { cost: node, count: '' };
    }
  }
  return prices;
}
function serviceName(code, services){ return (services.find(x=>String(x[0])===String(code))||[])[1] || code; }
function cleanCountryLabel(id, label){
  const meta = COUNTRY_META[String(id)] || {};
  let name = String(label || '').trim();
  // Nhiều API trả label chỉ là mã số, ví dụ '6', nên ưu tiên tên đã map.
  if (!name || name === String(id) || /^\d+$/.test(name)) name = meta.name || ('Quốc gia mã ' + String(id));
  return name;
}
function countryName(code, countries){
  const raw = (countries.find(x=>String(x[0])===String(code))||[])[1] || code;
  return cleanCountryLabel(code, raw);
}
function countryLabel(id, label, prices){
  const meta = COUNTRY_META[String(id)] || {};
  const parts = [cleanCountryLabel(id, label)];
  const dial = meta.dial || COUNTRY_DIAL[String(id)];
  if (dial) parts.push(dial);
  parts.push('mã ' + String(id));
  const p = prices && prices[String(id)];
  if (p && p.cost !== undefined && p.cost !== '') parts.push(money(p.cost));
  if (p && p.count !== undefined && p.count !== '') parts.push('còn ' + p.count + ' số');
  return parts.join(' • ');
}
function parseBalance(t){
  const s = String(t || '');
  const m = s.match(/ACCESS_BALANCE:([\d.]+)/i);
  if (m) return money(m[1]);
  if (/BAD_KEY/i.test(s)) return 'API key sai';
  return s || 'Chưa có dữ liệu';
}
function isKnownCountryOption(id, label){
  const meta = COUNTRY_META[String(id)] || {};
  const raw = String(label || '').trim();
  return !!meta.name || (raw && raw !== String(id) && !/^\d+$/.test(raw));
}
function localPhoneNumber(number, country){
  let n = String(number || '').trim();
  const meta = COUNTRY_META[String(country)] || {};
  const dial = String(meta.dial || '').replace(/\D/g, '');
  let digits = n.replace(/\D/g, '');
  if (dial && digits.startsWith(dial)) digits = digits.slice(dial.length);
  return digits || n;
}
function parseNumberResponse(raw, json){
  const text = String(raw || '').trim();

  // GrizzlySMS legacy Request a number returns text:
  // ACCESS_NUMBER:activationId:phoneNumber
  // Some deployments may still return JSON, so keep JSON parsing below.
  const data = json && typeof json === 'object' ? json : (() => {
    try { return JSON.parse(text); } catch { return null; }
  })();

  if (data && (data.activationId || data.id) && (data.phoneNumber || data.number || data.phone)) {
    const id = String(data.activationId || data.id);
    const number = String(data.phoneNumber || data.number || data.phone);
    return {
      ok: true,
      id,
      activationId: id,
      number,
      phone: number,
      phoneNumber: number,
      cost: data.activationCost ?? data.cost ?? '',
      currency: data.currency ?? '',
      countryCode: data.countryCode ?? '',
      raw: data
    };
  }

  // Keep old handler_api format as fallback, in case provider returns legacy text.
  const m = text.match(/ACCESS_NUMBER:([^:]+):(.+)/i);
  if (m) return { ok:true, id:m[1], activationId:m[1], number:m[2], phone:m[2], phoneNumber:m[2], raw:text };

  const messageMap = {
    BAD_ACTION: 'BAD_ACTION: Action thuê số không được endpoint hiện tại chấp nhận. Web sẽ tự thử getNumberV2 và getNumber.',
    BAD_SERVICE: 'BAD_SERVICE: Mã dịch vụ sai. Kiểm tra lại dịch vụ trong cấu hình.',
    BAD_KEY: 'BAD_KEY: API key GrizzlySMS sai.',
    NO_BALANCE: 'NO_BALANCE: Tài khoản GrizzlySMS không đủ tiền.',
    NO_NUMBERS: 'NO_NUMBERS: Quốc gia/dịch vụ này đang hết số.',
    ERROR_SQL: 'ERROR_SQL: Lỗi hệ thống từ GrizzlySMS, thử lại sau.'
  };

  const upper = text.toUpperCase();
  for (const [key, message] of Object.entries(messageMap)) {
    if (upper.includes(key)) return { ok:false, raw:text, message };
  }

  return { ok:false, raw:text || 'Không thuê được số.', message:text || 'Không thuê được số.' };
}

function looksNoNumbers(x){
  return /NO_NUMBERS/i.test(String((x && (x.raw || x.message)) || x || ''));
}
function simAttemptLabel(a){
  return `${a.action} service=${a.service} country=${a.country} => ${String((a.parsed && (a.parsed.raw || a.parsed.message)) || a.raw || '').trim()}`;
}
async function grizzlyGetNumberOnce({ apiKey, service, country }){
  const params = { api_key: apiKey, service, country };
  const attempts = [];

  // Grizzly docs: getNumberV2 works like getNumber but returns JSON with more info.
  const r2 = await grizzly('getNumberV2', params);
  const parsed2 = parseNumberResponse(r2.text, r2.json);
  attempts.push({ action:'getNumberV2', service, country, parsed:parsed2, raw:r2.text });
  if (parsed2.ok) return { ...parsed2, serviceUsed: service, countryUsed: country, action:'getNumberV2', attempts };

  // Legacy endpoint returns ACCESS_NUMBER:id:number. Keep it because some accounts/endpoints use it better.
  const r1 = await grizzly('getNumber', params);
  const parsed1 = parseNumberResponse(r1.text, r1.json);
  attempts.push({ action:'getNumber', service, country, parsed:parsed1, raw:r1.text });
  if (parsed1.ok) return { ...parsed1, serviceUsed: service, countryUsed: country, action:'getNumber', attempts };

  return { ok:false, serviceUsed:service, countryUsed:country, attempts, parsed2, parsed1,
    raw: attempts.map(simAttemptLabel).join(' | '),
    message: `${parsed2.message || parsed2.raw || r2.text || 'V2 lỗi'} | ${parsed1.message || parsed1.raw || r1.text || 'Legacy lỗi'}` };
}
function getTikTokServiceFallbacks(service){
  const s = String(service || '').trim().toLowerCase();
  // Trên nhiều bảng giá Grizzly/SMS Activate, TikTok có thể là lf hoặc tk.
  // Nếu người dùng chọn tk mà báo NO_NUMBERS dù còn số, thử lf ngay; ngược lại cũng thử tk.
  if (s === 'tk') return ['tk', 'lf'];
  if (s === 'lf') return ['lf', 'tk'];
  return [s || 'lf'];
}
async function grizzlyGetNumber({ apiKey, service, country }){
  const servicesToTry = getTikTokServiceFallbacks(service);
  const allAttempts = [];
  let firstResult = null;

  for (const svc of servicesToTry) {
    const r = await grizzlyGetNumberOnce({ apiKey, service: svc, country });
    allAttempts.push(...(r.attempts || []));
    if (r.ok) return { ...r, attempts: allAttempts };
    if (!firstResult) firstResult = r;

    // Chỉ tự đổi mã dịch vụ khi lỗi thật sự là hết số/no-number.
    // Các lỗi key/balance/service bị cấm thì giữ nguyên để báo chính xác.
    if (!looksNoNumbers(r)) break;
  }

  const raw = allAttempts.map(simAttemptLabel).join(' | ');
  const tried = [...new Set(allAttempts.map(a=>a.service))].join(' → ');
  const message = looksNoNumbers(raw)
    ? `NO_NUMBERS: Quốc gia/dịch vụ này đang hết số hoặc mã dịch vụ chưa đúng. Đã thử service ${tried}. Hãy đổi quốc gia hoặc đổi giữa TikTok mã lf / TikTok Alt mã tk.`
    : (firstResult && firstResult.message) || 'Không thuê được số.';
  return { ok:false, raw, message, attempts: allAttempts };
}
function parseSmsStatus(t){
  const s = String(t || '').trim();
  if (/STATUS_OK:/i.test(s)) return { status:'ok', code:(s.split(':').slice(1).join(':')||'').trim(), raw:s, message:'Đã nhận OTP' };
  if (/STATUS_WAIT_CODE/i.test(s)) return { status:'wait', code:'', raw:s, message:'Chưa có OTP' };
  if (/STATUS_WAIT_RETRY/i.test(s)) return { status:'wait', code:'', raw:s, message:'Chưa có OTP' };
  if (/STATUS_CANCEL/i.test(s)) return { status:'cancel', code:'', raw:s, message:'Phiên đã hủy: STATUS_CANCEL' };
  if (/NO_ACTIVATION/i.test(s)) return { status:'error', code:'', raw:s, message:'Không tìm thấy phiên thuê số: NO_ACTIVATION' };
  if (/BAD_KEY/i.test(s)) return { status:'error', code:'', raw:s, message:'API key sai: BAD_KEY' };
  if (/NO_BALANCE/i.test(s)) return { status:'error', code:'', raw:s, message:'Hết số dư: NO_BALANCE' };
  if (/ERROR/i.test(s)) return { status:'error', code:'', raw:s, message:s };
  return { status:'unknown', code:'', raw:s, message:s || 'Chưa có phản hồi từ API' };
}
async function simContext(req){
  const s = normalizeSimStore(req);
  let balance = 'Chưa nhập API key';
  let services = FALLBACK_SERVICES;
  let countries = FALLBACK_COUNTRIES;
  let prices = {};
  if (s.apiKey) {
    try { balance = parseBalance((await grizzly('getBalance', { api_key:s.apiKey })).text); } catch(e){ balance = 'Lỗi số dư: ' + e.message; }
    try { services = parseOptions(await grizzly('getServices', { api_key:s.apiKey }), FALLBACK_SERVICES); } catch {}
    try { countries = parseOptions(await grizzly('getCountries', { api_key:s.apiKey }), FALLBACK_COUNTRIES); } catch {}
    try { prices = parsePrices(await grizzly('getPrices', { api_key:s.apiKey, service:s.service }), s.service); } catch {}
  }
  // Ẩn mặc định các mã quốc gia API trả về nhưng chưa có tên/mã vùng để danh sách không bị rối.
  // Vẫn giữ quốc gia đang chọn nếu nó là mã lạ, tránh làm mất cấu hình cũ.
  countries = countries.filter(([id,label]) => isKnownCountryOption(id,label) || String(id) === String(s.country));
  return { s, balance, services, countries, prices };
}
function countrySearchText(id, label, prices){
  const meta = COUNTRY_META[String(id)] || {};
  const cleanName = cleanCountryLabel(id, label);
  const dial = meta.dial || '';
  const p = prices && prices[String(id)] || {};
  const aliases = [];
  if (/south korea/i.test(cleanName)) aliases.push('korea han quoc hàn quốc');
  if (/japan/i.test(cleanName)) aliases.push('nhat nhật');
  if (/vietnam/i.test(cleanName)) aliases.push('viet nam việt nam');
  if (/colombia/i.test(cleanName)) aliases.push('columbia');
  return [cleanName, String(id), dial, String(dial).replace(/\D/g,''), p.cost !== undefined ? money(p.cost) : '', p.count !== undefined ? String(p.count) : '', ...aliases].join(' ').toLowerCase();
}
function simSelect(name, value, options, prices = {}){
  return `<select name="${name}" ${name==='country'?'id="countrySelect"':''}>${options.map(([id,label])=>{
    const text = name === 'country' ? countryLabel(id, label, prices) : `${label} • mã ${id}`;
    const search = name === 'country' ? countrySearchText(id, label, prices) : String(label + ' ' + id).toLowerCase();
    return `<option value="${esc(id)}" data-search="${esc(search)}" ${String(id)===String(value)?'selected':''}>${esc(text)}</option>`;
  }).join('')}</select>`;
}


app.get('/thue-otp-sim', async (req,res)=>{
  const { s, balance, services, countries, prices } = await simContext(req);
  const clientId = getClientId(req, res);
  const active = getClientActive(s, clientId);
  const showConfig = req.query.config === '1' || !s.apiKey;
  const currentService = serviceName(s.service, services);
  const currentCountry = countryLabel(s.country, countryName(s.country, countries), prices);
  const activeHtml = active.length ? `<div class="list">${active.map(a=>{ const localNum = localPhoneNumber(a.number, a.country); return `<div class="list-item sim-session"><div class="sim-main"><div class="sim-phone-row"><div><b>${esc(a.number)}</b><small class="muted">Số local: ${esc(localNum)}</small></div><div class="sim-inline-actions"><button class="mini-copy" type="button" data-copy="${esc(localNum)}">📋 Số</button><a class="btn danger smallbtn" href="/sim/cancel/${urlEnc(a.id)}">Hủy</a></div></div><small class="muted">ID: ${esc(a.id)} • ${esc(serviceName(a.service, services))} • ${esc(countryLabel(a.country, countryName(a.country, countries), prices))}</small><div class="otpbox sim-otpbox"><div class="sim-otp-line"><small>OTP SMS</small><b class="sim-code" data-id="${esc(a.id)}">------</b></div><button type="button" data-check-sim-id="${esc(a.id)}" title="Kiểm tra OTP">🔄</button><button type="button" data-copy-sim-id="${esc(a.id)}" title="Copy OTP">📋</button><span class="sim-status" data-id="${esc(a.id)}">Chưa có OTP</span></div></div></div>`; }).join('')}</div>` : '<div class="empty">Chưa có phiên thuê số nào.</div>';
  const configForm = showConfig
    ? `<form method="post" action="/thue-otp-sim/settings"><label>API key GrizzlySMS</label><input name="apiKey" value="${esc(s.apiKey)}" placeholder="Nhập API key"><label>Dịch vụ</label>${simSelect('service', s.service, services)}<label>Quốc gia</label><input id="countrySearch" class="country-search" type="search" placeholder="Tìm quốc gia hoặc mã vùng, ví dụ: 84, 57, Vietnam, Colombia">${simSelect('country', s.country, countries, prices)}<button class="btn primary wide">💾 Lưu cấu hình</button><a class="btn soft wide" href="/thue-otp-sim">Ẩn cấu hình</a></form>`
    : `<div class="sim-config-summary"><div class="field"><label>Cấu hình hiện tại</label><div class="stat">${esc(currentService)}<br><small>${esc(currentCountry)}</small></div></div><a class="btn soft wide" href="/thue-otp-sim?config=1">⚙️ Cấu hình</a></div>`;
  const body = card('💰 Số dư GrizzlySMS', `<div class="big-result">${esc(balance)}</div>`)+
    card('⏳ Phiên đang chờ SMS', activeHtml)+
    card('📱 Thuê OTP SIM', `<form id="simGetForm" method="post" action="/sim/get-number"><button id="simGetBtn" class="btn primary wide">📲 Lấy số điện thoại</button><div id="simGetLoading" class="notice" style="display:none">⏳ Đang lấy số điện thoại...</div></form>${configForm}`);
  res.send(layout('Thuê OTP SIM', body, 'sim'));
});
app.post('/thue-otp-sim/settings',(req,res)=>{
  const old = normalizeSimStore(req);
  writeDomainSim(req,{...old, apiKey:req.body.apiKey||'', service:req.body.service||'lf', country:req.body.country||'10'});
  res.redirect('/thue-otp-sim');
});
app.post('/sim/get-number', async (req,res)=>{
  const s=normalizeSimStore(req);
  const clientId = getClientId(req, res);
  if(!s.apiKey) return res.redirect('/thue-otp-sim');
  try{
    const n = await grizzlyGetNumber({ apiKey:s.apiKey, service:s.service, country:s.country });
    if(n.ok){
      setClientActive(s, clientId, [{id:n.id, number:n.number, service:n.serviceUsed||s.service, country:n.countryUsed||s.country, clientId, createdAt:new Date().toISOString(), cost:n.cost||'', countryCode:n.countryCode||''}]);
      writeDomainSim(req,s);
      return res.redirect('/thue-otp-sim?rented=1');
    }
    res.send(layout('Không thuê được số', card('⚠️ Kết quả API', `<div class="big-result">${esc(n.message || n.raw)}</div><small class="muted">${esc(typeof n.raw === 'string' ? n.raw : JSON.stringify(n.raw || ''))}</small>${btn('/thue-otp-sim','Quay lại','soft')}`),'sim'));
  }catch(e){res.send(layout('Lỗi thuê số', card('Lỗi',esc(e.message)),'sim'));}
});
app.get('/api/sim/status/:id', async (req,res)=>{
  const s=normalizeSimStore(req);
  if(!s.apiKey) return res.json({status:false,message:'Chưa nhập API key'});
  try{
    const raw=(await grizzly('getStatus',{api_key:s.apiKey, id:req.params.id})).text;
    const st=parseSmsStatus(raw);
    res.json({status:true, checkedAt:new Date().toLocaleTimeString('vi-VN'), ...st});
  }catch(e){res.json({status:false,message:e.message});}
});
app.get('/sim/cancel/:id', async (req,res)=>{
  const s=normalizeSimStore(req);
  const clientId = getClientId(req, res);
  if(s.apiKey){ try{ await grizzly('setStatus',{api_key:s.apiKey, id:req.params.id, status:'8'}); }catch{} }
  setClientActive(s, clientId, getClientActive(s, clientId).filter(x=>String(x.id)!==String(req.params.id)));
  writeDomainSim(req,s);
  res.redirect('/thue-otp-sim');
});
app.get('/sim/complete/:id', async (req,res)=>{
  const s=normalizeSimStore(req);
  const clientId = getClientId(req, res);
  if(s.apiKey){ try{ await grizzly('setStatus',{api_key:s.apiKey, id:req.params.id, status:'6'}); }catch{} }
  setClientActive(s, clientId, getClientActive(s, clientId).filter(x=>String(x.id)!==String(req.params.id)));
  writeDomainSim(req,s);
  res.redirect('/thue-otp-sim');
});

initStorage().then(()=>{
  app.listen(PORT, ()=>console.log(`QuangFun chạy tại http://localhost:${PORT}`));
});
