# 云备份配置指南（用户侧）

octane 云备份直连两类存储：**S3 兼容存储**（阿里云 OSS / 腾讯云 COS，走 S3 协议）与**坚果云 WebDAV**。在扩展「设置 → 数据备份」里选对应 Tab，填凭证即可。备份文件固定覆盖式写入单文件，无历史版本。

## CORS：通常无需配置

扩展已在 manifest 声明 `host_permissions`（`*.aliyuncs.com` / `*.myqcloud.com` / `dav.jianguoyun.com`）。浏览器**不对扩展页面的这些云请求做 CORS 限制**，因此绝大多数情况下你无需在桶/服务端配置 CORS。若你另有从网页（非扩展）访问该桶的需求，才需单独配 CORS。

## S3 兼容存储（阿里云 OSS / 腾讯云 COS）

填：**服务商 preset**（阿里云 / 腾讯云）、**Region**、**Bucket**、**AccessKeyId / AccessKeySecret**。endpoint 由 preset + region 自动推导，无需手填。

- **阿里云**：Region 形如 `oss-cn-hangzhou`；走 S3 兼容域名 `s3.{region}.aliyuncs.com`（桶 vhost 风格）。
- **腾讯云**：Region 形如 `ap-guangzhou`；Bucket 形如 `名称-APPID`；走 `cos.{region}.myqcloud.com`（vhost，2024-01-01 后新建桶仅支持 vhost）。

### 最小权限子账号 AK/SK
**强烈建议**为云备份单独建子账号（RAM 用户 / 子用户），仅授权目标桶的读写，不要用主账号密钥：
- 授予指定 bucket 的对象读写 + 桶 `HEAD`/`ListBucket` 权限（阿里云 `oss:PutObject`/`oss:GetObject`/`oss:ListBucket`；腾讯云对应读写 + HeadBucket）。

## 坚果云 WebDAV

填：**服务商 preset**（坚果云）、**账号**（坚果云注册邮箱）、**应用密码**。

> 应用密码**不是**登录密码。在坚果云「账户信息 → 安全选项 → 第三方应用管理」生成，专用于 WebDAV 第三方接入。

备份落在坚果云 `dav/octane/octane-backup.json`（首次上传自动建 `octane/` 目录）。注意坚果云免费档有流量/频率限制，备份是低频覆盖写，正常使用不触发。

## 安全说明

所有凭证经你的主密码 AES-GCM 加密后存储于本机 `chrome.storage.local`，绝不明文落盘。使用云备份前需先设置/解锁主密码；未配置或锁定时「测试连接」与上传/下载会提示先解锁。
