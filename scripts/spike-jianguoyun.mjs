// 脚本用途：spike（e2e 前置）——验证坚果云 WebDAV 协议链路（PROPFIND/MKCOL/PUT/GET + Basic Auth）。
// Node 跑，验协议与凭证（账号邮箱 + 应用密码，非登录密码）可用性。
//
// 用法：
//   JGY_USER=you@example.com JGY_PASS=应用密码 \
//     node scripts/spike-jianguoyun.mjs
//
// 退出码：0=上传/下载往返成功；1=失败。
//
// 注意：坚果云应用密码在「账户信息 → 安全选项 → 第三方应用管理」生成，非登录密码。

const BASE = 'https://dav.jianguoyun.com/dav/';
const DIR = 'octane';
const FILE = 'octane-backup.json';
const USER = process.env.JGY_USER;
const PASS = process.env.JGY_PASS;

if (!USER || !PASS) {
  console.error('缺少环境变量 JGY_USER（账号邮箱）/ JGY_PASS（应用密码）');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const BODY = `hello from octane webdav spike @ ${new Date().toISOString()}`;

async function req(method, url, extra = {}) {
  // 注意 headers 必须后构造，否则 extra.headers（即便为 {}）会覆盖 Authorization
  const res = await fetch(url, {
    method,
    body: extra.body,
    headers: { Authorization: auth, ...extra.headers },
  });
  const text = await res.text().catch(() => '');
  return { status: res.status, ok: res.ok, text };
}

try {
  console.log(`PROPFIND ${BASE} (Depth: 0)`);
  const pf = await req('PROPFIND', BASE, { headers: { Depth: '0' } });
  console.log(`[PROPFIND] ${pf.status}`);
  if (!pf.ok && pf.status !== 207) {
    console.error(pf.text.slice(0, 800));
    console.error('\n❌ PROPFIND 失败——账号/应用密码错误，或网络不通。');
    process.exit(1);
  }

  console.log(`\nMKCOL ${BASE}${DIR}（幂等）`);
  const mk = await req('MKCOL', `${BASE}${DIR}`, { headers: {} });
  console.log(`[MKCOL] ${mk.status}`);
  if (![200, 201, 405, 409].includes(mk.status)) {
    console.error(mk.text.slice(0, 800));
    console.error('\n❌ MKCOL 失败。');
    process.exit(1);
  }

  console.log(`\nPUT ${BASE}${DIR}/${FILE}`);
  const put = await req('PUT', `${BASE}${DIR}/${FILE}`, { headers: {}, body: BODY });
  console.log(`[PUT] ${put.status}`);
  if (!put.ok) {
    console.error(put.text.slice(0, 800));
    console.error('\n❌ PUT 失败。');
    process.exit(1);
  }

  console.log(`\nGET ${BASE}${DIR}/${FILE}`);
  const get = await req('GET', `${BASE}${DIR}/${FILE}`, { headers: {} });
  console.log(`[GET] ${get.status}`);
  if (!get.ok) process.exit(1);

  const match = get.text === BODY;
  console.log(`\n往返内容匹配：${match ? '✅ 一致' : '❌ 不一致'}`);
  console.log(match ? '\n✅ SPIKE 通过：坚果云 WebDAV 链路可用。' : '\n❌ 内容不一致');
  process.exit(match ? 0 : 1);
} catch (e) {
  console.error('\n❌ 异常：', e);
  process.exit(1);
}
