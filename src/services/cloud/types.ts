/** 云服务商标识。未来追加：| 'aws' | 'r2' | ... */
export type ProviderId = 'oss' | 'cos';

/** 单个服务商的连接配置（明文，仅存在于内存/解锁态，绝不入盘）。 */
export interface CloudStorageConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** OSS 自定义域名 / COS 可选。 */
  endpoint?: string;
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
