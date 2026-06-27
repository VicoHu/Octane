import { getByKey, putRecord, deleteRecord } from '@/shared/db/database';
import type { CryptoMetadata } from '@/shared/types';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const DEFAULT_ITERATIONS = 600_000;
const SESSION_KEY_STORAGE_KEY = 'octane-derived-key';
/** verifier 固定明文：setup 时加密、unlock 时解密以校验密码正确性。_V1 预留算法升级空间。 */
const VERIFIER_PLAINTEXT = 'OCTANE_VERIFIER_V1';

// ========== 工具函数 ==========

/**
 * Node 24 的 Uint8Array 泛型参数导致 .buffer 返回 ArrayBufferLike，
 * 与 Web Crypto API 的 BufferSource 不兼容。
 * 此函数将 Uint8Array 转为基于纯 ArrayBuffer 的实例。
 */
function toBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buf);
  view.set(bytes);
  return view;
}

/** BufferSource → base64 */
function toBase64(data: BufferSource): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** base64 → Uint8Array<ArrayBuffer> */
function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 生成随机字节（基于纯 ArrayBuffer） */
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return toBuffer(crypto.getRandomValues(new Uint8Array(length)));
}

// ========== 密钥派生 ==========

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toBuffer(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

// ========== 对称加密原语（基于显式 key） ==========

/** 用显式 key 加密明文，返回 base64 的 { encryptedData, iv } */
export async function encryptWithKey(
  key: CryptoKey,
  plaintext: string,
): Promise<{ encryptedData: string; iv: string }> {
  const iv = randomBytes(IV_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    toBuffer(new TextEncoder().encode(plaintext)),
  );
  return { encryptedData: toBase64(ciphertext), iv: toBase64(iv) };
}

/** 用显式 key 解密。AES-GCM 失败抛 OperationError，调用方需 try/catch。 */
export async function decryptWithKey(
  key: CryptoKey,
  encryptedData: string,
  iv: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: fromBase64(iv) },
    key,
    fromBase64(encryptedData),
  );
  return new TextDecoder().decode(plaintext);
}

// ========== 会话密钥管理 ==========

interface ChromeStorageSession {
  get: (keys: string[]) => Promise<Record<string, string>>;
  set: (data: Record<string, string>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

function getChromeSession(): ChromeStorageSession | null {
  const g = globalThis as Record<string, unknown>;
  const chrome = g['chrome'];
  if (chrome && typeof chrome === 'object') {
    const storage = (chrome as Record<string, unknown>)['storage'];
    if (storage && typeof storage === 'object') {
      const session = (storage as Record<string, unknown>)['session'];
      if (session && typeof session === 'object') {
        return session as ChromeStorageSession;
      }
    }
  }
  return null;
}

async function storeKeyInSession(key: CryptoKey): Promise<void> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const session = getChromeSession();
  if (session) {
    await session.set({ [SESSION_KEY_STORAGE_KEY]: toBase64(rawKey) });
  }
}

async function getKeyFromSession(): Promise<CryptoKey | null> {
  const session = getChromeSession();
  if (!session) return null;

  const result = await session.get([SESSION_KEY_STORAGE_KEY]);
  const base64Key = result[SESSION_KEY_STORAGE_KEY];
  if (!base64Key) return null;

  return crypto.subtle.importKey(
    'raw',
    fromBase64(base64Key),
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
}

async function clearKeyFromSession(): Promise<void> {
  const session = getChromeSession();
  if (session) {
    await session.remove([SESSION_KEY_STORAGE_KEY]);
  }
}

// ========== 测试密钥 ==========

let _testKey: CryptoKey | null = null;

async function getEffectiveKey(): Promise<CryptoKey | null> {
  if (_testKey) return _testKey;
  return getKeyFromSession();
}

// ========== 公开 API ==========

/** 是否已设置主密码 */
export async function isPasswordSet(): Promise<boolean> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  return meta !== undefined;
}

/** 设置主密码（首次使用） */
export async function setupPassword(password: string): Promise<void> {
  const alreadySet = await isPasswordSet();
  if (alreadySet) {
    throw new Error('主密码已设置，请使用 changePassword 修改');
  }

  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  const verifier = await encryptWithKey(key, VERIFIER_PLAINTEXT);

  const meta: CryptoMetadata = {
    id: 'singleton',
    salt: toBase64(salt),
    iterations: DEFAULT_ITERATIONS,
    algorithm: `${ALGORITHM}-${KEY_LENGTH}`,
    createdAt: Date.now(),
    verifier,
  };
  await putRecord('cryptoMetadata', meta);
  await storeKeyInSession(key);
}

/** 解锁：用主密码派生密钥，校验 verifier 通过后存入 session */
export async function unlock(password: string): Promise<boolean> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (!meta) {
    throw new Error('未设置主密码，请先调用 setupPassword');
  }
  // 旧版 meta 无 verifier：无法校验密码，由上层引导重设。不写入 session key。
  if (!meta.verifier) {
    return false;
  }

  const salt = fromBase64(meta.salt);
  const key = await deriveKey(password, salt, meta.iterations);
  try {
    const decrypted = await decryptWithKey(
      key,
      meta.verifier.encryptedData,
      meta.verifier.iv,
    );
    if (decrypted !== VERIFIER_PLAINTEXT) {
      return false;
    }
  } catch {
    // AES-GCM 解密失败抛 OperationError = 密码错误
    return false;
  }

  await storeKeyInSession(key);
  return true;
}

/** 当前 meta 是否含 verifier（用于检测旧版数据并引导重设密码） */
export async function hasVerifier(): Promise<boolean> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  return Boolean(meta?.verifier);
}

/** 清除主密码 meta 与 session key（重设密码前置步骤） */
export async function clearMeta(): Promise<void> {
  await deleteRecord('cryptoMetadata', 'singleton');
  _testKey = null;
  await clearKeyFromSession();
}

/** 锁定：清除密钥 */
export async function lock(): Promise<void> {
  _testKey = null;
  await clearKeyFromSession();
}

/** 是否已解锁 */
export async function isUnlocked(): Promise<boolean> {
  const key = await getEffectiveKey();
  return key !== null;
}

/** 加密明文，返回 base64 编码的 { encryptedData, iv } */
export async function encrypt(
  plaintext: string,
): Promise<{ encryptedData: string; iv: string }> {
  const key = await getEffectiveKey();
  if (!key) {
    throw new Error('密钥不可用，请先解锁');
  }
  return encryptWithKey(key, plaintext);
}

/** 解密密文，返回明文 */
export async function decrypt(encryptedData: string, iv: string): Promise<string> {
  const key = await getEffectiveKey();
  if (!key) {
    throw new Error('密钥不可用，请先解锁');
  }
  return decryptWithKey(key, encryptedData, iv);
}

/**
 * 修改主密码（原子）。
 * 职责边界：本函数只管密钥/meta/verifier；笔记重加密由 reencrypt 回调注入
 * （调用方在回调里用 oldKey 解密、newKey 重加密并写回，避免本模块依赖 ContextService）。
 *
 * 原子顺序：先校验旧密码 → 派生新 key（不写 meta）→ 执行 reencrypt → 最后写 meta。
 * reencrypt 抛错则不写 meta，旧密码仍可用，保证可重试回滚。
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  reencrypt: (oldKey: CryptoKey, newKey: CryptoKey) => Promise<void>,
): Promise<void> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (!meta) {
    throw new Error('未设置主密码');
  }
  if (!meta.verifier) {
    throw new Error('当前主密码未启用校验，请先重设密码');
  }

  // 1. 校验旧密码
  const oldSalt = fromBase64(meta.salt);
  const oldKey = await deriveKey(oldPassword, oldSalt, meta.iterations);
  try {
    const decrypted = await decryptWithKey(
      oldKey,
      meta.verifier.encryptedData,
      meta.verifier.iv,
    );
    if (decrypted !== VERIFIER_PLAINTEXT) {
      throw new Error('旧密码错误');
    }
  } catch {
    throw new Error('旧密码错误');
  }

  // 2. 派生新 key（不写 meta，保证可回滚）
  const newSalt = randomBytes(SALT_LENGTH);
  const newKey = await deriveKey(newPassword, newSalt, meta.iterations);

  // 3. 调用方重加密（用 oldKey 解密、newKey 加密、写回 IndexedDB）。回调抛错则直接传播，不写 meta。
  await reencrypt(oldKey, newKey);

  // 4. 最后写 meta + verifier + session —— 此前任何失败都保留旧 meta
  const verifier = await encryptWithKey(newKey, VERIFIER_PLAINTEXT);
  await putRecord('cryptoMetadata', {
    ...meta,
    salt: toBase64(newSalt),
    verifier,
  });
  await storeKeyInSession(newKey);
}

// ========== 测试专用 ==========

/** 仅用于测试：设置密钥到内存 */
export function setTestKey(key: CryptoKey | null): void {
  _testKey = key;
}

/** 仅用于测试：派生密钥并存入内存 + 写入 CryptoMetadata */
export async function setupTestKey(password: string): Promise<void> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  _testKey = key;

  const meta: CryptoMetadata = {
    id: 'singleton',
    salt: toBase64(salt),
    iterations: DEFAULT_ITERATIONS,
    algorithm: `${ALGORITHM}-${KEY_LENGTH}`,
    createdAt: Date.now(),
  };
  await putRecord('cryptoMetadata', meta);
}
