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
export const DB_VERSION = 2;

/** 备份文件 schema 标识 */
export const BACKUP_SCHEMA = 'octane-backup';
/** 备份格式版本（schema 变更时递增；校验仅接受已知版本） */
export const BACKUP_VERSION = 1;

/** 备份数据载荷：5 表存储态（contexts 含密文，不解密） */
export interface BackupData {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  contexts: Context[];
  cryptoMetadata: CryptoMetadata | null;
}

/** 备份文件顶层结构 */
export interface BackupFile {
  schema: typeof BACKUP_SCHEMA;
  version: number;
  exportedAt: number;
  appVersion: string;
  data: BackupData;
}
