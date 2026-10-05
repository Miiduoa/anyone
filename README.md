# Anonymous Feedback Security Lab

[![ci](https://github.com/Miiduoa/anyone/actions/workflows/ci.yml/badge.svg)](https://github.com/Miiduoa/anyone/actions/workflows/ci.yml)

匿名留言牆，但重點不是「能留言」而已。

這個專案把匿名回饋常見的幾個後端問題一起處理：審核流程、重複送出、管理員操作紀錄、速率限制、敏感內容不外洩，以及媒體上傳邊界。

## 這版做了什麼

- 匿名留言預設進 `pending`，未審核原文不會直接下發給一般訪客
- `Idempotency-Key` 防止手機網路重送造成重複留言
- 管理操作寫入 append-only JSONL audit trail
- audit 只記 action / message id / 狀態，不複製留言內容或 IP
- 管理員 session 綁定 IP + User-Agent，並有登入 rate limit
- 匿名送出 API 有獨立 rate limit
- CORS allowlist、Helmet、安全媒體副檔名處理
- 管理員才能改公開狀態、置頂、刪除與上傳媒體
- 核心 policy 用 Node.js built-in test runner 測試
- GitHub Actions 會跑 syntax check + tests

## Threat model

這個版本主要處理幾個明確風險：

- **重複送出**：行動網路 timeout / retry 不應產生兩筆留言。
- **未審核內容外洩**：pending 原文不能因為前端隱藏方式不完整而被 API 直接讀走。
- **管理端暴力嘗試**：登入端點需要獨立 rate limit。
- **跨站呼叫**：production 僅允許明確設定的 browser origins。
- **審核紀錄過度蒐集**：audit trail 不複製留言正文、IP 或 User-Agent。
- **管理 session 被直接重用**：session 有時效，並綁定建立時的 IP + User-Agent。

目前沒有宣稱可以抵抗：

- 多 instance / distributed session consistency
- DDoS
- malware scanning
- 真正的匿名網路層保護
- database-level transaction / row locking

所以它是一個 security-conscious 單機服務，不是完整匿名通訊平台。

## API 重點

```text
POST   /api/messages
GET    /api/messages
GET    /api/messages/:id
PATCH  /api/messages/:id
DELETE /api/messages/:id

POST   /api/admin/login
POST   /api/admin/logout
GET    /api/admin/audit

GET    /api/stats
POST   /api/upload-media
```

### Idempotent create

同一次送出可以帶一個 8–128 字元的 `Idempotency-Key`：

```http
POST /api/messages
Idempotency-Key: device-20261005-0001
Content-Type: application/json

{"text":"這是一則匿名留言"}
```

如果前端因 timeout 重送同一個 key，後端會回傳原本建立的訊息，不再新增第二筆。

## Moderation audit

`data/moderation-audit.jsonl` 每行是一個操作事件，例如：

```json
{"ts":1791194400000,"action":"status_changed","messageId":"abc123","detail":{"fromStatus":"pending","toStatus":"public"}}
```

刻意不把留言文字、IP、User-Agent 寫進 audit，因為審核紀錄需要可追蹤，但不代表應該多留一份敏感資料。

## Local run

```bash
npm ci

ADMIN_PASSWORD="use-a-long-random-password" \
CORS_ORIGINS="http://localhost:3000" \
NODE_ENV=development \
npm start
```

正式環境必須設定 `CORS_ORIGINS`。

## Test

```bash
npm run check
```

目前 CI 會執行：

- `node --check server.js`
- `node --test`

## Storage trade-off

現在仍使用本機 JSON / JSONL 檔案，方便單機部署與備份。這代表它不適合多 instance 同時寫入。

如果要再往 production 走，下一步會把 message store、idempotency record 與 audit log 拆到交易型資料庫，而不是先把目前的單機版本包裝成「可水平擴充」。

## License

MIT
