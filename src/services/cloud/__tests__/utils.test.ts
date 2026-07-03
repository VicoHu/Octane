import { describe, test, expect } from 'vitest';
import { getRequired } from '../utils';
import type { CloudStorageConfig } from '../types';

describe('getRequired', () => {
  test('返回所请求键的 string 值（全部存在）', () => {
    const cfg: CloudStorageConfig = {
      region: 'oss-cn-hangzhou',
      bucket: 'mybucket',
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
    };
    const got = getRequired(cfg, ['region', 'bucket', 'accessKeyId', 'accessKeySecret']);
    expect(got).toEqual({
      region: 'oss-cn-hangzhou',
      bucket: 'mybucket',
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
    });
  });

  test('缺失字段时抛错并指名缺失字段', () => {
    const cfg: CloudStorageConfig = { region: 'oss-cn-hangzhou' };
    expect(() => getRequired(cfg, ['region', 'bucket'])).toThrow(/bucket/);
  });

  test('空字符串视为缺失并抛错', () => {
    const cfg: CloudStorageConfig = { region: '  ', bucket: 'b' };
    expect(() => getRequired(cfg, ['region', 'bucket'])).toThrow(/region/);
  });

  test('未请求的字段不包含在返回值中', () => {
    const cfg: CloudStorageConfig = { region: 'r', bucket: 'b', accessKeyId: 'AK' };
    const got = getRequired(cfg, ['region']);
    expect(got).toEqual({ region: 'r' });
    expect(got).not.toHaveProperty('bucket');
  });
});
