// 脚本用途：spike（e2e 前置）——验证 aws4fetch SigV4 能直连阿里/腾讯 S3 兼容端点。
// Node 跑（自带 fetch + crypto.subtle），验签名接受度，不碰浏览器 CORS。
//
// 用法（阿里）：
//   S3_PRESET=aliyun S3_AK=... S3_SK=... S3_BUCKET=name S3_REGION=oss-cn-hangzhou \
//     node scripts/spike-s3.mjs
// 用法（腾讯）：
//   S3_PRESET=tencent S3_AK=SecretId S3_SK=SecretKey S3_BUCKET=name-APPID S3_REGION=ap-guangzhou \
//     node scripts/spike-s3.mjs
//
// 退出码：0=PUT/GET 往返成功；1=失败（打印响应体定位签名/权限错）。

import { AwsClient } from 'aws4fetch';

const PRESET = process.env.S3_PRESET ?? 'aliyun';
const AK = process.env.S3_AK;
const SK = process.env.S3_SK;
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.S3_REGION;

if (!AK || !SK || !BUCKET || !REGION) {
  console.error('缺少环境变量 S3_AK / S3_SK / S3_BUCKET / S3_REGION');
  process.exit(1);
}

// vhost 风格：<bucket>.<host>，host 由 preset 推导（与 src/services/cloud/presets.ts 一致）
const HOST =
  PRESET === 'tencent' ? `cos.${REGION}.myqcloud.com` : `s3.${REGION}.aliyuncs.com`;
const VHOST = `https://${BUCKET}.${HOST}`;
const KEY = 'octane-spike-test.txt';
const BODY = `hello from octane s3 spike @ ${new Date().toISOString()}`;

const client = new AwsClient({ accessKeyId: AK, secretAccessKey: SK, region: REGION, service: 's3' });

async function dump(res, label) {
  const text = await res.text().catch(() => '');
  console.log(`[${label}] ${res.status} ${res.statusText}`);
  if (text) console.log(text.slice(0, 1200));
  return { ok: res.ok, text };
}

try {
  console.log(`preset=${PRESET} vhost=${VHOST} (service=s3, UNSIGNED-PAYLOAD)`);
  const putSigned = await client.sign(`${VHOST}/${KEY}`, {
    method: 'PUT',
    headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    body: BODY,
  });
  const { ok: putOk } = await dump(await fetch(putSigned), 'PUT');
  if (!putOk) {
    console.error('\n❌ PUT 失败——签名未被接受，或凭证/桶权限有误。');
    process.exit(1);
  }

  const getSigned = await client.sign(`${VHOST}/${KEY}`, { method: 'GET' });
  const { ok: getOk, text: got } = await dump(await fetch(getSigned), 'GET');
  if (!getOk) process.exit(1);

  const match = got === BODY;
  console.log(`\n往返内容匹配：${match ? '✅ 一致' : '❌ 不一致'}`);
  console.log(match ? `\n✅ SPIKE 通过：${PRESET} s3 端点可直连。` : '\n❌ 内容不一致');
  process.exit(match ? 0 : 1);
} catch (e) {
  console.error('\n❌ 异常：', e);
  process.exit(1);
}
