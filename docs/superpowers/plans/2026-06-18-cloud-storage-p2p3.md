# 云存储备份（OSS/COS 策略模式）实现计划 — P2 + P3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 octane 增加对象存储备份——用户可把数据手动上传到阿里云 OSS / 腾讯云 COS 并从云端覆盖恢复，凭证经主密码加密存储。

**Architecture:** 策略模式——`CloudStorageProvider` 接口（`testConnection/uploadBackup/downloadBackup` + `configFields` 驱动 UI）+ OSS/COS 两个实现 + 注册表；`CloudStorageService` 负责凭证 AES-GCM 加密存取与编排（解密后委托策略）；从云恢复完全复用 P1 的 `parseBackupFile` + `octane:apply-import` 覆盖事务。

**Tech Stack:** WXT 0.20, React 19, @douyinfe/semi-ui 2.100, Zustand 5, TypeScript 6, Vitest 4, ali-oss, cos-js-sdk-v5, @types/ali-oss

## Global Constraints

（摘自 spec `docs/superpowers/specs/2026-06-18-cloud-storage-p2p3-design.md`，每个任务的需求隐含包含本节）

- 强制中文：代码注释、日志、Toast 文案、测试描述一律中文。
- AK/SK 经主密码 AES-GCM 加密后存 `chrome.storage.local`（复用 `CryptoService.encrypt/decrypt`）；配置/使用云前必须已解锁。
- 备份对象 key 固定 `octane/backup/octane-backup.json`，覆盖式单文件。
- **上传 = 轻提示（非破坏性，仅 Spin + success Toast）**；**从云恢复 = 破坏性（Modal type=warning + Checkbox「我了解此操作不可撤销」+ danger 按钮）**。
- 沿用现有 Semi UI 主题，禁止引入新配色/字体；每个表单字段必须带可见 `<label>`，禁 placeholder-only；SK 用 `mode="password"`。
- 凭证按 provider 分键存储：`octane.cloudCreds.{providerId}`；上次备份时间 `octane.lastBackupAt.{providerId}`（明文时间戳）。
- 测试命令：`npm test`（= `vitest run`）；构建 `npm run build`。
- 破坏性操作错误一律 `role="alert"`（aria-live 播报）。

---

## File Structure

**Create:**
- `src/services/cloud/types.ts` — `ProviderId` / `CloudStorageConfig` / `ConfigFieldDef` / `CloudStorageProvider` 接口
- `src/services/cloud/constants.ts` — `BACKUP_OBJECT_KEY`
- `src/services/cloud/providers/OssProvider.ts` — ali-oss 实现
- `src/services/cloud/providers/CosProvider.ts` — cos-js-sdk-v5 实现
- `src/services/cloud/providers/index.ts` — `cloudProviders` 注册表 + `getCloudProvider`
- `src/services/CloudStorageService.ts` — 凭证加解密 + 编排
- `src/services/cloud/__tests__/OssProvider.test.ts`
- `src/services/cloud/__tests__/CosProvider.test.ts`
- `src/services/__tests__/CloudStorageService.test.ts`
- `src/components/backup/CloudBackupSection.tsx` — 共享 UI（mirror LocalBackupSection）
- `src/components/backup/CloudBackupSection.module.css`
- `src/components/backup/__tests__/CloudBackupSection.test.tsx`
- `docs/cloud-backup-setup.md` — 用户侧 CORS / AK-SK 配置指南

**Modify:**
- `wxt.config.ts:9` — permissions 加 host_permissions（OSS/COS 域名）
- `package.json:16,25` — 加 `ali-oss`、`cos-js-sdk-v5` 依赖 + `@types/ali-oss` devDep
- `src/services/BackupService.ts` — 抽出 `buildBackupBlob()`
- `src/store/useBackup.ts` — 扩展 cloud actions + 状态
- `src/newtab/components/Sidebar/index.tsx:135` — SideSheet 内渲染 `CloudBackupSection`
- `src/entrypoints/popup/views/SettingsView.tsx:14` — 渲染 `CloudBackupSection`
- `CHANGELOG.md` + `package.json` version → 0.1.3.5

---

## Task 1: 依赖安装 + wxt host_permissions + SDK 环境验证

**Files:**
- Modify: `package.json`
- Modify: `wxt.config.ts:6-9`
- Create: `docs/cloud-backup-setup.md`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `ali-oss` / `cos-js-sdk-v5` / `@types/ali-oss` 可用；OSS/COS 域名 host 权限；SDK 在 WXT 环境可加载（D6 前提验证）。本任务是**前置闸**：若 SDK 无法在 WXT 加载/打包，停止并重开 spec D6。

- [ ] **Step 1: 安装依赖**

```bash
npm install ali-oss cos-js-sdk-v5
npm install -D @types/ali-oss
```

- [ ] **Step 2: 验证安装写入 package.json**

Run: `node -e "const p=require('./package.json'); console.log(p.dependencies['ali-oss'], p.dependencies['cos-js-sdk-v5'], p.devDependencies['@types/ali-oss'])"`
Expected: 三个版本号均非 undefined。

- [ ] **Step 3: wxt.config.ts 加 host_permissions**

修改 `wxt.config.ts`，把 `manifest` 的 `permissions` 改为含 host_permissions 的完整结构：

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Octane',
    description: '书签 + 笔记 + 安全 — 浏览器里最方便的带笔记书签夹',
    permissions: ['storage', 'tabs', 'sidePanel'],
    host_permissions: ['https://*.aliyuncs.com/*', 'https://*.myqcloud.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'",
    },
    icons: {
      '16': 'icons/icon-16.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
});
```

- [ ] **Step 4: 构建验证（SDK 在 WXT 打包可用 = D6 前提闸）**

Run: `npm run build`
Expected: 构建成功，无 ali-oss / cos-js-sdk-v5 解析错误。记录 `.output/chrome-mv3` 下 background chunk 体积（后续若 >500KB 需评估动态 import，但本任务仅记录，不阻断）。

⚠️ 若构建报 SDK 无法打包 / 解析失败 → 停止，回 spec 重开 D6（手写签名回退）。

- [ ] **Step 5: 写用户侧配置指南**

创建 `docs/cloud-backup-setup.md`：

````markdown
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
````

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json wxt.config.ts docs/cloud-backup-setup.md
git commit -m "chore(cloud): 安装 OSS/COS SDK + host_permissions + 配置指南"
```

---

## Task 2: cloud/types.ts + cloud/constants.ts（策略接口）

**Files:**
- Create: `src/services/cloud/types.ts`
- Create: `src/services/cloud/constants.ts`
- Test: `src/services/cloud/__tests__/constants.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ProviderId`（`'oss'|'cos'`）、`CloudStorageConfig`、`ConfigFieldDef`、`CloudStorageProvider` 接口、`BACKUP_OBJECT_KEY`。后续所有 provider / service / UI 任务消费这些。

- [ ] **Step 1: 写 constants 测试（失败）**

创建 `src/services/cloud/__tests__/constants.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { BACKUP_OBJECT_KEY } from '../constants';

describe('cloud constants', () => {
  it('备份对象 key 固定为覆盖式单文件路径', () => {
    expect(BACKUP_OBJECT_KEY).toBe('octane/backup/octane-backup.json');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/services/cloud/__tests__/constants.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 constants.ts**

创建 `src/services/cloud/constants.ts`：

```ts
/** 云备份固定对象 key（覆盖式单文件，无历史版本）。所有 provider 共用。 */
export const BACKUP_OBJECT_KEY = 'octane/backup/octane-backup.json';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/services/cloud/__tests__/constants.test.ts`
Expected: PASS。

- [ ] **Step 5: 写 types.ts**

创建 `src/services/cloud/types.ts`：

```ts
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
```

- [ ] **Step 6: 类型编译验证**

Run: `npx tsc --noEmit`
Expected: 无新增类型错误（types.ts 纯类型 + constants 纯 const）。

- [ ] **Step 7: 提交**

```bash
git add src/services/cloud/
git commit -m "feat(cloud): CloudStorageProvider 策略接口 + 常量"
```

---

## Task 3: CloudStorageService 凭证层（save/get/clear + lastBackupAt）

**Files:**
- Create: `src/services/CloudStorageService.ts`
- Test: `src/services/__tests__/CloudStorageService.test.ts`

**Interfaces:**
- Consumes: `CryptoService.encrypt/decrypt`（base64 `{encryptedData, iv}`，需解锁）；`CloudStorageConfig`、`ProviderId`（Task 2）。
- Produces: `saveCloudConfig(id, config)`、`getCloudConfig(id)`、`clearCloudConfig(id)`、`getLastBackupAt(id)`、`setLastBackupAt(id, ts)`。Task 6 的编排方法与本文件同模块，后续追加。

- [ ] **Step 1: 写凭证层测试（失败）**

创建 `src/services/__tests__/CloudStorageService.test.ts`：

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDB, getDB } from '@/shared/db/database';
import { setupTestKey, setTestKey } from '@/services/CryptoService';
import {
  saveCloudConfig,
  getCloudConfig,
  clearCloudConfig,
  getLastBackupAt,
  setLastBackupAt,
} from '@/services/CloudStorageService';

const cfg = {
  region: 'oss-cn-hangzhou',
  bucket: 'octane-test',
  accessKeyId: 'AKIDxxx',
  accessKeySecret: 'SKyyy',
};

// chrome.storage.local 内存 mock
const localStore: Record<string, unknown> = {};
function installChromeStorageLocal() {
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in localStore) out[k] = localStore[k];
          return out;
        },
        set: async (data: Record<string, unknown>) => {
          Object.assign(localStore, data);
        },
        remove: async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete localStore[k];
        },
      },
    },
  };
}

async function clearAllStores() {
  const db = await getDB();
  const names = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) await tx.objectStore(n).clear();
  await tx.done;
}

beforeEach(async () => {
  resetDB();
  setTestKey(null);
  await getDB();
  await clearAllStores();
  for (const k of Object.keys(localStore)) delete localStore[k];
  installChromeStorageLocal();
});

describe('CloudStorageService 凭证层', () => {
  it('saveCloudConfig → getCloudConfig 往返还原（密文落盘，内存读出明文）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    const got = await getCloudConfig('oss');
    expect(got).toEqual(cfg);
  });

  it('凭证在 storage.local 中为密文（不可读明文 accessKeySecret）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    const raw = localStore['octane.cloudCreds.oss'] as { encryptedData: string; iv: string };
    expect(raw.encryptedData).not.toContain(cfg.accessKeySecret);
    expect(raw.iv).toBeTruthy();
  });

  it('未配置时 getCloudConfig 返回 null', async () => {
    await setupTestKey('main-password-1234');
    expect(await getCloudConfig('cos')).toBeNull();
  });

  it('未解锁时 getCloudConfig 抛错', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    setTestKey(null); // 模拟锁定
    await expect(getCloudConfig('oss')).rejects.toThrow();
  });

  it('clearCloudConfig 移除凭证', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    await clearCloudConfig('oss');
    expect(await getCloudConfig('oss')).toBeNull();
  });

  it('凭证按 provider 分键（oss/cos 互不干扰）', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    await saveCloudConfig('cos', { ...cfg, bucket: 'cos-bucket' });
    expect((await getCloudConfig('oss')).bucket).toBe('octane-test');
    expect((await getCloudConfig('cos')).bucket).toBe('cos-bucket');
  });

  it('lastBackupAt 明文时间戳读写', async () => {
    await setLastBackupAt('oss', 1_700_000_000_000);
    expect(await getLastBackupAt('oss')).toBe(1_700_000_000_000);
    expect(await getLastBackupAt('cos')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/services/__tests__/CloudStorageService.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 CloudStorageService.ts（凭证层部分）**

创建 `src/services/CloudStorageService.ts`：

```ts
import { encrypt, decrypt } from '@/services/CryptoService';
import type { CloudStorageConfig, ProviderId } from '@/services/cloud/types';

/** 凭证存储键（按 provider 分键，密文）。 */
const CREDS_KEY = (id: ProviderId): string => `octane.cloudCreds.${id}`;
/** 上次备份时间键（明文时间戳，非敏感）。 */
const LAST_BACKUP_KEY = (id: ProviderId): string => `octane.lastBackupAt.${id}`;

interface StoredCreds {
  encryptedData: string;
  iv: string;
  savedAt: number;
}

function chromeStorageLocal() {
  const chrome = (globalThis as Record<string, unknown>).chrome as
    | { storage?: { local?: Record<string, unknown> } }
    | undefined;
  const local = chrome?.storage?.local as
    | {
        get: (keys: string | string[]) => Promise<Record<string, unknown>>;
        set: (data: Record<string, unknown>) => Promise<void>;
        remove: (keys: string | string[]) => Promise<void>;
      }
    | undefined;
  if (!local) throw new Error('chrome.storage.local 不可用');
  return local;
}

/** 保存云配置：要求已解锁，凭证经主密码加密后按 provider 分键落盘。 */
export async function saveCloudConfig(id: ProviderId, config: CloudStorageConfig): Promise<void> {
  const { encryptedData, iv } = await encrypt(JSON.stringify(config));
  const stored: StoredCreds = { encryptedData, iv, savedAt: Date.now() };
  await chromeStorageLocal().set({ [CREDS_KEY(id)]: stored });
}

/** 读取云配置：要求已解锁；未配置返回 null。 */
export async function getCloudConfig(id: ProviderId): Promise<CloudStorageConfig | null> {
  const result = await chromeStorageLocal().get(CREDS_KEY(id));
  const raw = result[CREDS_KEY(id)] as StoredCreds | undefined;
  if (!raw) return null;
  return JSON.parse(await decrypt(raw.encryptedData, raw.iv)) as CloudStorageConfig;
}

/** 清除指定 provider 的云配置（安全卫生）。 */
export async function clearCloudConfig(id: ProviderId): Promise<void> {
  await chromeStorageLocal().remove(CREDS_KEY(id));
}

/** 上次备份时间（明文时间戳）。未备份返回 null。 */
export async function getLastBackupAt(id: ProviderId): Promise<number | null> {
  const result = await chromeStorageLocal().get(LAST_BACKUP_KEY(id));
  const ts = result[LAST_BACKUP_KEY(id)] as number | undefined;
  return ts ?? null;
}

/** 记录上次备份时间。 */
export async function setLastBackupAt(id: ProviderId, ts: number): Promise<void> {
  await chromeStorageLocal().set({ [LAST_BACKUP_KEY(id)]: ts });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/services/__tests__/CloudStorageService.test.ts`
Expected: PASS（7 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/services/CloudStorageService.ts src/services/__tests__/CloudStorageService.test.ts
git commit -m "feat(cloud): CloudStorageService 凭证加密存取 + lastBackupAt"
```

## Task 4: OssProvider（ali-oss 策略实现 + mock 测试）

**Files:**
- Create: `src/services/cloud/providers/OssProvider.ts`
- Test: `src/services/cloud/__tests__/OssProvider.test.ts`

**Interfaces:**
- Consumes: `CloudStorageProvider` / `CloudStorageConfig` / `ConfigFieldDef`（Task 2）、`BACKUP_OBJECT_KEY`（Task 2）、`ali-oss`（Task 1）。
- Produces: `OssProvider` 类（实现 `CloudStorageProvider`），供 Task 6 注册表使用。

- [ ] **Step 1: 写 OssProvider 测试（失败）**

创建 `src/services/cloud/__tests__/OssProvider.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BACKUP_OBJECT_KEY } from '../constants';
import { OssProvider } from '../providers/OssProvider';

// ali-oss 默认导出是构造函数；hoisted 共享方法 spy 供断言。
const mocks = vi.hoisted(() => ({
  OSS: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  getBucketInfo: vi.fn(),
}));
vi.mock('ali-oss', () => ({
  default: mocks.OSS.mockImplementation(() => ({
    put: mocks.put,
    get: mocks.get,
    getBucketInfo: mocks.getBucketInfo,
  })),
}));

const cfg = {
  region: 'oss-cn-hangzhou',
  bucket: 'octane-test',
  accessKeyId: 'AKIDxxx',
  accessKeySecret: 'SKyyy',
};

beforeEach(() => {
  mocks.OSS.mockClear();
  mocks.put.mockReset();
  mocks.get.mockReset();
  mocks.getBucketInfo.mockReset();
});

describe('OssProvider', () => {
  const provider = new OssProvider();

  it('元信息：id=oss，label=阿里云 OSS，configFields 含 5 项且 SK 为 password', () => {
    expect(provider.id).toBe('oss');
    expect(provider.label).toBe('阿里云 OSS');
    const names = provider.configFields.map((f) => f.name);
    expect(names).toEqual(['region', 'bucket', 'accessKeyId', 'accessKeySecret', 'endpoint']);
    const sk = provider.configFields.find((f) => f.name === 'accessKeySecret');
    expect(sk?.type).toBe('password');
    expect(sk?.required).toBe(true);
  });

  it('testConnection → 调 getBucketInfo', async () => {
    mocks.getBucketInfo.mockResolvedValue({});
    await provider.testConnection(cfg);
    expect(mocks.getBucketInfo).toHaveBeenCalled();
  });

  it('testConnection 失败 → 透传抛错（如 CORS/认证）', async () => {
    mocks.getBucketInfo.mockRejectedValue(new Error('CORS blocked'));
    await expect(provider.testConnection(cfg)).rejects.toThrow('CORS blocked');
  });

  it('uploadBackup → put(固定 key, blob)，客户端 secure:true', async () => {
    mocks.put.mockResolvedValue({});
    const blob = new Blob(['x']);
    await provider.uploadBackup(cfg, blob);
    expect(mocks.put).toHaveBeenCalledWith(BACKUP_OBJECT_KEY, blob);
    expect(mocks.OSS).toHaveBeenCalledWith(expect.objectContaining({ secure: true, bucket: cfg.bucket }));
  });

  it('uploadBackup 带自定义 endpoint → 客户端传 endpoint', async () => {
    mocks.put.mockResolvedValue({});
    await provider.uploadBackup({ ...cfg, endpoint: 'https://e.example.com' }, new Blob(['x']));
    expect(mocks.OSS).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'https://e.example.com' }));
  });

  it('downloadBackup → get(固定 key) → 返回 Blob', async () => {
    mocks.get.mockResolvedValue({ content: new Uint8Array([1, 2, 3]) });
    const blob = await provider.downloadBackup(cfg);
    expect(mocks.get).toHaveBeenCalledWith(BACKUP_OBJECT_KEY);
    expect(blob).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/services/cloud/__tests__/OssProvider.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 OssProvider.ts**

创建 `src/services/cloud/providers/OssProvider.ts`：

```ts
import OSS from 'ali-oss';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { BACKUP_OBJECT_KEY } from '../constants';

/** 阿里云 OSS 策略实现：签名与直传交给 ali-oss（浏览器构建）。 */
export class OssProvider implements CloudStorageProvider {
  readonly id = 'oss' as const;
  readonly label = '阿里云 OSS';
  readonly configFields: readonly ConfigFieldDef[] = [
    { name: 'region', label: 'Region', type: 'text', required: true, placeholder: 'oss-cn-hangzhou' },
    { name: 'bucket', label: 'Bucket', type: 'text', required: true },
    { name: 'accessKeyId', label: 'AccessKeyId', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'AccessKeySecret', type: 'password', required: true },
    { name: 'endpoint', label: '自定义 Endpoint（可选）', type: 'text', required: false },
  ];

  private buildClient(cfg: CloudStorageConfig) {
    return new OSS({
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      bucket: cfg.bucket,
      endpoint: cfg.endpoint || undefined,
      secure: true, // 强制 HTTPS
    });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    await this.buildClient(cfg).getBucketInfo({ bucket: cfg.bucket });
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    await this.buildClient(cfg).put(BACKUP_OBJECT_KEY, blob);
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const r = await this.buildClient(cfg).get(BACKUP_OBJECT_KEY);
    // ali-oss 浏览器构建中 get().content 为 Buffer/ArrayBuffer，可直接构造 Blob。
    return new Blob([r.content as BlobPart]);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/services/cloud/__tests__/OssProvider.test.ts`
Expected: PASS（6 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/services/cloud/providers/OssProvider.ts src/services/cloud/__tests__/OssProvider.test.ts
git commit -m "feat(cloud): OssProvider（ali-oss 策略实现）"
```

---

## Task 5: CosProvider（cos-js-sdk-v5 策略实现 + mock 测试）

**Files:**
- Create: `src/services/cloud/providers/CosProvider.ts`
- Test: `src/services/cloud/__tests__/CosProvider.test.ts`

**Interfaces:**
- Consumes: `CloudStorageProvider` / `CloudStorageConfig` / `ConfigFieldDef`（Task 2）、`BACKUP_OBJECT_KEY`（Task 2）、`cos-js-sdk-v5`（Task 1）。
- Produces: `CosProvider` 类，供 Task 6 注册表使用。注意：COS 的 SecretId/SecretKey 复用 `CloudStorageConfig.accessKeyId/accessKeySecret` 字段，仅 UI label 不同。

- [ ] **Step 1: 写 CosProvider 测试（失败）**

创建 `src/services/cloud/__tests__/CosProvider.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BACKUP_OBJECT_KEY } from '../constants';
import { CosProvider } from '../providers/CosProvider';

const mocks = vi.hoisted(() => ({
  COS: vi.fn(),
  putObject: vi.fn(),
  getObject: vi.fn(),
  headBucket: vi.fn(),
}));
vi.mock('cos-js-sdk-v5', () => ({
  default: mocks.COS.mockImplementation(() => ({
    putObject: mocks.putObject,
    getObject: mocks.getObject,
    headBucket: mocks.headBucket,
  })),
}));

const cfg = {
  region: 'ap-guangzhou',
  bucket: 'octane-test-1234567890',
  accessKeyId: 'AKIDxxx',
  accessKeySecret: 'SKyyy',
};

beforeEach(() => {
  mocks.COS.mockClear();
  mocks.putObject.mockReset();
  mocks.getObject.mockReset();
  mocks.headBucket.mockReset();
});

describe('CosProvider', () => {
  const provider = new CosProvider();

  it('元信息：id=cos，label=腾讯云 COS，SK 字段 label=SecretKey 且 password', () => {
    expect(provider.id).toBe('cos');
    expect(provider.label).toBe('腾讯云 COS');
    expect(provider.configFields.find((f) => f.name === 'accessKeyId')?.label).toBe('SecretId');
    expect(provider.configFields.find((f) => f.name === 'accessKeySecret')?.label).toBe('SecretKey');
  });

  it('testConnection → headBucket({Bucket, Region})', async () => {
    mocks.headBucket.mockResolvedValue({});
    await provider.testConnection(cfg);
    expect(mocks.headBucket).toHaveBeenCalledWith({ Bucket: cfg.bucket, Region: cfg.region });
  });

  it('testConnection 失败 → 透传抛错', async () => {
    mocks.headBucket.mockRejectedValue(new Error('CORS blocked'));
    await expect(provider.testConnection(cfg)).rejects.toThrow('CORS blocked');
  });

  it('uploadBackup → putObject({Bucket, Region, Key, Body})', async () => {
    mocks.putObject.mockResolvedValue({});
    const blob = new Blob(['x']);
    await provider.uploadBackup(cfg, blob);
    expect(mocks.putObject).toHaveBeenCalledWith({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: BACKUP_OBJECT_KEY,
      Body: blob,
    });
    // COS 构造用 SecretId/SecretKey（映射自 accessKeyId/accessKeySecret）
    expect(mocks.COS).toHaveBeenCalledWith(expect.objectContaining({ SecretId: cfg.accessKeyId, SecretKey: cfg.accessKeySecret }));
  });

  it('downloadBackup → getObject({Bucket, Region, Key}) → 返回 Body Blob', async () => {
    const blob = new Blob(['data']);
    mocks.getObject.mockResolvedValue({ Body: blob });
    expect(await provider.downloadBackup(cfg)).toBe(blob);
    expect(mocks.getObject).toHaveBeenCalledWith({ Bucket: cfg.bucket, Region: cfg.region, Key: BACKUP_OBJECT_KEY });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/services/cloud/__tests__/CosProvider.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写 CosProvider.ts**

创建 `src/services/cloud/providers/CosProvider.ts`：

```ts
import COS from 'cos-js-sdk-v5';
import type { CloudStorageConfig, CloudStorageProvider, ConfigFieldDef } from '../types';
import { BACKUP_OBJECT_KEY } from '../constants';

/** 腾讯云 COS 策略实现：签名直传交给 cos-js-sdk-v5（浏览器构建）。 */
export class CosProvider implements CloudStorageProvider {
  readonly id = 'cos' as const;
  readonly label = '腾讯云 COS';
  readonly configFields: readonly ConfigFieldDef[] = [
    { name: 'region', label: 'Region', type: 'text', required: true, placeholder: 'ap-guangzhou' },
    { name: 'bucket', label: 'Bucket', type: 'text', required: true, placeholder: '名称-APPID' },
    { name: 'accessKeyId', label: 'SecretId', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'SecretKey', type: 'password', required: true },
  ];

  private buildClient(cfg: CloudStorageConfig) {
    return new COS({
      SecretId: cfg.accessKeyId,
      SecretKey: cfg.accessKeySecret,
    });
  }

  async testConnection(cfg: CloudStorageConfig): Promise<void> {
    await this.buildClient(cfg).headBucket({ Bucket: cfg.bucket, Region: cfg.region });
  }

  async uploadBackup(cfg: CloudStorageConfig, blob: Blob): Promise<void> {
    await this.buildClient(cfg).putObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: BACKUP_OBJECT_KEY,
      Body: blob,
    });
  }

  async downloadBackup(cfg: CloudStorageConfig): Promise<Blob> {
    const data = await this.buildClient(cfg).getObject({
      Bucket: cfg.bucket,
      Region: cfg.region,
      Key: BACKUP_OBJECT_KEY,
    });
    return data.Body as Blob;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/services/cloud/__tests__/CosProvider.test.ts`
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/services/cloud/providers/CosProvider.ts src/services/cloud/__tests__/CosProvider.test.ts
git commit -m "feat(cloud): CosProvider（cos-js-sdk-v5 策略实现）"
```

---

## Task 6: 注册表 + CloudStorageService 编排（testConnection/upload/download）

**Files:**
- Create: `src/services/cloud/providers/index.ts`
- Modify: `src/services/CloudStorageService.ts`（追加编排方法）
- Modify: `src/services/__tests__/CloudStorageService.test.ts`（追加 providers mock + 编排测试）

**Interfaces:**
- Consumes: `OssProvider`（Task 4）、`CosProvider`（Task 5）、`ProviderId`（Task 2）、本文件凭证层（Task 3）。
- Produces: `cloudProviders` 注册表、`getCloudProvider(id)`；服务编排 `testConnection(id)` / `uploadBackup(id, blob)` / `downloadBackup(id): Promise<Blob>`。供 Task 8 store 消费。

- [ ] **Step 1: 写注册表**

创建 `src/services/cloud/providers/index.ts`：

```ts
import type { CloudStorageProvider, ProviderId } from '../types';
import { OssProvider } from './OssProvider';
import { CosProvider } from './CosProvider';

/** 云服务商注册表：新增服务商在此加一行即可接入（策略模式扩展点）。 */
export const cloudProviders: Record<ProviderId, CloudStorageProvider> = {
  oss: new OssProvider(),
  cos: new CosProvider(),
};

/** 按 id 取策略。 */
export function getCloudProvider(id: ProviderId): CloudStorageProvider {
  return cloudProviders[id];
}
```

- [ ] **Step 2: 在 CloudStorageService.ts 顶部 import 追加 + 文件末尾追加编排方法**

在 `src/services/CloudStorageService.ts` 顶部 import 区追加：

```ts
import { getCloudProvider } from '@/services/cloud/providers';
```

在文件末尾追加（编排：解密凭证 → 委托策略）：

```ts
/** 测试连通性：解密凭证后委托 provider；未配置抛错。 */
export async function testConnection(id: ProviderId): Promise<void> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  await getCloudProvider(id).testConnection(cfg);
}

/** 上传备份：解密凭证 → 委托 provider.put → 记录 lastBackupAt。 */
export async function uploadBackup(id: ProviderId, blob: Blob): Promise<void> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  await getCloudProvider(id).uploadBackup(cfg, blob);
  await setLastBackupAt(id, Date.now());
}

/** 下载备份：解密凭证 → 委托 provider.get → 返回 Blob。 */
export async function downloadBackup(id: ProviderId): Promise<Blob> {
  const cfg = await getCloudConfig(id);
  if (!cfg) throw new Error('未配置云存储');
  return getCloudProvider(id).downloadBackup(cfg);
}
```

- [ ] **Step 3: 修改 CloudStorageService.test.ts 顶部加 providers mock + import，末尾追加编排 describe**

在 `src/services/__tests__/CloudStorageService.test.ts` 顶部 `import` 之前加 hoisted mock + vi.mock：

```ts
const fakeProvider = vi.hoisted(() => ({
  testConnection: vi.fn(),
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: () => fakeProvider,
}));
```

补充 `vitest` import 含 `vi`，并在 import 块追加：

```ts
import { testConnection, uploadBackup, downloadBackup } from '@/services/CloudStorageService';
```

在 `beforeEach` 末尾追加重置：

```ts
  fakeProvider.testConnection.mockReset();
  fakeProvider.uploadBackup.mockReset();
  fakeProvider.downloadBackup.mockReset();
```

在文件末尾追加：

```ts
describe('CloudStorageService 编排', () => {
  it('未配置时 testConnection 抛错', async () => {
    await setupTestKey('main-password-1234');
    await expect(testConnection('oss')).rejects.toThrow('未配置');
  });

  it('uploadBackup 解密凭证 → 委托 provider → 记录 lastBackupAt', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    fakeProvider.uploadBackup.mockResolvedValue(undefined);
    const blob = new Blob(['x']);
    await uploadBackup('oss', blob);
    expect(fakeProvider.uploadBackup).toHaveBeenCalledWith(cfg, blob);
    expect(await getLastBackupAt('oss')).toBeGreaterThan(0);
  });

  it('downloadBackup 返回 provider 的 Blob', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    const blob = new Blob(['data']);
    fakeProvider.downloadBackup.mockResolvedValue(blob);
    expect(await downloadBackup('oss')).toBe(blob);
    expect(fakeProvider.downloadBackup).toHaveBeenCalledWith(cfg);
  });

  it('testConnection 委托 provider 并传入解密后的凭证', async () => {
    await setupTestKey('main-password-1234');
    await saveCloudConfig('oss', cfg);
    fakeProvider.testConnection.mockResolvedValue(undefined);
    await testConnection('oss');
    expect(fakeProvider.testConnection).toHaveBeenCalledWith(cfg);
  });
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/services/__tests__/CloudStorageService.test.ts`
Expected: PASS（凭证层 7 + 编排 4 = 11 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/services/cloud/providers/index.ts src/services/CloudStorageService.ts src/services/__tests__/CloudStorageService.test.ts
git commit -m "feat(cloud): provider 注册表 + CloudStorageService 编排"
```

## Task 7: 抽取 buildBackupBlob（导出 + 上传共用）

**Files:**
- Modify: `src/services/BackupService.ts`（追加 `buildBackupBlob`）
- Modify: `src/store/useBackup.ts`（`exportData` 改用 `buildBackupBlob`，行为不变）
- Test: `src/services/__tests__/BackupService.test.ts`（追加 `buildBackupBlob` 用例）

**Interfaces:**
- Consumes: `exportAllData`（database.ts）、`BACKUP_SCHEMA`/`BACKUP_VERSION`（types）、`browser.runtime.getManifest()`。
- Produces: `buildBackupBlob(): Promise<Blob>` —— 导出与云上传共用同一份备份 Blob。Task 8 的 `uploadCloudBackup` 消费它。

- [ ] **Step 1: 写 buildBackupBlob 测试（失败）**

在 `src/services/__tests__/BackupService.test.ts` 顶部加 `wxt/browser` mock（若该文件已有则跳过），追加 import 与用例：

```ts
const { getManifest } = vi.hoisted(() => ({ getManifest: vi.fn(() => ({ version: '0.1.3.5' })) }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { getManifest } } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBackupBlob } from '@/services/BackupService';
import * as DB from '@/shared/db/database';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { BackupData } from '@/shared/types';

const okData: BackupData = { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null };

beforeEach(() => { getManifest.mockClear(); });

describe('buildBackupBlob', () => {
  it('生成 schema/version/appVersion/data 正确的备份 Blob', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(okData);
    const blob = await buildBackupBlob();
    const parsed = JSON.parse(await blob.text());
    expect(parsed.schema).toBe(BACKUP_SCHEMA);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.appVersion).toBe('0.1.3.5');
    expect(parsed.data).toEqual(okData);
    expect(getManifest).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/services/__tests__/BackupService.test.ts`
Expected: FAIL（`buildBackupBlob` 未导出）。

- [ ] **Step 3: 在 BackupService.ts 追加 buildBackupBlob**

在 `src/services/BackupService.ts` 顶部 import 区追加：

```ts
import { exportAllData } from '@/shared/db/database';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import { browser } from 'wxt/browser';
```

（`exportAllData` 已在文件中 import 了吗？核对：BackupService.ts 当前 import 了 `replaceAllDataRaw, broadcastChange, broadcastImport`，未 import `exportAllData`。追加 `exportAllData`。）

在文件末尾追加：

```ts
/**
 * 构建备份 Blob（导出与云上传共用同一份）。
 * 内部取存储态 exportAllData（contexts 含密文，不解密）。
 */
export async function buildBackupBlob(): Promise<Blob> {
  const data = await exportAllData();
  const file = {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: browser.runtime.getManifest().version,
    data,
  };
  return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
}
```

- [ ] **Step 4: 重构 useBackup.exportData 复用 buildBackupBlob**

修改 `src/store/useBackup.ts`：顶部 import 改为

```ts
import { parseBackupFile, buildBackupBlob } from '@/services/BackupService';
```

（移除原 `import { exportAllData } from '@/shared/db/database'` 与 `BACKUP_SCHEMA, BACKUP_VERSION, BackupData` 中仅 exportData 用到的部分——若 BackupData 仍被 pendingData 类型使用则保留）。把 `exportData` 实现替换为：

```ts
  exportData: async () => {
    set({ status: 'running', errorMessage: null });
    try {
      const blob = await buildBackupBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      set({ status: 'success' });
    } catch (e) {
      set({ status: 'error', errorMessage: (e as Error).message || '导出失败' });
    }
  },
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/services/__tests__/BackupService.test.ts src/store/__tests__/useBackup.test.ts`
Expected: PASS（新 buildBackupBlob 用例 + 原有 useBackup 用例不变）。

- [ ] **Step 6: 提交**

```bash
git add src/services/BackupService.ts src/services/__tests__/BackupService.test.ts src/store/useBackup.ts
git commit -m "refactor(backup): 抽取 buildBackupBlob 供导出与云上传共用"
```

---

## Task 8: useBackup 扩展 cloud actions

**Files:**
- Modify: `src/store/useBackup.ts`（追加 cloud 方法）
- Test: `src/store/__tests__/useBackup.test.ts`（追加 cloud 用例）

**Interfaces:**
- Consumes: `CloudStorageService.{saveCloudConfig,clearCloudConfig,testConnection,uploadBackup,downloadBackup}`（Task 3/6）、`buildBackupBlob`（Task 7）、`parseBackupFile`（P1）、`browser.runtime.sendMessage`、`ProviderId`/`CloudStorageConfig`/`BackupData`。
- Produces: store 方法 `saveCloudConfig(id,config)`、`clearCloudConfig(id)`、`testCloudConnection(id)`、`uploadCloudBackup(id)`、`restoreFromCloud(id): Promise<BackupData>`、`applyCloudRestore(data)`。Task 9 组件消费。这些方法**不**改动本地导入的状态机，错误一律 throw，由组件 catch + Toast。

- [ ] **Step 1: 写 cloud 方法测试（失败）**

在 `src/store/__tests__/useBackup.test.ts` 顶部追加 CloudStorageService mock（与既有 `wxt/browser` mock 并列）：

```ts
const cloud = vi.hoisted(() => ({
  saveCloudConfig: vi.fn(),
  clearCloudConfig: vi.fn(),
  testConnection: vi.fn(),
  uploadBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
vi.mock('@/services/CloudStorageService', () => cloud);
```

import 区追加：

```ts
import { buildBackupBlob, parseBackupFile } from '@/services/BackupService';
```

`beforeEach` 追加重置：

```ts
  cloud.saveCloudConfig.mockReset();
  cloud.clearCloudConfig.mockReset();
  cloud.testConnection.mockReset();
  cloud.uploadBackup.mockReset();
  cloud.downloadBackup.mockReset();
```

文件末尾追加：

```ts
describe('useBackup cloud actions', () => {
  const cfg = { region: 'r', bucket: 'b', accessKeyId: 'ak', accessKeySecret: 'sk' };

  it('saveCloudConfig → 委托 CloudStorageService.saveCloudConfig', async () => {
    await useBackup.getState().saveCloudConfig('oss', cfg);
    expect(cloud.saveCloudConfig).toHaveBeenCalledWith('oss', cfg);
  });

  it('clearCloudConfig → 委托 CloudStorageService.clearCloudConfig', async () => {
    await useBackup.getState().clearCloudConfig('oss');
    expect(cloud.clearCloudConfig).toHaveBeenCalledWith('oss');
  });

  it('testCloudConnection → 委托 CloudStorageService.testConnection', async () => {
    await useBackup.getState().testCloudConnection('oss');
    expect(cloud.testConnection).toHaveBeenCalledWith('oss');
  });

  it('uploadCloudBackup → buildBackupBlob → uploadBackup(id, blob)', async () => {
    const blob = new Blob(['x']);
    vi.spyOn({ buildBackupBlob }, 'buildBackupBlob'); // 仅占位，下面用模块 spy
    const spy = await import('@/services/BackupService').then((m) => vi.spyOn(m, 'buildBackupBlob').mockResolvedValue(blob));
    cloud.uploadBackup.mockResolvedValue(undefined);
    await useBackup.getState().uploadCloudBackup('oss');
    expect(cloud.uploadBackup).toHaveBeenCalledWith('oss', blob);
    spy.mockRestore();
  });

  it('restoreFromCloud → download → parseBackupFile → 返回 data', async () => {
    cloud.downloadBackup.mockResolvedValue(new Blob(['x']));
    vi.spyOn({ parseBackupFile }, 'parseBackupFile');
    const spy = await import('@/services/BackupService').then((m) => vi.spyOn(m, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData }));
    const data = await useBackup.getState().restoreFromCloud('oss');
    expect(data).toEqual(okData);
    spy.mockRestore();
  });

  it('restoreFromCloud 解析失败 → throw', async () => {
    cloud.downloadBackup.mockResolvedValue(new Blob(['x']));
    const spy = await import('@/services/BackupService').then((m) => vi.spyOn(m, 'parseBackupFile').mockResolvedValue({ ok: false, error: '坏备份' }));
    await expect(useBackup.getState().restoreFromCloud('oss')).rejects.toThrow('坏备份');
    spy.mockRestore();
  });

  it('applyCloudRestore → 发 octane:apply-import', async () => {
    sendMessage.mockResolvedValue({ ok: true });
    await useBackup.getState().applyCloudRestore(okData);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'octane:apply-import', data: okData });
  });

  it('applyCloudRestore background 失败 → throw', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: '写入失败' });
    await expect(useBackup.getState().applyCloudRestore(okData)).rejects.toThrow('写入失败');
  });
});
```

> 说明：上面用 `await import(...).then(spyOn)` 是因为 `buildBackupBlob`/`parseBackupFile` 是 ES 模块命名导出，spy 需拿到模块实例。也可在文件顶部 `import * as BackupService` 后直接 `vi.spyOn(BackupService, 'buildBackupBlob')`（与既有 `parseBackupFile` spy 一致），更简洁——**实现时用后者**：

```ts
import * as BackupService from '@/services/BackupService';
// 用例内：
const blob = new Blob(['x']);
vi.spyOn(BackupService, 'buildBackupBlob').mockResolvedValue(blob);
// ...
vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: okData });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/store/__tests__/useBackup.test.ts`
Expected: FAIL（store 上无 cloud 方法）。

- [ ] **Step 3: 在 useBackup.ts 追加 cloud 方法**

`src/store/useBackup.ts` 顶部 import 追加：

```ts
import * as CloudStorageService from '@/services/CloudStorageService';
import type { ProviderId, CloudStorageConfig } from '@/services/cloud/types';
```

在 `BackupState` 接口追加方法签名：

```ts
  saveCloudConfig: (id: ProviderId, config: CloudStorageConfig) => Promise<void>;
  clearCloudConfig: (id: ProviderId) => Promise<void>;
  testCloudConnection: (id: ProviderId) => Promise<void>;
  uploadCloudBackup: (id: ProviderId) => Promise<void>;
  restoreFromCloud: (id: ProviderId) => Promise<BackupData>;
  applyCloudRestore: (data: BackupData) => Promise<void>;
```

在 `create` 对象内（与 `exportData` 等并列）追加实现：

```ts
  saveCloudConfig: async (id, config) => {
    await CloudStorageService.saveCloudConfig(id, config);
  },
  clearCloudConfig: async (id) => {
    await CloudStorageService.clearCloudConfig(id);
  },
  testCloudConnection: async (id) => {
    await CloudStorageService.testConnection(id);
  },
  uploadCloudBackup: async (id) => {
    const blob = await buildBackupBlob();
    await CloudStorageService.uploadBackup(id, blob);
  },
  restoreFromCloud: async (id) => {
    const blob = await CloudStorageService.downloadBackup(id);
    const r = await parseBackupFile(new File([blob], 'octane-cloud-backup.json'));
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  applyCloudRestore: async (data) => {
    const res = await browser.runtime.sendMessage({ type: 'octane:apply-import', data });
    if (!res || !res.ok) throw new Error((res?.error as string) || '恢复失败');
  },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/store/__tests__/useBackup.test.ts`
Expected: PASS（原 5 + cloud 8 = 13 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/store/useBackup.ts src/store/__tests__/useBackup.test.ts
git commit -m "feat(cloud): useBackup 扩展 cloud 配置/上传/恢复 actions"
```

---

## Task 9: CloudBackupSection UI（共享组件）

**Files:**
- Create: `src/components/backup/CloudBackupSection.tsx`
- Create: `src/components/backup/CloudBackupSection.module.css`
- Test: `src/components/backup/__tests__/CloudBackupSection.test.tsx`

**Interfaces:**
- Consumes: `useBackup` cloud 方法（Task 8）、`getCloudProvider`（Task 6）、`isUnlocked`（CryptoService）、`getLastBackupAt`（CloudStorageService）、`ProviderId`/`CloudStorageConfig`/`ConfigFieldDef`（Task 2）、Semi UI。
- Produces: `<CloudBackupSection />` 组件，供 Task 10 两站点渲染。**不触碰** LocalBackupSection（恢复确认流程用组件本地 state，避免与本地导入的 store confirming 态冲突）。

- [ ] **Step 1: 写 CSS module**

创建 `src/components/backup/CloudBackupSection.module.css`：

```css
.cloudSection {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.fieldGroup {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fieldRow {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fieldLabel {
  font-size: 13px;
  color: var(--semi-color-text-2);
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.lastTime {
  font-size: 13px;
  color: var(--semi-color-text-2);
}
.confirmBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

- [ ] **Step 2: 写组件测试（失败）**

创建 `src/components/backup/__tests__/CloudBackupSection.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// mocks
const store = vi.hoisted(() => ({
  testCloudConnection: vi.fn(),
  saveCloudConfig: vi.fn(),
  clearCloudConfig: vi.fn(),
  uploadCloudBackup: vi.fn(),
  restoreFromCloud: vi.fn(),
  applyCloudRestore: vi.fn(),
}));
vi.mock('@/store/useBackup', () => ({
  useBackup: { getState: () => store },
}));

const crypto = vi.hoisted(() => ({ isUnlocked: vi.fn() }));
vi.mock('@/services/CryptoService', () => ({ isUnlocked: crypto.isUnlocked }));

const cloudSvc = vi.hoisted(() => ({ getLastBackupAt: vi.fn() }));
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: cloudSvc.getLastBackupAt }));

const providers = vi.hoisted(() => ({
  oss: { id: 'oss', label: '阿里云 OSS', configFields: [
    { name: 'region', label: 'Region', type: 'text', required: true },
    { name: 'accessKeySecret', label: 'AccessKeySecret', type: 'password', required: true },
  ] },
  cos: { id: 'cos', label: '腾讯云 COS', configFields: [
    { name: 'region', label: 'Region', type: 'text', required: true },
  ] },
}));
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: (id: 'oss' | 'cos') => providers[id],
}));

import { CloudBackupSection } from '../CloudBackupSection';
import type { BackupData } from '@/shared/types';

const okData: BackupData = { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null };

beforeEach(() => {
  Object.values(store).forEach((m) => (m as ReturnType<typeof vi.fn>).mockReset());
  crypto.isUnlocked.mockReset();
  cloudSvc.getLastBackupAt.mockReset();
  // 默认已解锁、无历史备份
  crypto.isUnlocked.mockResolvedValue(true);
  cloudSvc.getLastBackupAt.mockResolvedValue(null);
});

describe('CloudBackupSection', () => {
  it('渲染两个服务商 Tab + 当前 provider 的字段 label', async () => {
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText('阿里云 OSS')).toBeInTheDocument());
    expect(screen.getByText('腾讯云 COS')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('AccessKeySecret')).toBeInTheDocument();
  });

  it('未解锁 → 显示 Banner + 操作按钮 disabled', async () => {
    crypto.isUnlocked.mockResolvedValue(false);
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText(/请先解锁/)).toBeInTheDocument());
    expect(screen.getByText('测试连接').closest('button')).toBeDisabled();
    expect(screen.getByText('上传备份').closest('button')).toBeDisabled();
  });

  it('点击「从云恢复」→ 下载解析成功 → 弹破坏性确认 Modal（含 Checkbox，未勾选时确认禁用）', async () => {
    store.restoreFromCloud.mockResolvedValue(okData);
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText('上传备份')).toBeInTheDocument());
    fireEvent.click(screen.getByText('从云恢复'));
    await waitFor(() => expect(store.restoreFromCloud).toHaveBeenCalledWith('oss'));
    await waitFor(() => expect(screen.getByText('确认覆盖全部数据')).toBeInTheDocument());
    const confirmBtn = screen.getByText('确认覆盖').closest('button');
    expect(confirmBtn).toBeDisabled(); // 未勾选 Checkbox
    fireEvent.click(screen.getByText('我了解此操作不可撤销'));
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
  });

  it('确认覆盖 → applyCloudRestore', async () => {
    store.restoreFromCloud.mockResolvedValue(okData);
    store.applyCloudRestore.mockResolvedValue(undefined);
    render(<CloudBackupSection />);
    await waitFor(() => expect(screen.getByText('上传备份')).toBeInTheDocument());
    fireEvent.click(screen.getByText('从云恢复'));
    await waitFor(() => expect(screen.getByText('确认覆盖')).toBeInTheDocument());
    fireEvent.click(screen.getByText('我了解此操作不可撤销'));
    fireEvent.click(screen.getByText('确认覆盖'));
    await waitFor(() => expect(store.applyCloudRestore).toHaveBeenCalledWith(okData));
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -- src/components/backup/__tests__/CloudBackupSection.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 4: 写 CloudBackupSection.tsx**

创建 `src/components/backup/CloudBackupSection.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { Tabs, Input, Button, Modal, Banner, Toast, Typography, Checkbox } from '@douyinfe/semi-ui';
import { useBackup } from '@/store/useBackup';
import { getCloudProvider } from '@/services/cloud/providers';
import { isUnlocked } from '@/services/CryptoService';
import { getLastBackupAt } from '@/services/CloudStorageService';
import type { BackupData } from '@/shared/types';
import type { CloudStorageConfig, ProviderId } from '@/services/cloud/types';
import styles from './CloudBackupSection.module.css';

const TABS: ProviderId[] = ['oss', 'cos'];

/** 云备份区：OSS/COS 配置 + 连通测试 + 上传/恢复（覆盖式，恢复为破坏性强确认）。popup/newtab 共享。 */
export function CloudBackupSection() {
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<ProviderId>('oss');
  // 表单按 provider 分组，切换 Tab 不丢失输入
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreData, setRestoreData] = useState<BackupData | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const provider = getCloudProvider(tab);

  useEffect(() => {
    isUnlocked().then(setUnlocked);
  }, []);
  useEffect(() => {
    getLastBackupAt(tab).then(setLastBackup).catch(() => setLastBackup(null));
  }, [tab, busy]);

  const fieldVal = (name: string) => forms[tab]?.[name] ?? '';
  const setField = (name: string, val: string) =>
    setForms((f) => ({ ...f, [tab]: { ...(f[tab] ?? {}), [name]: val } }));

  const disabled = !unlocked || busy;

  const handleTest = async () => {
    setBusy(true);
    try {
      await useBackup.getState().testCloudConnection(tab);
      Toast.success('连接成功，桶可访问');
    } catch {
      Toast.error('连接失败：请检查桶 CORS 与 AK/SK 权限');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    for (const f of provider.configFields) {
      if (f.required && !fieldVal(f.name).trim()) {
        Toast.error(`请填写 ${f.label}`);
        return;
      }
    }
    setBusy(true);
    try {
      const cfg: CloudStorageConfig = {
        region: fieldVal('region'),
        bucket: fieldVal('bucket'),
        accessKeyId: fieldVal('accessKeyId'),
        accessKeySecret: fieldVal('accessKeySecret'),
        endpoint: fieldVal('endpoint') || undefined,
      };
      await useBackup.getState().saveCloudConfig(tab, cfg);
      Toast.success('配置已保存');
    } catch {
      Toast.error('保存失败：请先解锁主密码');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await useBackup.getState().clearCloudConfig(tab);
      Toast.success('已清除云配置');
    } catch {
      Toast.error('清除失败');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    setBusy(true);
    try {
      await useBackup.getState().uploadCloudBackup(tab);
      Toast.success('已上传备份');
    } catch {
      Toast.error('上传失败：请检查网络与权限');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreClick = async () => {
    setBusy(true);
    try {
      const data = await useBackup.getState().restoreFromCloud(tab);
      setRestoreData(data);
      setConfirmed(false);
    } catch {
      Toast.error('下载失败：请检查网络与权限');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreData) return;
    setBusy(true);
    try {
      await useBackup.getState().applyCloudRestore(restoreData);
      setRestoreData(null);
      Toast.success('恢复完成，如含加密数据请用原密码解锁');
    } catch {
      Toast.error('恢复失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.cloudSection}>
      {!unlocked && (
        <Banner type="warning" description="云备份凭证由主密码加密，使用前请先解锁。" />
      )}
      <Tabs activeKey={tab} onTabChange={(k) => setTab(k as ProviderId)}>
        {TABS.map((id) => (
          <Tabs.TabPane key={id} itemKey={id} tab={getCloudProvider(id).label} />
        ))}
      </Tabs>

      <div className={styles.fieldGroup}>
        {provider.configFields.map((f) => (
          <div key={f.name} className={styles.fieldRow}>
            <label htmlFor={`cloud-${tab}-${f.name}`} className={styles.fieldLabel}>{f.label}</label>
            <Input
              id={`cloud-${tab}-${f.name}`}
              mode={f.type === 'password' ? 'password' : undefined}
              disabled={disabled}
              value={fieldVal(f.name)}
              placeholder={f.placeholder}
              onChange={(v) => setField(f.name, v)}
            />
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <Button disabled={disabled} loading={busy} onClick={handleTest}>测试连接</Button>
        <Button theme="solid" disabled={disabled} onClick={handleSave}>保存配置</Button>
        <Button disabled={disabled} onClick={handleClear}>清除配置</Button>
      </div>

      <Typography.Text type="tertiary" className={styles.lastTime}>
        上次备份：{lastBackup ? new Date(lastBackup).toLocaleString() : '尚未备份'}
      </Typography.Text>

      <div className={styles.actions}>
        <Button theme="solid" disabled={disabled} loading={busy} onClick={handleUpload}>上传备份</Button>
        <Button type="danger" disabled={disabled} onClick={handleRestoreClick}>从云恢复</Button>
      </div>

      <Modal
        title="确认覆盖全部数据"
        visible={restoreData !== null}
        onCancel={() => setRestoreData(null)}
        maskClosable={false}
        footer={
          <Button theme="solid" type="danger" block disabled={!confirmed || busy} loading={busy} onClick={handleConfirmRestore}>
            确认覆盖
          </Button>
        }
      >
        <div className={styles.confirmBody}>
          <Typography.Text>
            此操作将清除当前全部工作区、书签与上下文，并替换为云端备份内容，不可撤销。
            {restoreData?.cryptoMetadata ? ' 云端备份含加密数据，恢复后请用导出端主密码解锁。' : ''}
          </Typography.Text>
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked ?? false)}>
            我了解此操作不可撤销
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- src/components/backup/__tests__/CloudBackupSection.test.tsx`
Expected: PASS（4 个用例）。

- [ ] **Step 6: 提交**

```bash
git add src/components/backup/CloudBackupSection.tsx src/components/backup/CloudBackupSection.module.css src/components/backup/__tests__/CloudBackupSection.test.tsx
git commit -m "feat(cloud): CloudBackupSection 共享 UI（双 Tab + 配置 + 上传/恢复强确认）"
```

## Task 10: 渲染接入（newtab Sidebar SideSheet + popup SettingsView）

**Files:**
- Modify: `src/newtab/components/Sidebar/index.tsx:5,135`
- Modify: `src/entrypoints/popup/views/SettingsView.tsx:2,14`
- Modify: `src/entrypoints/popup/views/SettingsView.test.tsx`

**Interfaces:**
- Consumes: `<CloudBackupSection />`（Task 9）。
- Produces: 两站点均渲染云备份区，用户可达。

- [ ] **Step 1: SettingsView 接入**

修改 `src/entrypoints/popup/views/SettingsView.tsx`，import 与 JSX 各加一行：

```tsx
import SubPageHeader from './SubPageHeader';
import { LocalBackupSection } from '@/components/backup/LocalBackupSection';
import { CloudBackupSection } from '@/components/backup/CloudBackupSection';
import styles from '../popup.module.css';

interface SettingsViewProps {
  onBack: () => void;
}

/** 设置子页面：本地数据备份 + 云备份。 */
export default function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <div className={styles.settingsView}>
      <SubPageHeader title="设置" onBack={onBack} />
      <LocalBackupSection />
      <CloudBackupSection />
    </div>
  );
}
```

- [ ] **Step 2: Sidebar SideSheet 接入**

修改 `src/newtab/components/Sidebar/index.tsx`：import 区（第 5 行附近）追加：

```ts
import { CloudBackupSection } from '@/components/backup/CloudBackupSection';
```

SideSheet 内（`<LocalBackupSection />` 之后，第 135 行后）追加：

```tsx
        <LocalBackupSection />
        <CloudBackupSection />
```

- [ ] **Step 3: 更新 SettingsView.test.tsx 加 cloud 依赖 mock + 断言**

CloudBackupSection 在 render 期会调用 `getCloudProvider`（拉 ali-oss/cos）与 effect 内 `isUnlocked`/`getLastBackupAt`，需在 SettingsView 测试中 mock，避免真实 SDK/IndexedDB 介入。修改 `src/entrypoints/popup/views/SettingsView.test.tsx`，在 `import { render ... }` 之前追加：

```ts
vi.mock('@/services/cloud/providers', () => ({
  getCloudProvider: (id: string) => ({
    id,
    label: id === 'oss' ? '阿里云 OSS' : '腾讯云 COS',
    configFields: [{ name: 'region', label: 'Region', type: 'text' as const, required: true }],
  }),
}));
vi.mock('@/services/CryptoService', () => ({ isUnlocked: () => Promise.resolve(true) }));
vi.mock('@/services/CloudStorageService', () => ({ getLastBackupAt: () => Promise.resolve(null) }));
```

在 `describe` 内追加用例：

```ts
  it('渲染云备份区（上传/恢复按钮）', async () => {
    render(<SettingsView onBack={vi.fn()} />);
    expect(await screen.findByText('上传备份')).toBeTruthy();
    expect(screen.getByText('从云恢复')).toBeTruthy();
  });
```

（`screen.findByText` 等待 effect 完成；若 TS 报 `screen` 未含 findByText，已由 `@testing-library/react` 提供。）

- [ ] **Step 4: 运行测试 + 构建**

Run: `npm test -- src/entrypoints/popup/views/SettingsView.test.tsx`
Expected: PASS（原 2 + 新 1 = 3 个用例）。

Run: `npm run build`
Expected: 构建成功，manifest 含 `host_permissions`（OSS/COS 域名）。

- [ ] **Step 5: 提交**

```bash
git add src/newtab/components/Sidebar/index.tsx src/entrypoints/popup/views/SettingsView.tsx src/entrypoints/popup/views/SettingsView.test.tsx
git commit -m "feat(cloud): newtab/popup 设置页接入 CloudBackupSection"
```

---

## Task 11: 端到端验证 + 版本号 + CHANGELOG

**Files:**
- Modify: `package.json:3`（version → 0.1.3.5）
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 全部前置任务。
- Produces: 真实云环境验证通过 + 版本 0.1.3.5 + CHANGELOG。本任务的端到端验证是 spec 的 **CORS + SDK 真实可用性闸**（P2 第一步验证在 Task 1 仅静态确认打包，真实联通在此验证）。

- [ ] **Step 1: 全量单元测试 + 类型**

Run: `npm test`
Expected: 全部 PASS（含新增 cloud 用例，无回归）。

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 2: 端到端手动验证（OSS）**

`npm run dev` 加载扩展后，依次验证（需真实 OSS 桶 + 已配 CORS + 最小权限 AK/SK）：

1. 设置主密码并解锁。
2. 设置页 → 云备份 → 阿里云 OSS Tab，填 region/bucket/AK/SK → 保存配置 → Toast「配置已保存」。
3. 点「测试连接」→ Toast「连接成功，桶可访问」。（若失败：按提示检查桶 CORS / AK-SK 权限。）
4. 点「上传备份」→ Toast「已上传备份」，显示「上次备份：<时间>」。在 OSS 控制台确认 `octane/backup/octane-backup.json` 存在。
5. （在另一空库或清库后）点「从云恢复」→ 弹破坏性确认 Modal → 勾选 Checkbox → 确认覆盖 → 数据恢复，加密笔记可用原密码解锁。

记录结果。若 SDK 在 service worker 实测不可用（步骤 3/4 失败且非 CORS/权限问题）→ 停止，回 spec 重开 D6。

- [ ] **Step 3: 端到端手动验证（COS）**

对腾讯云 COS Tab 重复 Step 2（桶名带 APPID，Region 如 ap-guangzhou，SecretId/SecretKey）。确认上传/恢复链路通。

- [ ] **Step 4: 版本号 → 0.1.3.5**

修改 `package.json` 第 3 行：

```json
  "version": "0.1.3.5",
```

- [ ] **Step 5: CHANGELOG 追加 0.1.3.5**

在 `CHANGELOG.md` 顶部（遵循既有 Keep a Changelog 格式）追加：

```markdown
## [0.1.3.5] - 2026-06-18

### Added
- 云存储备份：阿里云 OSS / 腾讯云 COS 手动上传与覆盖恢复（策略模式，凭证经主密码 AES-GCM 加密存储）。
- 云存储配置 UI：双 Tab（OSS/COS）+ 连通性测试 + 清除配置 + 上次备份时间。
- wxt host_permissions 放行 `*.aliyuncs.com` / `*.myqcloud.com`。
- 用户侧配置指南 `docs/cloud-backup-setup.md`（桶 CORS + 最小权限子账号）。

### Changed
- 导出与云上传共用 `buildBackupBlob`；上传为轻提示（非破坏性），从云恢复为破坏性强确认。
```

- [ ] **Step 6: 提交**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version and changelog (v0.1.3.5)"
```

---

## Self-Review

### 1. Spec 覆盖（每条需求 → 任务）

| Spec 需求 | 任务 |
|---|---|
| 策略接口 `CloudStorageProvider` + `configFields` 驱动 UI | Task 2 |
| `BACKUP_OBJECT_KEY` 固定 key | Task 2 |
| OssProvider（ali-oss）/ CosProvider（cos-js-sdk-v5） | Task 4 / Task 5 |
| 注册表 + 扩展点 | Task 6 |
| 凭证 AES-GCM 加密按 provider 分键存 chrome.storage.local | Task 3 |
| 编排 testConnection/uploadBackup/downloadBackup | Task 6 |
| `buildBackupBlob` 导出+上传共用 | Task 7 |
| store cloud actions（含恢复复用 apply-import） | Task 8 |
| CloudBackupSection UI（双 Tab + 字段 label + 解锁态 Banner） | Task 9 |
| 上传 = 轻提示（无 Modal） | Task 9（handleUpload 仅 Toast） |
| 从云恢复 = Modal type=warning + Checkbox + danger | Task 9 |
| 清除云配置入口（D8） | Task 9（handleClear） |
| 渲染接入两站点 | Task 10 |
| host_permissions + deps + @types/ali-oss | Task 1 |
| 用户侧 CORS/AK-SK 文档 | Task 1（docs/cloud-backup-setup.md） |
| 错误可访问（aria-live） | Task 9（Semi Toast 自带 aria-live；handleTest 给分类可操作提示） |
| 真实 CORS/SDK 可用性验证 | Task 1（静态打包闸）+ Task 11（真实联通闸） |
| 版本 0.1.3.5 + CHANGELOG | Task 11 |

无遗漏。

### 2. 占位符扫描

无 TBD/TODO/「适当处理」/「类似 Task N」。所有步骤含完整代码或确切命令 + 预期输出。Task 8 测试中给出了两种 spy 写法并明确「实现时用后者」，非占位。

### 3. 类型 / 命名一致性

- `CloudStorageService`：`saveCloudConfig/getCloudConfig/clearCloudConfig/getLastBackupAt/setLastBackupAt/testConnection/uploadBackup/downloadBackup`（Task 3/6 定义，Task 8/9 消费，名称一致）。
- store 方法：`saveCloudConfig/clearCloudConfig/testCloudConnection/uploadCloudBackup/restoreFromCloud/applyCloudRestore`（Task 8 定义，Task 9 组件 + 测试消费，一致）。注意 store 用 `testCloudConnection`（区别于 service 的 `testConnection`，避免命名混淆）—— 全链路一致。
- `CloudStorageConfig` 字段（region/bucket/accessKeyId/accessKeySecret/endpoint?）跨 types/Provider/store 一致；COS 的 SecretId/SecretKey 映射到 accessKeyId/accessKeySecret，仅 UI label 不同（Task 5）。
- `ProviderId = 'oss' | 'cos'` 全链路一致。
- `BACKUP_OBJECT_KEY`（Task 2）在 OssProvider/CosProvider（Task 4/5）使用，值一致。

### 备注（实现时留意，非阻断）

- **OSS `client.get().content` 类型**：@types/ali-oss 标注为 `Buffer`，浏览器构建运行时为 ArrayBuffer/Uint8Array。`new Blob([r.content as BlobPart])` 通过类型检查；若 tsc 仍报错，改 `as unknown as BlobPart`。运行时正确性由 Task 11 端到端验证。
- **COS `getObject().Body` 类型**：SDK 类型为联合，浏览器为 Blob，`as Blob` 断言；运行时由 Task 11 验证。
- **错误可访问性**：当前用 Semi Toast（自带 aria-live）满足 spec。若需持久内联错误，可补 `<Typography.Text type="danger" role="alert">`（参考 LocalBackupSection），但 YAGNI，暂不加。
- **未解锁态检测**：组件挂载时调一次 `isUnlocked()`；解锁/锁定状态变化不实时刷新（设置页通常在解锁后打开）。若需实时，可监听解锁广播，但超范围，暂不做。

