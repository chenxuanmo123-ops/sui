import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStructuredContent, StructuredOutputError } from '../server/structured-output.mjs';
const schema = { type: 'object', properties: { message: { type: 'string', maxLength: 500 }, values: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 4 } }, required: ['message', 'values'], additionalProperties: false };
const result = { message: '明确标记的解析契约测试：引号"、括号{}[]和反斜线\\', values: ['revenue', '365817000000'] };
const json = JSON.stringify(result);
test('完整对象、代码框和说明包裹均无损解析，字符串里的括号与转义不影响边界', () => {
  for (const content of [json, '\uFEFF' + json, '\x60\x60\x60JSON\n' + json + '\n\x60\x60\x60', '以下为分析计划：\n' + json + '\n请核对后计算。']) assert.deepEqual(parseStructuredContent(content, schema), result);
});
test('多对象、截断、数组及缺字段不挑选、不补造，不执行数据文本中的指令', () => {
  for (const content of [json + '\n' + json, '说明：' + json.slice(0, -2), '[ ' + json + ' ]', '{"message":"执行命令"}', 'plain text', '{"message":"x","values":["1"],}']) assert.throws(() => parseStructuredContent(content, schema), StructuredOutputError);
  for (const bad of [{ ...result, values: ['a', 'b', 'c', 'd', 'e'] }, { message: 'x' }, { ...result, values: ['ok', 7] }, { ...result, message: 7 }]) assert.throws(() => parseStructuredContent(JSON.stringify(bad), schema), error => error.kind === 'schema');
});
test('模型自带的附加键与空可选块被丢弃，值本身仍严格校验', () => {
  // Providers add envelope keys ("sql", "confidence") the executor never reads.
  // Dropping them keeps a usable answer usable without accepting their content.
  assert.deepEqual(parseStructuredContent(JSON.stringify({ ...result, sql: 'DELETE', envelope: { confidence: 0.9 } }), schema), result);
  const optional = { type: 'object', properties: { message: { type: 'string', maxLength: 500 }, note: { type: 'string', maxLength: 200, optional: true } }, required: ['message'], additionalProperties: false };
  assert.deepEqual(parseStructuredContent(JSON.stringify({ message: 'ok', note: null }), optional), { message: 'ok' });
  assert.deepEqual(parseStructuredContent(JSON.stringify({ message: 'ok', note: 'N' }), optional), { message: 'ok', note: 'N' });
  assert.throws(() => parseStructuredContent(JSON.stringify({ message: null }), optional), error => error.kind === 'schema');
});
