import { focusOrCreateHomeTab } from '@/shared/tabs/focusOrCreateHomeTab';

/**
 * 快捷键命令分发：background 的 commands.onCommand listener 顶层调用（避 SW 唤醒时序，A1）。
 *
 * - open-home：聚焦/创建 pinned home tab（focusOrCreateHomeTab，用 tabs API，无需 user gesture）。
 * - _execute_side_panel_action：Chrome 116+ 保留命令，由 Chrome 直接打开 side panel，
 *   **不进入 onCommand**。原因：chrome.sidePanel.open() 要求 user gesture，而 commands 的
 *   onCommand 事件不被 Chrome 视为 user gesture（实测报错），故 side panel 快捷键只能用
 *   保留命令、不能走 handler（plan-eng-review A2 决议据此从「普通命令」反转为「保留命令」）。
 */
export async function handleCommand(command: string): Promise<void> {
  if (command === 'open-home') {
    await focusOrCreateHomeTab().catch((e) =>
      console.error('[octane] 快捷键唤起 home 失败', e),
    );
  }
}
