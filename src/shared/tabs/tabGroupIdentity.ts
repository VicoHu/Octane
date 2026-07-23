/**
 * tabGroup 稳定标识：Chrome tabGroup 的 groupId 会话内唯一但重启后变（C3 易失），
 * 无自定义元数据字段（只有 title/color/collapsed）。用 title 拼 workspaceId 派生哈希
 * 作跨重启稳定、重名唯一的标识。wsHash = workspaceId 去横线前 8 hex（UUID 前 8 位
 * 碰撞概率 << 工作区数）。用户可编辑 title 删标识 → 回找不到 → 走兜底 restore（容忍）。
 */

declare const chrome: unknown;

interface TabGroupLike {
  id: number;
  windowId: number;
  title?: string;
}

interface ChromeLike {
  tabGroups: {
    query(info: { windowId?: number }): Promise<TabGroupLike[]>;
  };
}

function getChrome(): ChromeLike | null {
  const c = chrome as unknown as ChromeLike | undefined;
  if (!c?.tabGroups?.query) return null;
  return c;
}

/** workspaceId 去横线前 8 hex，小写。跨重启稳定、重名工作区唯一。 */
export function wsHash(workspaceId: string): string {
  return workspaceId.replace(/-/g, '').slice(0, 8).toLowerCase();
}

/** 标识后缀（匹配用）：` ·${wsHash}`。 */
export function IDENTITY_SUFFIX(workspaceId: string): string {
  return ` ·${wsHash(workspaceId)}`;
}

/** tabGroup title：`${工作区名} ·${wsHash}`。 */
export function makeGroupTitle(workspaceName: string, workspaceId: string): string {
  return `${workspaceName}${IDENTITY_SUFFIX(workspaceId)}`;
}

/**
 * 在窗口内按标识回找 tabGroup。唯一命中返回 groupId；未命中 / 多结果（wsHash 碰撞
 * 或用户复制组）返回 null → 调用方走兜底 restore（重建组，不任选防关错组）。
 */
export async function findGroupByIdentity(
  windowId: number,
  workspaceId: string,
): Promise<number | null> {
  const c = getChrome();
  if (!c) return null;
  const suffix = IDENTITY_SUFFIX(workspaceId);
  const groups = await c.tabGroups.query({ windowId });
  const matched = groups.filter((g) => g.title?.endsWith(suffix));
  return matched.length === 1 ? matched[0]!.id : null;
}
