import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';

// Isolate configuration; never open the developer's saved model connections.
const temp = await mkdtemp(join(tmpdir(), 'shujian-production-'));
const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', SHUJIAN_CONFIG_PATH: join(temp, 'connections.json'), LLM_BASE_URL: '', LLM_API_KEY: '', LLM_MODEL: '', LLM_PROVIDERS_JSON: '' };
const child = spawn(process.execPath, ['server/serve.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
let checks = 0;
const check = (actual, expected) => { assert.equal(actual, expected); checks++; };
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Production server startup timed out')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Production server exited: ${code} ${stderr}`)); });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  const get = (path, options) => fetch(base + path, options);
  const health = await get('/api/health');
  check(health.status, 200); check((await health.json()).status, 'ok');
  check((await get('/api/health', { method: 'HEAD' })).status, 200);
  const home = await get('/'); check(home.status, 200);
  const html = await home.text(); assert.match(html, /<div id="root"/); checks++;
  check(home.headers.get('cache-control'), 'no-cache');
  const assets = await readdir('dist/assets');
  for (const [suffix, mime] of [['.js', 'javascript'], ['.css', 'text/css'], ['.wasm', 'application/wasm'], ['.mjs', 'javascript']]) {
    const name = assets.find(name => name.endsWith(suffix)); assert.ok(name, `Missing ${suffix} build asset`);
    const asset = await get('/assets/' + name); check(asset.status, 200);
    assert.ok(asset.headers.get('content-type')?.includes(mime)); checks++;
    check(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    await asset.arrayBuffer();
  }
  for (const path of ['/.env', '/.local/model-connections.json', '/.git/config', '/%2elocal/config', '/server/ai.mjs', '/assets/missing.js']) {
    const response = await get(path); assert.ok([403, 404].includes(response.status), `${path}: ${response.status}`); checks++;
  }
  check((await get('/analysis/history')).status, 200);
  check((await get('/api/missing')).status, 404);
  check((await get('/%', {})).status, 400);
  check((await get('/', { method: 'POST' })).status, 405);
  const remoteHeaders = { Host: 'review.example', Origin: 'https://review.example', 'Content-Type': 'application/json' };
  // Node fetch can replace Host with URL authority; raw HTTP preserves the public Host.
  const remote = (path, body) => new Promise((resolve, reject) => {
    const req = request(base + path, { method: body ? 'POST' : 'GET', headers: remoteHeaders }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, json: async () => JSON.parse(Buffer.concat(chunks).toString()) }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
  const statusResponse = await remote('/api/ai/status'); check(statusResponse.status, 200);
  const status = await statusResponse.json(); check(status.canManage, false); check(status.configured, false); check(status.providers.length, 0);
  check((await remote('/api/ai/connections', '{}')).status, 403);
  console.log(`PASS ${checks} production checks: built assets/WASM/PDF worker MIME, health, cache, private paths, SPA, public model-management boundary. No model API called.`);
} finally {
  if (child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
  }
  await rm(temp, { recursive: true, force: true });
}
