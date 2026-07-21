/**
 * S3 兼容服务商预设（枚举锁，无 custom）。
 * endpoint 由 preset + region 推导，不暴露自由输入。
 */
export type S3Preset = 'aliyun' | 'tencent';

/**
 * WebDAV 服务商预设（枚举锁，目前仅坚果云；下拉结构为后续扩展保留）。
 */
export type WebdavPreset = 'jianguoyun';

/** 云服务商标识。枚举锁：S3（阿里/腾讯）+ WebDAV（坚果云）。 */
export type ProviderId = 's3' | 'webdav';

/** 单个服务商的连接配置（明文，仅存在于内存/解锁态，绝不入盘）。字段按 provider 按需填。 */
export interface CloudStorageConfig {
  // 通用（S3 用）
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  // S3
  s3Preset?: S3Preset;
  // WebDAV
  webdavPreset?: WebdavPreset;
  /** WebDAV / 坚果云账号（邮箱）。 */
  username?: string;
  /** WebDAV / 坚果云应用密码（非登录密码）。 */
  password?: string;
}

/** 驱动 UI 表单动态渲染的字段定义：新服务商声明字段即可，无需改 UI。 */
export interface ConfigFieldDef {
  name: keyof CloudStorageConfig;
  label: string;
  type: 'text' | 'password' | 'select';
  /** type='select' 时的候选。 */
  options?: string[];
  required: boolean;
  placeholder?: string;
}

/**
 * 单个备份版本的元信息（list 返回，不下载 blob）。双层方案：固定 latest + UUID snapshot。
 */
export interface BackupVersion {
  /** 版本 id（snapshot 文件名去前缀去 .json）。作为 downloadBackup/deleteBackup 的 versionId。 */
  id: string;
  /** 完整 key（S3=相对对象路径，WebDAV=完整 URL），provider 内部定位用。 */
  key: string;
  /** 设备标识前 8 位（dev8）。retention 按 device 分组。 */
  device: string;
  /** 数据生成时间戳（毫秒，blob.exportedAt，非上传完成时间）。权威排序源（不依赖不可靠的 Last-Modified）。 */
  timestamp: number;
  /** 字节数。近似，仅展示。 */
  size: number;
}

/**
 * 云端完全无备份（latest 也不存在；restoreFromCloud/downloadBackup 不传 versionId 时 latest 404）抛出。
 * UI 用 instanceof 区分「云端空」与「网络错误」，不靠字符串匹配。
 */
export class EmptyBackupListError extends Error {
  constructor() {
    super('云端无备份');
    this.name = 'EmptyBackupListError';
  }
}

/**
 * 云服务商策略契约（策略模式）。
 * 新增服务商：实现此接口 + 在 providers/index.ts 注册，UI 通用渲染。
 *
 * 双层版本快照（固定 latest + UUID snapshot per-device）：
 * - latest = 固定 key（覆盖写），restore 默认 GET 它（1 RTT），retention 永不删；
 * - snapshot = octane-backup-{dev8}-{exportedAt}-{rand8}.json（create-only 追加），仅打开历史时 LIST。
 */
export interface CloudStorageProvider {
  readonly id: ProviderId;
  /** 显示名，用于 Tab 标题。 */
  readonly label: string;
  /** 配置表单字段元信息，驱动 UI 渲染。 */
  readonly configFields: readonly ConfigFieldDef[];
  /** 测试连通性 + 试 LIST/列目录权限（早发现 ListBucket/列目录缺失或 CORS）；失败 throw。 */
  testConnection(config: CloudStorageConfig): Promise<void>;
  /**
   * 上传：PUT latest（固定 key 覆盖）+ PUT snapshot（create-only，If-None-Match:*；412→重生成 rand8 重试≤3）。
   * 返回 latest 与 snapshot 两个版本的元信息。
   */
  uploadBackup(
    config: CloudStorageConfig,
    blob: Blob,
  ): Promise<{ latest: BackupVersion; snapshot: BackupVersion }>;
  /** 列出全部 snapshot 版本（不含 latest），按 timestamp（exportedAt）倒序。空列表返回 []。 */
  listBackups(config: CloudStorageConfig): Promise<BackupVersion[]>;
  /**
   * 下载：不传 versionId = GET latest（固定 key，1 RTT）；传 = GET snapshot。
   * latest 404 = 云端完全无备份；snapshot 404 = 版本已被清理（陈旧，UI 提示刷新列表）。
   */
  downloadBackup(config: CloudStorageConfig, versionId?: string): Promise<Blob>;
  /** 删除指定 snapshot 版本（versionId 严格校验，永不删 latest）。 */
  deleteBackup(config: CloudStorageConfig, versionId: string): Promise<void>;
}
