import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resetDB, getDB, putRecord } from '@/shared/db/database';
import { useCrypto } from '@/store/useCrypto';
import type { CryptoMetadata } from '@/shared/types';

async function clearAllStores(): Promise<void> {
  const db = await getDB();
  const storeNames = ['workspaces', 'categories', 'bookmarks', 'contexts', 'cryptoMetadata'] as const;
  const tx = db.transaction([...storeNames], 'readwrite');
  for (const name of storeNames) {
    await tx.objectStore(name).clear();
  }
  await tx.done;
}

function resetStoreState(): void {
  useCrypto.setState({
    passwordSet: false,
    unlocked: false,
    loading: false,
    needsReset: false,
    unlockModalOpen: false,
  });
}

beforeEach(async () => {
  resetDB();
  await getDB();
  await clearAllStores();
  resetStoreState();
});

afterAll(() => {
  resetDB();
});

describe('useCrypto — 密码校验（#4 安全回归）', () => {
  it('错误密码解锁抛错且不进入解锁态', async () => {
    await useCrypto.getState().setupMasterPassword('correct-password-123');
    useCrypto.setState({ unlocked: false }); // 模拟重锁

    await expect(
      useCrypto.getState().unlockWithPassword('wrong-password-xxx'),
    ).rejects.toThrow('密码错误');
    expect(useCrypto.getState().unlocked).toBe(false);
    expect(useCrypto.getState().loading).toBe(false);
  });

  it('正确密码解锁成功', async () => {
    await useCrypto.getState().setupMasterPassword('correct-password-123');
    useCrypto.setState({ unlocked: false });

    await useCrypto.getState().unlockWithPassword('correct-password-123');
    expect(useCrypto.getState().unlocked).toBe(true);
  });
});

describe('useCrypto — 旧版数据迁移（needsReset）', () => {
  it('检测到无 verifier 的旧 meta → needsReset=true', async () => {
    // 模拟升级前的旧版 meta（无 verifier）
    const legacyMeta: CryptoMetadata = {
      id: 'singleton',
      salt: 'b64salt==',
      iterations: 600_000,
      algorithm: 'AES-GCM-256',
      createdAt: 0,
    };
    await putRecord('cryptoMetadata', legacyMeta);

    await useCrypto.getState().checkStatus();
    expect(useCrypto.getState().passwordSet).toBe(true);
    expect(useCrypto.getState().needsReset).toBe(true);
  });

  it('resetPassword 后 needsReset=false 且新密码可解锁', async () => {
    await putRecord('cryptoMetadata', {
      id: 'singleton',
      salt: 'b64salt==',
      iterations: 600_000,
      algorithm: 'AES-GCM-256',
      createdAt: 0,
    });
    await useCrypto.getState().checkStatus();
    expect(useCrypto.getState().needsReset).toBe(true);

    await useCrypto.getState().resetPassword('brand-new-password');
    expect(useCrypto.getState().needsReset).toBe(false);
    expect(useCrypto.getState().passwordSet).toBe(true);

    useCrypto.setState({ unlocked: false });
    await useCrypto.getState().unlockWithPassword('brand-new-password');
    expect(useCrypto.getState().unlocked).toBe(true);
  });

  it('有 verifier 的正常 meta → needsReset=false', async () => {
    await useCrypto.getState().setupMasterPassword('normal-password-123');
    await useCrypto.getState().checkStatus();
    expect(useCrypto.getState().needsReset).toBe(false);
  });
});
