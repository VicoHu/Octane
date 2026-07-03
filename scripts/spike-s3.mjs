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
if (!['aliyun', 'tencent'].includes(PRESET)) {
  console.error(`S3_PRESET 必须是 aliyun 或 tencent，收到：${PRESET}`);
  process.exit(1);
}
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
// 用含「/」的 key 验证虚拟目录路径（生产 BACKUP_OBJECT_KEY 也含 /），但不占用生产备份路径
const KEY = 'octane/spike-test.txt';
const BODY = `hello from octane s3 spike @ ${new Date().toISOString()}`;

const client = new AwsClient({ accessKeyId: AK, secretAccessKey: SK, region: REGION, service: 's3' });

async function dump(res, label) {
  const text = await res.text().catch(() => '');
  console.log(`[${label}] ${res.status} ${res.statusText}`);
  if (text) console.log(text.slice(0, 1200));
  return { ok: res.ok, status: res.status, text };
}

try {
  console.log(`preset=${PRESET} vhost=${VHOST} (service=s3, UNSIGNED-PAYLOAD)`);

  // testConnection 链路：HEAD bucket（200=桶存在可达 / 403=凭证 / 404=桶不存在）
  const headSigned = await client.sign(VHOST, { method: 'HEAD' });
  const head = await dump(await fetch(headSigned), 'HEAD bucket');
  if (head.status === 403) {
    console.error('\n❌ HEAD 403：凭证或权限不足。');
    process.exit(1);
  }
  if (head.status === 404) {
    console.error('\n❌ HEAD 404：桶不存在。');
    process.exit(1);
  }

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
  console.log(match ? `\n✅ SPIKE 通过：${PRESET} s3 端点 HEAD/PUT/GET 链路可直连。` : '\n❌ 内容不一致');
  process.exit(match ? 0 : 1);
} catch (e) {
  console.error('\n❌ 异常：', e);
  process.exit(1);
}
