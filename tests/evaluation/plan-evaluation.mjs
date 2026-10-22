import { checkPlan } from '../../server/ai.mjs';
import { planSchema, validate } from '../../server/contracts.mjs';

// This evaluates a captured output against a pinned fixture, never live business
// data. Domain understanding is deliberately reserved for human review.
export function evaluatePlan(payload, { caseId, dataset, execute, expectations, reviewRubric }) {
  const wrapped = payload && Object.hasOwn(payload, 'plan');
  const plan = wrapped ? payload.plan : payload;
  const report = {
    caseId,
    datasetHash: dataset.fingerprint,
    binding: { status: wrapped ? 'pending' : 'unbound', note: wrapped ? '' : 'Raw plan has no captured dataset hash; provenance needs human confirmation.' },
    structural: { passed: false, error: '' },
    execution: { passed: false, tasks: [], error: '' },
    calculation: { passed: false, targets: [] },
    safetyFlags: [],
    semantic: { status: 'pending-human-review', rubric: reviewRubric, decision: null },
    verdict: 'failed-automated-checks',
    limitations: [
      'No model accuracy score is inferred from keywords or a successful HTTP response.',
      'Execution means SQL actually ran; calculation means its full results and source row IDs matched this fixture gold.',
      'Human review of business meaning, causality, units, missing dates and sample scope is still required.',
    ],
  };
  if (!wrapped) {
    report.binding.note = 'A captured { datasetHash, plan } wrapper is required; an unbound plan cannot pass.';
    return report;
  }
  if (wrapped) {
    if (payload.datasetHash !== dataset.fingerprint) {
      report.binding.status = 'mismatch';
      report.binding.note = 'Captured output belongs to another or an unspecified dataset snapshot.';
      return report;
    }
    report.binding.status = 'matched';
  }
  try {
    validate(plan, planSchema);
    report.structural.passed = true;
  } catch (error) {
    report.structural.error = error.message;
    return report;
  }
  try {
    checkPlan(plan, { columns: dataset.headers.map(field => ({ field })) });
    if (!plan.tasks.length) throw new Error('Clarification-only output has no executable tasks.');
  } catch (error) {
    report.execution.error = error.message;
    return report;
  }
  for (const task of plan.tasks) {
    try {
      const result = execute(task);
      report.execution.tasks.push({ id: task.id, passed: true, mapping: task.mapping, sql: result.sql, parameters: result.parameters, points: result.points, datasetHash: result.datasetHash });
      if (caseId === 'sec-apple-annual-financial-facts') {
        for (const point of result.points) {
          const rows = point.rowIds.map(id => dataset.rows[id - 2]);
          // Counting source records across metric categories is not adding their monetary values.
          if (!['count', 'distinct'].includes(task.mapping.aggregate) && task.mapping.metric === 'value' && new Set(rows.map(row => row.metric)).size > 1) {
            report.safetyFlags.push({ taskId: task.id, code: 'mixed-financial-metrics', label: point.label });
          }
          if (task.mapping.aggregate === 'sum' && rows.some(row => row.fact_type === 'stock') && new Set(rows.map(row => row.end)).size > 1) {
            report.safetyFlags.push({ taskId: task.id, code: 'stock-summed-across-periods', label: point.label });
          }
        }
      }
    } catch (error) {
      report.execution.tasks.push({ id: task.id, passed: false, mapping: task.mapping, error: error.message });
    }
  }
  report.execution.passed = report.execution.tasks.length > 0 && report.execution.tasks.every(task => task.passed);
  const equalPoints = (actual, expected) => actual.length === expected.length && expected.every(target => {
    const point = actual.find(candidate => candidate.label === target.label);
    if (!point || Math.abs(point.value - target.value) > Math.max(1e-8, Math.abs(target.value) * 1e-12)) return false;
    return JSON.stringify([...point.rowIds].sort((a, b) => a - b)) === JSON.stringify([...target.rowIds].sort((a, b) => a - b));
  });
  report.calculation.targets = expectations.map(target => {
    const matching = report.execution.tasks.filter(task => task.passed && task.mapping.x === target.x && task.mapping.metric === target.metric && equalPoints(task.points, target.points));
    return { id: target.id, passed: matching.length > 0, matchedTaskIds: matching.map(task => task.id), expectedPointCount: target.points.length };
  });
  report.calculation.passed = expectations.length > 0 && report.calculation.targets.every(target => target.passed);
  if (report.execution.passed && report.calculation.passed && !report.safetyFlags.length) report.verdict = 'needs-human-review';
  return report;
}
