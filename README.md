## Miiduoa 匿名留言牆

簡單的 Express + 靜態前端專案，用來接收與管理「想對 Miiduoa 說什麼」的匿名留言。

### 安裝與啟動

```bash
npm install

# 開發模式（本機使用，CORS 較寬鬆）
npm run dev

# 正式模式（建議設定 NODE_ENV=production）
NODE_ENV=production ADMIN_PASSWORD="一組很長很難猜的密碼" CORS_ORIGINS="https://你的正式網域" node server.js
```

### 必要環境變數

- **ADMIN_PASSWORD**：管理後台登入密碼（只存在伺服器記憶體，不寫入硬碟）。  
  - 建議長度至少 16 碼亂數字元，請透過雲端 Secret / `.env` 管理，不要 commit。
- **CORS_ORIGINS**：允許前端呼叫 API 的網域清單，逗號分隔，例如：
  - `https://miiduoa.com,https://www.miiduoa.com`
  - 若未設定、且非 production 環境，後端會允許所有 Origin，方便本機開發。

### 安全說明（重點）

- 使用 `helmet` 套件加入常見 HTTP 安全標頭。  
- 使用 `express-rate-limit`：
  - 管理員登入有暴力破解防護。
  - 匿名留言 API 有速率限制，降低被刷爆風險。
- 所有留言文字、暱稱、回覆在前端渲染前都會經過 HTML escape，降低 XSS 風險。
- 管理員登入成功後會得到一組隨機 Token：
  - Token 僅存在伺服器記憶體，不寫入 Cookie。
  - Token 與請求的 IP、User-Agent 綁定，不同來源將被拒絕。
- 媒體上傳（圖片 / 影片 / 音檔）僅限管理員：
  - 僅接受 `image/*`、`video/*`、`audio/*` MIME。
  - 副檔名會套用白名單或根據 MIME 改成安全副檔名。
  - 檔案預設上限為 25MB。

## 想對 Miiduoa 說什麼－後端說明

這個專案現在有一個簡單的 Node.js/Express 後端，提供留言的 REST API。

### 安裝

```bash
cd /Volumes/外接硬碟/匿名
npm install
```

### 啟動後端（含靜態前端）

把你的 `index.html` 放在同一個資料夾（也就是這個專案根目錄），然後：

```bash
npm start
```

預設會在 `http://localhost:3000` 提供：

- `/`：靜態前端（你的 HTML）
- `/api/messages`：留言 API
- `/api/stats`：統計 API

### API 一覽

- `GET /api/messages`  
  取得所有留言（陣列）

- `POST /api/messages`  
  Body：`{ text, mood, alias }`  
  回傳建立好的留言物件（含 `id`、`editKey` 等欄位）

- `PATCH /api/messages/:id`  
  Body 可帶任意要更新的欄位：
  - `status`: `"public" | "pending" | "hidden"`
  - `pinned`: `boolean`
  - `liked`: `boolean`
  - `text`: `string`（會順便更新 `editedTs`）
  - `alias`: `string`

- `DELETE /api/messages/:id`  
  刪除指定留言

- `GET /api/stats`  
  回傳 `{ total, pub, pending, hidden }`

資料會存成 `data/messages.json` 檔案，方便你備份或搬移。

