// Public web background lookup. This answers "what does this term / standard
// mean", never "what is in the user's file": it contacts Wikipedia only, on an
// explicit user action, returns short attributed excerpts with their source
// links, and is never fed into the planning or evidence pipeline. No user data
// and no credential ever leaves the server through this path.

const WIKI = [
  { language: 'zh', host: 'zh.wikipedia.org' },
  { language: 'en', host: 'en.wikipedia.org' },
];
const MAX_QUERY = 120;
const MAX_RESULTS = 3;
const MAX_EXTRACT = 700;
const USER_AGENT = 'ShujianDataAnalysis/1.0 (competition demo; public Wikipedia lookup)';

export function sanitizeLookupQuery(raw) {
  if (typeof raw !== 'string') throw new Error('查询内容无效');
  const query = raw.replace(/\s+/g, ' ').trim();
  if (query.length < 2 || query.length > MAX_QUERY) throw new Error('联网查询词需要 2—' + MAX_QUERY + ' 个字符');
  return query;
}

function plain(value, max) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

async function getJson(url, deadline, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    signal: deadline,
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('返回格式不是 JSON');
  const text = await response.text();
  if (text.length > 400000) throw new Error('返回内容过大');
  return JSON.parse(text);
}

async function searchArticles(site, query, deadline, fetchImpl) {
  const url = 'https://' + site.host + '/w/api.php?action=query&format=json&utf8=1' +
    '&list=search&srnamespace=0&srlimit=' + MAX_RESULTS +
    '&srprop=snippet&srsearch=' + encodeURIComponent(query);
  const data = await getJson(url, deadline, fetchImpl);
  const hits = data?.query?.search;
  if (!Array.isArray(hits)) return [];
  return hits
    .filter(hit => hit && Number.isInteger(hit.pageid) && typeof hit.title === 'string' && hit.title.trim())
    .slice(0, MAX_RESULTS)
    .map(hit => ({ pageId: hit.pageid, title: plain(hit.title, 120), snippet: plain(hit.snippet, 200) }));
}

async function summarise(site, hits, deadline, fetchImpl) {
  if (!hits.length) return [];
  const url = 'https://' + site.host + '/w/api.php?action=query&format=json&utf8=1&redirects=1' +
    '&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=' + MAX_EXTRACT +
    '&pageids=' + hits.map(hit => hit.pageId).join('%7C');
  const data = await getJson(url, deadline, fetchImpl);
  const pages = data?.query?.pages ?? {};
  return hits.map(hit => {
    const page = pages[String(hit.pageId)] ?? {};
    const extract = plain(page.extract, MAX_EXTRACT) || hit.snippet;
    return {
      title: plain(page.title, 120) || hit.title,
      extract,
      url: typeof page.fullurl === 'string' && page.fullurl.startsWith('https://' + site.host + '/') ? page.fullurl : 'https://' + site.host + '/?curid=' + hit.pageId,
      pageId: hit.pageId,
    };
  }).filter(item => item.extract);
}

// Optional deployment relay. Some networks cannot reach Wikipedia at all; when
// the deployer sets WEB_LOOKUP_PROXY to their own public deployment, the local
// server forwards the same bounded query there instead of failing. It is only
// ever the deployer's own configured origin, never a user-supplied URL.
export function proxyLookup(base, rawQuery, { signal, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const query = sanitizeLookupQuery(rawQuery);
  const url = new URL('/api/ai/web-lookup', String(base).endsWith('/') ? base : base + '/');
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('联网查询中转地址必须是 HTTPS');
  return (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.any ? AbortSignal.any([signal, controller.signal].filter(Boolean)) : controller.signal,
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!data || !Array.isArray(data.results)) throw new Error('中转服务返回格式不符');
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('联网查询超时，未取得任何结果；本次没有使用网页内容。');
      throw new Error('联网查询暂时不可用（' + (error instanceof Error ? error.message : '网络错误') + '）。本次没有使用任何网页内容，不影响本地计算。');
    } finally { clearTimeout(timer); }
  })();
}

// One query, at most two upstream requests, one of them only when the Chinese
// edition has no article for the term. Any upstream failure is reported as a
// failed lookup instead of an empty result, so the UI never implies "nothing
// exists" when the network simply did not answer.
export async function webLookup(rawQuery, { signal, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const query = sanitizeLookupQuery(rawQuery);
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持联网查询');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    for (const site of WIKI) {
      let hits;
      try {
        hits = await searchArticles(site, query, controller.signal, fetchImpl);
      } catch (error) {
        if (controller.signal.aborted) throw new Error('联网查询超时或已取消，未取得任何结果；本次没有使用网页内容。当前网络可能无法访问维基百科，本地计算与内置知识库不受影响。');
        if (site === WIKI[WIKI.length - 1]) throw new Error('联网查询暂时不可用（' + (error instanceof Error ? error.message : '网络错误') + '）。当前网络可能无法访问维基百科；本次没有使用任何网页内容，本地计算与内置知识库不受影响。');
        continue;
      }
      if (!hits.length) continue;
      let results;
      try { results = await summarise(site, hits, controller.signal, fetchImpl); }
      catch { results = hits.map(hit => ({ title: hit.title, extract: hit.snippet, url: 'https://' + site.host + '/?curid=' + hit.pageId, pageId: hit.pageId })); }
      if (!results.length) continue;
      return {
        query,
        source: 'Wikipedia',
        language: site.language,
        fetchedAt: new Date().toISOString(),
        results,
        note: '公开网页背景资料，由你主动发起，只用于理解术语与常见口径；它不是本次计算的证据，不代表你的数据，也可能过时或不适用于你的统计范围。',
      };
    }
    return {
      query,
      source: 'Wikipedia',
      language: 'zh',
      fetchedAt: new Date().toISOString(),
      results: [],
      note: '中文与英文维基百科都没有找到匹配条目。可以换一个更具体的术语，或直接提问，由 AI 依据你的数据结构提出可执行计划。',
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abort);
  }
}
