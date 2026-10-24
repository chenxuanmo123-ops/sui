import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { modelOptions, normalizeBaseURL, requestModel, completionContent } from '../server/model-client.mjs';

async function fixture(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const provider = { baseURL: 'http://127.0.0.1:' + server.address().port, apiKey: 'TEST_ONLY_SECRET', model: 'test' };
  try { await run(provider); }
  finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}
const options = () => ({ signal: new AbortController().signal, body: {} });
test('DeepSeek budgets and explicit non-thinking apply only to official modern models', () => {
  const modern = { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash' };
  assert.equal(modelOptions(modern, true).thinking.type, 'disabled');
  assert.ok(modelOptions(modern, true).max_tokens >= 1024);
  assert.equal(modelOptions({ ...modern, model: 'deepseek-reasoner' }, true).max_tokens, 4096);
  assert.ok(!modelOptions({ ...modern, baseURL: 'https://third-party.example/v1' }).thinking);
  assert.equal(normalizeBaseURL(' https://api.deepseek.com/v1/chat/completions/// '), 'https://api.deepseek.com/v1');
});
test('Timeout covers delayed response body after headers and heartbeat whitespace', async () => {
  await fixture((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write(' '); }, async provider => {
    await assert.rejects(requestModel(provider, { ...options(), timeoutMs: 80 }), /超时/);
  });
});
test('Cancellation interrupts waiting body and surfaces a clear message', async () => {
  await fixture((req, res) => { res.writeHead(200); res.write(' '); }, async provider => {
    const controller = new AbortController();
    const waiting = requestModel(provider, { ...options(), signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 50);
    try { await assert.rejects(waiting, /取消/); } finally { clearTimeout(timer); }
  });
});
test('401 and 402 errors are actionable and never reflect upstream credentials', async () => {
  for (const [status, message] of [[401, /API Key/], [402, /余额不足/]]) {
    await fixture((req, res) => { res.writeHead(status); res.end('TEST_ONLY_SECRET'); }, async provider => {
      await assert.rejects(requestModel(provider, options()), error => message.test(error.message) && !error.message.includes(provider.apiKey));
    });
  }
});
test('Final content required; reasoning alone and token truncation cannot pass connection tests', () => {
  assert.throws(() => completionContent({ choices: [{ message: { content: '', reasoning_content: 'test reasoning' } }] }), /没有给出分析内容/);
  assert.throws(() => completionContent({ choices: [{ message: { content: '' } }] }), /没有返回分析内容/);
  assert.throws(() => completionContent({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }), /截断/);
  assert.equal(completionContent({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }), 'OK');
});
test('Redirects are refused instead of followed, so credentials stay on the configured origin', async () => {
  let followed = 0;
  await fixture((req, res) => {
    if (req.url.startsWith('/other')) { followed++; res.writeHead(200); return res.end('{}'); }
    res.writeHead(302, { Location: '/other' }); res.end();
  }, async provider => {
    await assert.rejects(requestModel(provider, options()), /重定向/);
  });
  assert.equal(followed, 0);
});
test('Outbound fetch uses manual redirect mode because workerd rejects redirect:error', async () => {
  const original = globalThis.fetch;
  let mode;
  globalThis.fetch = async (url, init) => { mode = init.redirect; return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try { await requestModel({ baseURL: 'https://example.com/v1', apiKey: 'TEST_ONLY_SECRET', model: 'test' }, options()); }
  finally { globalThis.fetch = original; }
  assert.equal(mode, 'manual');
});
test('Bounded response reader rejects oversized bodies', async () => {
  await fixture((req, res) => { res.writeHead(200); res.end('x'.repeat(1000001)); }, async provider => {
    await assert.rejects(requestModel(provider, options()), /响应过大/);
  });
});
