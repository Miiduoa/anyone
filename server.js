const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const MSG_FILE = path.join(DATA_DIR, 'messages.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

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
      hint: '分享到 IG 後加 Link Sticker（建議貼網站）'
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

app.use(cors());
// 提高 JSON 限制，避免頭貼/文字太大被擋掉（預設 100kb）
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Static frontend (optional: put your index.html in this folder)
app.use(express.static(__dirname));
// 靜態提供已上傳的媒體檔案
app.use('/media', express.static(MEDIA_DIR));

// Multer 設定，用於媒體上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const id = nanoid(16);
    cb(null, ext ? `${id}${ext}` : id);
  }
});
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB 上限，避免手機影片太大直接被擋
  }
});

// Get all messages
app.get('/api/messages', (req, res) => {
  const msgs = readMessages().map(m => ({
    ...m,
    replies: Array.isArray(m.replies) ? m.replies : []
  }));
  res.json(msgs);
});

// Create new message (anonymous or admin post)
app.post('/api/messages', (req, res) => {
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
  res.json(msg);
});

// Delete message
app.delete('/api/messages/:id', (req, res) => {
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
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file_too_large', message: '檔案太大，請縮短或壓縮再上傳（上限約 25MB）。' });
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

