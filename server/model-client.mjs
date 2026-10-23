// OpenAI-compatible transport. Credentials and upstream bodies never enter diagnostics.
// Web-standard APIs only, so the same code runs on Node and in Cloudflare Workers.
export const MODEL_TIMEOUT_MS = 180000;
export function normalizeBaseURL(value) {
  return value.trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '');
}
export function modelOptions(provider, probe = false) {
  const official = new URL(provider.baseURL).hostname === 'api.deepseek.com';
  const modern = official && /^deepseek-(flash|v4)/i.test(provider.model);
  const reasoner = official && /reasoner/i.test(provider.model);
  return { max_tokens: probe ? (reasoner ? 4096 : 1024) : (reasoner ? 16384 : official ? 8192 : 6000), ...(modern ? { thinking: { type: 'disabled' } } : {}) };
}
const explanations = {
  400: '请求参数不兼容，请核对模型 ID 与 JSON 输出设置',
  401: 'API Key 无效或已失效，请在模型连接中更新密钥',
  402: '账户余额不足，请到模型服务商账户检查余额',
  403: '密钥没有此模型的访问权限',
  404: '接口地址或模型不存在，请核对 API 根地址并获取模型列表',
  422: '请求参数不受支持，请核对模型和 JSON 输出设置',
  429: '服务商限流，请稍后重试',
  500: '模型服务内部故障，请稍后重试',
  502: '模型服务网关故障，请稍后重试',
  503: '模型服务繁忙，请稍后重试',
};
function decodeChunks(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}
export async function requestModel(provider, { signal, action = 'chat', body, timeoutMs = MODEL_TIMEOUT_MS }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const forward = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', forward, { once: true });
  try {
    const response = await fetch(normalizeBaseURL(provider.baseURL) + (action === 'models' ? '/models' : '/chat/completions'), {
      method: action === 'models' ? 'GET' : 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: 'Bearer ' + provider.apiKey, 'Content-Type': 'application/json' },
      ...(action === 'models' ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('模型服务 HTTP ' + response.status + '：' + (explanations[response.status] || '请求失败，请检查服务商状态') + '。');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('模型服务返回空响应。');
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 1000000) { await reader.cancel(); throw new Error('模型响应过大，已拒绝。'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let result;
    try { result = JSON.parse(decodeChunks(chunks)); }
    catch { throw new Error('接口返回了非 JSON 内容，请核对 API 根地址；不要填写聊天网页地址。'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('模型服务返回了无效响应。');
    return result;
  } catch (error) {
    if (signal.aborted) throw new Error('请求已取消。');
    if (timedOut) throw new Error('模型等待超时，请重试或切换更快的模型。');
    const code = error.cause?.code;
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) throw new Error('无法解析模型服务域名，请检查 API 地址与 DNS。');
    if (['ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET'].includes(code)) throw new Error('无法连接模型服务，请检查网络、代理或本机服务是否启动。');
    if (error instanceof TypeError) throw new Error('无法连接模型服务，请检查网络、代理、证书与 API 地址。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}
export class ModelContentError extends Error {
  constructor(message) { super(message); this.recoverable = true; }
}
export function completionContent(body) {
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('模型输出被截断（推理也可能耗尽输出额度），请缩小问题或切换非推理模型。');
  if (choice?.finish_reason === 'content_filter') throw new Error('模型服务拦截了本次内容，请调整问题后重试。');
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    if (choice?.message?.reasoning_content) throw new ModelContentError('AI 仅返回了思考过程，没有给出分析内容。');
    throw new ModelContentError('AI 没有返回分析内容。');
  }
  return content;
}
