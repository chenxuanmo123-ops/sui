// Unknown API paths must answer JSON, not the SPA's HTML shell. A 200 HTML
// response on an API route looks like success to naive health checks.
export function onRequest() {
  return new Response(JSON.stringify({ error: '接口不存在' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
