import { test, expect } from 'vitest';
import { evaluateCapturedPlan, loadEvaluationCase } from './evaluation-runtime';

const role = (field, role = 'unknown') => ({ field, meaning: '来自用户数据的待核对字段', role });
const task = (id, title, mapping, chart = 'line') => ({ id, title, rationale: '先完成可验证的描述性计算', chart, mapping });
const mapping = (x, metric, aggregate, unit = '', timeBucket = 'none', filter = '', value = '') => ({ x, metric, aggregate, unit, timeBucket, filter, value, from: '', to: '', conditions: [] });
const base = (fieldRoles, tasks, questions = []) => ({
  goal: '按固定口径回答真实数据问题', scene: '描述性统计', grain: '每行是一条来源记录', fieldRoles,
  assumptions: [], questions, tasks, limitations: ['结果仅描述固定来源快照，不证明因果或总体。'],
});

test('捕获计划评测器回归（手写计划）：SEC 任务真实执行并比对收入与期末现金来源行', async () => {
  const payload = {
    datasetHash: 'placeholder',
    plan: base(
      [role('period_label', 'time'), role('value', 'metric'), role('metric', 'dimension'), role('fact_type', 'dimension')],
      [
        task('revenue', '按披露期比较收入', mapping('period_label', 'value', 'sum', 'USD', 'none', 'metric', 'revenue')),
        task('cash', '按披露期查看期末现金', mapping('period_label', 'value', 'sum', 'USD', 'none', 'metric', 'cash_and_cash_equivalents')),
      ],
      ['请确认 filing_fy 是申报元数据，不能替代 period_label。'],
    ),
  };
  const fixture = await import('./evaluation-runtime');
  const loaded = fixture.loadEvaluationCase('sec-apple-annual-financial-facts');
  payload.datasetHash = loaded.dataset.fingerprint;
  const report = await evaluateCapturedPlan(payload, 'sec-apple-annual-financial-facts');
  expect(report.binding.status).toBe('matched');
  expect(report.execution.passed).toBe(true);
  expect(report.calculation.passed).toBe(true);
  expect(report.safetyFlags).toEqual([]);
  expect(report.verdict).toBe('needs-human-review');
});

test('捕获计划评测器回归（手写计划）：平台统计按事件记录核对全部非空日期', async () => {
  const fixture = await import('./evaluation-runtime');
  const loaded = fixture.loadEvaluationCase('stackoverflow-question-events');
  const payload = {
    datasetHash: loaded.dataset.fingerprint,
    plan: base(
      [role('event_date', 'time'), role('question_id', 'id')],
      [task('daily', '按日统计问题创建事件', mapping('event_date', 'question_id', 'count'))],
      ['没有记录的日期不能直接当作真实零值；这是标签过滤的公开问题事件，不是用户数。'],
    ),
  };
  const report = await fixture.evaluateCapturedPlan(payload, 'stackoverflow-question-events');
  expect(report.execution.passed).toBe(true);
  expect(report.calculation.targets[0].passed).toBe(true);
  expect(report.verdict).toBe('needs-human-review');
});

test('捕获计划评测器回归（手写计划）：数据范围或字段错误不会进入结果通过', async () => {
  const fixture = await import('./evaluation-runtime');
  const loaded = fixture.loadEvaluationCase('owid-china-energy-time-series');
  const payload = {
    datasetHash: 'b'.repeat(64),
    plan: base([role('year', 'time'), role('invented', 'metric')], [task('bad', '不安全任务', mapping('year', 'invented', 'sum'))]),
  };
  const report = await fixture.evaluateCapturedPlan(payload, 'owid-china-energy-time-series');
  expect(report.binding.status).toBe('mismatch');
  expect(report.verdict).toBe('failed-automated-checks');
});

function owidPayload() {
  const fixture = loadEvaluationCase('owid-china-energy-time-series');
  return { datasetHash: fixture.dataset.fingerprint, plan: base([], [task('annual', '年度发电量', mapping('year', 'renewables_electricity', 'sum', 'TWh'))]) };
}

test('捕获计划评测器：裸计划缺少数据绑定时拒绝', async () => {
  const report = await evaluateCapturedPlan(owidPayload().plan, 'owid-china-energy-time-series');
  expect(report.binding.status).toBe('unbound');
  expect(report.execution.tasks).toEqual([]);
  expect(report.verdict).toBe('failed-automated-checks');
});

test('捕获计划评测器：字段错误、澄清空任务和不支持的分桶拒绝', async () => {
  for (const kind of ['field', 'empty', 'bucket']) {
    const payload = owidPayload();
    if (kind === 'field') payload.plan.tasks[0].mapping.metric = 'invented';
    if (kind === 'empty') { payload.plan.tasks = []; payload.plan.questions = ['请确认业务范围']; }
    if (kind === 'bucket') payload.plan.tasks[0].mapping.timeBucket = 'week';
    const report = await evaluateCapturedPlan(payload, 'owid-china-energy-time-series');
    expect(report.verdict, kind).toBe('failed-automated-checks');
    expect(report.execution.tasks, kind).toEqual([]);
  }
});

test('捕获计划评测器：能执行但数值错误时不能通过', async () => {
  const payload = owidPayload();
  payload.plan.tasks[0].mapping.aggregate = 'count';
  const report = await evaluateCapturedPlan(payload, 'owid-china-energy-time-series');
  expect(report.execution.passed).toBe(true);
  expect(report.calculation.passed).toBe(false);
  expect(report.verdict).toBe('failed-automated-checks');
});

test('捕获计划评测器：正确任务也不能掩盖额外的混合指标与跨期余额求和', async () => {
  const fixture = loadEvaluationCase('sec-apple-annual-financial-facts');
  const payload = { datasetHash: fixture.dataset.fingerprint, plan: base([], [
    task('revenue', '收入', mapping('period_label', 'value', 'sum', 'USD', 'none', 'metric', 'revenue')),
    task('cash', '现金', mapping('period_label', 'value', 'sum', 'USD', 'none', 'metric', 'cash_and_cash_equivalents')),
    task('mixed', '错误的混合指标', mapping('period_label', 'value', 'sum', 'USD')),
    task('stock', '错误的跨期现金合计', mapping('metric', 'value', 'sum', 'USD', 'none', 'metric', 'cash_and_cash_equivalents')),
  ]) };
  const report = await evaluateCapturedPlan(payload, 'sec-apple-annual-financial-facts');
  expect(report.execution.passed).toBe(true);
  expect(report.calculation.passed).toBe(true);
  expect(report.safetyFlags.map(flag => flag.code)).toContain('mixed-financial-metrics');
  expect(report.safetyFlags.map(flag => flag.code)).toContain('stock-summed-across-periods');
  expect(report.verdict).toBe('failed-automated-checks');
});

test('SEC 评测器区分跨指标记录数与跨指标金额，计数不被误判为金额相加', async () => {
  const fixture = loadEvaluationCase('sec-apple-annual-financial-facts');
  const payload = { datasetHash: fixture.dataset.fingerprint, plan: base([], [
    task('revenue', '收入原值', mapping('period_label', 'value', 'sum', 'USD', 'none', 'metric', 'revenue')),
    task('cash', '现金原值', mapping('period_label', 'value', 'sum', 'USD', 'none', 'metric', 'cash_and_cash_equivalents')),
    task('records', '各期来源记录数', mapping('period_label', 'metric', 'count', '条')),
  ]) };
  const counted = await evaluateCapturedPlan(payload, 'sec-apple-annual-financial-facts');
  expect(counted.safetyFlags).toEqual([]);
  expect(counted.calculation.passed).toBe(true);
  expect(counted.verdict).toBe('needs-human-review');
  payload.plan.tasks[2] = task('mixed', '错误合并金额', mapping('period_label', 'value', 'sum', 'USD'));
  const mixed = await evaluateCapturedPlan(payload, 'sec-apple-annual-financial-facts');
  expect(mixed.safetyFlags.some(flag => flag.code === 'mixed-financial-metrics')).toBe(true);
  expect(mixed.verdict).toBe('failed-automated-checks');
});
