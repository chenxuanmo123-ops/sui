#!/usr/bin/env node
// Checks that a deployed address really serves the AI backend instead of the
// SPA fallback. Status codes alone are not enough: Pages answers unknown paths
// with index.html and HTTP 200.
// Usage: node scripts/verify-public.mjs https://your-site.pages.dev
const base = (process.argv[2] || 'https://sui-ae9.pages.dev').replace(/\/+$/, '');
const results = [];
let failed = 0;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
}

async function get(path, init) {
  const response = await fetch(base + path, { redirect: 'manual', ...init });
  const text = await response.text();
  return { response, text, type: response.headers.get('content-type') || '' };
}

try {
  const home = await get('/');
  record('首页可打开', home.response.ok && home.type.includes('text/html'), `${home.response.status} ${home.type}`);

  const health = await get('/api/health');
  let healthBody = null;
  try { healthBody = JSON.parse(health.text); } catch { /* reported below */ }
  record('/api/health 返回 JSON', health.type.includes('application/json') && healthBody?.status === 'ok',
    `${health.response.status} ${health.type}`);
  record('/api/health 报告模型配置', typeof healthBody?.aiConfigured === 'boolean',
    healthBody ? `aiConfigured=${healthBody.aiConfigured}` : '响应体不是 JSON，仍是 SPA 回退');

  const status = await get('/api/ai/status');
  let statusBody = null;
  try { statusBody = JSON.parse(status.text); } catch { /* reported below */ }
  record('/api/ai/status 返回 JSON', status.type.includes('application/json') && statusBody !== null,
    `${status.response.status} ${status.type}`);
  record('状态接口不泄露密钥', !/apiKey|api_key|sk-[A-Za-z0-9]{12,}/.test(status.text), '检查响应体关键字');
  if (statusBody) record('状态接口结构完整', typeof statusBody.configured === 'boolean' && Array.isArray(statusBody.providers), JSON.stringify({ configured: statusBody.configured, providers: statusBody.providers?.length }));

  const unknown = await get('/api/__verify_unknown__');
  record('未知 API 返回 JSON 404，而不是 HTML 200', unknown.response.status === 404 && unknown.type.includes('application/json'),
    `${unknown.response.status} ${unknown.type}`);
} catch (error) {
  record('网络请求', false, error instanceof Error ? error.message : String(error));
}

for (const item of results) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ' — ' + item.detail : ''}`);
console.log(`\n${results.length - failed}/${results.length} checks passed against ${base}`);
if (failed) {
  console.log('提示：任何 /api/* 返回 text/html 都说明该地址还没有运行 Pages Functions，或环境变量尚未生效。');
  process.exit(1);
}
