/** S3 版本对象目录前缀。WebDAV 用 WEBDAV_BACKUP_DIR（WebdavProvider 内），不共享此常量。 */
export const BACKUP_PREFIX = 'octane/backup/';
/** snapshot 版本文件名前缀（两 provider 共享）。完整名 = `${BACKUP_VERSION_PREFIX}${dev8}-${exportedAt}-${rand8}`。 */
export const BACKUP_VERSION_PREFIX = 'octane-backup-';
/** latest 固定 key（覆盖式，restore 默认 GET 它；retention 永不删）。S3=相对路径；WebDAV 由 provider 拼 `${baseUrl}${WEBDAV_BACKUP_DIR}/octane-backup.json`。 */
export const BACKUP_OBJECT_KEY = 'octane/backup/octane-backup.json';
/** 设备标识 chrome.storage.local key（首次 crypto.randomUUID() 生成并持久化；dev8 = 前 8 位入 snapshot 文件名）。 */
export const DEVICE_ID_KEY = 'octane.deviceId';
/** retention：每设备保留最近 snapshot 数（per-device，防跨设备挤占）。 */
export const MAX_SNAPSHOTS_PER_DEVICE = 5;
/** retention：全局兜底上限（所有设备 snapshot 总数硬上限，有界 ≤100）。 */
export const MAX_SNAPSHOTS_GLOBAL = 100;
