import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 background.ts）。
declare const chrome: unknown;

interface ChromeLike {
  commands: { getAll(): Promise<Command[]> };
  tabs: { create(opts: { url: string }): Promise<unknown> };
}
interface Command {
  name: string;
  description: string;
  shortcut?: string;
}

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';
// 只展示本扩展声明的两个命令（getAll 可能含其他）。
// _execute_side_panel_action 是 Chrome 保留命令，getAll 也会返回它。
const KEPT_COMMANDS = ['open-home', '_execute_side_panel_action'];

/** "Alt+Shift+H" → ['Alt','Shift','H']；空/缺 → null（未设置） */
function parseKeys(shortcut?: string): string[] | null {
  if (!shortcut) return null;
  return shortcut
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean);
}

const kbdStyle: React.CSSProperties = {
  background: 'var(--semi-color-bg-0)',
  border: '1px solid var(--semi-color-border)',
  borderBottomWidth: 2,
  borderRadius: 'var(--semi-border-radius-small)',
  padding: '3px 8px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--semi-color-text-1)',
};
const kbdUnsetStyle: React.CSSProperties = {
  ...kbdStyle,
  background: 'var(--semi-color-fill-0)',
  color: 'var(--semi-color-text-2)',
  borderStyle: 'dashed',
  borderBottomWidth: 1,
};

/**
 * 快捷键设置分区：只读展示 open-home / open-sidepanel 的当前按键绑定。
 *
 * Chrome 不允许扩展运行时改按键，故按键值由 chrome.commands.getAll() 读取，
 * 用户通过「前往自定义」跳转 chrome://extensions/shortcuts 自行配置（见 Banner 说明）。
 */
export function ShortcutsSection() {
  const [cmds, setCmds] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const c = chrome as unknown as ChromeLike;
    c.commands
      .getAll()
      .then((all) =>
        setCmds(all.filter((cmd) => KEPT_COMMANDS.includes(cmd.name))),
      )
      .finally(() => setLoading(false));
  }, []);

  const openShortcuts = () => {
    (chrome as unknown as ChromeLike).tabs.create({ url: SHORTCUTS_URL });
  };

  return (
    <div>
      {/* 单一 accent：用品牌色淡底，不用 Semi info 蓝（design review） */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
          background: 'var(--semi-color-primary-light-default)',
          borderRadius: 'var(--semi-border-radius-small)',
          padding: '10px 12px',
          marginBottom: 16,
          fontSize: 'var(--font-sm)',
          color: 'var(--semi-color-text-1)',
          lineHeight: 1.6,
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            flexShrink: 0,
            borderRadius: 'var(--semi-border-radius-full)',
            background: 'var(--semi-color-primary)',
            marginTop: 1,
          }}
        />
        <span>
          Chrome 规定扩展不能直接修改快捷键按键。如需更改，请点击下方「前往自定义」在浏览器快捷键设置页配置。
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spinner />
        </div>
      ) : (
        <div>
          {cmds.map((cmd) => {
            const keys = parseKeys(cmd.shortcut);
            return (
              <div
                key={cmd.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 0',
                  borderBottom: '1px solid var(--semi-color-border)',
                }}
              >
                <span style={{ fontSize: 14 }}>{cmd.description}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {keys ? (
                    keys.map((k) => (
                      <kbd key={k} style={kbdStyle}>
                        {k}
                      </kbd>
                    ))
                  ) : (
                    <kbd style={kbdUnsetStyle}>未设置</kbd>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Button onClick={openShortcuts}>
          前往自定义
        </Button>
      </div>
    </div>
  );
}
