/** 工作区 */
export interface Workspace {
  id: string;
  name: string;
  icon: string;
  createdAt: number;
  order: number;
}

/** 分类 */
export interface Category {
  id: string;
  workspaceId: string;
  name: string;
  icon: string;
  order: number;
  createdAt: number;
}

/** 书签 */
export interface Bookmark {
  id: string;
  /** 冗余字段，保证数据完整性 */
  workspaceId: string;
  categoryId: string;
  name: string;
  url: string;
  description: string;
  faviconUrl: string;
  /** 冗余：上下文数量 */
  contextCount: number;
  /** 冗余：是否包含加密上下文 */
  hasEncryptedContext: boolean;
  createdAt: number;
  /** 乐观锁字段，防止并发覆盖 */
  updatedAt: number;
}

/** 上下文类型 */
export enum ContextType {
  NOTE = 'note',
  // 未来扩展:
  // CREDENTIAL = 'credential',
  // CONFIG = 'config',
}

/**
 * 上下文（内部存储模型）
 *
 * 一个书签可以拥有多个上下文条目。
 * content 是运行时明文，不持久化到 IndexedDB。
 * 加密时 content→encryptedData，解密时 encryptedData→content。
 */
export interface Context {
  id: string;
  /** 索引，关联书签 */
  bookmarkId: string;
  /** 上下文类型 */
  type: ContextType;
  /** 上下文标题，在列表中区分不同条目 */
  title: string;
  /** 运行时明文，不持久化 */
  content: string;
  isEncrypted: boolean;
  /** base64, AES-GCM-256 ciphertext */
  encryptedData?: string;
  /** 每次加密随机生成 */
  iv?: string;
  /** 预留排序字段，v1 不暴露 API，默认按 createdAt 升序 */
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** 加密元数据（全局单例） */
export interface CryptoMetadata {
  id: 'singleton';
  /** base64, 16 字节随机盐 */
  salt: string;
  iterations: number;
  algorithm: string;
  /**
   * 密码验证器：setup 时用派生 key 加密固定明文得到。
   * unlock 时尝试解密它来校验密码正确性（解密失败=密码错）。
   * 旧版本 meta 无此字段，检测到需引导重设密码。
   */
  verifier?: {
    encryptedData: string;
    iv: string;
  };
  createdAt: number;
}

/** IndexedDB 数据库名称 */
export const DB_NAME = 'octane-db';

/** IndexedDB 数据库版本号 */
export const DB_VERSION = 4;

/** Favicon 缓存记录（per-hostname 去重） */
export interface FaviconRecord {
  /** 主键：hostname（new URL().hostname），同站多书签共享一份 */
  hostname: string;
  /** 原始图片字节 */
  blob: Blob;
  /** image/png 等，用于诊断 */
  mimeType: string;
  /** 抓取时间戳；永久缓存（D2），仅手动刷新或 URL 变更时失效 */
  fetchedAt: number;
}

/**
 * 常驻标签（Per-Workspace Pinned Tab）
 *
 * 独立实体（非 Bookmark 字段）：与书签完全解耦，无 faviconUrl（走 useFavicon 懒加载）、
 * 无 sourceBookmarkId。per-workspace 跨分类（切分类不动，切工作区联动）。
 * order 字段 v1 按数组顺序展示，v1.5 启用拖拽重排。
 */
export interface PinnedTab {
  id: string;
  /** 索引，关联工作区 */
  workspaceId: string;
  name: string;
  url: string;
  /** 排序字段，v1 按数组顺序展示；v1.5 启用拖拽重排 */
  order: number;
  createdAt: number;
}

/** 备份文件 schema 标识 */
export const BACKUP_SCHEMA = 'octane-backup';
/** 当前备份格式版本（导出时写入；v2 起含 pinnedTabs，v3 起含 kind） */
export const BACKUP_VERSION = 3;
/** 导入时接受的版本集合（v1 旧备份缺 pinnedTabs；v1/v2 无 kind → 默认 backup） */
export const ACCEPTED_BACKUP_VERSIONS: readonly number[] = [1, 2, 3];

/** 备份文件种类：backup=全量覆盖恢复（灾备），share=部分合并导入（分享） */
export type BackupKind = 'backup' | 'share';

/**
 * 分享选择集：导出方勾选 + 接收方再勾选共用同一 shape。
 * workspaceIds 整选 → 含其全部分类 + pinnedTabs；
 * categoryIds 在未整选的工作区内挑部分分类 → 连带其书签。
 */
export interface ShareSelection {
  /** 选中的工作区 ID（整选 → 含其全部分类 + pinnedTabs） */
  workspaceIds: string[];
  /** 选中的分类 ID（在未整选的工作区内挑部分分类 → 连带其书签） */
  categoryIds: string[];
}

/** 备份数据载荷：6 表存储态（contexts 含密文，不解密） */
export interface BackupData {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  contexts: Context[];
  /**
   * 常驻标签（v4 起）。v1 旧备份无此字段 → 解析时补 []（T3 BackupService 处理）；
   * 此处保持 optional 以便 T1 数据层先行、向后解析不报错。
   */
  pinnedTabs?: PinnedTab[];
  cryptoMetadata: CryptoMetadata | null;
}

/** 备份文件顶层结构 */
export interface BackupFile {
  schema: typeof BACKUP_SCHEMA;
  version: number;
  /** v3 起；缺失（v1/v2 旧文件）→ 解析时默认 'backup'（向后兼容） */
  kind?: BackupKind;
  exportedAt: number;
  appVersion: string;
  data: BackupData;
}
