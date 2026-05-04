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
