import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { withRuntime } from './evaluate-plan-cli.mjs';

// Uses the host's normal provider selection. Never reads or prints credentials,
// edits connections, tests every vendor, or sends user-uploaded files.
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(case|base-url)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --case=<id> [--base-url=http://127.0.0.1:5174]');
  return match.slice(1);
}));
if (!args.case) throw new Error('A single --case is required; bulk model calls are not automatic.');
const host = new URL(args['base-url'] || 'http://127.0.0.1:5174');
if (host.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || host.username || host.password || host.pathname !== '/' || host.search || host.hash) throw new Error('Use a local host origin.');
const hash = data => createHash('sha256').update(data).digest('hex');
const files = ['server/ai.mjs', 'server/contracts.mjs', 'server/model-client.mjs', 'src/ai.ts', 'src/data.ts', 'src/analytics.ts', 'tests/evaluation/cases.json', 'tests/evaluation/plan-evaluation.mjs', 'tests/evaluation/evaluation-runtime.ts'];
const protocolFiles = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(resolve(file)))])));
const statusResponse = await fetch(new URL('/api/ai/status', host));
if (!statusResponse.ok) throw new Error('Local AI host status request failed.');
const status = await statusResponse.json();
const provider = status.providers?.find(p => p.id === status.defaultProviderId);
if (!provider) throw new Error('No default provider is configured; no model call made.');
await withRuntime(async runtime => {
  const fixture = runtime.loadEvaluationCase(args.case);
  const request = { ...fixture.request, providerId: provider.id };
  const directory = resolve('artifacts/model-evaluation', new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'request.json'), JSON.stringify(request, null, 2) + '\n', { flag: 'wx' });
  const startedAt = new Date().toISOString();
  console.log('Calling one default model on public fixture: ' + args.case + ' / ' + provider.model);
  const response = await fetch(new URL('/api/ai/plan', host), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: host.origin }, body: JSON.stringify(request), signal: AbortSignal.timeout(195000) });
  const captured = await response.json();
  const record = { caseId: args.case, providerId: provider.id, model: provider.model, startedAt, completedAt: new Date().toISOString(), httpStatus: response.status, datasetHash: fixture.dataset.fingerprint, requestSha256: hash(JSON.stringify(request)), protocolFiles, kind: 'single-live-planning-case-with-explicit-context', limitations: ['Not blind domain classification.', 'No aggregate accuracy or cross-vendor claim.', 'No model interpretation or PDF extraction was evaluated.'] };
  await writeFile(resolve(directory, 'run.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  await writeFile(resolve(directory, 'response.json'), JSON.stringify(captured, null, 2) + '\n', { flag: 'wx' });
  if (!response.ok) {
    console.log(JSON.stringify({ httpStatus: response.status, caseId: args.case, evidenceDirectory: directory, outcome: 'model-request-failed-no-score' }, null, 2));
    process.exitCode = 1;
    return;
  }
  const report = await runtime.evaluateCapturedPlan(captured, args.case);
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ model: provider.model, caseId: args.case, tasks: captured.plan.tasks.length, questions: captured.plan.questions.length, binding: report.binding.status, execution: report.execution.passed, calculation: report.calculation.passed, flags: report.safetyFlags, verdict: report.verdict, evidenceDirectory: directory }, null, 2));
  if (report.verdict === 'failed-automated-checks') process.exitCode = 1;
});
