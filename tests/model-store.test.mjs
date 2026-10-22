import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createProfileStore } from '../server/profile-store.mjs';
import { createAiHandler } from '../server/ai.mjs';
const listen = async server => { await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port; };
const close = async server => { await new Promise(r => { server.close(r); server.closeAllConnections(); }); };
const file = () => resolve('artifacts', 'test-config-' + randomUUID(), 'models.json');
const post = (url, path, body, headers = {}) => fetch(url + '/api/ai/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const rawRequest = (url, method, body, headers) => new Promise((resolve, reject) => {
  const req = request(url, { method, headers: { 'Content-Type': 'application/json', ...headers } }, res => { let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, text: async () => raw, json: async () => JSON.parse(raw) })); }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
});
const inspection = { summary: '字段显示可能是能源统计，需确认数据来源。', scene: '年度能源统计候选', grain: '可能按地区年度记录，需要确认唯一性。', fields: [{ field: 'year', meaning: '可能是统计年', role: 'time' }], risks: [{ title: '缺失记录需核查', detail: '请检查空值含义。', fields: ['value'] }], directions: [{ title: '年度比较', question: '各年能源指标如何变化？', requiredContext: '确认指标单位和唯一粒度。' }], questions: ['请确认统计范围及单位。'], limitations: ['只基于字段元数据的初步定位，没有完成业务计算。'] };
test('本机配置跨处理器重启保留，编辑留空保留密钥，状态永不回传密钥', async () => {
  const path = file();
  let app = createServer(createAiHandler([], { store: createProfileStore(path) })), url = await listen(app);
  const profile = { id: 'user_saved', name: '本机分析连接', model: 'contract', baseURL: 'https://example.com/v1', apiKey: 'PERSIST_TEST_ONLY_SECRET', jsonMode: true };
  try {
    const response = await post(url, 'connections', { action: 'save', profile, makeDefault: true });
    assert.equal(response.status, 200); const raw = await response.text(); assert.ok(!raw.includes(profile.apiKey)); assert.equal(JSON.parse(raw).defaultProviderId, profile.id);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).profiles[0].apiKey, profile.apiKey);
  } finally { await close(app); }
  app = createServer(createAiHandler([], { store: createProfileStore(path) })); url = await listen(app);
  try {
    let status = await (await fetch(url + '/api/ai/status')).json(); assert.equal(status.providers[0].editable, true); assert.equal(status.providers[0].baseURL, profile.baseURL); assert.ok(!('apiKey' in status.providers[0]));
    let response = await post(url, 'connections', { action: 'save', profile: { ...profile, apiKey: '', model: 'contract-new', name: '已编辑连接' } }); assert.equal(response.status, 200);
    const saved = JSON.parse(await readFile(path, 'utf8')); assert.equal(saved.profiles[0].apiKey, profile.apiKey); assert.equal(saved.profiles[0].model, 'contract-new');
    response = await post(url, 'connections', { action: 'save', profile: { ...profile, id: 'user_second', name: '第二连接' } }); assert.equal(response.status, 200);
    response = await post(url, 'connections', { action: 'default', id: 'user_second' }); assert.equal((await response.json()).defaultProviderId, 'user_second');
    response = await post(url, 'connections', { action: 'delete', id: 'user_saved' }); assert.equal((await response.json()).providers.length, 1);
    response = await post(url, 'connections', { action: 'delete', id: 'user_second' }); assert.equal((await response.json()).configured, false);
  } finally { await close(app); }
});
test('远程访问不允许管理本机配置，不泄露地址与密钥；跨来源写入被拒绝', async () => {
  const store = createProfileStore(file());
  await store.update(() => ({ profiles: [{ id: 'user_saved', name: '私有连接', model: 'test', baseURL: 'https://example.com/v1', apiKey: 'PRIVATE_TEST_KEY' }], defaultId: 'user_saved' }));
  const app = createServer(createAiHandler([], { store })), url = await listen(app);
  try {
    const headers = { Host: 'public.example' };
    const status = await (await rawRequest(url + '/api/ai/status', 'GET', null, headers)).text(); assert.ok(!status.includes('PRIVATE_TEST_KEY')); assert.ok(!status.includes('baseURL')); assert.equal(JSON.parse(status).canManage, false);
    const result = await rawRequest(url + '/api/ai/connections', 'POST', { action: 'delete', id: 'user_saved' }, headers); assert.equal(result.status, 403);
    const cross = await post(url, 'connections', { action: 'delete', id: 'user_saved' }, { Origin: 'https://attacker.example' }); assert.equal(cross.status, 403); assert.equal((await store.read()).profiles.length, 1);
  } finally { await close(app); }
});
test('内置初步定位使用默认模型，拒绝无授权与虚构字段，只转发元数据', async () => {
  let answer = structuredClone(inspection), received, calls = 0;
  const upstream = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    calls++; received = { key: req.headers.authorization, body: JSON.parse(text) };
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }));
  });
  const upstreamURL = await listen(upstream), store = createProfileStore(file());
  const p = { id: 'user_default', name: '默认分析', model: 'default-analysis', baseURL: upstreamURL + '/v1', apiKey: 'DEFAULT_TEST_SECRET', jsonMode: true };
  await store.update(() => ({ profiles: [{ ...p, id: 'user_other', model: 'other' }, p], defaultId: p.id }));
  const app = createServer(createAiHandler([], { store })), url = await listen(app);
  const dataset = { hash: 'a'.repeat(64), name: 'real-subset.csv', rowCount: 8, columns: [{ field: 'year', typeCandidate: '数值', missing: 0, nonempty: 8, numeric: 8, examples: ['SECRET_CELL'] }, { field: 'value', missing: 1 }], rows: ['SECRET_ROW'] };
  try {
    let response = await post(url, 'inspect', { dataset }); assert.equal(response.status, 400); assert.equal(calls, 0);
    response = await post(url, 'inspect', { consent: true, providerId: 'user_other', dataset }); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.model, 'default-analysis'); assert.equal(body.datasetHash, dataset.hash); assert.equal(received.key, 'Bearer DEFAULT_TEST_SECRET');
    assert.ok(!JSON.stringify(received.body).includes('SECRET_CELL')); assert.ok(!JSON.stringify(received.body).includes('SECRET_ROW')); assert.match(received.body.messages[0].content, /列名不是业务事实/);
    answer.fields[0].field = 'invented'; response = await post(url, 'inspect', { consent: true, dataset }); assert.equal(response.status, 400); assert.match((await response.json()).error, /不存在/);
    answer = structuredClone(inspection); answer.risks[0].fields = ['invented']; response = await post(url, 'inspect', { consent: true, dataset }); assert.equal(response.status, 400);
    response = await post(url, 'inspect', { consent: true, dataset: { ...dataset, hash: 'invalid' } }); assert.equal(response.status, 400);
  } finally { await close(app); await close(upstream); }
});
