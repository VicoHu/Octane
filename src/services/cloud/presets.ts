import type { S3Preset, WebdavPreset } from './types';

/**
 * S3 兼容服务商预设定义。endpoint 由 preset + region 推导（vhost 风格桶地址由 provider 拼
 * `{bucket}.{host}`）。枚举锁，无 custom。
 *
 * 端点依据（plan-eng-review search check 钉死）：
 * - 阿里云：S3 兼容域名 s3.{region}.aliyuncs.com（非 oss-{region}.aliyuncs.com，后者走 OSS 原生签名）。
 *   spike 已验证 service=s3 + UNSIGNED-PAYLOAD + region=oss-cn-hangzhou 可用。
 * - 腾讯云：cos.{region}.myqcloud.com（vhost；2024-01-01 后新建桶仅支持 vhost）。
 */
export interface S3PresetDef {
  /**
   * 返回 endpoint **host（不含 scheme）**，{region} 占位。
   * provider 负责：`https://` 前缀 + vhost 桶地址 `{bucket}.{host}` 拼装。
   * 例：aliyun → `s3.${region}.aliyuncs.com`，provider 拼 `https://${bucket}.s3.${region}.aliyuncs.com/${key}`。
   */
  endpoint: (region: string) => string;
  /** 显示名。 */
  label: string;
  /** region 输入占位提示。 */
  regionPlaceholder: string;
}

export const S3_PRESETS: Record<S3Preset, S3PresetDef> = {
  aliyun: {
    endpoint: (region) => `s3.${region}.aliyuncs.com`,
    label: '阿里云 OSS',
    regionPlaceholder: 'oss-cn-hangzhou',
  },
  tencent: {
    endpoint: (region) => `cos.${region}.myqcloud.com`,
    label: '腾讯云 COS',
    regionPlaceholder: 'ap-guangzhou',
  },
};

/**
 * WebDAV 服务商预设定义。baseUrl 固定（枚举锁，不暴露自由输入）。
 * 坚果云：dav.jianguoyun.com/dav/，Basic Auth，username=邮箱，password=应用密码。
 */
export interface WebdavPresetDef {
  /** 固定 base URL（含末尾斜杠）。 */
  baseUrl: string;
  /** 显示名。 */
  label: string;
}

export const WEBDAV_PRESETS: Record<WebdavPreset, WebdavPresetDef> = {
  jianguoyun: {
    baseUrl: 'https://dav.jianguoyun.com/dav/',
    label: '坚果云',
  },
};
