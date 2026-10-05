# Anyone｜Anonymous Feedback Service

一個小型 Express 匿名留言服務，重點放在「匿名內容可以投稿，但管理權限與未公開內容不能一起被放出去」。

## 主要流程

```text
anonymous message
      ↓
pending state
      ↓
public response redacts pending content
      ↓
admin moderation
      ↓
public / hidden
```

管理操作使用短期 token；token 綁定 request IP 與 User-Agent。

## Security decisions

- `helmet` 提供常見 HTTP security headers。
- admin login 與 anonymous submit 各自 rate limit。
- production 啟動時 **必須設定 `CORS_ORIGINS`**，不再因漏設定而自動允許所有瀏覽器來源。
- admin password comparison 使用 Node `crypto.timingSafeEqual` 的固定長度 digest。
- session / message IDs 使用 `crypto.randomBytes`，不依賴額外 token library。
- hidden message 不對一般訪客下發。
- pending message 對一般訪客只回傳 placeholder，不回原文。
- anonymous author 只能持有正確 `editKey` 時修改自己的文字。
- 管理欄位需要 admin token。
- media upload 有 MIME 類型與檔案大小限制。

## 執行

```bash
npm ci

# development
npm run dev

# production
NODE_ENV=production \
ADMIN_PASSWORD="use-a-long-random-secret" \
CORS_ORIGINS="https://example.com" \
npm start
```

## Tests

```bash
npm test
```

目前 CI 先驗證不需要啟動 server 的 security primitives：

- secret comparison
- random token length / uniqueness
- development CORS behavior
- production origin whitelist
- non-browser request behavior

另外會跑：

```bash
node --check server.js
```

確保 server entrypoint 至少能被 Node parser 正確解析。

## Storage

目前 message / settings 使用本機 JSON files：

```text
data/messages.json
data/settings.json
data/media/
```

這讓原型很容易搬移，但正式多 instance 部署會有一致性問題；如果要水平擴展，應換成 shared database / object storage。

## Known limitations

- admin sessions 在 process memory，重啟後失效。
- JSON file persistence 不適合多 instance。
- CSP 目前因舊前端仍包含 inline script/style 而關閉；這是明確的待改善安全債。
- IP + User-Agent binding 是額外 session constraint，不應被視為完整裝置認證。
- 目前測試聚焦 security helpers，HTTP route integration coverage 還不完整。

這個 repo 的重點不是做一個「匿名牆 UI」，而是把 moderation boundary、pending-content privacy 與 deployment security 做清楚。
