import { getDB, deleteRecord, broadcastChange } from '@/shared/db/database';
import type { PinnedTab } from '@/shared/types';

/** 每个工作区常驻标签上限（2 行 × 4 列）；超限由调用方 Toast 提示。 */
export const PINNED_TAB_CAP = 8;

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * URL 规范化（用于 dedup 比较）：
 * - 小写协议 + host
 * - pathname 缺省补 /
 * - 保留 query（服务端语义，?a=1 vs ?a=2 是不同页面）
 * - 去 hash（客户端锚点，不改变目标页面）
 * 无效 URL（new URL 抛错）回退原串比较。
 */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol.toLowerCase()}://${u.hostname.toLowerCase()}${u.pathname || '/'}${u.search}`;
  } catch {
    return raw;
  }
}

/** 获取指定工作区的常驻标签，按 order 升序（v1 按追加顺序展示）。 */
export async function listByWorkspace(workspaceId: string): Promise<PinnedTab[]> {
  const db = await getDB();
  const list = await db.getAllFromIndex('pinnedTabs', 'by-workspaceId', workspaceId);
  return list.sort((a, b) => a.order - b.order);
}

/**
 * 创建常驻标签（单 readwrite 事务，原子保证 dedup/cap 校验）。
 * - dedup：同工作区同 URL（规范化后比较）已存在则抛错
 * - cap：已达 PINNED_TAB_CAP(8) 抛错
 * - order = 现有最大 order + 1（删除留洞不影响，避免碰撞）
 *
 * 单事务原因：read-check-write 跨事务时，多上下文并发可双双通过校验后写入，
 * 突破 cap 或重复。idb readwrite 事务在 await 链期间保持活跃，校验与写入同事务即原子。
 */
export async function createPinnedTab(
  workspaceId: string,
  data: { name: string; url: string },
): Promise<PinnedTab> {
  const db = await getDB();
  const tx = db.transaction('pinnedTabs', 'readwrite');
  const store = tx.objectStore('pinnedTabs');
  const existing = await store.index('by-workspaceId').getAll(workspaceId);

  const targetUrl = normalizeUrl(data.url);
  if (existing.some((p) => normalizeUrl(p.url) === targetUrl)) {
    throw new Error('该 URL 已是该工作区的常驻标签');
  }
  if (existing.length >= PINNED_TAB_CAP) {
    throw new Error(`常驻标签已达上限（${PINNED_TAB_CAP}）`);
  }

  const nextOrder = existing.reduce((max, p) => Math.max(max, p.order), -1) + 1;
  const pin: PinnedTab = {
    id: generateId(),
    workspaceId,
    name: data.name,
    url: data.url,
    order: nextOrder,
    createdAt: Date.now(),
  };
  await store.put(pin);
  await tx.done;
  // 跨 context 广播（T6 newtab 订阅后刷新）；事务外触发，不阻塞原子性
  broadcastChange('pinnedTabs', 'put');
  return pin;
}

/** 删除常驻标签。deleteRecord 内置 broadcast，跨 context 同步。 */
export async function deletePinnedTab(id: string): Promise<void> {
  await deleteRecord('pinnedTabs', id);
}
