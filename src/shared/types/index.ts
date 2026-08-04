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
  /** 分类内排序，0 起（v4→v5 迁移按 createdAt ASC, id ASC 回填） */
  order: number;
  /**
   * Bookmark Tag 数组（Issue #47）。去重后最多 20 个，每个最多 32 字符，不含空白。
   * 历史书签由 DB v5→v6 迁移回填空数组。规则见 src/shared/utils/tagRules.ts。
   */
  tags: string[];
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

/** 待办优先级 */
export type TaskPriority = 'high' | 'medium' | 'low' | 'none';

/** 待办状态 */
export type TaskStatus = 'active' | 'completed';

/** 待办固定调色板颜色 */
export type TodoColor = 'gray' | 'red' | 'amber' | 'green' | 'cyan' | 'blue' | 'violet' | 'pink';

/** 待办清单 */
export interface TaskList {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  color: TodoColor;
  order: number;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 待办任务 */
export interface Task {
  id: string;
  workspaceId: string;
  listId: string | null;
  containerKey: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string | null;
  status: TaskStatus;
  order: number;
  completedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 待办检查项 */
export interface ChecklistItem {
  id: string;
  taskId: string;
  text: string;
  isCompleted: boolean;
  completedAt: number | null;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** 待办标签 */
export interface TaskTag {
  id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  color: TodoColor;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** 待办任务与标签关联 */
export interface TaskTagAssignment {
  taskId: string;
  tagId: string;
  createdAt: number;
}

/** IndexedDB 数据库名称 */
export const DB_NAME = 'octane-db';

/** IndexedDB 数据库版本号 */
export const DB_VERSION = 7;

/** 第三方 favicon 来源。 */
export type ThirdPartyFaviconSource = 'icon-horse';

/** Favicon 第三方高清缓存记录（per-hostname 去重）。 */
export interface FaviconRecord {
  /** 主键：hostname（new URL().hostname），同站多书签共享一份 */
  hostname: string;
  /** 验证并规范化后的 64×64 PNG；失败冷却记录可无 blob */
  blob?: Blob;
  source?: ThirdPartyFaviconSource;
  mimeType?: string;
  width?: number;
  height?: number;
  fetchedAt?: number;
  expiresAt?: number;
  /** 成功缓存版本 ID，用于避免迟到的图片错误删除更新版本。 */
  cacheId?: string;
  /** 抓取中的跨运行时请求令牌；只有持有当前令牌的请求可以提交结果。 */
  refreshToken?: string;
  refreshMode?: 'normal' | 'force';
  refreshStartedAt?: number;
  /** 最近一次强制刷新的开始时间，阻止更早启动的 normal 请求迟到提交。 */
  lastForceStartedAt?: number;
  /** 第三方全失败后的下次允许重试时间 */
  thirdPartyRetryAt?: number;
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

/**
 * 工作区标签隔离：切出工作区时归档的单个标签条目（rev4 瘦身，只存可恢复字段）。
 * tabs.create 自动重取 title/favicon；active 在切换入口是 home tab 取不到。
 */
export interface TabEntry {
  url: string;
  /** 固定标签（chrome.tabs pinned 状态） */
  pinned?: boolean;
  /** 窗口内顺序，restore 时按 index 重开 */
  order: number;
}

/**
 * 工作区标签会话快照：存 chrome.storage.local 分键 tabSession.<workspaceId>。
 * 切回工作区时按 tabs 顺序 + pinned 恢复（仅 URL 集合，不保页面运行时态）。
 */
export interface TabSession {
  tabs: TabEntry[];
  /** 归档时间戳 */
  savedAt: number;
}

/** 备份文件 schema 标识 */
export const BACKUP_SCHEMA = 'octane-backup';
/** 当前备份格式版本（v6 起完整包含待办五表） */
export const BACKUP_VERSION = 6;
/** 导入时接受的版本集合（v1-v5 缺少待办五表时规范化为空数组） */
export const ACCEPTED_BACKUP_VERSIONS: readonly number[] = [1, 2, 3, 4, 5, 6];

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

/** 备份数据载荷：书签与待办存储态（contexts 含密文，不解密） */
export interface BackupData {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  contexts: Context[];
  /** v1 旧备份缺失时，解析阶段保留 undefined 以维持历史 pinnedTabs 恢复语义。 */
  pinnedTabs?: PinnedTab[];
  cryptoMetadata: CryptoMetadata | null;
  taskLists: TaskList[];
  tasks: Task[];
  checklistItems: ChecklistItem[];
  taskTags: TaskTag[];
  taskTagAssignments: TaskTagAssignment[];
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
