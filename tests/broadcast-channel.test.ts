import { describe, it, expect } from 'vitest';

/**
 * 烟雾测试：确认测试环境（Node 全局）的 BroadcastChannel 可用且异步。
 * 原生 BroadcastChannel postMessage 异步派发，onmessage 在后续微/宏任务触发。
 */
describe('BroadcastChannel（原生，测试环境可用性）', () => {
  it('同名 channel 异步互通：postMessage 后 await 收到', async () => {
    const a = new BroadcastChannel('smoke-pair');
    const b = new BroadcastChannel('smoke-pair');
    let received: unknown = null;
    b.onmessage = (e: MessageEvent) => {
      received = e.data;
    };
    a.postMessage({ store: 'bookmarks', action: 'put' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toEqual({ store: 'bookmarks', action: 'put' });
    a.close();
    b.close();
  });

  it('同实例不回环', async () => {
    const a = new BroadcastChannel('smoke-loop');
    let selfReceived = false;
    a.onmessage = () => {
      selfReceived = true;
    };
    a.postMessage('hello');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(selfReceived).toBe(false);
    a.close();
  });
});
