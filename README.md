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

