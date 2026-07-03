// 脚本用途：spike（设计步骤 0）——验证 aws4fetch 的 SigV4（service=s3 + UNSIGNED-PAYLOAD）
// 能否被阿里云 S3 兼容端点 s3.{region}.aliyuncs.com 接受。
// 未知数是「签名接受度」，不是 CORS（扩展已有 *.aliyuncs.com host_permission 且 ali-oss 今天
// 就在浏览器直连阿里）。用 Node 跑（自带 fetch + crypto.subtle），与凭证解耦、不碰浏览器 CORS。
//
// 用法：
//   ALIYUN_AK=xxx ALIYUN_SK=yyy ALIYUN_BUCKET=name ALIYUN_REGION=oss-cn-hangzhou \
//     node scripts/spike-aliyun-s3.mjs
//
// 退出码：0=PUT/GET 往返成功；1=失败（打印响应体定位签名/权限错）。

import { AwsClient } from 'aws4fetch';

const AK = process.env.ALIYUN_AK;
const SK = process.env.ALIYUN_SK;
const BUCKET = process.env.ALIYUN_BUCKET;
const REGION = process.env.ALIYUN_REGION; // 如 oss-cn-hangzhou

if (!AK || !SK || !BUCKET || !REGION) {
  console.error('缺少环境变量 ALIYUN_AK / ALIYUN_SK / ALIYUN_BUCKET / ALIYUN_REGION');
  process.exit(1);
}

// vhost 风格：<bucket>.s3.<region>.aliyuncs.com
const HOST = `${BUCKET}.s3.${REGION}.aliyuncs.com`;
const KEY = 'octane-spike-test.txt';
const BODY = `hello from octane spike @ ${new Date().toISOString()}`;

const client = new AwsClient({
  accessKeyId: AK,
  secretAccessKey: SK,
  region: REGION,
  service: 's3',
});

async function dump(res, label) {
  const text = await res.text().catch(() => '');
  console.log(`[${label}] ${res.status} ${res.statusText}`);
  if (text) console.log(text.slice(0, 1200));
  return { ok: res.ok, text };
}

try {
  console.log(`PUT https://${HOST}/${KEY}  (service=s3, region=${REGION}, UNSIGNED-PAYLOAD)`);
  const putSigned = await client.sign(`https://${HOST}/${KEY}`, {
    method: 'PUT',
    headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' },
    body: BODY,
  });
  const putRes = await fetch(putSigned);
  const { ok: putOk } = await dump(putRes, 'PUT');
  if (!putOk) {
    console.error('\n❌ PUT 失败——签名未被阿里 s3 端点接受，或凭证/权限有误。');
    process.exit(1);
  }

  console.log(`\nGET https://${HOST}/${KEY}`);
  const getSigned = await client.sign(`https://${HOST}/${KEY}`, { method: 'GET' });
  const getRes = await fetch(getSigned);
  const { ok: getOk, text: got } = await dump(getRes, 'GET');
  if (!getOk) process.exit(1);

  const match = got === BODY;
  console.log(`\n往返内容匹配：${match ? '✅ 一致' : '❌ 不一致'}`);
  console.log(match ? '\n✅ SPIKE 通过：aws4fetch + 阿里 s3 兼容端点可直连，方案 B 成立。' : '\n❌ 内容不一致');
  process.exit(match ? 0 : 1);
} catch (e) {
  console.error('\n❌ 异常：', e);
  process.exit(1);
}
