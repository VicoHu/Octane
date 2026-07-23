/** 在当前窗口所有 tab 的最右侧创建一个新 tab。 */
declare const chrome: unknown;

interface ChromeLike {
  tabs?: {
    query?: (queryInfo: { currentWindow: boolean }) => Promise<Array<{ index?: number }>>;
    create?: (createProperties: { url: string; active: boolean; index: number }) => Promise<unknown>;
  };
}

export async function openUrlInNewTab(url: string, active: boolean): Promise<void> {
  const c = chrome as ChromeLike | undefined;
  if (!c?.tabs?.query || !c.tabs.create) return;

  const tabs = await c.tabs.query({ currentWindow: true });
  const rightmostIndex = tabs.reduce(
    (max, tab, index) => Math.max(max, tab.index ?? index),
    -1,
  ) + 1;
  await c.tabs.create({ url, active, index: rightmostIndex });
}
