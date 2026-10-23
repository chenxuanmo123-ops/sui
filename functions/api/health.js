// Same-origin health check. Without this file Pages' SPA fallback answers
// /api/health with index.html and HTTP 200, which hides a missing backend.
// aiConfigured only reports whether the model variables exist; it never
// echoes their values.
function aiConfigured(env) {
  if (!env) return false;
  if (env.LLM_PROVIDERS_JSON) return true;
  return Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
}

export function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: '方法不允许' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }
  const body = JSON.stringify({ status: 'ok', service: 'shujian-agent', aiConfigured: aiConfigured(env) });
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
