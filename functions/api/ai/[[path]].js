// Cloudflare Pages Functions adapter for the same AI service the Node server
// uses. Credentials come from the Pages environment, never from the browser,
// and are never written to storage or logs.
import { createAiService, providersFromEnv } from '../../../server/ai.mjs';

const EMPTY_STORE = {
  read: async () => ({ profiles: [], defaultId: '' }),
  update: async () => { throw new Error('公网部署不保存模型配置，请在 Cloudflare 环境变量中设置'); },
};

function allowedHosts(env) {
  return String(env?.LLM_ALLOWED_HOSTS || '').split(',').map(value => value.trim()).filter(Boolean);
}

async function readJsonBody(request, maxSize) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new Error('请求需要 JSON');
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxSize) throw new Error('分析上下文过大，请减少样本或字段');
  const text = await request.text();
  if (text.length > maxSize) throw new Error('分析上下文过大，请减少样本或字段');
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('请求需要有效的 JSON 对象'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求需要有效的 JSON 对象');
  return body;
}

function jsonResponse(result) {
  return new Response(JSON.stringify(result.payload), {
    status: result.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const maxSize = url.pathname === '/api/ai/extract-document' ? 6000000 : 400000;
  try {
    const service = createAiService(providersFromEnv(env || {}), { store: EMPTY_STORE, allowedHosts: allowedHosts(env) });
    const client = request.headers.get('cf-connecting-ip') || 'public';
    const result = await service({
      method: request.method,
      path: url.pathname,
      origin: request.headers.get('origin'),
      host: url.host,
      // Pages has no trusted loopback caller: key management stays local-only.
      isLocal: false,
      remoteAddress: client,
      signal: request.signal,
      readBody: () => readJsonBody(request, maxSize),
    });
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({
      status: 500,
      payload: { error: error instanceof Error ? error.message : '分析请求失败' },
    });
  }
}
