import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { onRequest as aiFunction } from '../functions/api/ai/[[path]].js';
import { onRequest as healthFunction } from '../functions/api/health.js';
import { onRequest as apiFallback } from '../functions/api/[[path]].js';

const dataset = { hash: 'b'.repeat(64), columns: [{ field: 'year' }, { field: 'value' }, { field: 'country' }] };
const mapping = { x: 'year', metric: 'value', filter: 'country', value: 'China', from: '2015', to: '2022', unit: 'TWh', aggregate: 'sum', timeBucket: 'year', conditions: [] };
const plan = { goal: '比较所选地区的年度发电量', scene: '年度能源统计', grain: '每行是一个地区一年', fieldRoles: [{ field: 'year', meaning: '统计年', role: 'time' }], assumptions: [], questions: [], tasks: [{ id: 'annual', title: '年度比较', rationale: '回答年度变化问题', chart: 'line', mapping }], limitations: ['仅描述统计，不判断原因'] };

const call = (handler, path, { method = 'GET', body, headers = {}, env = {} } = {}) => handler({
  request: new Request('https://example.pages.dev' + path, {
    method,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  }),
  env,
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}

test('Pages 健康检查返回 JSON 而不是 SPA HTML', async () => {
  const response = await call(healthFunction, '/api/health');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'shujian-agent', aiConfigured: false });
  const configured = await call(healthFunction, '/api/health', { env: { LLM_BASE_URL: 'https://api.example.com/v1', LLM_API_KEY: 'k', LLM_MODEL: 'm' } });
  assert.equal((await configured.json()).aiConfigured, true);
  assert.equal((await call(healthFunction, '/api/health', { method: 'HEAD' })).status, 200);
  assert.equal((await call(healthFunction, '/api/health', { method: 'POST' })).status, 405);
});

test('未知 API 路径返回 JSON 404，不被 SPA 回退吞掉', async () => {
  const response = await call(apiFallback, '/api/unknown');
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /application\/json/);
});

test('未配置模型时状态接口 JSON 报告未配置，且不泄露凭据', async () => {
  const response = await call(aiFunction, '/api/ai/status', { env: {} });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  const status = await response.json();
  assert.equal(status.configured, false);
  assert.equal(status.canManage, false);
  assert.deepEqual(status.providers, []);
});

test('状态接口即使配置了环境变量也不返回 Key 或接口地址', async () => {
  const env = { LLM_BASE_URL: 'https://api.example.com/v1', LLM_API_KEY: 'PAGES_TEST_SECRET', LLM_MODEL: 'test-model' };
  const response = await call(aiFunction, '/api/ai/status', { env });
  const text = await response.text();
  assert.ok(!text.includes('PAGES_TEST_SECRET'));
  assert.ok(!text.includes('api.example.com'));
  const status = JSON.parse(text);
  assert.equal(status.configured, true);
  assert.equal(status.canManage, false);
  assert.equal(status.providers[0].model, 'test-model');
});

test('未配置模型时分析请求返回 503 JSON，而不是 HTML 或假结果', async () => {
  const response = await call(aiFunction, '/api/ai/plan', { method: 'POST', body: { question: '测试', dataset }, env: {} });
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.match((await response.json()).error, /尚未配置/);
});

test('来源不匹配与非法 JSON 被拒绝', async () => {
  const env = { LLM_BASE_URL: 'https://api.example.com/v1', LLM_API_KEY: 'PAGES_TEST_SECRET', LLM_MODEL: 'test-model' };
  const cross = await call(aiFunction, '/api/ai/plan', { method: 'POST', body: { question: '测试', dataset }, headers: { Origin: 'https://evil.example' }, env });
  assert.equal(cross.status, 403);
  const broken = await call(aiFunction, '/api/ai/plan', { method: 'POST', body: '{', env });
  assert.equal(broken.status, 400);
  assert.match((await broken.json()).error, /JSON/);
});

test('Pages 适配器走完真实计划契约（本地测试替身，不是实际模型评测）', async () => {
  let seenAuthorization = '';
  const upstream = createServer(async (req, res) => {
    seenAuthorization = req.headers.authorization;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    assert.equal(request.model, 'test-model');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }] }));
  });
  const upstreamURL = await listen(upstream);
  try {
    const env = { LLM_BASE_URL: upstreamURL + '/v1', LLM_API_KEY: 'PAGES_TEST_SECRET', LLM_MODEL: 'test-model' };
    const response = await call(aiFunction, '/api/ai/plan', { method: 'POST', body: { question: '年度发电量如何变化？', dataset, providerId: 'default' }, env });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan.tasks[0].id, 'annual');
    assert.equal(payload.datasetHash, dataset.hash);
    assert.equal(seenAuthorization, 'Bearer PAGES_TEST_SECRET');
  } finally {
    await close(upstream);
  }
});

test('公网适配器不允许在网页保存模型连接', async () => {
  const env = { LLM_BASE_URL: 'https://api.example.com/v1', LLM_API_KEY: 'PAGES_TEST_SECRET', LLM_MODEL: 'test-model' };
  const response = await call(aiFunction, '/api/ai/connections', { method: 'POST', body: { action: 'save', profile: { id: 'user_x', name: 'x', baseURL: 'https://api.example.com/v1', apiKey: 'k', model: 'm' } }, env });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /本机/);
});
