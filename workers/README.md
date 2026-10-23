# NovelAI Shared Queue Worker

这个 Worker 使用 Cloudflare Durable Objects，按 NAI API Key 的哈希值建立共享队列，避免多个客户端同时使用同一个 Key 发起生图。

## 部署与启用

1. 在插件根目录执行 `npx wrangler deploy -c workers/wrangler.nai-queue.jsonc`。
2. 代码修改后需要重新执行部署命令，本地 `workers/nai-queue-worker.js` 不会自动更新线上 Worker。
3. 在小手机 `设置 -> 生图设置 -> NovelAI / NAI` 中选择“官方站点”。
4. 把部署后的 Worker 地址填入“共享队列服务 URL”。留空、选择公益站点或选择自定义地址时，手机会直接请求 NovelAI，不会经过共享队列。

队列只能协调使用同一个 Worker 地址并提交相同 NAI Key 的客户端。没有接入该 Worker 的其他程序仍可能占用 NovelAI 上游生成锁，手机端会在收到明确的并发锁响应后等待并自动重试。

## 队列异常恢复

- 轮到等待中的任务时，先预留 30 秒；客户端通过原有 `/my-turn` 查询领取后才开始完整生成租期。未领取的任务会在后续队列请求中清理，不再占用 8～12 分钟。
- 已领取任务由手机端每 15 秒续租；心跳失联超过 1 分钟、或任务总计超过 12 分钟时过期。兼容 `/join-queue` 客户端仍免心跳，最多 12 分钟。服务端不能确认上游是否还在生成，因此保留多次心跳容错，避免网络抖动误释放正常任务。
- 完成或退出已领取任务必须提交有效的 `token` / `lock_token`；尚未领取的等待任务可凭原 `user_id` 取消。
- 同一浏览器的多个等待任务分别保留，按顺序执行。
- Worker 与小手机端代码需同时更新：重新部署 Worker，并更新插件文件，确保 15 秒心跳与 1 分钟失联租期配套生效。

# Doubao Voice Clone Worker

这个 Worker 用于代理豆包音色复刻接口，避免浏览器直连 `openspeech.bytedance.com` 时遇到跨域限制。

## 部署

1. 在 Cloudflare Workers 新建一个 Worker。
2. 把 `doubao-clone-worker.js` 的内容复制进去。
3. 部署后拿到 `https://xxx.workers.dev` 地址。
4. 在小手机 `设置 -> 语音 TTS -> 火山引擎（豆包） -> 豆包音色复刻` 填入 Worker 地址。

## 接口

- `POST /api/clone`
- `POST /api/status`

Worker 不内置任何 Token，也不保存数据。用户的 `Access Token`、`APP ID`、`Speaker ID` 会随请求发送到该 Worker，再由 Worker 转发给豆包接口。

# MiMo TTS Relay Worker

这个 Worker 用于代理 MiMo 公益站 / New API 的 OpenAI 兼容 TTS 接口，以及 MiMo 官方 chat/completions 复刻接口，避免浏览器直连 `/v1/audio/speech`、`/v1/chat/completions` 或 `/v1/models` 时遇到跨域限制。

## 部署

1. 在 Cloudflare Workers 新建一个 Worker。
2. 把 `mimo-tts-relay-worker.js` 的内容复制进去。
3. 部署后拿到 `https://xxx.workers.dev` 地址。
4. 在小手机 `设置 -> 语音 TTS -> 通用 TTS / MiMo -> MiMo Worker 中转` 填入 Worker 地址。

## 接口

- `POST /api/speech`
- `POST /api/chat`
- `POST /api/models`

Worker 不内置任何 API Key，也不保存数据。用户填写的公益站地址和 Key 会随请求发送到该 Worker，再由 Worker 转发到公益站。
