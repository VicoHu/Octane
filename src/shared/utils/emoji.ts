/**
 * Emoji 识别与校验工具。
 *
 * 用于 workspace / category 的自定义图标输入校验，防止用户填入
 * 字母、长文本、特殊符号等非 emoji 字符破坏视觉一致性。
 *
 * 设计权衡（见 docs/workspace-icon-custom-design.md §3、§6）：
 * - 采用 ECMAScript 标准 Unicode 属性转义 \p{Extended_Pictographic}，零第三方依赖。
 * - 目标是「防滥用」而非「严格只允许标准 emoji」：旗子（区域标志）、
 *   肤色修饰等多码点序列按「首码点为 Extended_Pictographic」宽松放行。
 * - 码点数上限 7：兼容 👨‍💻 这类含 ZWJ 的 3-4 码点组合，
 *   同时防止超长 emoji 序列拼接。
 */

/**
 * 匹配单个 emoji，支持三类形态：
 * 1. Extended_Pictographic 基础码点，可含 Variation Selector-16（️）
 *    与 ZWJ 续接的额外 emoji 码点（如 👨‍💻、🏳️‍🌈）
 * 2. 旗子序列：两个 Regional Indicator 码点（如 🇨🇳）
 * 3. 肤色修饰：Extended_Pictographic + 肤色修饰符（如 👍🏽）
 */
const EMOJI_REGEX =
  /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|\p{Extended_Pictographic}\p{Emoji_Modifier}|\p{Regional_Indicator}{2})$/u;

/** 码点数上限：覆盖常见组合 emoji，拒绝超长粘贴 */
const MAX_CODE_POINTS = 7;

/**
 * 判断输入是否为合法的单个 emoji 字符。
 *
 * @returns true 表示可作为 workspace/category 图标安全写入
 */
export function isEmoji(input: string): boolean {
  if (!input) return false;
  const codePoints = [...input];
  if (codePoints.length > MAX_CODE_POINTS) return false;
  return EMOJI_REGEX.test(input);
}
