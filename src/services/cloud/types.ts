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
 * 云服务商策略契约（策略模式）。
 * 新增服务商：实现此接口 + 在 providers/index.ts 注册，UI 通用渲染。
 */
export interface CloudStorageProvider {
  readonly id: ProviderId;
  /** 显示名，用于 Tab 标题。 */
  readonly label: string;
  /** 配置表单字段元信息，驱动 UI 渲染。 */
  readonly configFields: readonly ConfigFieldDef[];
  /** 测试连通性：以当前凭证能否访问 bucket；失败 throw。 */
  testConnection(config: CloudStorageConfig): Promise<void>;
  /** 上传备份（覆盖固定 key）。 */
  uploadBackup(config: CloudStorageConfig, blob: Blob): Promise<void>;
  /** 下载备份。 */
  downloadBackup(config: CloudStorageConfig): Promise<Blob>;
}
