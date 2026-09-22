import { getByKey, putRecord, deleteRecord } from '@/shared/db/database';
import type { CryptoMetadata, PinConfig, PinFormat } from '@/shared/types';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const DEFAULT_ITERATIONS = 600_000;
const SESSION_KEY_STORAGE_KEY = 'octane-derived-key';
/** verifier 固定明文：setup 时加密、unlock 时解密以校验密码正确性。_V1 预留算法升级空间。 */
const VERIFIER_PLAINTEXT = 'OCTANE_VERIFIER_V1';

// ---------- 快速解锁 PIN（信封机制，#96）----------

/** PIN 信封：session（默认，重启即清）与 local（持久）共用同一 key，写入一侧时清另一侧 */
const PIN_ENVELOPE_KEY = 'octane-pin-envelope';
/** 连续失败计数（存 local，刷新/重启不重置；成功解锁清零） */
const PIN_FAIL_COUNT_KEY = 'octane-pin-fail-count';
/** 连续输错 5 次 → 熔断：擦除信封与 PIN 配置，回退主密码 */
const PIN_MAX_FAILED_ATTEMPTS = 5;

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

interface ChromeStorageArea {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
}

/** 安全访问 chrome.storage.<area>（非扩展环境返回 null） */
function getChromeArea(area: 'session' | 'local'): ChromeStorageArea | null {
  const g = globalThis as Record<string, unknown>;
  const chrome = g['chrome'];
  if (chrome && typeof chrome === 'object') {
    const storage = (chrome as Record<string, unknown>)['storage'];
    if (storage && typeof storage === 'object') {
      const a = (storage as Record<string, unknown>)[area];
      if (a && typeof a === 'object') {
        return a as ChromeStorageArea;
      }
    }
  }
  return null;
}

async function storeKeyInSession(key: CryptoKey): Promise<void> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const session = getChromeArea('session');
  if (session) {
    await session.set({ [SESSION_KEY_STORAGE_KEY]: toBase64(rawKey) });
  }
}

async function getKeyFromSession(): Promise<CryptoKey | null> {
  const session = getChromeArea('session');
  if (!session) return null;

  const result = await session.get([SESSION_KEY_STORAGE_KEY]);
  const base64Key = result[SESSION_KEY_STORAGE_KEY] as string | undefined;
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
  const session = getChromeArea('session');
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
 *
 * PIN 联动（#96）：主流程成功后，若已启用 PIN——
 * - opts.pin 提供当前 PIN → 用新派生密钥重建信封，PIN 保持有效；
 * - 未提供 → PIN 自动停用（重建信封必须持有 PIN 原文，无法凭空保留）。
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  reencrypt: (oldKey: CryptoKey, newKey: CryptoKey) => Promise<void>,
  opts?: { pin?: string },
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

  // 2.5 若启用 PIN 且提供了 PIN：先解旧信封验证 PIN 正确性。
  // 手滑输错的 PIN 会静默产出解不开的信封（用户下次解锁即触发熔断）——必须在改写任何
  // 持久状态之前拦下；旧信封不可用（如重启后的非持久模式）则无从验证，改密后 PIN 停用。
  const pinConfig = meta.pin;
  let verifiedPinKek: CryptoKey | null = null;
  let pinShouldDisable = false;
  if (pinConfig && opts?.pin) {
    const oldEnvelope = await readEnvelope(pinConfig.persistEnvelope);
    if (!oldEnvelope) {
      pinShouldDisable = true;
    } else {
      const kek = await deriveKey(opts.pin, fromBase64(pinConfig.salt), pinConfig.iterations);
      try {
        await decryptWithKey(kek, oldEnvelope.encryptedData, oldEnvelope.iv);
      } catch {
        throw new Error('PIN 错误');
      }
      verifiedPinKek = kek;
    }
  }

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

  // 5. PIN 信封联动：验证过的 PIN 用新密钥重建；未提供或无从验证 → 停用（见函数头注释）
  if (pinConfig) {
    if (verifiedPinKek) {
      await writeEnvelope(newKey, verifiedPinKek, pinConfig.persistEnvelope);
      await writeFailCount(0);
    } else if (!opts?.pin || pinShouldDisable) {
      await disablePin();
    }
  }
}

// ========== 快速解锁 PIN（信封机制，#96）==========

/** PIN 形态校验：digits-4/digits-6 要求纯数字定长，custom 至少 4 字符 */
function validatePinFormat(pin: string, format: PinFormat): void {
  if (format === 'digits-4' && !/^\d{4}$/.test(pin)) {
    throw new Error('PIN 必须为 4 位数字');
  }
  if (format === 'digits-6' && !/^\d{6}$/.test(pin)) {
    throw new Error('PIN 必须为 6 位数字');
  }
  if (pin.length < 4) {
    throw new Error('PIN 至少 4 个字符');
  }
}

/** 读当前 PIN 配置（meta.pin） */
async function readPinConfig(): Promise<PinConfig | null> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  return meta?.pin ?? null;
}

/** 读信封（按 persistEnvelope 决定从 local 还是 session 读） */
async function readEnvelope(
  persist: boolean,
): Promise<{ encryptedData: string; iv: string } | null> {
  const area = getChromeArea(persist ? 'local' : 'session');
  if (!area) return null;
  const r = await area.get([PIN_ENVELOPE_KEY]);
  const envelope = r[PIN_ENVELOPE_KEY];
  if (!envelope || typeof envelope !== 'object') return null;
  return envelope as { encryptedData: string; iv: string };
}

/**
 * 把派生密钥包装成信封并写入目标存储区，同时清掉另一侧（模式切换不留残留）。
 * 信封 = 用 PIN 派生 KEK 加密的派生密钥 raw（base64）；主密钥本身永不明文持久化。
 */
async function writeEnvelope(
  key: CryptoKey,
  pinKek: CryptoKey,
  persist: boolean,
): Promise<void> {
  const rawKey = await crypto.subtle.exportKey('raw', key);
  const envelope = await encryptWithKey(pinKek, toBase64(rawKey));
  await moveEnvelope(persist, envelope);
}

/** 信封写入目标侧并清除另一侧（写入侧与清除侧互斥，不留模式切换残留） */
async function moveEnvelope(
  persist: boolean,
  envelope: { encryptedData: string; iv: string },
): Promise<void> {
  const target = getChromeArea(persist ? 'local' : 'session');
  const other = getChromeArea(persist ? 'session' : 'local');
  await target?.set({ [PIN_ENVELOPE_KEY]: envelope });
  await other?.remove([PIN_ENVELOPE_KEY]);
}

async function clearEnvelope(): Promise<void> {
  await getChromeArea('session')?.remove([PIN_ENVELOPE_KEY]);
  await getChromeArea('local')?.remove([PIN_ENVELOPE_KEY]);
}

/** 失败计数存 local：刷新/浏览器重启都不重置，只有成功解锁或熔断才清零 */
async function readFailCount(): Promise<number> {
  const local = getChromeArea('local');
  if (!local) return 0;
  const r = await local.get([PIN_FAIL_COUNT_KEY]);
  const n = r[PIN_FAIL_COUNT_KEY];
  return typeof n === 'number' ? n : 0;
}

async function writeFailCount(count: number): Promise<void> {
  await getChromeArea('local')?.set({ [PIN_FAIL_COUNT_KEY]: count });
}

/**
 * 启用快速解锁 PIN（前置：已设主密码且当前已解锁——包装需要会话中的派生密钥）。
 * 设置/修改/关闭 PIN 的主密码确认门槛由 UI 层负责，本层只校验解锁态。
 */
export async function setupPin(
  pin: string,
  format: PinFormat,
  persistEnvelope: boolean,
): Promise<void> {
  validatePinFormat(pin, format);
  const key = await getEffectiveKey();
  if (!key) {
    throw new Error('密钥不可用，请先解锁后再设置 PIN');
  }
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (!meta?.verifier) {
    throw new Error('未设置主密码，请先设置主密码');
  }

  const salt = randomBytes(SALT_LENGTH);
  const pinKek = await deriveKey(pin, salt, DEFAULT_ITERATIONS);
  await writeEnvelope(key, pinKek, persistEnvelope);
  await putRecord('cryptoMetadata', {
    ...meta,
    pin: {
      salt: toBase64(salt),
      iterations: DEFAULT_ITERATIONS,
      persistEnvelope,
      format,
      createdAt: Date.now(),
    },
  });
  await writeFailCount(0);
}

/** 是否已启用 PIN */
export async function isPinEnabled(): Promise<boolean> {
  return (await readPinConfig()) !== null;
}

/** 当前 PIN 配置（未启用返回 null；设置区展示形态与持久化状态用） */
export async function getPinConfig(): Promise<PinConfig | null> {
  return readPinConfig();
}

/** 当前模式下信封是否可用（决定解锁弹窗显示 PIN 输入还是主密码） */
export async function hasPinEnvelope(): Promise<boolean> {
  const cfg = await readPinConfig();
  if (!cfg) return false;
  return (await readEnvelope(cfg.persistEnvelope)) !== null;
}

/**
 * 用 PIN 解锁：解信封还原派生密钥并写入 session。
 * 连续输错 5 次 → 熔断（擦除信封与 PIN 配置，回退主密码）；成功解锁清零计数。
 *
 * @returns true=解锁成功；false=PIN 错误或信封不可用
 */
export async function unlockWithPin(pin: string): Promise<boolean> {
  const cfg = await readPinConfig();
  if (!cfg) return false;
  const envelope = await readEnvelope(cfg.persistEnvelope);
  if (!envelope) return false;

  const pinKek = await deriveKey(pin, fromBase64(cfg.salt), cfg.iterations);
  let rawKeyBase64: string;
  try {
    rawKeyBase64 = await decryptWithKey(pinKek, envelope.encryptedData, envelope.iv);
  } catch {
    // AES-GCM 解密失败 = PIN 错误
    const fails = (await readFailCount()) + 1;
    if (fails >= PIN_MAX_FAILED_ATTEMPTS) {
      await disablePin();
    } else {
      await writeFailCount(fails);
    }
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64(rawKeyBase64),
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  );
  await storeKeyInSession(key);
  await writeFailCount(0);
  return true;
}

/** 关闭 PIN：擦除信封、PIN 配置与失败计数 */
export async function disablePin(): Promise<void> {
  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (meta?.pin) {
    const { pin: _removed, ...rest } = meta;
    await putRecord('cryptoMetadata', rest);
  }
  await clearEnvelope();
  await writeFailCount(0);
}

/**
 * 切换「重启后仍可用 PIN 解锁」（信封持久化位置）。
 * 信封内容与存储位置无关，直接把现有信封搬到目标侧即可，无需 PIN 原文；
 * 切到持久侧前必须确认信封确实存在（否则持久化一个空开关毫无意义）。
 */
export async function setPinPersistence(persist: boolean): Promise<void> {
  const cfg = await readPinConfig();
  if (!cfg) {
    throw new Error('未启用 PIN');
  }
  if (cfg.persistEnvelope === persist) return;

  const envelope = await readEnvelope(cfg.persistEnvelope);
  if (!envelope) {
    throw new Error('PIN 信封不可用，请先解锁后再修改');
  }
  await moveEnvelope(persist, envelope);

  const meta = await getByKey<CryptoMetadata>('cryptoMetadata', 'singleton');
  if (meta) {
    await putRecord('cryptoMetadata', { ...meta, pin: { ...cfg, persistEnvelope: persist } });
  }
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
