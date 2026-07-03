import type { CloudStorageProvider, ProviderId } from '../types';
import { S3Provider } from './S3Provider';
import { WebdavProvider } from './WebdavProvider';

/**
 * 云服务商注册表：新增服务商在此加一行即可接入（策略模式扩展点）。
 * 当前：s3（阿里/腾讯，aws4fetch）+ webdav（坚果云）。
 */
export const cloudProviders: Record<ProviderId, CloudStorageProvider> = {
  s3: new S3Provider(),
  webdav: new WebdavProvider(),
};

/** 按 id 取策略。 */
export function getCloudProvider(id: ProviderId): CloudStorageProvider {
  return cloudProviders[id];
}
