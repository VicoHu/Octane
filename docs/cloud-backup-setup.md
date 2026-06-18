# 云备份配置指南（用户侧）

octane 云备份直连你的对象存储桶（阿里云 OSS / 腾讯云 COS）。使用前需在云控制台完成两件事：

## 1. 桶 CORS 配置（硬前置，否则连接失败）

在 OSS / COS 桶的「跨域设置 / CORS」加一条规则：

- **来源 Origin**：`chrome-extension://<你的扩展ID>`（调试期可暂用 `*`）
- **允许 Methods**：`GET`、`PUT`、`HEAD`
- **允许 Headers**：`*`
- **暴露 Headers**：`ETag`

未配 CORS 时，octane 的「测试连接」会失败并提示检查 CORS。

## 2. 最小权限子账号 AK/SK

**强烈建议**为云备份单独创建子账号（RAM 用户 / 子用户），仅授权目标桶的读写，不要用主账号密钥：

- **OSS**：授予指定 bucket 的 `oss:PutObject` / `oss:GetObject` / `oss:GetBucketInfo` 权限。
- **COS**：授予指定 bucket 的读写 + `cos:HeadBucket`。

## 3. 安全说明

AK/SK 经你的主密码 AES-GCM 加密后存储于本机 `chrome.storage.local`，不会明文落盘。使用云备份前需先解锁主密码。
