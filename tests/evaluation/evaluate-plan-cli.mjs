import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as createViteServer } from 'vite';

export function parseArguments(argv) {
  const args = {};
  for (const value of argv) {
    const match = /^--(case|input|output)=(.+)$/.exec(value);
    if (!match || args[match[1]]) throw new Error('Use --case=<id> --input=<plan.json> [--output=<report.json>]');
    args[match[1]] = match[2];
  }
  if (!args.case || !args.input) throw new Error('Use --case=<id> --input=<plan.json> [--output=<report.json>]');
  return args;
}

export async function withRuntime(callback) {
  // Vite transforms the exact production TypeScript engine; no browser worker or
  // independent approximate reimplementation of the SQL engine is used here.
  const vite = await createViteServer({ configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom' });
  try {
    return await callback(await vite.ssrLoadModule('/tests/evaluation/evaluation-runtime.ts'));
  } finally { await vite.close(); }
}

export async function main(argv) {
  const args = parseArguments(argv);
  const payload = JSON.parse(await readFile(resolve(args.input), 'utf8'));
  const report = await withRuntime(runtime => runtime.evaluateCapturedPlan(payload, args.case));
  if (args.output) {
    await mkdir(dirname(resolve(args.output)), { recursive: true });
    await writeFile(resolve(args.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict === 'failed-automated-checks') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
