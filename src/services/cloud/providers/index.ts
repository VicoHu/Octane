import type { CloudStorageProvider, ProviderId } from '../types';
import { OssProvider } from './OssProvider';
import { CosProvider } from './CosProvider';
import { S3Provider } from './S3Provider';
import { WebdavProvider } from './WebdavProvider';

/**
 * 云服务商注册表：新增服务商在此加一行即可接入（策略模式扩展点）。
 * Wave 2：s3(aws4fetch) / webdav(坚果云) 加入；oss/cos 旧实现保留至 Wave 3 删除。
 */
export const cloudProviders: Record<ProviderId, CloudStorageProvider> = {
  oss: new OssProvider(),
  cos: new CosProvider(),
  s3: new S3Provider(),
  webdav: new WebdavProvider(),
};

/** 按 id 取策略。 */
export function getCloudProvider(id: ProviderId): CloudStorageProvider {
  return cloudProviders[id];
}
