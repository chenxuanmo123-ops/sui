import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

// The dev script must wire the same AI service as production. A missing profile
// store used to crash `npm run dev` at startup while `npm start` kept working.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('开发服务同时提供页面与 AI 接口', { timeout: 45000 }, async () => {
  const port = await freePort();
  const temp = await mkdtemp(join(tmpdir(), 'shujian-dev-'));
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), SHUJIAN_CONFIG_PATH: join(temp, 'connections.json'), LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '', LLM_PROVIDERS_JSON: '' };
  const child = spawn(process.execPath, ['scripts/dev.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const base = `http://127.0.0.1:${port}`;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Dev server startup timed out: ' + output)), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Dev server exited: ${code} ${output}`)); });
      child.stdout.on('data', chunk => { if (chunk.toString().includes('http://')) { clearTimeout(timer); resolve(); } });
    });
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<div id="root"/);
    const status = await fetch(base + '/api/ai/status');
    assert.equal(status.status, 200);
    assert.match(status.headers.get('content-type') ?? '', /application\/json/);
    const data = await status.json();
    assert.equal(typeof data.configured, 'boolean');
    assert.equal(typeof data.canManage, 'boolean');
    assert.ok(!JSON.stringify(data).toLowerCase().includes('apikey'));
    const unknown = await fetch(base + '/api/ai/unknown', { method: 'POST' });
    assert.equal(unknown.status, 404);
  } finally {
    child.kill();
    await rm(temp, { recursive: true, force: true });
  }
});
