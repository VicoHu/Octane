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
  /** 快速判断是否有笔记 */
  hasNote: boolean;
  /** 快速判断笔记是否加密（卡片显示锁图标） */
  isNoteEncrypted: boolean;
  createdAt: number;
  /** 乐观锁字段，防止并发覆盖 */
  updatedAt: number;
}

/**
 * 笔记（内部存储模型）
 *
 * content 是运行时明文，不持久化到 IndexedDB。
 * 加密时 content→encryptedData，解密时 encryptedData→content。
 * 业务层通过 NoteService 访问，始终拿到明文。
 */
export interface Note {
  bookmarkId: string;
  /** 运行时明文，不持久化 */
  content: string;
  isEncrypted: boolean;
  /** base64, AES-GCM-256 ciphertext */
  encryptedData?: string;
  /** 每次加密随机生成 */
  iv?: string;
  updatedAt: number;
}

/** 加密元数据（全局单例） */
export interface CryptoMetadata {
  id: 'singleton';
  /** base64, 16 字节随机盐 */
  salt: string;
  iterations: number;
  algorithm: string;
  createdAt: number;
}

/** IndexedDB 数据库名称 */
export const DB_NAME = 'octane-db';

/** IndexedDB 数据库版本号 */
export const DB_VERSION = 1;
