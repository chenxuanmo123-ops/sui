import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createProfileStore } from '../server/profile-store.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAiHandler, checkPlan, providersFromEnv, userProvider, sanitizeDataset, sanitizeReferences, checkRepair } from '../server/ai.mjs';
import { planSchema, validate } from '../server/contracts.mjs';
const isolatedHandler = (providers, options = {}) => createAiHandler(providers, { store: createProfileStore(resolve('artifacts', 'test-config-' + randomUUID(), 'models.json')), ...options });
const dataset = { hash: 'a'.repeat(64), columns: [{field:'year'}, {field:'value'}, {field:'country'}] };
const mapping = {x:'year', metric:'value', filter:'country',value:'China',from:'2015',to:'2022',unit:'TWh',aggregate:'sum',timeBucket:'year',conditions:[]};
const plan = {goal:'比较所选地区的年度发电量',scene:'年度能源统计',grain:'每行是一个地区一年',fieldRoles:[{field:'year',meaning:'统计年',role:'time'}],assumptions:[],questions:[],tasks:[{id:'annual',title:'年度比较',rationale:'回答年度变化问题',chart:'line',mapping}],limitations:['仅描述统计，不判断原因']};
const clone = v => structuredClone(v);
async function listen(server) { await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); return 'http://127.0.0.1:'+server.address().port; }
async function close(server) { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
test('计划约束：字段真实、任务唯一、拒绝额外属性', () => {
  assert.equal(checkPlan(clone(plan),dataset).tasks.length,1);
  const unknown=clone(plan); unknown.tasks[0].mapping.metric='imaginary'; assert.throws(()=>checkPlan(unknown,dataset),/字段/);
  const duplicate=clone(plan); duplicate.tasks.push(clone(duplicate.tasks[0])); assert.throws(()=>checkPlan(duplicate,dataset),/重复/);
  const extra=clone(plan); extra.sql='DELETE'; assert.throws(()=>validate(extra,planSchema),/未知字段/);
  const countSameField=clone(plan); countSameField.tasks[0].mapping.aggregate='count'; countSameField.tasks[0].mapping.metric='year'; assert.equal(checkPlan(countSameField,dataset).tasks.length,1);
  assert.throws(()=>validate(JSON.parse('{"__proto__":{},"goal":"x"}'),planSchema));
  const hypothesis = clone(plan); hypothesis.hypotheses = [{ id: 'h1', statement: '候选解释，不是结论', testTaskIds: ['annual'] }];
  assert.equal(checkPlan(hypothesis,dataset).hypotheses[0].testTaskIds[0], 'annual');
  hypothesis.hypotheses[0].testTaskIds = ['missing']; assert.throws(() => checkPlan(hypothesis,dataset), /验证任务/);
  const duplicateHypothesis = clone(plan); duplicateHypothesis.hypotheses = [{ id: 'h1', statement: '第一种解释', testTaskIds: ['annual'] }, { id: 'h1', statement: '第二种解释', testTaskIds: ['annual'] }]; assert.throws(() => checkPlan(duplicateHypothesis,dataset), /候选假设/);
  const duplicateBinding = clone(plan); duplicateBinding.hypotheses = [{ id: 'h1', statement: '重复绑定不应产生两个结果', testTaskIds: ['annual', 'annual'] }]; assert.throws(() => checkPlan(duplicateBinding,dataset), /候选假设/);
  const blankHypothesis = clone(plan); blankHypothesis.hypotheses = [{ id: 'annual', statement: ' ', testTaskIds: ['annual'] }]; assert.throws(() => checkPlan(blankHypothesis,dataset), /候选假设/);
});
test('澄清问题与安全任务可以并存，只有没有任务时等待补充', () => {
  const partial=clone(plan); partial.questions=['请确认是否仅分析上传子集'];
  const checked=checkPlan(partial,dataset);
  assert.deepEqual(checked.questions,partial.questions);
  assert.deepEqual(checked.tasks,plan.tasks);
  const clarifyOnly=clone(partial); clarifyOnly.tasks=[];
  assert.equal(checkPlan(clarifyOnly,dataset).tasks.length,0);
  const empty=clone(clarifyOnly); empty.questions=[];
  assert.throws(()=>checkPlan(empty,dataset),/问题或任务/);
});
test('未配置时明确报告，配置凭据不出现在状态接口', async () => {
  assert.deepEqual(providersFromEnv({}),[]);
  const providers=providersFromEnv({LLM_BASE_URL:'http://127.0.0.1/v1',LLM_API_KEY:'TEST_ONLY_SECRET',LLM_MODEL:'test-contract'});
  const server=createServer(isolatedHandler(providers)); const url=await listen(server);
  try { const status=await (await fetch(url+'/api/ai/status')).text(); assert.ok(!status.includes('TEST_ONLY_SECRET')); assert.ok(!status.includes('baseURL')); assert.equal(JSON.parse(status).configured,true); }
  finally { await close(server); }
  const empty=createServer(isolatedHandler([])); const emptyURL=await listen(empty);
  try { const response=await fetch(emptyURL+'/api/ai/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); assert.equal(response.status,503); }
  finally { await close(empty); }
});
test('兼容接口契约与证据拒绝规则（本地测试替身，不是实际模型评测）', async () => {
  let answer=clone(plan), upstreamCode=200, requestBody, authorization;
  const upstream=createServer(async (req,res)=>{
    assert.equal(req.url,'/v1/chat/completions'); authorization=req.headers.authorization;
    let body=''; for await(const chunk of req) body+=chunk;
    requestBody=JSON.parse(body); res.writeHead(upstreamCode,{'Content-Type':'application/json'});
    res.end(upstreamCode===200 ? JSON.stringify({choices:[{message:{content:typeof answer==='string'?answer:JSON.stringify(answer)},finish_reason:'stop'}]}) : '{"error":"TEST_ONLY_SECRET"}');
  });
  const upstreamURL=await listen(upstream);
  const server=createServer(isolatedHandler([{id:'test',name:'接口测试',model:'test-contract',apiKey:'TEST_ONLY_SECRET',baseURL:upstreamURL+'/v1',jsonMode:true}]));
  const url=await listen(server);
  const post=(path,body,headers={})=>fetch(url+'/api/ai/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({providerId:'test',...body})});
  const input={question:'比较年度情况',context:'按地区年度统计，单位为 TWh，无重复记录',dataset};
  try {
    let response=await post('plan',input); assert.equal(response.status,200); assert.equal((await response.json()).datasetHash,dataset.hash);
    assert.equal(authorization,'Bearer TEST_ONLY_SECRET'); assert.equal(requestBody.model,'test-contract'); assert.equal(requestBody.stream,false); assert.equal(requestBody.response_format.type,'json_object');
    assert.match(requestBody.messages[0].content,/行粒度/);
    response=await post('plan',{...input,context:''}); assert.equal(response.status,200); assert.match(JSON.parse(requestBody.messages[1].content).context,/未补充/);
    const withoutContext={...input}; delete withoutContext.context; response=await post('plan',withoutContext); assert.equal(response.status,200);
    answer='not JSON'; response=await post('plan',input); assert.equal(response.status,400);
    answer=clone(plan); answer.tasks[0].mapping.metric='invented'; response=await post('plan',input); assert.equal(response.status,400);
    upstreamCode=401; response=await post('plan',input); assert.equal(response.status,400); assert.ok(!(await response.text()).includes('TEST_ONLY_SECRET')); upstreamCode=200;
    response=await post('plan',input,{Origin:'https://other.example'}); assert.equal(response.status,403);
    const reviewInput={question:'比较结果',context:'已确认口径',plan,facts:[{id:'annual:fact0',text:'程序计算的证据'}]};
    const review={answerability:'descriptive_only',findings:[{statement:'不同年度的发电量存在差异，具体数值见证据。',evidenceIds:['annual:fact0'],interpretation:'observation'}],limitations:['汇总结果不能解释因果。'],nextQuestions:[]};
    answer=clone(review); response=await post('review',reviewInput); assert.equal(response.status,200);
    answer=clone(review); answer.findings[0].evidenceIds=['missing']; response=await post('review',reviewInput); assert.equal(response.status,400);
    answer=clone(review); answer.findings[0].statement='上升了 25%'; response=await post('review',reviewInput); assert.equal(response.status,400);
    answer=clone(review); answer.findings[0].statement='政策导致增长'; response=await post('review',reviewInput); assert.equal(response.status,400);
    const withInsight=items=>({...clone(review),insight:{possibleMeanings:[{statement:'不同年度之间的差异可能来自规模或统计口径，仍需核对。',evidenceIds:['annual:fact0']}],possibleUses:[{statement:'可以按地区拆分后核查差异集中的分组。',evidenceIds:['annual:fact0']}]},...items});
    answer=withInsight(); response=await post('review',reviewInput); assert.equal(response.status,200);
    answer=withInsight(); answer.insight.possibleMeanings[0].evidenceIds=['missing']; response=await post('review',reviewInput); assert.equal(response.status,400); assert.match((await response.json()).error,/证据/);
    answer=withInsight(); answer.insight.possibleMeanings[0].statement='差异约为 25%'; response=await post('review',reviewInput); assert.equal(response.status,400);
    answer=withInsight(); answer.insight.possibleUses[0].statement='政策导致增长'; response=await post('review',reviewInput); assert.equal(response.status,400);
    answer=withInsight(); answer.insight.possibleMeanings[0].referenceIds=['R-A']; response=await post('review',reviewInput); assert.equal(response.status,400); assert.match((await response.json()).error,/参考资料/);
    answer={...clone(review),insight:{possibleMeanings:[],possibleUses:[]}}; response=await post('review',reviewInput); assert.equal(response.status,200);
    answer=withInsight(); answer.insight.possibleMeanings[0].statement='不同年度之间的差异可能来自规模或统计口径，仍需核对。'; delete answer.insight.possibleMeanings[0].evidenceIds; response=await post('review',reviewInput); assert.equal(response.status,400);
  } finally { await close(server); await close(upstream); }
});


test('网页连接配置：真实本地 HTTP 转发、模型发现、切换与密钥不回显（测试替身）', async () => {
  const calls = [];
  const upstream = createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    calls.push({ path: req.url, auth: req.headers.authorization, body: text ? JSON.parse(text) : null });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-one' }, { id: 'test-two' }, { id: 'test-one' }] }));
    const body = JSON.parse(text);
    res.end(JSON.stringify({ choices: [{ message: { content: body.messages[0].content === 'Reply with OK only.' ? 'OK' : JSON.stringify(plan) }, finish_reason: 'stop' }] }));
  });
  const upstreamURL = await listen(upstream);
  const server = createServer(isolatedHandler([])); const url = await listen(server);
  const provider = { id: 'user_test', name: '网页接口', baseURL: upstreamURL + '/v1/chat/completions', apiKey: 'SESSION_TEST_SECRET', model: 'test-one', jsonMode: true };
  const post = (path, body = {}) => fetch(url + '/api/ai/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ provider, ...body }) });
  try {
    let response = await post('models'); assert.equal(response.status, 200); assert.deepEqual((await response.json()).models, ['test-one', 'test-two']);
    response = await post('test'); const probe = await response.json(); assert.equal(probe.ok, true); assert.equal(probe.model, 'test-one'); assert.ok(probe.latencyMs >= 0); assert.ok(!JSON.stringify(probe).includes(provider.apiKey));
    response = await post('plan', { question: '比较年度差异', context: '每行一个地区一年，TWh', dataset }); assert.equal(response.status, 200); assert.equal((await response.json()).model, 'test-one');
    provider.model = 'test-two'; provider.apiKey = 'SECOND_TEST_SECRET';
    response = await post('test'); assert.equal(response.status, 200); assert.equal(calls.at(-1).body.model, 'test-two'); assert.equal(calls.at(-1).auth, 'Bearer SECOND_TEST_SECRET');
    assert.equal(calls[0].path, '/v1/models'); assert.equal(calls[1].path, '/v1/chat/completions');
    const status = await (await fetch(url + '/api/ai/status')).json(); assert.deepEqual(status.providers, []); assert.equal(status.configured, false);
    provider.baseURL = 'https://user:pass@invalid.example/v1'; response = await post('test'); assert.equal(response.status, 400); assert.ok(!(await response.text()).includes('pass@'));
    response = await post('test', { provider: { ...provider, baseURL: upstreamURL + '/v1', apiKey: 'SECRET\r\nInjection' } }); assert.equal(response.status, 400);
    assert.throws(() => userProvider({ ...provider, baseURL: 'http://127.0.0.1/v1' }), /HTTPS/);
    assert.throws(() => userProvider({ ...provider, baseURL: 'https://unknown.example/v1' }, { local: false }), /域名/);
    assert.equal(userProvider({ ...provider, baseURL: 'https://allowed.example/v1' }, { allowedHosts: ['allowed.example'] }).baseURL, 'https://allowed.example/v1');
  } finally { await close(server); await close(upstream); }
});

test('类别与样本分别授权，未知属性和未授权原值不传模型', () => {
  const input = { ...dataset, secretExtra: 'DO_NOT_FORWARD', columns: [{ field: 'year', typeCandidate: '文本', examples: ['2023'], categoryValues: ['2022', '2023'], categoryValuesComplete: true, rawRows: ['DO_NOT_FORWARD'] }] };
  const clean = sanitizeDataset(input);
  assert.equal(clean.columns[0].examples, undefined);
  assert.equal(clean.columns[0].categoryValues, undefined);
  assert.ok(!JSON.stringify(clean).includes('DO_NOT_FORWARD'));
  const dictionary = sanitizeDataset(input, { includeCategories: true });
  assert.deepEqual(dictionary.columns[0].categoryValues, ['2022', '2023']);
  assert.equal(dictionary.columns[0].categoryValuesComplete, true);
  assert.equal(dictionary.columns[0].examples, undefined);
  assert.equal(sanitizeDataset(input, { includeSamples: true }).columns[0].categoryValues, undefined);
  const invalid = clone(input); invalid.columns[0].categoryValues.push('2022');
  assert.throws(() => sanitizeDataset(invalid, { includeCategories: true }), /类别字典/);
  const incomplete = clone(input); incomplete.columns[0].categoryValuesComplete = false;
  assert.throws(() => sanitizeDataset(incomplete, { includeCategories: true }), /类别字典/);
  const oversized = clone(input); oversized.columns[0].categoryValues = Array.from({ length: 17 }, (_, i) => String(i));
  assert.throws(() => sanitizeDataset(oversized, { includeCategories: true }), /类别字典/);
  const repeated = clone(input); repeated.columns.push(repeated.columns[0]);
  assert.throws(() => sanitizeDataset(repeated), /重复/);
});
test('失败修正仅允许原失败 ID，拒绝增加、遗漏与替换成功任务', () => {
  const failure = [{ taskId: 'annual', error: '没有有效数值' }];
  assert.equal(checkRepair(clone(plan), plan, failure, dataset).tasks.length, 1);
  assert.throws(() => checkRepair(plan, plan, [{ taskId: 'unknown', error: 'x' }], dataset), /原计划/);
  assert.throws(() => checkRepair(plan, plan, [...failure, ...failure], dataset), /原计划/);
  const noTasks = clone(plan); noTasks.tasks = []; noTasks.questions = ['请确认口径'];
  assert.throws(() => checkRepair(noTasks, plan, failure, dataset), /无法安全修正/);
  const changed = clone(plan); changed.tasks[0].id = 'invented';
  assert.throws(() => checkRepair(changed, plan, failure, dataset), /逐一对应/);
});
test('修正接口真实 HTTP 转发真实错误、拒绝快照/次数/错误 ID；模型为明确测试替身', async () => {
  let captured, calls = 0, answer = clone(plan);
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    captured = JSON.parse(raw); calls++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }));
  });
  const upstreamURL = await listen(upstream);
  const server = createServer(isolatedHandler([{ id: 'test', name: '测试替身', baseURL: upstreamURL + '/v1', apiKey: 'TEST_ONLY_SECRET', model: 'repair-contract', jsonMode: true }]));
  const url = await listen(server);
  const base = { providerId: 'test', question: '年度比较', dataset: { ...dataset, columns: [...dataset.columns.slice(0, 2), { field: 'country', typeCandidate: '文本', categoryValues: ['China'], categoryValuesComplete: true, examples: ['DO_NOT_FORWARD'], rawRows: ['DO_NOT_FORWARD'] }] }, includeCategories: true, previous: { plan, datasetHash: dataset.hash }, failures: [{ taskId: 'annual', title: '年度比较', error: '没有精确匹配记录' }], attempt: 1 };
  const post = body => fetch(url + '/api/ai/repair-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(body) });
  try {
    let response = await post(base); assert.equal(response.status, 200);
    let sent = JSON.parse(captured.messages[1].content);
    assert.equal(sent.executionFeedback.failures[0].error, '没有精确匹配记录');
    assert.deepEqual(sent.dataset.columns[2].categoryValues, ['China']);
    assert.ok(!JSON.stringify(sent).includes('DO_NOT_FORWARD'));
    assert.match(captured.messages[0].content, /仅为回答原问题修正失败任务/);
    const before = calls;
    response = await post({ ...base, attempt: 3 }); assert.equal(response.status, 400);
    response = await post({ ...base, previous: { plan, datasetHash: 'b'.repeat(64) } }); assert.equal(response.status, 400);
    response = await post({ ...base, failures: [{ taskId: 'unknown', error: 'x' }] }); assert.equal(response.status, 400);
    assert.equal(calls, before);
    answer = clone(plan); answer.tasks[0].id = 'invented';
    response = await post(base); assert.equal(response.status, 400);
    answer = clone(plan);
    response = await post({ ...base, includeCategories: false }); assert.equal(response.status, 200);
    sent = JSON.parse(captured.messages[1].content);
    assert.equal(sent.dataset.columns[2].categoryValues, undefined);
  } finally { await close(server); await close(upstream); }
});

test('输出格式异常自动重新生成一次，字段校验失败与HTTP故障不盲重试；明确模型替身', async () => {
  let responses = [], calls = [], upstreamCode = 200;
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    res.writeHead(upstreamCode, { 'Content-Type': 'application/json' });
    const answer = responses.shift() ?? { content: '不是可执行分析 TEST_ONLY_SECRET' };
    res.end(JSON.stringify({ choices: [{ message: answer, finish_reason: answer.finish || 'stop' }] }));
  });
  const upstreamURL = await listen(upstream);
  const server = createServer(isolatedHandler([{ id: 'test', name: '格式兼容测试替身', model: 'format-contract', apiKey: 'TEST_ONLY_SECRET', baseURL: upstreamURL + '/v1', jsonMode: false }]));
  const url = await listen(server);
  const post = () => fetch(url + '/api/ai/plan', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ providerId: 'test', question: '年度比较', dataset }) });
  try {
    for (const first of [{ content: '说明文字，尚未提供计划' }, { content: '{"goal":"遗漏字段"}' }, { content: '' }, { content: null, reasoning_content: '只有推理' }]) {
      calls = []; responses = [first, { content: '以下是分析步骤：\n' + JSON.stringify(plan) + '\n请确认。' }];
      const response = await post(); assert.equal(response.status, 200); assert.deepEqual((await response.json()).plan, plan);
      assert.equal(calls.length, 2); assert.equal(calls[0].messages[1].content, calls[1].messages[1].content);
      assert.match(calls[1].messages[0].content, /上一次响应/); assert.ok(!JSON.stringify(calls[1]).includes('只有推理'));
    }
    calls = []; responses = []; let response = await post(); assert.equal(response.status, 400);
    const message = (await response.json()).error; assert.equal(calls.length, 2); assert.match(message, /自动重试一次/); assert.ok(!message.includes('TEST_ONLY_SECRET')); assert.ok(!message.includes('JSON'));
    calls = []; const bad = clone(plan); bad.tasks[0].mapping.metric = 'imaginary'; responses = [{ content: JSON.stringify(bad) }];
    response = await post(); assert.equal(response.status, 400); assert.equal(calls.length, 1);
    calls = []; responses = [{ content: '{"goal":', finish: 'length' }];
    response = await post(); assert.equal(response.status, 400); assert.equal(calls.length, 1); assert.match((await response.json()).error, /截断/);
    calls = []; upstreamCode = 401;
    response = await post(); assert.equal(response.status, 400); assert.equal(calls.length, 1); assert.match((await response.json()).error, /401/);
  } finally { await close(server); await close(upstream); }
});

test('比例计划需显式分母，拒绝结果预筛选、错误单位和未知原值',()=>{
 const ds={hash:'a'.repeat(64),columns:[{field:'VisitorType'},{field:'Revenue',categoryValuesComplete:true,categoryValues:['TRUE','FALSE']}]};
 const p=clone(plan);p.fieldRoles=[];p.tasks=[{id:'rate',title:'转化率',rationale:'按访问记录比较',chart:'bar',mapping:{...mapping,x:'VisitorType',metric:'Revenue',aggregate:'count',filter:'',value:'',from:'',to:'',unit:'%',timeBucket:'none',rate:{successValue:'TRUE',eligibleValues:['TRUE','FALSE']}}}];
 assert.equal(checkPlan(p,ds).tasks.length,1);
 for(const change of [{unit:'条'},{filter:'Revenue',value:'TRUE'},{conditions:[{field:'Revenue',operator:'eq',value:'TRUE'}]},{rate:{successValue:'TRUE',eligibleValues:['FALSE']}},{rate:{successValue:'TRUE',eligibleValues:['TRUE','FALSE','unknown']}}]){const invalid=clone(p);Object.assign(invalid.tasks[0].mapping,change);assert.throws(()=>checkPlan(invalid,ds),/比例|分母/)}
});

test('参考片段有界、字段明确、标识唯一且不能伪装成证据', () => {
  const refs = [
    { id: 'R-A', title: '业务口径.txt', source: 'file', page: 2, text: '退款率分母为已支付订单。' },
    { id: 'M-A', title: '缺失值不是零', source: 'method', text: '空值不能当作零处理。' },
  ];
  assert.deepEqual(sanitizeReferences(refs), refs);
  assert.deepEqual(sanitizeReferences(undefined), []);
  assert.throws(() => sanitizeReferences([{ ...refs[0], id: 'M-A' }]), /标识与类型/);
  assert.throws(() => sanitizeReferences([refs[0], { ...refs[0] }]), /重复/);
  assert.throws(() => sanitizeReferences([{ ...refs[0], id: 'R-Z' }]), /标识/);
  assert.throws(() => sanitizeReferences([{ ...refs[0], page: 0 }]), /页码/);
  assert.throws(() => sanitizeReferences([{ ...refs[0], page: 2, source: 'method' }]), /标识与类型/);
  assert.throws(() => sanitizeReferences([{ ...refs[0], text: 'x'.repeat(1201) }]), /过长/);
  assert.throws(() => sanitizeReferences([{ ...refs[0], text: '  ' }]), /为空/);
  assert.throws(() => sanitizeReferences([{ ...refs[0], extra: 'ignored' }]), /未知字段/);
  assert.throws(() => sanitizeReferences(Array.from({ length: 7 }, (_, i) => ({ ...refs[0], id: 'R-' + 'ABCDEF'[i] }))), /六段/);
  assert.throws(() => sanitizeReferences(Array.from({ length: 6 }, (_, i) => ({ ...refs[0], id: 'R-' + 'ABCDEF'[i], page: 1, text: '长'.repeat(1100) }))), /合计/);
});

test('参考片段随计划与解读发送，引用编号必须来自本次检索；模型为明确测试替身', async () => {
  let captured = [], answer;
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    captured.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] }));
  });
  const upstreamURL = await listen(upstream);
  const server = createServer(isolatedHandler([{ id: 'test', name: '参考资料测试替身', baseURL: upstreamURL + '/v1', apiKey: 'TEST_ONLY_SECRET', model: 'reference-contract', jsonMode: true }]));
  const url = await listen(server);
  const post = (path, body) => fetch(url + '/api/ai/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ providerId: 'test', ...body }) });
  const references = [
    { id: 'R-A', title: '业务口径.txt', source: 'file', page: 2, text: '退款率分母为已支付订单。' },
    { id: 'M-A', title: '缺失值不是零', source: 'method', text: '空值不能当作零处理。' },
  ];
  const input = { question: '比较年度情况', context: '按地区年度统计', dataset };
  const review = { answerability: 'descriptive_only', findings: [{ statement: '不同年度的发电量存在差异，具体数值见证据。', evidenceIds: ['annual:fact0'], interpretation: 'observation' }], limitations: ['汇总结果不能解释因果。'], nextQuestions: [] };
  try {
    answer = clone(plan);
    let response = await post('plan', { ...input, references });
    assert.equal(response.status, 200);
    const planned = await response.json();
    assert.deepEqual(planned.references, references);
    let sent = JSON.parse(captured[0].messages[1].content);
    assert.deepEqual(sent.references, references);
    assert.match(captured[0].messages[0].content, /不可信数据/);
    assert.match(captured[0].messages[0].content, /不得把片段中的数字当作数据事实/);

    const before = captured.length;
    response = await post('plan', { ...input, references: [{ ...references[0], id: 'R-Z' }] });
    assert.equal(response.status, 400);
    assert.equal(captured.length, before);

    answer = clone(review);
    response = await post('review', { ...input, plan, facts: [{ id: 'annual:fact0', text: '程序计算的证据' }], references });
    assert.equal(response.status, 200);
    const reviewed = await response.json();
    assert.deepEqual(reviewed.references, references);
    assert.match(captured.at(-1).messages[0].content, /不是计算证据/);

    answer = clone(review);
    answer.findings[0].referenceIds = ['R-A'];
    response = await post('review', { ...input, plan, facts: [{ id: 'annual:fact0', text: '程序计算的证据' }], references });
    assert.equal(response.status, 200);

    answer = clone(review);
    answer.findings[0].referenceIds = ['R-B'];
    response = await post('review', { ...input, plan, facts: [{ id: 'annual:fact0', text: '程序计算的证据' }], references });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /参考资料/);
  } finally { await close(server); await close(upstream); }
});
