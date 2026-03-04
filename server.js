const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.join(__dirname, 'data');
const MSG_FILE = path.join(DATA_DIR, 'messages.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const PUBLIC_DIR = path.join(__dirname, 'public');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SESSION_MS = 2 * 60 * 60 * 1000; // 2 小時
const adminSessions = new Map(); // token -> { createdAt, expiresAt }

// Admin 登入暴力破解防護（IP 基礎的速率限制）
const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 分鐘視窗
  max: 20, // 同一 IP 最多 20 次嘗試
  standardHeaders: true,
  legacyHeaders: false
});

// 匿名留言 API 速率限制（避免被濫刷）
const createMessageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分鐘視窗
  max: 60, // 同一 IP 每分鐘最多 60 則
  standardHeaders: true,
  legacyHeaders: false
});

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function readMessages() {
  try {
    const raw = fs.readFileSync(MSG_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

function writeMessages(messages) {
  fs.writeFileSync(MSG_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

function readSettings() {
  const defaultSettings = {
    promoSettings: {
      displayName: 'Miiduoa',
      tagline: '資訊管理｜創作者｜想聽你說話',
      siteLabel: '匿名悄悄話',
      siteUrl: '',
      igHandle: '@miiduoa',
      igUrl: '',
      cta1: '匿名留言給我',
      cta2: '看更多內容 → IG 主頁',
      hint: '分享到 IG 後加 Link Sticker（建議貼網站）',
      storyStyle: 'metal',
      storyImageX: 0,
      storyImageY: 0,
      storyImageScale: 1
    },
    avatarDataUrl: null
  };

  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return {
      promoSettings: { ...defaultSettings.promoSettings, ...(data.promoSettings || {}) },
      avatarDataUrl: data.avatarDataUrl || null
    };
  } catch {
    return defaultSettings;
  }
}

function writeSettings(settings) {
  const current = readSettings();
  const next = {
    promoSettings: { ...current.promoSettings, ...(settings.promoSettings || {}) },
    avatarDataUrl: typeof settings.avatarDataUrl === 'string'
      ? settings.avatarDataUrl
      : current.avatarDataUrl
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) {
    res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return res === 0;
}

function requireAdminToken(req, res) {
  const token = req.headers['x-admin-token'];
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const sess = adminSessions.get(token);
  if (!sess || sess.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const reqIp = req.ip;
  const reqUa = req.headers['user-agent'] || '';
  if (sess.ip !== reqIp || sess.ua !== reqUa) {
    adminSessions.delete(token);
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return token;
}

function getValidAdminToken(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return null;
  const sess = adminSessions.get(token);
  if (!sess || sess.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  const reqIp = req.ip;
  const reqUa = req.headers['user-agent'] || '';
  if (sess.ip !== reqIp || sess.ua !== reqUa) {
    adminSessions.delete(token);
    return null;
  }
  return token;
}

function toClientMessage(msg, includeSensitive = false) {
  const base = {
    id: msg.id,
    alias: msg.alias,
    text: msg.text,
    mood: msg.mood,
    ts: msg.ts,
    editedTs: msg.editedTs || 0,
    status: msg.status,
    liked: !!msg.liked,
    pinned: !!msg.pinned,
    isAdminPost: !!msg.isAdminPost,
    mediaUrl: msg.mediaUrl || null,
    replies: Array.isArray(msg.replies) ? msg.replies : []
  };
  if (includeSensitive) {
    base.editKey = msg.editKey;
  }
  return base;
}

function toPublicPendingMessage(msg) {
  // 未公開內容不對一般訪客下發原文，避免透過分享/開發者工具外洩
  return {
    id: msg.id,
    alias: msg.alias,
    text: '（此留言審核中，內容暫不公開）',
    mood: msg.mood,
    ts: msg.ts,
    editedTs: msg.editedTs || 0,
    status: msg.status,
    liked: false,
    pinned: false,
    isAdminPost: !!msg.isAdminPost,
    mediaUrl: null,
    replies: []
  };
}

// 基本安全標頭
// 注意：目前前端大量使用 inline script/style 與 inline 事件（onclick）。
// 若啟用 helmet 預設 CSP，會在 production 直接被瀏覽器阻擋，導致前端幾乎無法操作。
app.use(helmet({
  contentSecurityPolicy: false
}));

// CORS 設定：可透過環境變數 CORS_ORIGINS 設定允許的網域（以逗號分隔）
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // 非瀏覽器（如 cURL / Postman）沒有 origin，直接允許
    if (!origin) return callback(null, true);
    // 若未設定白名單，預設允許所有，避免部署時因漏設 CORS_ORIGINS 而整站 API 故障
    if (ALLOWED_ORIGINS.length === 0) {
      return callback(null, true);
    }
    // 有設定白名單時，必須在白名單內才允許
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  allowedHeaders: ['Content-Type', 'x-admin-token']
}));
// 提高 JSON 限制，避免頭貼/文字太大被擋掉（預設 100kb）
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Static frontend：僅對外提供 public 資料夾，避免 data 等伺服器端資料被直接讀取
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}
// 靜態提供已上傳的媒體檔案
app.use('/media', express.static(MEDIA_DIR));

// 媒體上傳允許類型
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp4', '.webm', '.ogg',
  '.mp3', '.wav'
]);

function pickSafeExt(file) {
  const mime = file.mimetype || '';
  if (/^image\//.test(mime)) return '.png';
  if (/^video\//.test(mime)) return '.mp4';
  if (/^audio\//.test(mime)) return '.mp3';
  return '';
}

// Multer 設定，用於媒體上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      // 如果副檔名不在白名單內，根據 mimetype 給予一個安全的預設
      ext = pickSafeExt(file);
    }
    const id = nanoid(16);
    cb(null, ext ? `${id}${ext}` : id);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB 上限，避免手機影片太大直接被擋
  },
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype || '';
    const allowed = ALLOWED_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
    if (!allowed) {
      return cb(new Error('invalid_file_type'));
    }
    cb(null, true);
  }
});

// Get all messages
app.get('/api/messages', (req, res) => {
  const isAdmin = !!getValidAdminToken(req);
  const msgs = readMessages()
    .filter(m => {
      if (isAdmin) return true;
      // 前台顯示公開與待審，待審由前端以馬賽克呈現；隱藏內容仍不對外公開
      return m.status === 'public' || m.status === 'pending';
    })
    .map(m => {
      if (!isAdmin && m.status === 'pending') return toPublicPendingMessage(m);
      return toClientMessage(m, false);
    });
  res.json(msgs);
});

app.get('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  const messages = readMessages();
  const msg = messages.find(m => m.id === id);
  if (!msg) return res.status(404).json({ error: 'not found' });

  const isAdmin = !!getValidAdminToken(req);
  const editKey = typeof req.query.editKey === 'string' ? req.query.editKey.trim() : '';
  const canRead = isAdmin || msg.status === 'public' || (editKey && editKey === msg.editKey);
  if (!canRead) return res.status(404).json({ error: 'not found' });

  res.json(toClientMessage(msg, false));
});

// Admin login / logout
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'admin_not_configured' });
  }
  const body = req.body || {};
  const password = String(body.password || '');

  const ok = safeEqual(ADMIN_PASSWORD, password);
  if (!ok) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const token = nanoid(32);
  const now = Date.now();
  adminSessions.set(token, {
    createdAt: now,
    expiresAt: now + ADMIN_SESSION_MS,
    ip: req.ip,
    ua: req.headers['user-agent'] || ''
  });
  res.json({ token, expiresAt: now + ADMIN_SESSION_MS });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) adminSessions.delete(token);
  res.status(204).end();
});

// Create new message (anonymous or admin post)
app.post('/api/messages', createMessageLimiter, (req, res) => {
  const { text, mood, alias, adminPost, mediaUrl } = req.body || {};
  const cleanText = String(text || '').trim().slice(0, 500);
  const cleanAlias = String(alias || '').trim().slice(0, 16);
  const isAdminPost = !!adminPost;
  const cleanMood = String(mood || (isAdminPost ? '📣' : '💬'));
  const cleanMediaUrl = typeof mediaUrl === 'string'
    ? mediaUrl.trim().slice(0, 500)
    : '';

  if (!cleanText) {
    return res.status(400).json({ error: 'text is required' });
  }

  const messages = readMessages();
  const now = Date.now();

  if (isAdminPost) {
    if (!requireAdminToken(req, res)) return;
  }

  const msg = {
    id: nanoid(16),
    alias: cleanAlias || (isAdminPost ? 'Miiduoa' : `匿名${Math.random().toString(36).slice(2, 6)}`),
    text: cleanText,
    mood: cleanMood,
    ts: now,
    editedTs: 0,
    status: isAdminPost ? 'public' : 'pending',
    liked: false,
    pinned: false,
    editKey: nanoid(12),
    isAdminPost,
    replies: [],
    mediaUrl: isAdminPost && cleanMediaUrl ? cleanMediaUrl : null
  };

  messages.unshift(msg);
  writeMessages(messages);
  res.status(201).json(msg);
});

// Update message (status / pin / like / content / replies)
app.patch('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const messages = readMessages();
  const idx = messages.findIndex(m => m.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const msg = messages[idx];
  if (!Array.isArray(msg.replies)) msg.replies = [];

  const wantsContentEdit =
    typeof body.text === 'string' ||
    typeof body.alias === 'string';

  const wantsAdminFields =
    typeof body.status === 'string' ||
    typeof body.pinned === 'boolean' ||
    body.replyFromAdmin === true;

  let isAdmin = false;
  if (wantsAdminFields) {
    if (!requireAdminToken(req, res)) return;
    isAdmin = true;
  }

  // 一般使用者編輯內容時，必須提供正確的 editKey
  if (wantsContentEdit && !isAdmin) {
    const editKey = typeof body.editKey === 'string' ? body.editKey.trim() : '';
    if (!editKey || editKey !== msg.editKey) {
      return res.status(403).json({ error: 'invalid_edit_key' });
    }
  }

  if (typeof body.status === 'string') {
    msg.status = ['public', 'pending', 'hidden'].includes(body.status)
      ? body.status
      : msg.status;
  }
  if (typeof body.pinned === 'boolean') {
    msg.pinned = body.pinned;
  }
  if (typeof body.liked === 'boolean') {
    msg.liked = body.liked;
  }
  if (typeof body.text === 'string') {
    const t = body.text.trim().slice(0, 500);
    if (t) {
      msg.text = t;
      msg.editedTs = Date.now();
    }
  }
  if (typeof body.alias === 'string') {
    msg.alias = body.alias.trim().slice(0, 16) || msg.alias;
  }

  if (typeof body.replyText === 'string') {
    if (!isAdmin && msg.status !== 'public') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const replyText = body.replyText.trim().slice(0, 500);
    if (replyText) {
      msg.replies = msg.replies || [];
      const fromAdmin = !!body.replyFromAdmin;
      const replyAliasRaw = typeof body.replyAlias === 'string'
        ? body.replyAlias.trim().slice(0, 16)
        : '';
      const reply = {
        id: nanoid(12),
        text: replyText,
        ts: Date.now(),
        fromAdmin
      };
      if (replyAliasRaw) {
        reply.alias = replyAliasRaw;
      }
      msg.replies.push(reply);
    }
  }

  messages[idx] = msg;
  writeMessages(messages);
  res.json(toClientMessage(msg, false));
});

// Delete message
app.delete('/api/messages/:id', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  const { id } = req.params;
  const messages = readMessages();
  const next = messages.filter(m => m.id !== id);
  if (next.length === messages.length) {
    return res.status(404).json({ error: 'not found' });
  }
  writeMessages(next);
  res.status(204).end();
});

// Simple stats
app.get('/api/stats', (req, res) => {
  const messages = readMessages();
  const total = messages.length;
  const pub = messages.filter(m => m.status === 'public').length;
  const pending = messages.filter(m => m.status === 'pending').length;
  const hidden = messages.filter(m => m.status === 'hidden').length;
  res.json({ total, pub, pending, hidden });
});

// Promo / avatar settings
app.get('/api/settings', (req, res) => {
  const settings = readSettings();
  res.json(settings);
});

app.patch('/api/settings', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  const body = req.body || {};
  const safe = {};

  if (body.promoSettings && typeof body.promoSettings === 'object') {
    const p = body.promoSettings;
    safe.promoSettings = {};
    if (typeof p.displayName === 'string') safe.promoSettings.displayName = p.displayName.slice(0, 40);
    if (typeof p.tagline === 'string') safe.promoSettings.tagline = p.tagline.slice(0, 200);
    if (typeof p.siteLabel === 'string') safe.promoSettings.siteLabel = p.siteLabel.slice(0, 40);
    if (typeof p.siteUrl === 'string') safe.promoSettings.siteUrl = p.siteUrl.slice(0, 200);
    if (typeof p.igHandle === 'string') safe.promoSettings.igHandle = p.igHandle.slice(0, 40);
    if (typeof p.igUrl === 'string') safe.promoSettings.igUrl = p.igUrl.slice(0, 200);
    if (typeof p.cta1 === 'string') safe.promoSettings.cta1 = p.cta1.slice(0, 60);
    if (typeof p.cta2 === 'string') safe.promoSettings.cta2 = p.cta2.slice(0, 60);
    if (typeof p.hint === 'string') safe.promoSettings.hint = p.hint.slice(0, 200);
    if (typeof p.storyStyle === 'string') {
      safe.promoSettings.storyStyle = ['metal', 'glass'].includes(p.storyStyle) ? p.storyStyle : 'metal';
    }
    if (typeof p.storyImageX === 'number' && Number.isFinite(p.storyImageX)) {
      safe.promoSettings.storyImageX = Math.max(-260, Math.min(260, p.storyImageX));
    }
    if (typeof p.storyImageY === 'number' && Number.isFinite(p.storyImageY)) {
      safe.promoSettings.storyImageY = Math.max(-260, Math.min(260, p.storyImageY));
    }
    if (typeof p.storyImageScale === 'number' && Number.isFinite(p.storyImageScale)) {
      safe.promoSettings.storyImageScale = Math.max(0.6, Math.min(2.2, p.storyImageScale));
    }
  }

  if (typeof body.avatarDataUrl === 'string') {
    // 粗略限制大小與格式（避免塞整個影片進來）
    if (body.avatarDataUrl.length <= 400000 && body.avatarDataUrl.startsWith('data:image/')) {
      safe.avatarDataUrl = body.avatarDataUrl;
    }
  }

  writeSettings(safe);
  const updated = readSettings();
  res.json(updated);
});

// 媒體檔案上傳（圖片 / 影片 / 音檔）
app.post('/api/upload-media', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large', message: '檔案太大，請縮短或壓縮再上傳（上限約 25MB）。' });
      }
      if (err && err.message === 'invalid_file_type') {
        return res.status(400).json({ error: 'invalid_file_type', message: '只允許上傳圖片、影片或音訊檔。' });
      }
      console.error('upload-media error:', err);
      return res.status(500).json({ error: 'upload_failed', message: '媒體上傳失敗，請稍後再試。' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'no_file', message: '沒有收到檔案。' });
    }
    const urlPath = `/media/${req.file.filename}`;
    res.json({ url: urlPath });
  });
});

app.listen(PORT, () => {
  console.log(`Miiduoa backend listening on http://localhost:${PORT}`);
});

