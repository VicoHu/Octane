import type { CloudStorageProvider, ProviderId } from '../types';
import { OssProvider } from './OssProvider';
import { CosProvider } from './CosProvider';

/** 云服务商注册表：新增服务商在此加一行即可接入（策略模式扩展点）。 */
export const cloudProviders: Record<ProviderId, CloudStorageProvider> = {
  oss: new OssProvider(),
  cos: new CosProvider(),
};

/** 按 id 取策略。 */
export function getCloudProvider(id: ProviderId): CloudStorageProvider {
  return cloudProviders[id];
}
