import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { proxyLookup, sanitizeLookupQuery, webLookup } from '../server/web-lookup.mjs';
import { createAiHandler } from '../server/ai.mjs';
import { createProfileStore } from '../server/profile-store.mjs';

// Transport doubles only: no product dataset and no live Wikipedia answer is
// reproduced here. Every test asserts the fixed upstream hosts and the shape of
// what the UI may show.
function wikiDouble({ zhSearch = [], enSearch = [], pages = {}, fail = false } = {}) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    if (fail) throw new Error('network down');
    const parsed = new URL(url);
    const language = parsed.hostname.startsWith('zh.') ? 'zh' : 'en';
    const search = language === 'zh' ? zhSearch : enSearch;
    const payload = parsed.searchParams.get('list') === 'search'
      ? { query: { search: search.map(hit => ({ pageid: hit.pageId, title: hit.title, snippet: '<span class="searchmatch">' + hit.title + '</span> 条目摘要' })) } }
      : { query: { pages: Object.fromEntries(Object.entries(pages).map(([id, page]) => [id, { title: page.title, extract: page.extract, fullurl: 'https://' + parsed.hostname + '/wiki/' + encodeURIComponent(page.title) }])) } };
    return { ok: true, headers: { get: () => 'application/json; charset=utf-8' }, text: async () => JSON.stringify(payload) };
  };
  return { calls, impl };
}

test('联网查询只接受有界查询词', () => {
  assert.equal(sanitizeLookupQuery('  石油   产量 '), '石油 产量');
  for (const bad of ['', ' a ', 'x'.repeat(121), 42, null, { q: 'x' }]) assert.throws(() => sanitizeLookupQuery(bad), /查询词|无效/);
});

test('先查中文维基，返回真实条目标题、摘要与原文链接，并声明不是证据', async () => {
  const { calls, impl } = wikiDouble({
    zhSearch: [{ pageId: 11, title: '石油' }, { pageId: 12, title: '石油产量' }],
    pages: { 11: { title: '石油', extract: '石油是一种天然存在的可燃液体。' }, 12: { title: '石油产量', extract: '各国石油产量统计口径不同。' } },
  });
  const result = await webLookup('石油产量', { fetchImpl: impl });
  assert.equal(result.language, 'zh');
  assert.equal(result.source, 'Wikipedia');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].title, '石油');
  assert.match(result.results[0].extract, /可燃液体/);
  assert.match(result.results[0].url, /^https:\/\/zh\.wikipedia\.org\//);
  assert.match(result.note, /不是本次计算的证据/);
  assert.ok(calls.every(url => /^https:\/\/(zh|en)\.wikipedia\.org\/w\/api\.php\?/.test(url)), '只允许固定维基百科接口');
  assert.equal(calls.length, 2);
});

test('中文没有条目时退回英文，仍只返回带出处的摘录', async () => {
  const { calls, impl } = wikiDouble({
    enSearch: [{ pageId: 21, title: 'Peak oil' }],
    pages: { 21: { title: 'Peak oil', extract: 'Peak oil is the point of maximum extraction.' } },
  });
  const result = await webLookup('peak oil', { fetchImpl: impl });
  assert.equal(result.language, 'en');
  assert.equal(result.results[0].title, 'Peak oil');
  assert.match(result.results[0].url, /^https:\/\/en\.wikipedia\.org\//);
  assert.equal(calls.filter(url => url.includes('list=search')).length, 2);
});

test('没有匹配条目时返回空列表与说明，不编造资料', async () => {
  const { impl } = wikiDouble({});
  const result = await webLookup('zzzz-no-such-term', { fetchImpl: impl });
  assert.deepEqual(result.results, []);
  assert.match(result.note, /没有找到匹配条目/);
});

test('网络失败明确报错，而不是返回空结果冒充“查无此项”', async () => {
  const { impl } = wikiDouble({ fail: true });
  await assert.rejects(() => webLookup('石油', { fetchImpl: impl }), /联网查询暂时不可用/);
});

test('网络无法访问维基时可由部署中转，且只发往部署者配置的 HTTPS 地址', async () => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ query: '石油', source: 'Wikipedia', language: 'zh', fetchedAt: new Date(0).toISOString(), results: [{ title: '石油', extract: '条目摘要', url: 'https://zh.wikipedia.org/wiki/石油', pageId: 1 }], note: '背景资料，不是证据。' }) };
  };
  const result = await proxyLookup('https://example.pages.dev', ' 石油 ', { fetchImpl: impl });
  assert.equal(result.results.length, 1);
  assert.equal(calls[0].url, 'https://example.pages.dev/api/ai/web-lookup');
  assert.equal(calls[0].body.query, '石油');
  assert.throws(() => proxyLookup('http://not-https.example.com', '石油', { fetchImpl: impl }), /HTTPS/);
  await assert.rejects(() => proxyLookup('https://example.pages.dev', '石油', { fetchImpl: async () => ({ ok: false, status: 500 }) }), /联网查询暂时不可用/);
});

test('接口无需配置模型即可联网，且限制查询长度', async () => {
  const store = createProfileStore(resolve('artifacts', 'test-lookup-' + randomUUID(), 'models.json'));
  let seen = '';
  const app = createServer(createAiHandler([], { store, lookup: async query => { seen = query; return { query, source: 'Wikipedia', language: 'zh', fetchedAt: new Date(0).toISOString(), results: [], note: '背景资料，不是证据。' }; } }));
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + app.address().port + '/api/ai/web-lookup';
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const ok = await post({ query: '石油产量' });
    assert.equal(ok.status, 200);
    assert.equal(seen, '石油产量');
    assert.match((await ok.json()).note, /不是证据/);
    assert.equal((await post({ query: 'x'.repeat(200) })).status, 400);
    assert.equal((await post({})).status, 400);
  } finally { await new Promise(r => app.close(r)); }
});
