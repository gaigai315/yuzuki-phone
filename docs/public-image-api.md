# 柚月小手机公开生图接口 v1

第三方插件提交提示词，使用用户在柚月小手机中配置的正文生图服务，取得图片后自行保存与展示。接口不绑定酒馆正文楼层，也不写入小手机相册。无需读取或传递 API Key。

## 检测与调用

接口挂载于同一酒馆页面的 `window.VirtualPhone.imageAPI`。`version === 1` 表示支持本文契约。小手机发布接口时触发窗口事件 `yuzuki-phone:image-api-ready`，`event.detail.version` 为 `1`。调用方应先检测全局接口，再按需监听事件，兼容双方加载先后顺序。

```js
const api = window.VirtualPhone?.imageAPI;
if (!api || api.version !== 1) throw new Error('请更新并启用柚月小手机');

const status = api.getStatus();
if (!status.ready) throw new Error(`正文生图尚未就绪：${status.code}`);

const controller = new AbortController();
const result = await api.generate({
    prompt: '1girl, garden, sunlight',
    negativePrompt: 'blurry', // 可选
    signal: controller.signal, // 可选，取消时调用 controller.abort()
});

// result.blob 是图片 Blob，交给调用插件自身的文件存储流程。
// 此函数由接入方实现，并非小手机接口：
await saveImageInYourPlugin(result.blob);
```

`getStatus()` 同步返回 `{ version, ready, code, provider, model }`。可用时 `code` 为空字符串；检测只检查基本本地配置，不探测网络、不保证远端服务可用、不判断本次费用。

`generate()` 返回 Promise，成功值为：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| version | number | 固定为 1 |
| blob | Blob | 图片文件数据 |
| mimeType | string | 图片 MIME 类型，如 image/png |
| provider | string | 生图服务商标识 |
| model | string | 生图模型；无可用信息时为空字符串 |
| width / height | number 或 null | 实际图片尺寸，服务商未提供时为 null |
| seed | number 或 null | 返回的种子，无有效种子时为 null |

只接受 `prompt`、`negativePrompt`、`signal`。`prompt` 必须为非空字符串；`negativePrompt` 为额外负面提示词，具体效果取决于服务商能力。正文生图的尺寸、预设、固定提示词、服务商与工作流由小手机当前配置决定；不能通过此接口覆盖密钥、服务商或强行启用生图。不会自动选景或调用正文 TAG 生成流程。

## 失败与取消

失败时抛出 Error，通过 `error.code` 判断，勿依赖错误文案：

| code | 含义 |
| --- | --- |
| NOT_READY | 小手机生图管理器尚未就绪 |
| DISABLED | 用户未启用生图 |
| NOT_CONFIGURED | 缺少必要配置 |
| UNSUPPORTED_PROVIDER | 当前服务商不受支持 |
| INVALID_ARGS | 参数无效或包含未支持的字段 |
| ABORTED | 任务取消，error.name 为 AbortError |
| GENERATION_FAILED | 上游生成失败 |
| INVALID_RESULT | 未取得有效图片，或返回了视频 |

取消信号传给生图请求和图片读取流程；远端任务是否停止取决于服务商。取消后的结果不会交付给调用方，取消不保证免除上游费用。调用方切换聊天、关闭任务时应取消自己的请求。

调用会使用用户已配置的服务，可能产生费用。接口不判断是否免费，也不弹出费用确认；接入方应明确呈现生成操作，自动生成应取得用户授权。

返回的 Blob 由调用方负责存储。预览可使用 `URL.createObjectURL(result.blob)`，不再需要时调用 `URL.revokeObjectURL()`。不要将 Base64 图片存入 localStorage、extensionSettings 或聊天元数据。

## 兼容约定

v1 保留入口、上述输入、返回字段和错误码语义；兼容更新可以增加返回字段和服务商标识，调用方应忽略未知返回字段。不兼容调整应发布新的主版本，并保留 v1 兼容入口。内部的 `imageGenerationManager` 不属于第三方稳定契约，接入方请使用 `imageAPI`。
