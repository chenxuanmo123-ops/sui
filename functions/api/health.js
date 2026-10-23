// Same-origin health check. Without this file Pages' SPA fallback answers
// /api/health with index.html and HTTP 200, which hides a missing backend.
export function onRequest({ request }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: '方法不允许' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', service: 'shujian-agent' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
