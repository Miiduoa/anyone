const ADMIN_EMAIL = "demohan513@gmail.com";
const SESSION_TIMEOUT = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const STORAGE_KEY = "anon_msgs_v5";
const AVATAR_KEY = "miiduoa_admin_avatar_v1";
const PROMO_KEY  = "miiduoa_promo_settings_v1";

const IG_URL = "https://www.instagram.com/miiduoa?igsh=MWM1eDJzOXpuNWdyOA%3D%3D&utm_source=qr";
const SITE_URL = location.origin + location.pathname;
const SHARE_TITLE = "想對Miiduoa說什麼";

const AVATARS = ["🦊","🐱","🐰","🐻","🐼","🐨","🦁","🐯","🐸","🐵","🦄","🐲","🦋","🐬","🦜","🐙","🦝","🐺","🦉","🐢"];
const MOODS = ["💬","❤️","🔥","😂","😭","🤔","✨","🎵","💀","🫶"];
const ALIAS_ADJ = ["可愛的","溫柔的","酷酷的","認真的","神秘的","閃亮的","快樂的","勇敢的","害羞的","有趣的"];
const ALIAS_ANIM = ["小狐狸","小貓咪","小兔子","小熊熊","小企鵝","小海豚","小恐龍","小刺蝟","小老虎","小章魚"];

let currentPage = 'home';
let messages = [];
let lastSeenMessageTs = 0;
let activityTimer = null;
let isAdmin = false;
let adminToken = null;
let sessionStart = 0;
let loginAttempts = 0;
let lockUntil = 0;

// 在部分較舊的內建瀏覽器（例如某些 App 內建 WebView）中，可能沒有原生 Set
// 這裡做一個極簡相容層，避免整段腳本一開始就因為 new Set() 崩潰
let SimpleSet;
if (typeof Set === 'undefined') {
  SimpleSet = function() { this._m = Object.create(null); };
  SimpleSet.prototype.add = function(v){ this._m[String(v)] = true; return this; };
  SimpleSet.prototype.delete = function(v){ const k = String(v); const had = !!this._m[k]; delete this._m[k]; return had; };
  SimpleSet.prototype.has = function(v){ return !!this._m[String(v)]; };
  SimpleSet.prototype.clear = function(){ this._m = Object.create(null); };
  Object.defineProperty(SimpleSet.prototype, 'size', {
    get: function(){ return Object.keys(this._m).length; }
  });
} else {
  SimpleSet = Set;
}
let selectedMessages = new SimpleSet();
let isSelectionMode = false;

let sessionTimerInterval = null;

let activeModalId = null;

let promoSettings = {
  displayName: "Miiduoa",
  tagline: "資訊管理｜創作者｜想聽你說話",
  siteLabel: "匿名悄悄話",
  siteUrl: SITE_URL,
  igHandle: "@miiduoa",
  igUrl: IG_URL,
  cta1: "匿名留言給我",
  cta2: "看更多內容 → IG 主頁",
  hint: "分享到 IG 後加 Link Sticker（建議貼網站）"
};

let serverAvatarDataUrl = null;

let lastSubmitted = null; // {id, editKey}

let editingTarget = null; // {id, editKey}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return m + " 分鐘前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小時前";
  const days = Math.floor(h / 24);
  if (days < 30) return days + " 天前";
  return new Date(ts).toLocaleDateString("zh-TW");
}
function randInt(min, max){
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function showToast(msg, type='success'){
  const toast=document.getElementById('toast');
  toast.textContent=msg;
  toast.className=`toast ${type}`;
  toast.style.display='block';
  setTimeout(()=>{toast.style.display='none'},2600);
}

function escapeHTML(str) {
  // 使用相容性較好的寫法，避免舊版或內建瀏覽器不支援 replaceAll
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

/* ======= Modal ======= */
function openModal(id){
  activeModalId = id;
  document.getElementById('modal-backdrop').style.display='block';
  const m = document.getElementById(id);
  m.style.display='block';
  m.setAttribute('aria-hidden','false');

  // ✅ 防止背景滾動（modal 本身仍可捲）
  document.body.style.overflow = 'hidden';
  document.body.style.touchAction = 'none';

  // ✅ 每次打開回到頂部
  m.scrollTop = 0;
}
function closeModal(){
  document.getElementById('modal-backdrop').style.display='none';
  if (activeModalId) {
    const m = document.getElementById(activeModalId);
    if (m) {
      m.style.display='none';
      m.setAttribute('aria-hidden','true');
    }
  }
  activeModalId = null;

  // ✅ 還原背景
  document.body.style.overflow = '';
  document.body.style.touchAction = '';
}

/* ======= Storage（avatar/promo 使用，留言改走後端 API） ======= */
function saveMessages(){
  // 後端已負責儲存留言，這裡保留函式避免舊程式碼出錯（不再寫入 localStorage）
}

async function loadMessages(){
  try {
    const headers = { 'Accept': 'application/json' };
    if (adminToken) headers['X-Admin-Token'] = adminToken;
    const res = await fetch('/api/messages', { headers });
    if (!res.ok) throw new Error('Failed to load messages');
    const data = await res.json();
    messages = (Array.isArray(data) ? data : []).map(m => ({
      ...m,
      replies: Array.isArray(m.replies) ? m.replies : []
    }));
  } catch (e) {
    console.error(e);
    messages = [];
    showToast("⚠️ 無法從伺服器載入留言（暫時顯示為空）","danger");
  }
}

/* ======= Social proof (honest, local) ======= */
function getLocalStats(){
  const total = messages.length;
  const pub = messages.filter(m => m.status === 'public').length;
  const pending = messages.filter(m => m.status === 'pending').length;
  const last10min = messages.filter(m => (Date.now() - m.ts) <= 10*60*1000).length;
  return { total, pub, pending, last10min };
}

function computeTrueStats(){
  const total = messages.length;
  const pub = messages.filter(m => m.status === 'public').length;
  const pending = messages.filter(m => m.status === 'pending').length;
  const hidden = messages.filter(m => m.status === 'hidden').length;
  const last10min = messages.filter(m => (Date.now() - (m.ts || 0)) <= 10*60*1000).length;
  return { total, pub, pending, hidden, last10min };
}

function getPublicHeatStats(){
  const s = computeTrueStats();
  let displayLast10 = s.last10min;

  if (!isAdmin){
    // 允許適度「美化」，但不要離譜
    if (displayLast10 === 0){
      // 小機率維持 0，多數情況顯示 1
      displayLast10 = Math.random() < 0.3 ? 0 : 1;
    } else if (displayLast10 <= 2){
      displayLast10 = displayLast10 + randInt(0, 2);
    } else if (displayLast10 <= 5){
      displayLast10 = displayLast10 + randInt(0, 3);
    } else if (displayLast10 <= 10){
      displayLast10 = displayLast10 + randInt(-1, 4);
    } else {
      displayLast10 = displayLast10 + randInt(-2, 5);
    }
    if (displayLast10 < 0) displayLast10 = 0;
  }

  let heatLabel = "安靜中";
  if (displayLast10 >= 1 && displayLast10 <= 3) heatLabel = "有人路過";
  else if (displayLast10 <= 8) heatLabel = "正在升溫";
  else if (displayLast10 <= 15) heatLabel = "蠻熱鬧的";
  else heatLabel = "非常熱鬧";

  return {
    displayLast10,
    heatLabel,
    trueLast10: s.last10min,
    stats: s
  };
}

/* ======= Page nav ======= */
function showPage(page){
  currentPage=page;
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.page===page);
  });
  render();
}

/* ======= Messages ======= */
function randomEditKey(len=12){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(len);
  try { crypto.getRandomValues(arr); } catch {
    for (let i=0;i<len;i++) arr[i] = Math.floor(Math.random()*256);
  }
  let out = "";
  for (let i=0;i<len;i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function genAlias(){
  const a = ALIAS_ADJ[Math.floor(Math.random()*ALIAS_ADJ.length)];
  const b = ALIAS_ANIM[Math.floor(Math.random()*ALIAS_ANIM.length)];
  return a + b;
}

async function addMessage(text, mood, aliasInput){
  const payload = {
    text,
    mood,
    alias: aliasInput ? aliasInput.slice(0, 16) : genAlias()
  };
  try {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to create message');
    const msg = await res.json();
    messages.unshift(msg);
    if (msg.ts) {
      lastSeenMessageTs = Math.max(lastSeenMessageTs, msg.ts);
    }
    lastSubmitted = { id: msg.id, editKey: msg.editKey };
    showToast("✨ 訊息已送出！等待主人查看");
    return msg;
  } catch (e) {
    console.error(e);
    showToast("⚠️ 送出失敗，請稍後再試","danger");
    throw e;
  }
}

async function setStatus(id,status){
  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Admin-Token': adminToken || ''
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Failed to update status');
    const updated = await res.json();
    messages = messages.map(m=>m.id===id?updated:m);
    render();
  } catch (e) {
    console.error(e);
    showToast("⚠️ 更新狀態失敗","danger");
  }
}

async function deleteMsg(id){
  const prev = messages.slice();
  messages = messages.filter(m=>m.id!==id);
  render();
  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'X-Admin-Token': adminToken || ''
      }
    });
    if (!res.ok) throw new Error('Failed to delete');
    showToast("🗑 已刪除","danger");
  } catch (e) {
    console.error(e);
    messages = prev;
    render();
    showToast("⚠️ 刪除失敗","danger");
  }
}

async function togglePin(id){
  const target = messages.find(m=>m.id===id);
  if (!target) return;
  const nextPinned = !target.pinned;
  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Admin-Token': adminToken || ''
      },
      body: JSON.stringify({ pinned: nextPinned })
    });
    if (!res.ok) throw new Error('Failed to toggle pin');
    const updated = await res.json();
    messages = messages.map(m=>m.id===id?updated:m);
    render();
  } catch (e) {
    console.error(e);
    showToast("⚠️ 置頂狀態更新失敗","danger");
  }
}

async function toggleLike(id){
  const target = messages.find(m=>m.id===id);
  if (!target) return;
  const nextLiked = !target.liked;
  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ liked: nextLiked })
    });
    if (!res.ok) throw new Error('Failed to toggle like');
    const updated = await res.json();
    messages = messages.map(m=>m.id===id?updated:m);
    render();
  } catch (e) {
    console.error(e);
    showToast("⚠️ 喜歡狀態更新失敗","danger");
  }
}

/* ======= Admin login ======= */
async function handleLogin(pwd){
  if (lockUntil > Date.now()) return;
  try{
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ password: pwd })
    });
    if (!res.ok) {
      loginAttempts++;
      if (loginAttempts >= MAX_ATTEMPTS){
        const lockSecs = Math.min(60 * Math.pow(2, Math.floor(loginAttempts / MAX_ATTEMPTS) - 1), 3600);
        lockUntil = Date.now() + lockSecs * 1000;
        showToast(`🔒 已鎖定 ${lockSecs} 秒（嘗試 ${loginAttempts} 次）`,"danger");
      } else {
        showToast(`❌ 密碼錯誤（${loginAttempts}/${MAX_ATTEMPTS}）`,"danger");
      }
      render();
      return;
    }
    const data = await res.json();
    adminToken = data.token || null;
    isAdmin = !!adminToken;
    if (isAdmin){
      sessionStart = Date.now();
      loginAttempts = 0;
      await loadMessages();
      showToast("✅ 登入成功","success");
      updateAvatarUI();
      render();
    } else {
      showToast("❌ 登入失敗","danger");
    }
  }catch(e){
    console.error(e);
    showToast("⚠️ 登入時發生錯誤，請稍後再試","danger");
  }
}
function handleLogout(){
  const token = adminToken;
  adminToken = null;
  isAdmin=false; sessionStart=0; currentPage='home';
  if (sessionTimerInterval){ clearInterval(sessionTimerInterval); sessionTimerInterval=null; }
  isSelectionMode=false; selectedMessages.clear();
  showToast("已安全登出","danger");
  updateAvatarUI();
  loadMessages().then(() => render());
  if (token){
    fetch('/api/admin/logout', {
      method: 'POST',
      headers: { 'X-Admin-Token': token }
    }).catch(()=>{});
  }
}

/* ======= Avatar (admin editable，改走後端設定) ======= */
function getStoredAvatarDataURL(){
  return serverAvatarDataUrl;
}
function setStoredAvatarDataURL(dataUrl){
  serverAvatarDataUrl = dataUrl;
}
function updateAvatarUI(){
  const img=document.getElementById('admin-avatar-img');
  const fallback=document.getElementById('admin-avatar-fallback');
  const editBtn=document.getElementById('avatar-edit-btn');
  const link=document.getElementById('ig-avatar-link');

  if (link) link.href = promoSettings.igUrl || IG_URL;

  const dataUrl = getStoredAvatarDataURL();
  if (dataUrl && img && fallback){
    img.src=dataUrl; img.style.display='block'; fallback.style.display='none';
  } else if (img && fallback){
    img.removeAttribute('src'); img.style.display='none'; fallback.style.display='flex';
  }
  if (editBtn) editBtn.style.display = isAdmin ? 'inline-flex' : 'none';
}
function openAvatarPicker(){ if (!isAdmin) return; const input=document.getElementById('avatar-file'); if (input) input.click(); }
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onerror=reject;
    r.onload=()=>resolve(r.result);
    r.readAsDataURL(file);
  });
}
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
async function fileToSquareAvatarDataURL(file,size=256){
  const dataUrl=await fileToDataURL(file);
  const img=await loadImage(dataUrl);

  const canvas=document.createElement('canvas');
  canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext('2d');

  const sw=img.naturalWidth||img.width;
  const sh=img.naturalHeight||img.height;
  const s=Math.min(sw,sh);
  const sx=Math.floor((sw-s)/2);
  const sy=Math.floor((sh-s)/2);

  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(img,sx,sy,s,s,0,0,size,size);

  return canvas.toDataURL('image/png',0.92);
}
function initAvatarPicker(){
  const input=document.getElementById('avatar-file');
  if (!input) return;
  input.addEventListener('change', async ()=>{
    if (!isAdmin) return;
    const file=input.files && input.files[0];
    input.value='';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')){ showToast("⚠️ 請選擇圖片檔","danger"); return; }
    try{
      const dataUrl=await fileToSquareAvatarDataURL(file,256);
      setStoredAvatarDataURL(dataUrl);
      await saveSettingsToServer(false);
      updateAvatarUI();
      showToast("✅ 頭貼已更新");
    }catch(e){
      console.error(e);
      showToast("⚠️ 頭貼更新失敗","danger");
    }
  });
}

/* ======= Promo / Avatar settings（集中經由後端 settings API） ======= */
async function fetchSettingsFromServer(){
  try{
    const res = await fetch('/api/settings', { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('settings load failed');
    const data = await res.json();
    if (data && typeof data === 'object') {
      if (data.promoSettings && typeof data.promoSettings === 'object') {
        promoSettings = { ...promoSettings, ...data.promoSettings };
      }
      if (typeof data.avatarDataUrl === 'string' && data.avatarDataUrl.startsWith('data:image/')) {
        serverAvatarDataUrl = data.avatarDataUrl;
      }
    }
  }catch(e){
    console.error(e);
    // 若載入失敗就用前端預設，不中斷
  }finally{
    updateAvatarUI();
  }
}

async function saveSettingsToServer(showToastOnSuccess = true){
  if (!isAdmin) return;
  try{
    const payload = {
      promoSettings,
      avatarDataUrl: serverAvatarDataUrl
    };
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Admin-Token': adminToken || ''
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('settings save failed');
    const data = await res.json();
    if (data && typeof data === 'object') {
      if (data.promoSettings && typeof data.promoSettings === 'object') {
        promoSettings = { ...promoSettings, ...data.promoSettings };
      }
      if (typeof data.avatarDataUrl === 'string' && data.avatarDataUrl.startsWith('data:image/')) {
        serverAvatarDataUrl = data.avatarDataUrl;
      }
    }
    if (showToastOnSuccess){
      showToast("✅ 名片設定已儲存");
    }
    updateAvatarUI();
  }catch(e){
    console.error(e);
    showToast("⚠️ 儲存設定失敗，請稍後再試","danger");
  }
}

// 舊的 loadPromoSettings/ savePromoSettings 變成 wrapper，避免其他地方呼叫壞掉
function loadPromoSettings(){
  // 真正的載入在 boot() 時呼叫 fetchSettingsFromServer()
}
function savePromoSettings(){
  saveSettingsToServer(true);
}

function renderMediaHtml(url){
  const u = String(url || '').trim();
  if (!u) return '';
  const lower = u.toLowerCase();
  const safeUrl = escapeHTML(u);
  if (/\.(png|jpe?g|gif|webp)$/.test(lower)){
    return `<img src="${safeUrl}" alt="附加圖片" style="max-width:100%; border-radius:12px; margin-top:4px; display:block;"/>`;
  }
  if (/\.(mp4|webm|ogg)$/.test(lower)){
    return `<video autoplay muted loop playsinline controls style="width:100%; max-height:420px; border-radius:12px; margin-top:4px; background:#000; object-fit:cover;"><source src="${safeUrl}"></video>`;
  }
  if (/\.(mp3|wav|ogg)$/.test(lower)){
    return `<audio controls style="width:100%; margin-top:4px;"><source src="${safeUrl}"></audio>`;
  }
  return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="font-size:13px; color:var(--color-accent); text-decoration:underline; display:inline-flex; align-items:center; gap:4px; margin-top:4px;">🔗 開啟附加連結</a>`;
}

/* ======= Share modal content ======= */
function openShareModalFor(msg){
  const sub = document.getElementById("share-modal-sub");
  const img = document.getElementById("share-preview-img");

  const canvas = generatePromoStoryCanvas();
  img.src = canvas.toDataURL("image/png", 0.92);

  sub.textContent = promoSettings.hint || "分享到 IG 後加 Link Sticker（建議貼網站）";

  const codebox = document.getElementById("share-codebox");
  const codeEl = document.getElementById("share-edit-code");
  if (msg && msg.editKey){
    codebox.style.display = "flex";
    codeEl.textContent = msg.editKey;
  } else {
    codebox.style.display = "none";
    codeEl.textContent = "";
  }

  openModal("share-modal");
}

function getEditLinkFor(id, editKey){
  return `${SITE_URL}#edit=${encodeURIComponent(id)}.${encodeURIComponent(editKey)}`;
}

async function copyTextToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    showToast("📋 已複製");
  }catch(e){
    console.error(e);
    showToast("⚠️ 複製失敗（可能需要 HTTPS 或手動複製）","danger");
  }
}
function copySiteLink(){ copyTextToClipboard(promoSettings.siteUrl || SITE_URL); }
function copyIgLink(){ copyTextToClipboard(promoSettings.igUrl || IG_URL); }

function copyEditLink(){
  if (!lastSubmitted) return;
  const link = getEditLinkFor(lastSubmitted.id, lastSubmitted.editKey);
  copyTextToClipboard(link);
}
function openEditModalWithLast(){
  if (!lastSubmitted) { openEditModal(); return; }
  const link = getEditLinkFor(lastSubmitted.id, lastSubmitted.editKey);
  openEditModal(link);
}

/* ======= Edit ======= */
function openEditModal(prefill=""){
  const tokenInput = document.getElementById("edit-token-input");
  const alias = document.getElementById("edit-alias");
  const text = document.getElementById("edit-text");
  const saveBtn = document.getElementById("save-edit-btn");
  const meta = document.getElementById("edit-meta");

  editingTarget = null;
  tokenInput.value = prefill || "";
  alias.value = "";
  text.value = "";
  alias.disabled = true;
  text.disabled = true;
  saveBtn.disabled = true;
  meta.textContent = "";

  openModal("edit-modal");
}

async function pasteFromClipboard(){
  try{
    const t = await navigator.clipboard.readText();
    const tokenInput = document.getElementById("edit-token-input");
    tokenInput.value = (t || "").trim();
    showToast("✅ 已貼上");
  }catch(e){
    console.error(e);
    showToast("⚠️ 無法讀取剪貼簿（可能需要 HTTPS/權限）","danger");
  }
}

function normalizeEditToken(raw){
  let s = String(raw || "").trim();
  if (!s) return "";

  const idx = s.indexOf("#edit=");
  if (idx >= 0) s = s.slice(idx + 6);

  if (s.startsWith("edit=")) s = s.slice(5);
  if (s.startsWith("#")) s = s.slice(1);
  if (s.startsWith("edit=")) s = s.slice(5);

  try { s = decodeURIComponent(s); } catch {}
  return s.trim();
}

async function loadEditFromToken(){
  const tokenInput = document.getElementById("edit-token-input");
  const token = normalizeEditToken(tokenInput.value);
  if (!token || !token.includes(".")){
    showToast("⚠️ Token 格式不正確","danger");
    return;
  }
  const [id, editKey] = token.split(".", 2);
  let msg = messages.find(m => m.id === id);
  if (!msg) {
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(id)}?editKey=${encodeURIComponent(editKey)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error('load message failed');
      msg = await res.json();
    } catch (e) {
      console.error(e);
      showToast("⚠️ 找不到可編輯的留言，或編輯碼不正確","danger");
      return;
    }
  }

  editingTarget = { id, editKey };

  const alias = document.getElementById("edit-alias");
  const text = document.getElementById("edit-text");
  const saveBtn = document.getElementById("save-edit-btn");
  const meta = document.getElementById("edit-meta");

  alias.disabled = false;
  text.disabled = false;
  saveBtn.disabled = false;

  alias.value = msg.alias || "";
  text.value = msg.text || "";

  meta.textContent = `載入成功：${timeAgo(msg.ts)}；狀態：${msg.status === 'public' ? '公開' : msg.status === 'pending' ? '待審' : '隱藏'}。`;
}

async function saveEdit(){
  if (!editingTarget) return;
  const aliasVal = document.getElementById("edit-alias").value.trim().slice(0, 16);
  const textVal = document.getElementById("edit-text").value.trim().slice(0, 500);

  if (!textVal){
    showToast("⚠️ 內容不能空白","danger");
    return;
  }

  const payload = {
    alias: aliasVal || genAlias(),
    text: textVal,
    editKey: editingTarget.editKey
  };

  try {
    const res = await fetch(`/api/messages/${encodeURIComponent(editingTarget.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to save edit');
    const updated = await res.json();
    messages = messages.map(m => m.id === updated.id ? updated : m);
    showToast("✅ 已更新你的留言");
    closeModal();
    render();
  } catch (e) {
    console.error(e);
    showToast("⚠️ 更新失敗，請稍後再試","danger");
  }
}

function handleHashEdit(){
  const h = location.hash || "";
  if (!h.startsWith("#edit=")) return;
  const token = normalizeEditToken(h);
  if (!token) return;

  openEditModal(token);
  setTimeout(()=>loadEditFromToken(), 0);
}

/* ======= UI ======= */
function renderSubmitPage(){
  const heat = getPublicHeatStats();
  const st = heat.stats;
  return `
    <div class="page-shell" style="max-width: 680px;">
      <div style="text-align:center; margin-bottom: 22px;">
        <div class="hero-badge">💌</div>
        <h1 style="font-size: 28px; font-weight: 900; margin-bottom: 6px; font-family: 'Playfair Display', serif;">想對Miiduoa說什麼？</h1>
        <p style="color: var(--color-sub); font-size: 14px; letter-spacing: 1px;">Say anything. Stay anonymous.</p>
      </div>

      <div class="mini-card" style="margin-bottom: 14px;">
        <div class="mini-row">
          <div>
            <div class="mini-label">${isAdmin ? '真實統計（這個站）' : '最近 10 分鐘大約有'}</div>
            <div class="mini-val">
              ${isAdmin ? st.total : heat.displayLast10}
              ${isAdmin ? '' : '<span style="font-size:12px; margin-left:4px;">則新匿名留言</span>'}
            </div>
          </div>
          <div style="text-align:right">
            <div class="mini-label">${isAdmin ? '公開 / 待審 / 隱藏' : '熱度狀態'}</div>
            <div class="mini-val" style="font-size:14px;">
              ${isAdmin
                ? `${st.pub} / ${st.pending} / ${st.hidden}`
                : heat.heatLabel}
            </div>
          </div>
        </div>
        <div class="small-note">
          ${isAdmin
            ? `最近 10 分鐘實際新留言：${heat.trueLast10} 則。前台顯示的是稍微美化過的熱度（僅文字感受用）。`
            : ''}
        </div>
      </div>

      <div class="panel-card" style="box-shadow: 0 0 0 1px rgba(225,48,108,0.1);">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom: 12px; flex-wrap:wrap;">
          <div style="flex: 1; min-width: 240px;">
            <label style="font-size: 13px; color: var(--color-sub); margin-bottom: 8px; display:block;">匿名暱稱（可不填）</label>
            <input id="alias-input" placeholder="例如：神秘小狐狸 / 隨便你想要的" maxlength="16"
              style="width:100%; padding: 12px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); color: var(--color-text); outline:none;" />
            <div class="small-note">不填會自動生成一個可愛匿名暱稱；之後可用「編輯碼」修改。</div>
          </div>

          <button onclick="openEditModal()" class="action-btn" style="flex:0 0 auto; min-width: 170px;">
            ✏️ 編輯我的留言
          </button>
        </div>

        <p style="font-size: 13px; color: var(--color-sub); margin-bottom: 10px;">選擇心情</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom: 16px;" id="mood-selector">
          ${MOODS.map(m => `<button data-mood="${m}" onclick="selectMood('${m}')" style="width:40px;height:40px;border-radius:12px;font-size:20px;background:rgba(255,255,255,0.05);border:2px solid transparent;cursor:pointer;transition:all .2s;">${m}</button>`).join('')}
        </div>

        <div style="position: relative;">
          <textarea id="msg-text" placeholder="在這裡寫下你想說的話...&#10;&#10;完全匿名，放心說！" maxlength="500"
            style="width: 100%; min-height: 160px; background: rgba(255,255,255,0.04); border: 1px solid var(--color-border); border-radius: 14px; padding: 16px; color: var(--color-text); font-size: 15px; line-height: 1.7; resize: vertical; outline: none;"></textarea>
          <div id="char-count" style="position:absolute; bottom: 12px; right: 14px; font-size: 12px; color: var(--color-sub);">0/500</div>
        </div>

        <button onclick="submitMessage()" class="primary-cta">
          🚀 匿名送出
        </button>

        <div style="display:flex; align-items:center; justify-content:center; gap:6px; margin-top: 14px; color: var(--color-sub); font-size: 12px;">
          <span>🔒</span><span>完全匿名 · 不追蹤 · 不記錄身份</span>
        </div>
      </div>
    </div>
  `;
}

function getAvatar(id){
  return AVATARS[Math.abs(Array.from(id).reduce((a,c)=>a+c.charCodeAt(0),0)) % AVATARS.length];
}

function getAdminAvatarHtml(size){
  const dataUrl = getStoredAvatarDataURL();
  const px = size || 80;
  if (dataUrl){
    return `<img src="${escapeHTML(dataUrl)}" alt="Miiduoa Avatar" style="width:${px}px;height:${px}px;border-radius:999px;object-fit:cover;border:2px solid rgba(255,255,255,0.3);" />`;
  }
  return `<div style="width:${px}px;height:${px}px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--brand-gradient);font-size:${Math.floor(px*0.45)}px;font-weight:900;font-family:'Playfair Display',serif;">M</div>`;
}

function renderProfilePage(){
  const adminPosts = messages
    .filter(m => m.isAdminPost)
    .sort((a,b)=> (b.ts||0)-(a.ts||0));

  const esc = escapeHTML;

  return `
    <div class="page-shell">
      <div style="display:flex; gap:16px; align-items:flex-end; margin-bottom:20px; padding-top:8px;">
        <div onclick="showPage('profile')" style="cursor:default;">
          ${getAdminAvatarHtml(80)}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:22px; font-weight:900; margin-bottom:2px;">${esc(promoSettings.displayName || 'Miiduoa')}</div>
          <div style="font-size:14px; color:var(--color-sub); margin-bottom:6px;">@${esc((promoSettings.igHandle || '@miiduoa').replace(/^@/,'')).slice(0,24)}</div>
          <div style="font-size:13px; color:rgba(255,255,255,0.85); white-space:pre-line;">${esc(promoSettings.tagline || '')}</div>
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-bottom:18px; flex-wrap:wrap;">
        <button class="action-btn" style="flex:1; min-width:140px;" onclick="copySiteLink()">🔗 複製匿名留言連結</button>
        <button class="action-btn" style="flex:1; min-width:140px;" onclick="copyIgLink()">📸 前往 IG 主頁</button>
      </div>

      <div style="border-top:1px solid var(--color-border); padding-top:14px; margin-bottom:10px;">
        <div style="font-size:14px; font-weight:800; margin-bottom:4px;">Threads 風動態</div>
        <div style="font-size:12px; color:var(--color-sub);">${adminPosts.length} 則官方貼文 · 任何人都可以在牆上回覆</div>
      </div>

      ${adminPosts.length === 0 ? `
        <div style="padding:40px 0; text-align:center; color:var(--color-sub); font-size:13px;">
          還沒有官方貼文。登入管理後可以在這裡發佈第一則。
        </div>
      ` : `
        <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:24px;">
          ${adminPosts.map((m,i)=>`
            <div class="card-hover" style="background:var(--color-card); border-radius:18px; padding:16px 16px 12px; border:1px solid var(--color-border);">
              <div style="display:flex; gap:10px;">
                <button onclick="showPage('profile')" style="border:none; background:none; padding:0; cursor:pointer; flex-shrink:0;">
                  ${getAdminAvatarHtml(40)}
                </button>
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
                    <span style="font-size:13px; font-weight:700;">${esc(promoSettings.displayName || 'Miiduoa')}</span>
                    <span style="font-size:12px; color:var(--color-sub);">@${esc((promoSettings.igHandle || '@miiduoa').replace(/^@/,'')).slice(0,24)}</span>
                    <span style="font-size:11px; color:var(--color-sub); margin-left:auto;">${timeAgo(m.ts)}</span>
                  </div>
                  <div style="font-size:14px; color:rgba(255,255,255,0.9); line-height:1.7; white-space:pre-line; word-break:break-word;">
                    ${esc(m.text || '')}
                  </div>
                  ${m.mediaUrl ? `
                    <div style="margin-top:8px;">
                      ${renderMediaHtml(m.mediaUrl)}
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderWallPage(){
  const sorted = messages.slice().sort((a,b)=>{
    if (!!a.pinned && !b.pinned) return -1;
    if (!a.pinned && !!b.pinned) return 1;
    return b.ts - a.ts;
  });

  if (sorted.length===0){
    return `
      <div style="text-align:center; padding-top: 80px; animation: fadeIn .5s; max-width:680px; margin:0 auto;">
        <div style="font-size: 60px; margin-bottom: 16px;">🌙</div>
        <p style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">還沒有留言</p>
        <p style="color: var(--color-sub); font-size: 14px;">去留個言吧，也許你的會被選中！</p>
      </div>
    `;
  }

  return `
    <div style="animation: fadeUp .4s; max-width:680px; margin:0 auto;">
      <div style="text-align:center; margin-bottom: 28px;">
        <h2 style="font-size: 24px; font-weight: 900; font-family: 'Playfair Display', serif;">💫 留言牆</h2>
        <p style="color: var(--color-sub); font-size: 13px; margin-top: 4px;">${sorted.length} 則留言</p>
      </div>

      ${isAdmin ? `
      <div style="display:flex; gap:8px; margin-bottom: 16px; align-items:center;">
        <button onclick="toggleSelectionMode()" style="flex:1; padding:10px 0; border-radius:12px; font-size:13px; font-weight:700; background:${isSelectionMode?'rgba(225,48,108,0.15)':'rgba(255,255,255,0.04)'}; border:1px solid ${isSelectionMode?'rgba(225,48,108,0.3)':'var(--color-border)'}; color:${isSelectionMode?'var(--color-accent)':'var(--color-sub)'}; cursor:pointer;">
          ${isSelectionMode?'✓ 選取模式':'📸 批次限動'}
        </button>
        ${isSelectionMode && selectedMessages.size>0 ? `
        <button onclick="generateBatchStory()" style="flex:1; padding:10px 0; border-radius:12px; font-size:13px; font-weight:800; background: var(--brand-gradient); border:none; color:#fff; cursor:pointer; background-size:200% 200%; animation: gradientMove 3s ease infinite;">
          生成 ${selectedMessages.size} 則限動
        </button>` : ``}
      </div>` : ``}

      <div style="display:flex; flex-direction:column; gap:14px;">
        ${sorted.map((m,i)=>{
          const shouldMosaic = (!isAdmin && m.status !== 'public');
          const isAdminPost = !!m.isAdminPost;
          const statusTag = isAdmin
            ? (m.status === 'pending'
              ? '<div style="position:absolute; top:0; right:0; background: rgba(255,165,0,0.15); border:1px solid rgba(255,165,0,0.3); padding:3px 12px; border-radius:0 0 0 12px; font-size:11px; font-weight:700; color:#ffa500;">⏳ 待審</div>'
              : m.status === 'hidden'
                ? '<div style="position:absolute; top:0; right:0; background: rgba(128,128,128,0.15); border:1px solid rgba(128,128,128,0.3); padding:3px 12px; border-radius:0 0 0 12px; font-size:11px; font-weight:700; color:#888;">🙈 隱藏</div>'
                : '')
            : (m.status !== 'public'
              ? '<div style="position:absolute; top:0; right:0; background: rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); padding:3px 12px; border-radius:0 0 0 12px; font-size:11px; font-weight:800; color: rgba(255,255,255,0.6);">🔒 未公開</div>'
              : '');

          const edited = m.editedTs ? `<span style="font-size:11px; color: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.08); padding:1px 8px; border-radius:999px;">✏️ 已編輯</span>` : "";
          const adminTag = isAdminPost ? `<span style="font-size:11px; color: rgba(225,48,108,0.9); border:1px solid rgba(225,48,108,0.35); padding:1px 8px; border-radius:999px; background:rgba(225,48,108,0.1);">📣 官方貼文</span>` : "";

          return `
          <div class="card-hover" style="background: var(--color-card); border-radius:18px; padding:20px; border:1px solid ${m.pinned?'rgba(225,48,108,0.3)':'var(--color-border)'}; animation: fadeUp .4s ease ${i*0.05}s both; position:relative; overflow:hidden; ${shouldMosaic?'opacity:0.88':''}">
            ${isAdmin && isSelectionMode ? `<input type="checkbox" onchange="toggleSelection('${m.id}')" ${selectedMessages.has(m.id)?'checked':''} style="position:absolute; top:12px; left:12px; width:20px; height:20px; cursor:pointer; z-index:10;" />` : ``}
            ${m.pinned ? '<div style="position:absolute; top:0; right:0; background: var(--brand-gradient); padding:3px 12px 3px 14px; border-radius:0 0 0 12px; font-size:11px; font-weight:700;">📌 置頂</div>' : ''}
            ${statusTag}

            <div style="display:flex; gap:12px; align-items:flex-start;">
              ${m.isAdminPost
                ? `<button onclick="showPage('profile')" style="border:none; background:none; padding:0; cursor:pointer; flex-shrink:0;">
                     ${getAdminAvatarHtml(42)}
                   </button>`
                : `<div style="width:42px; height:42px; border-radius:14px; background: rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0;">${getAvatar(m.id)}</div>`
              }
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                  <span style="font-weight:800; font-size:14px;">${escapeHTML(m.alias || "匿名小可愛")}</span>
                  <span style="font-size:20px;">${m.mood}</span>
                  ${adminTag}
                  ${edited}
                  <span style="font-size:12px; color: var(--color-sub); margin-left:auto;">${timeAgo(m.ts)}</span>
                </div>

                <div style="position:relative;">
                  <p style="font-size:15px; line-height:1.7; color: rgba(255,255,255,0.9); word-break: break-word; filter:${shouldMosaic?'blur(10px)':'none'}; user-select:${shouldMosaic?'none':'text'};">
                    ${escapeHTML(m.text)}
                  </p>
                  ${shouldMosaic ? '<div style="position:absolute; inset:0; border-radius:8px; background: repeating-linear-gradient(45deg, rgba(0,0,0,0.35) 0 10px, rgba(0,0,0,0.12) 10px 20px); pointer-events:none;"></div>' : ''}
                </div>

                ${isAdminPost && m.mediaUrl ? `
                  <div style="margin-top:8px;">
                    ${renderMediaHtml(m.mediaUrl)}
                  </div>
                ` : ''}

                ${Array.isArray(m.replies) && m.replies.length > 0 ? `
                  <div style="margin-top:10px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06);">
                    ${m.replies.map(r => {
                      const fromAdmin = !!r.fromAdmin;
                      const alias = r.alias || (fromAdmin ? 'Miiduoa' : '匿名訪客');
                      const safeAlias = escapeHTML(alias);
                      const label = fromAdmin ? 'Miiduoa 回覆' : `${safeAlias} 的回覆`;
                      const avatarText = fromAdmin ? 'M' : safeAlias.charAt(0).toUpperCase();
                      const avatarBg = fromAdmin
                        ? 'var(--brand-gradient)'
                        : 'rgba(255,255,255,0.08)';
                      const avatarHtml = fromAdmin
                        ? `<button onclick="showPage('profile')" style="border:none; background:none; padding:0; cursor:pointer;">
                             ${getAdminAvatarHtml(28)}
                           </button>`
                        : `<div style="width:28px; height:28px; border-radius:10px; background:${avatarBg}; display:flex; align-items:center; justify-content:center; font-size:14px;">${escapeHTML(avatarText)}</div>`;
                      return `
                        <div style="display:flex; gap:8px; align-items:flex-start; margin-bottom:6px;">
                          ${avatarHtml}
                          <div style="flex:1; min-width:0;">
                            <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
                              <span style="font-size:12px; font-weight:700;">${label}</span>
                              <span style="font-size:11px; color: rgba(255,255,255,0.5);">${timeAgo(r.ts)}</span>
                            </div>
                            <div style="font-size:14px; color: rgba(255,255,255,0.9); line-height:1.6; word-break: break-word;">
                              ${escapeHTML(r.text)}
                            </div>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : ''}
              </div>
            </div>

            ${isAdmin ? `
            <div style="display:flex; gap:6px; margin-top:14px; flex-wrap:wrap;">
              <button onclick="setStatus('${m.id}','public')" style="flex:1; min-width:60px; padding:8px 0; border-radius:10px; font-size:12px; font-weight:800; background:${m.status==='public'?'rgba(46,204,113,0.2)':'rgba(46,204,113,0.12)'}; border:1px solid rgba(46,204,113,0.25); color: var(--color-ok); cursor:pointer;">
                ${m.status==='public'?'✓ 已公開':'👁 公開'}
              </button>
              <button onclick="setStatus('${m.id}','hidden')" style="flex:1; min-width:60px; padding:8px 0; border-radius:10px; font-size:12px; font-weight:800; background:${m.status==='hidden'?'rgba(231,76,60,0.2)':'rgba(231,76,60,0.12)'}; border:1px solid rgba(231,76,60,0.25); color: var(--color-no); cursor:pointer;">
                ${m.status==='hidden'?'✓ 已隱藏':'🙈 隱藏'}
              </button>
              <button onclick="togglePin('${m.id}')" style="flex:1; min-width:60px; padding:8px 0; border-radius:10px; font-size:12px; font-weight:800; background:${m.pinned?'rgba(225,48,108,0.12)':'rgba(255,255,255,0.04)'}; border:1px solid ${m.pinned?'rgba(225,48,108,0.25)':'var(--color-border)'}; color:${m.pinned?'var(--color-accent)':'var(--color-sub)'}; cursor:pointer;">
                ${m.pinned?'📌 取消':'📌 置頂'}
              </button>
              <button onclick="toggleReplyBox('${m.id}')" style="flex:1; min-width:60px; padding:8px 0; border-radius:10px; font-size:12px; font-weight:800; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); color:rgba(255,255,255,0.8); cursor:pointer;">
                💬 回覆
              </button>
              <button onclick="deleteMsg('${m.id}')" style="padding:8px 14px; border-radius:10px; font-size:12px; background: rgba(231,76,60,0.08); border:1px solid rgba(231,76,60,0.15); color: rgba(231,76,60,0.7); cursor:pointer;">🗑</button>
            </div>
            <div id="reply-box-${m.id}" style="margin-top:8px; display:none;">
              <textarea id="reply-text-${m.id}" placeholder="回覆這則匿名留言..." maxlength="500" style="width:100%; min-height:80px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:var(--color-text); padding:10px; font-size:13px;"></textarea>
              <div style="display:flex; gap:8px; margin-top:6px; justify-content:flex-end;">
                <button class="action-btn" style="flex:0 0 auto; min-width:80px; padding:6px 10px; font-size:12px;" onclick="toggleReplyBox('${m.id}')">取消</button>
                <button class="action-btn primary" style="flex:0 0 auto; min-width:100px; padding:6px 10px; font-size:12px;" onclick="submitReply('${m.id}')">送出回覆</button>
              </div>
            </div>
            ` : `
            <div style="display:flex; flex-direction:column; gap:6px; margin-top:12px;">
              <div style="display:flex; justify-content:flex-end;">
                ${m.status==='public'
                  ? `<button onclick="toggleLike('${m.id}')" style="background:${m.liked?'rgba(225,48,108,0.15)':'transparent'}; border:1px solid ${m.liked?'rgba(225,48,108,0.3)':'var(--color-border)'}; border-radius:20px; padding:5px 14px; font-size:13px; cursor:pointer; color:${m.liked?'var(--color-accent)':'var(--color-sub)'}; display:flex; align-items:center; gap:4px;">
                      <span style="animation:${m.liked?'heartBeat .6s ease':'none'};">${m.liked?'❤️':'🤍'}</span>
                      ${m.liked?'已喜歡':'喜歡'}
                    </button>`
                  : `<div style="font-size:12px; color: rgba(255,255,255,0.45); padding:6px 10px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);">🔒 內容尚未公開</div>`
                }
              </div>
              ${(m.status==='public')
                ? `<div>
                    <button style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:999px; padding:5px 12px; font-size:12px; color:rgba(255,255,255,0.75); cursor:pointer;" onclick="togglePublicReplyBox('${m.id}')">💬 回覆這則訊息</button>
                    <div id="public-reply-box-${m.id}" style="margin-top:6px; display:none;">
                      <input id="public-reply-alias-${m.id}" placeholder="你的暱稱（可不填）" maxlength="16" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.03); color:var(--color-text); font-size:12px; margin-bottom:6px;"/>
                      <textarea id="public-reply-text-${m.id}" placeholder="寫下你對這則訊息的回覆..." maxlength="500" style="width:100%; min-height:70px; border-radius:8px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.04); color:var(--color-text); padding:8px 10px; font-size:13px;"></textarea>
                      <div style="display:flex; gap:8px; margin-top:6px; justify-content:flex-end;">
                        <button class="action-btn" style="flex:0 0 auto; min-width:70px; padding:6px 10px; font-size:12px;" onclick="togglePublicReplyBox('${m.id}')">取消</button>
                        <button class="action-btn primary" style="flex:0 0 auto; min-width:90px; padding:6px 10px; font-size:12px;" onclick="submitPublicReply('${m.id}')">送出回覆</button>
                      </div>
                    </div>
                  </div>`
                : ''
              }
            </div>
            `}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderLoginPage(){
  const isLocked = lockUntil > Date.now();
  const remainSec = Math.ceil((lockUntil - Date.now()) / 1000);

  return `
    <div class="page-shell" style="max-width:400px; margin:40px auto;">
      <div style="text-align:center; margin-bottom:32px;">
        <div class="hero-badge" style="background:rgba(225,48,108,0.1);border:1px solid rgba(225,48,108,0.2);box-shadow:none;">🔐</div>
        <h2 style="font-size:24px;font-weight:900;">管理員驗證</h2>
        <p style="color:var(--color-sub);font-size:13px;margin-top:6px;">僅限授權管理員存取</p>
      </div>

      <div class="panel-card" style="padding:28px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px; background:rgba(225,48,108,0.06); border-radius:12px; padding:10px 14px; border:1px solid rgba(225,48,108,0.12);">
          <span style="font-size:18px;">🛡️</span>
          <div>
            <div style="font-size:12px;font-weight:800;color:var(--color-accent);">伺服器端驗證</div>
            <div style="font-size:11px;color:var(--color-sub);">密碼只在伺服器記憶體中比對，不在瀏覽器或硬碟儲存</div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; margin-bottom:20px; background:rgba(255,255,255,0.03); border-radius:12px; padding:10px 14px; border:1px solid var(--color-border);">
          <span style="font-size:16px;">👤</span>
          <div>
            <div style="font-size:11px;color:var(--color-sub);">管理員帳號</div>
            <div style="font-size:13px;font-weight:700;color:var(--color-text);">${ADMIN_EMAIL}</div>
          </div>
        </div>

        <label style="font-size:13px;color:var(--color-sub);margin-bottom:8px;display:block;">管理員密碼</label>
        <div style="position:relative; margin-bottom:6px;">
          <input type="password" id="admin-pwd" placeholder="輸入管理員密碼" ${isLocked?'disabled':''}
            style="width:100%; padding:14px 50px 14px 16px; background:${isLocked?'rgba(231,76,60,0.08)':'rgba(255,255,255,0.04)'}; border:1px solid var(--color-border); border-radius:14px; color:var(--color-text); font-size:15px; outline:none;" />
          <button id="admin-pwd-toggle"
            style="position:absolute; right:12px; top:50%; transform: translateY(-50%); background:none; border:none; cursor:pointer; font-size:18px; padding:4px; color:var(--color-sub);">👁</button>
        </div>

        ${loginAttempts>0?`
          <div style="padding:10px 14px;border-radius:10px;margin-bottom:12px;background:rgba(231,76,60,0.12);border:1px solid rgba(231,76,60,0.2);animation:fadeIn .3s;">
            <p style="color: var(--color-no); font-size:13px; font-weight:700;">
              ${isLocked?`🔒 已鎖定 ${remainSec} 秒`:`❌ 密碼錯誤（${loginAttempts}/${MAX_ATTEMPTS}）`}
            </p>
          </div>`:''}

        <button id="admin-login-btn" ${isLocked?'disabled':''}
          style="width:100%; padding:14px 0; margin-top:8px; background:${isLocked?'#333':'var(--brand-gradient)'}; border:none; border-radius:14px; color:#fff; font-size:15px; font-weight:900; cursor:${isLocked?'not-allowed':'pointer'}; background-size:200% 200%; animation:${isLocked?'none':'gradientMove 3s ease infinite'};">
          ${isLocked?'🔒 已鎖定':'🔓 驗證登入'}
        </button>
      </div>
    </div>
  `;
}

function renderAdminPanel(){
  const esc = escapeHTML;
  const total = messages.length;
  const vis = messages.filter(m => m.status === 'public').length;
  const pend = messages.filter(m => m.status === 'pending').length;
  const hid = messages.filter(m => m.status === 'hidden').length;

  return `
    <div class="page-shell" style="max-width: 880px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h2 style="font-size:22px; font-weight:900;">⚙️ 管理後台</h2>
        <button onclick="handleLogout()" style="background: rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.2); border-radius:10px; padding:6px 14px; font-size:12px; color: var(--color-no); cursor:pointer; font-weight:800;">🚪 登出</button>
      </div>

      <div class="status-strip">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color: var(--color-ok);">🟢</span>
          <span style="color: var(--color-sub);">${ADMIN_EMAIL}</span>
        </div>
        <div style="color: var(--color-sub);" id="session-timer">⏱ 30:00</div>
      </div>

      <div class="form-card">
        <div class="form-title">🪪 名片/限動設定（僅管理員可改）</div>
        <div class="form-grid">
          <div class="field">
            <label>顯示名稱</label>
            <input id="ps_displayName" value="${esc(promoSettings.displayName)}" />
          </div>
          <div class="field">
            <label>IG Handle</label>
            <input id="ps_igHandle" value="${esc(promoSettings.igHandle)}" />
          </div>
          <div class="field">
            <label>網站標籤</label>
            <input id="ps_siteLabel" value="${esc(promoSettings.siteLabel)}" />
          </div>
          <div class="field">
            <label>網站連結（Link Sticker 建議貼這個）</label>
            <input id="ps_siteUrl" value="${esc(promoSettings.siteUrl)}" />
          </div>
          <div class="field">
            <label>IG 連結</label>
            <input id="ps_igUrl" value="${esc(promoSettings.igUrl)}" />
          </div>
          <div class="field">
            <label>名片 CTA 1</label>
            <input id="ps_cta1" value="${esc(promoSettings.cta1)}" />
          </div>
          <div class="field">
            <label>名片 CTA 2</label>
            <input id="ps_cta2" value="${esc(promoSettings.cta2)}" />
          </div>
          <div class="field">
            <label>副標/身份（可多行）</label>
            <textarea id="ps_tagline">${esc(promoSettings.tagline)}</textarea>
          </div>
          <div class="field">
            <label>分享提示文字（彈窗顯示）</label>
            <textarea id="ps_hint">${esc(promoSettings.hint)}</textarea>
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
          <button class="action-btn primary" onclick="updatePromoFromForm()">💾 儲存設定</button>
          <button class="action-btn" onclick="openShareModalFor(null)">👀 預覽/分享名片限動</button>
          <button class="action-btn" onclick="copySiteLink()">📋 複製網站連結</button>
          <button class="action-btn" onclick="copyIgLink()">📋 複製 IG 連結</button>
        </div>
      </div>

      <div class="form-card">
        <div class="form-title">📣 管理者發文（類似 Threads 貼文）</div>
        <div class="field">
          <label>貼文內容</label>
          <textarea id="admin-post-text" placeholder="寫點現在想跟大家說的話..." maxlength="500"></textarea>
        </div>
        <div class="field">
          <label>圖片 / 影片 / 音檔</label>
          <input id="admin-post-media-url" placeholder="可貼外部連結，或直接從下方上傳（可不填）" />
          <input id="admin-post-media-file" type="file" accept="image/*,video/*,audio/*" style="margin-top:6px;" />
          <div id="admin-post-media-preview" style="margin-top:8px; font-size:12px; color:var(--color-sub);"></div>
        </div>
        <div style="display:flex; gap:8px; margin-top:8px; justify-content:flex-end;">
          <button class="action-btn primary" style="flex:0 0 auto; min-width:140px;" onclick="submitAdminPost()">📣 發佈貼文</button>
        </div>
        <div class="small-note">發文會以管理者身份公開顯示在留言牆中，並標記為「官方貼文」。圖片/影片/音檔可以直接從手機選擇上傳。</div>
      </div>

      <div class="stats-grid">
        ${[
          {icon:"📬", label:"全部", val: total},
          {icon:"⏳", label:"待審", val: pend},
          {icon:"✅", label:"已公開", val: vis},
          {icon:"🙈", label:"隱藏", val: hid},
        ].map(x=>`
          <div class="stats-card">
            <div style="font-size:22px; margin-bottom:4px;">${x.icon}</div>
            <div style="font-size:26px; font-weight:900;">${x.val}</div>
            <div style="font-size:12px; color: var(--color-sub);">${x.label}</div>
          </div>
        `).join('')}
      </div>

      <div style="color: var(--color-sub); font-size: 12px;">
        審核留言請到「🌟 牆」操作（公開/隱藏/置頂/刪除、批次限動）。
      </div>
    </div>
  `;
}

function initAdminPostSection(){
  adminPostMediaFile = null;
  const fileInput = document.getElementById('admin-post-media-file');
  const preview = document.getElementById('admin-post-media-preview');
  if (!fileInput || !preview) return;

  fileInput.addEventListener('change', () => {
    adminPostMediaFile = null;
    const file = fileInput.files && fileInput.files[0];
    if (!file){
      preview.innerHTML = '';
      return;
    }
    adminPostMediaFile = file;
    const type = file.type || '';
    const url = URL.createObjectURL(file);
    let html = '';
    if (type.startsWith('image/')){
      html = `<div style="font-size:12px; margin-bottom:4px;">已選擇圖片：${escapeHTML(file.name)}</div>
              <img src="${url}" alt="預覽圖片" style="max-width:100%; border-radius:12px; display:block;"/>`;
    } else if (type.startsWith('video/')){
      html = `<div style="font-size:12px; margin-bottom:4px;">已選擇影片：${escapeHTML(file.name)}</div>
              <video controls style="width:100%; max-height:260px; border-radius:12px; background:#000;"><source src="${url}"></video>`;
    } else if (type.startsWith('audio/')){
      html = `<div style="font-size:12px; margin-bottom:4px;">已選擇音檔：${escapeHTML(file.name)}</div>
              <audio controls style="width:100%;"><source src="${url}"></audio>`;
    } else {
      html = `<div style="font-size:12px;">已選擇檔案：${escapeHTML(file.name)}</div>`;
    }
    preview.innerHTML = html;
  });
}

function updatePromoFromForm(){
  if (!isAdmin) return;
  const read = (id) => (document.getElementById(id)?.value || "").trim();

  promoSettings = {
    displayName: read("ps_displayName") || promoSettings.displayName,
    tagline: read("ps_tagline") || promoSettings.tagline,
    siteLabel: read("ps_siteLabel") || promoSettings.siteLabel,
    siteUrl: read("ps_siteUrl") || promoSettings.siteUrl,
    igHandle: read("ps_igHandle") || promoSettings.igHandle,
    igUrl: read("ps_igUrl") || promoSettings.igUrl,
    cta1: read("ps_cta1") || promoSettings.cta1,
    cta2: read("ps_cta2") || promoSettings.cta2,
    hint: read("ps_hint") || promoSettings.hint
  };
  savePromoSettings();
  render();
}

/* ======= Admin replies & posts helpers ======= */
let adminPostMediaFile = null;

function toggleReplyBox(id){
  const box = document.getElementById(`reply-box-${id}`);
  if (!box) return;
  const cur = box.style.display || 'none';
  box.style.display = cur === 'none' ? 'block' : 'none';
}

async function submitReply(id){
  if (!isAdmin) { showToast("⚠️ 只有管理員可以回覆","danger"); return; }
  const textarea = document.getElementById(`reply-text-${id}`);
  if (!textarea) return;
  const text = textarea.value.trim();
  if (!text){
    showToast("⚠️ 回覆不能空白","danger");
    return;
  }
  try{
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Admin-Token': adminToken || ''
      },
      body: JSON.stringify({ replyText: text, replyFromAdmin: true })
    });
    if (!res.ok) throw new Error('reply failed');
    const updated = await res.json();
    messages = messages.map(m => m.id === updated.id ? {
      ...updated,
      replies: Array.isArray(updated.replies) ? updated.replies : []
    } : m);
    textarea.value = '';
    toggleReplyBox(id);
    render();
    showToast("✅ 已回覆此留言");
  }catch(e){
    console.error(e);
    showToast("⚠️ 回覆失敗，請稍後再試","danger");
  }
}

function togglePublicReplyBox(id){
  const box = document.getElementById(`public-reply-box-${id}`);
  if (!box) return;
  const cur = box.style.display || 'none';
  box.style.display = cur === 'none' ? 'block' : 'none';
}

async function submitPublicReply(id){
  const textEl = document.getElementById(`public-reply-text-${id}`);
  const aliasEl = document.getElementById(`public-reply-alias-${id}`);
  if (!textEl) return;
  const text = textEl.value.trim();
  if (!text){
    showToast("⚠️ 回覆不能空白","danger");
    return;
  }
  const alias = (aliasEl?.value || '').trim().slice(0, 16);
  try{
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        replyText: text,
        replyFromAdmin: false,
        replyAlias: alias || genAlias()
      })
    });
    if (!res.ok) throw new Error('public reply failed');
    const updated = await res.json();
    messages = messages.map(m => m.id === updated.id ? {
      ...updated,
      replies: Array.isArray(updated.replies) ? updated.replies : []
    } : m);
    textEl.value = '';
    if (aliasEl) aliasEl.value = '';
    togglePublicReplyBox(id);
    render();
    showToast("✅ 已送出回覆");
  }catch(e){
    console.error(e);
    showToast("⚠️ 回覆失敗，請稍後再試","danger");
  }
}

async function submitAdminPost(){
  if (!isAdmin) { showToast("⚠️ 只有管理員可以發文","danger"); return; }
  const el = document.getElementById('admin-post-text');
  const mediaUrlInput = document.getElementById('admin-post-media-url');
  if (!el) return;
  const text = el.value.trim();
  if (!text){
    showToast("⚠️ 內容不能空白","danger");
    return;
  }

  let mediaUrl = '';
  try{
    if (adminPostMediaFile){
      const fd = new FormData();
      fd.append('file', adminPostMediaFile);
      const res = await fetch('/api/upload-media', {
        method: 'POST',
        headers: {
          'X-Admin-Token': adminToken || ''
        },
        body: fd
      });
      if (!res.ok) throw new Error('upload failed');
      const data = await res.json();
      mediaUrl = data.url || '';
    } else if (mediaUrlInput){
      mediaUrl = mediaUrlInput.value.trim();
    }
  }catch(e){
    console.error(e);
    showToast("⚠️ 媒體上傳失敗，請稍後再試或改用連結","danger");
    return;
  }

  const payload = {
    text,
    mood: '📣',
    alias: promoSettings.displayName || 'Miiduoa',
    mediaUrl,
    adminPost: true
  };
  try{
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Admin-Token': adminToken || ''
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('post failed');
    const msg = await res.json();
    messages.unshift({
      ...msg,
      replies: Array.isArray(msg.replies) ? msg.replies : []
    });
    el.value = '';
    render();
    showToast("📣 已發佈一則貼文");
  }catch(e){
    console.error(e);
    showToast("⚠️ 發文失敗，請稍後再試","danger");
  }
}

/* ======= Selection / batch story (admin) ======= */
function toggleSelectionMode(){
  isSelectionMode = !isSelectionMode;
  if (!isSelectionMode) selectedMessages.clear();
  render();
}
function toggleSelection(id){
  if (selectedMessages.has(id)) selectedMessages.delete(id);
  else selectedMessages.add(id);
  render();
}

/* ======= Promo story image ======= */
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}
function wrapText(ctx, text, maxW){
  const chars = Array.from(String(text || ''));
  const lines = [];
  let line = '';
  for (let i=0;i<chars.length;i++){
    const ch = chars[i];
    if (ch === '\n'){ lines.push(line); line=''; continue; }
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line){ lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function canvasToBlob(canvas){
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), 'image/png'));
}
async function shareOrDownload(blob, filename, title=SHARE_TITLE, text=""){
  const file = new File([blob], filename, { type: 'image/png' });
  const data = { files: [file], title, text };

  if (navigator.canShare && navigator.canShare(data)) {
    try { await navigator.share(data); return; }
    catch(e){ if (e.name !== 'AbortError') console.error(e); }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function drawMetalCard(ctx,x,y,w,h,r){
  const g1 = ctx.createLinearGradient(x,y,x+w,y+h);
  g1.addColorStop(0,"rgba(255,255,255,0.22)");
  g1.addColorStop(0.22,"rgba(255,255,255,0.06)");
  g1.addColorStop(0.50,"rgba(0,0,0,0.22)");
  g1.addColorStop(0.78,"rgba(255,255,255,0.10)");
  g1.addColorStop(1,"rgba(255,255,255,0.16)");

  ctx.fillStyle="rgba(0,0,0,0.38)";
  roundRect(ctx,x,y,w,h,r); ctx.fill();

  ctx.fillStyle=g1;
  roundRect(ctx,x+2,y+2,w-4,h-4,r-2); ctx.fill();

  ctx.save();
  ctx.globalAlpha=0.06;
  for (let i=0;i<1100;i++){
    const px = x + Math.random()*w;
    const py = y + Math.random()*h;
    const a = Math.random()*0.85;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(px,py,1,1);
  }
  ctx.restore();

  const g2 = ctx.createLinearGradient(x,y,x+w,y);
  g2.addColorStop(0,"rgba(255,255,255,0.00)");
  g2.addColorStop(0.5,"rgba(255,255,255,0.26)");
  g2.addColorStop(1,"rgba(255,255,255,0.00)");
  ctx.fillStyle=g2;
  roundRect(ctx,x+26,y+28,w-52,10,6); ctx.fill();
}
function fitText(ctx, text, maxWidth, baseSize, minSize, weight=800, family="Arial"){
  let size=baseSize;
  while(size>=minSize){
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minSize;
}
function generatePromoStoryCanvas(){
  const s = promoSettings;
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle="#0a0a0a";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const bg = ctx.createRadialGradient(820,420,40,540,700,900);
  bg.addColorStop(0,"rgba(225,48,108,0.22)");
  bg.addColorStop(0.55,"rgba(131,58,180,0.12)");
  bg.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const cardX=110, cardY=520, cardW=860, cardH=560;
  drawMetalCard(ctx, cardX, cardY, cardW, cardH, 40);

  ctx.textAlign="center";
  ctx.fillStyle="rgba(255,255,255,0.94)";
  const name = String(s.displayName||"Miiduoa").slice(0,24);
  const nameSize = fitText(ctx, name, 860, 72, 46, 900, "Arial");
  ctx.font=`900 ${nameSize}px Arial`;
  ctx.fillText(name, 540, 280);

  ctx.font="700 28px Arial";
  ctx.fillStyle="rgba(255,255,255,0.65)";
  ctx.fillText("想對我說什麼？匿名留言", 540, 340);

  ctx.font="600 28px Arial";
  ctx.fillStyle="rgba(255,255,255,0.60)";
  const tagLines = wrapText(ctx, String(s.tagline||""), 860).slice(0,2);
  tagLines.forEach((ln,idx)=>ctx.fillText(ln, 540, 392 + idx*38));

  ctx.textAlign="left";
  ctx.fillStyle="rgba(255,255,255,0.92)";
  ctx.font="900 44px Arial";
  ctx.fillText(String(s.cta1||"匿名留言給我").slice(0,16), cardX+60, cardY+140);

  ctx.font="700 28px Arial";
  ctx.fillStyle="rgba(255,255,255,0.72)";
  ctx.fillText("Website", cardX+60, cardY+230);

  const siteUrl = String(s.siteUrl || SITE_URL);
  ctx.fillStyle="rgba(255,255,255,0.90)";
  ctx.font="800 30px Arial";
  wrapText(ctx, siteUrl, 740).slice(0,2).forEach((ln,idx)=>ctx.fillText(ln, cardX+60, cardY+280 + idx*42));

  ctx.font="700 28px Arial";
  ctx.fillStyle="rgba(255,255,255,0.72)";
  ctx.fillText("Instagram", cardX+60, cardY+380);

  ctx.font="900 34px Arial";
  ctx.fillStyle="rgba(255,255,255,0.92)";
  ctx.fillText(String(s.igHandle||"@miiduoa").slice(0,20), cardX+60, cardY+430);

  ctx.textAlign="center";
  ctx.font="800 34px Arial";
  ctx.fillStyle="rgba(255,255,255,0.88)";
  ctx.fillText(String(s.cta2||"看更多內容 → IG 主頁").slice(0,26), 540, 1220);

  ctx.font="600 26px Arial";
  ctx.fillStyle="rgba(255,255,255,0.55)";
  const hint = String(s.hint||"").trim();
  if (hint) ctx.fillText(hint.slice(0,40), 540, 1280);

  ctx.font="700 30px Arial";
  ctx.fillStyle="rgba(255,255,255,0.55)";
  ctx.fillText("↑ " + SHARE_TITLE, 540, 1780);

  return canvas;
}

async function sharePromoStory(){
  const canvas = generatePromoStoryCanvas();
  const blob = await canvasToBlob(canvas);
  await shareOrDownload(blob, "miiduoa_story.png", SHARE_TITLE, "分享名片限動");
  showToast("📸 名片限動已產生！到 IG 加上連結貼紙就完成了");
}

/* ======= Batch story (admin) ======= */
async function generateBatchStory(){
  if (!isAdmin) return;
  if (selectedMessages.size === 0) return;

  const selected = messages.filter(m => selectedMessages.has(m.id));
  const messagesPerStory = 3;
  const stories = [];

  for (let i=0;i<selected.length;i+=messagesPerStory){
    const batch = selected.slice(i, i+messagesPerStory);
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0,0,canvas.width,canvas.height);
    grad.addColorStop(0,'#833AB4'); grad.addColorStop(0.5,'#E1306C'); grad.addColorStop(1,'#F77737');
    ctx.fillStyle=grad; ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.globalAlpha=0.08; ctx.fillStyle='#fff';
    [[150,300,200],[900,1500,250],[800,400,100]].forEach(([x,y,r])=>{
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    });
    ctx.globalAlpha=1;

    ctx.font='900 52px Arial';
    ctx.fillStyle='#fff';
    ctx.textAlign='center';
    ctx.fillText('💌 ' + SHARE_TITLE, canvas.width/2, 200);
    const cardStartY=320, cardHeight=400, cardSpacing=40;

    batch.forEach((msg,idx)=>{
      const y = cardStartY + idx*(cardHeight+cardSpacing);

      ctx.fillStyle='rgba(0,0,0,0.35)';
      roundRect(ctx,80,y,920,cardHeight,30); ctx.fill();

      ctx.fillStyle='rgba(255,255,255,0.08)';
      roundRect(ctx,82,y+2,916,cardHeight-4,28); ctx.fill();

      ctx.font='64px Arial';
      ctx.textAlign='center';
      ctx.fillStyle='#fff';
      ctx.fillText(msg.mood, 540, y+84);

      ctx.fillStyle='#ffffff';
      ctx.font='800 34px Arial';
      const lines = wrapText(ctx, msg.text, 820);
      const lineHeight=48, startTextY=y+150;
      lines.slice(0,5).forEach((line,li)=>ctx.fillText(line,540,startTextY+li*lineHeight));

      ctx.font='22px Arial';
      ctx.fillStyle='rgba(255,255,255,0.65)';
      ctx.fillText(`— ${timeAgo(msg.ts)}`, 540, y+cardHeight-40);
    });

    ctx.font='30px Arial';
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText('↑ 留言給我', canvas.width/2, 1800);

    stories.push(canvas);
  }

  for (let i=0;i<stories.length;i++){
    const blob = await canvasToBlob(stories[i]);
    await shareOrDownload(blob, stories.length===1 ? 'story.png' : `story_${i+1}.png`, SHARE_TITLE, 'IG 限動分享');
    if (stories.length>1) await new Promise(r=>setTimeout(r,500));
  }

  showToast(`📸 已生成 ${stories.length} 張限時動態！`);
  isSelectionMode=false;
  selectedMessages.clear();
  render();
}

/* ======= Submit ======= */
let selectedMood = '💬';
function selectMood(mood){
  selectedMood=mood;
  document.querySelectorAll('#mood-selector button').forEach(btn=>{
    const isSelected = btn.dataset.mood === mood;
    btn.style.background = isSelected ? 'rgba(225,48,108,0.2)' : 'rgba(255,255,255,0.05)';
    btn.style.borderColor = isSelected ? 'rgba(225,48,108,0.5)' : 'transparent';
    btn.style.transform = isSelected ? 'scale(1.1)' : 'scale(1)';
  });
}

async function submitMessage(){
  const textarea = document.getElementById('msg-text');
  const text = textarea.value.trim();
  if (!text) return;
  const alias = (document.getElementById('alias-input')?.value || "").trim();

  try {
    const msg = await addMessage(text, selectedMood, alias);
    textarea.value='';
    if (document.getElementById('alias-input')) document.getElementById('alias-input').value='';
    selectedMood='💬';
    openShareModalFor(msg);
  } catch {
    // addMessage 已經有提示
  }
}

/* ======= Login submit ======= */
function submitLogin(){
  const pwd=document.getElementById('admin-pwd').value;
  if (!pwd) return;
  handleLogin(pwd);
  document.getElementById('admin-pwd').value='';
}
function togglePwdVisibility(){
  const input=document.getElementById('admin-pwd');
  input.type = input.type==='password' ? 'text' : 'password';
}

/* ======= Render ======= */
function render(){
  const app=document.getElementById('app');

  if (currentPage==='home'){
    app.innerHTML = renderSubmitPage();
    const textarea=document.getElementById('msg-text');
    const counter=document.getElementById('char-count');
    textarea.addEventListener('input', ()=>{
      counter.textContent = `${textarea.value.length}/500`;
      counter.style.color = textarea.value.length>450 ? 'var(--color-no)' : 'var(--color-sub)';
    });
  } else if (currentPage==='wall'){
    app.innerHTML = renderWallPage();
  } else if (currentPage==='profile'){
    app.innerHTML = renderProfilePage();
  } else if (currentPage==='admin'){
    if (!isAdmin) {
      app.innerHTML = renderLoginPage();
      initLoginForm();
    } else {
      app.innerHTML = renderAdminPanel();
      updateSessionTimer();
      initAdminPostSection();
    }
  }
}

// 綁定全域導覽列（避免依賴 inline onclick，符合嚴格 CSP）
function initGlobalNav(){
  const title = document.querySelector('.nav-title');
  if (title) {
    title.addEventListener('click', function(){ showPage('home'); });
  }
  const navBtns = document.querySelectorAll('.nav-btn');
  for (let i = 0; i < navBtns.length; i++) {
    (function(btn){
      const page = btn.getAttribute('data-page') || 'home';
      btn.addEventListener('click', function(){ showPage(page); });
    })(navBtns[i]);
  }
}

// 綁定管理登入表單事件（避免依賴 inline onclick）
function initLoginForm(){
  const input = document.getElementById('admin-pwd');
  const btn = document.getElementById('admin-login-btn');
  const toggle = document.getElementById('admin-pwd-toggle');

  if (btn) {
    btn.addEventListener('click', function () {
      submitLogin();
    });
  }
  if (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        submitLogin();
      }
    });
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      togglePwdVisibility();
    });
  }
}

function updateSessionTimer(){
  if (sessionTimerInterval) return;
  sessionTimerInterval=setInterval(()=>{
    if (!isAdmin) return;
    const elapsed=Date.now()-sessionStart;
    const left=SESSION_TIMEOUT - elapsed;
    if (left<=0){ handleLogout(); return; }
    const min=Math.floor(left/60000);
    const sec=Math.floor((left%60000)/1000);
    const timer=document.getElementById('session-timer');
    if (timer) timer.textContent = `⏱ ${min}:${sec<10?'0':''}${sec}`;
  },1000);
}

/* ======= 活動感（新留言通知輪詢） ======= */
async function pollNewMessages(){
  try{
    const headers = { 'Accept': 'application/json' };
    if (adminToken) headers['X-Admin-Token'] = adminToken;
    const res = await fetch('/api/messages', { headers });
    if (!res.ok) throw new Error('poll failed');
    const raw = await res.json();
    if (!Array.isArray(raw)) return;
    const data = raw.map(m => ({
      ...m,
      replies: Array.isArray(m.replies) ? m.replies : []
    }));

    const latestTs = data.reduce((max,m)=>Math.max(max, m.ts || 0), 0);
    const prevTs = lastSeenMessageTs || 0;

    // 找出真正比之前新的留言
    const newly = data
      .filter(m => (m.ts || 0) > prevTs)
      .sort((a,b)=>(a.ts||0)-(b.ts||0));

    messages = data;

    if (newly.length > 0){
      // 只顯示最近幾則，避免刷屏
      const slice = newly.slice(-3);
      slice.forEach((m, idx) => {
        const alias = m.alias || "匿名訪客";
        const delay = idx * 800;
        setTimeout(()=>{
          showToast(`💌 「${alias}」剛剛留了一則匿名訊息`, 'success');
        }, delay);
      });
      if (currentPage === 'wall'){
        render();
      }
    }

    lastSeenMessageTs = latestTs;
  }catch(e){
    console.error(e);
    // 輪詢失敗就暫時忽略，下次再試
  }
}

function startActivityWatcher(){
  if (activityTimer) return;
  // 先抓目前已載入留言的最新時間，避免一進站就刷一堆舊通知
  lastSeenMessageTs = messages.reduce((max,m)=>Math.max(max, m.ts || 0), 0);
  activityTimer = setInterval(pollNewMessages, 20000); // 每 20 秒輪詢一次
}

/* Boot */
initAvatarPicker();
updateAvatarUI();

async function boot(){
  initGlobalNav();
  await fetchSettingsFromServer();
  await loadMessages();
  render();
  handleHashEdit();
  startActivityWatcher();
}
boot();

window.addEventListener("hashchange", handleHashEdit);

