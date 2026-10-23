#!/usr/bin/env node
// 在上下文压缩或会话结束时保存一份只含仓库事实的快照。
// 快照用于恢复现场，不替代 docs/交接文档.md 的总结。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

let input = '';
try {
  if (!process.stdin.isTTY) input = readFileSync(0, 'utf8');
} catch {
  // 无 stdin 时仍生成快照。
}

let payload = {};
try {
  payload = JSON.parse(input);
} catch {
  // 保持为空对象。
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const event = typeof payload.hook_event_name === 'string' ? payload.hook_event_name : 'PreCompact';
const now = new Date();
const pad = value => String(value).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`;

function git(...gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '(不可用)';
  }
}

let config = {};
try {
  config = JSON.parse(readFileSync(join(projectDir, '.claude', 'handover.json'), 'utf8'));
} catch {
  // 使用默认文档路径。
}
const docRel = typeof config.docPath === 'string' && config.docPath ? config.docPath : 'docs/交接文档.md';
const docPath = resolve(projectDir, docRel);
const docInfo = existsSync(docPath)
  ? `${docRel}，更新于 ${new Date(statSync(docPath).mtimeMs).toISOString()}`
  : `${docRel} 不存在`;

const body = [
  '# 上下文快照（自动）',
  '',
  `- 时间：${now.toISOString()}`,
  `- 事件：${event}`,
  `- 会话：${typeof payload.session_id === 'string' ? payload.session_id : '未知'}`,
  `- 分支：${git('rev-parse', '--abbrev-ref', 'HEAD')}`,
  `- HEAD：${git('rev-parse', '--short', 'HEAD')}`,
  `- 交接文档：${docInfo}`,
  '',
  '## git status --short',
  '',
  '```text',
  git('status', '--short') || '(clean)',
  '```',
  '',
  '## git diff --stat',
  '',
  '```text',
  git('diff', '--stat') || '(none)',
  '```',
  '',
  '## 最近提交',
  '',
  '```text',
  git('log', '-5', '--oneline') || '(none)',
  '```',
  '',
  '> 本文件由 hook 自动生成，只记录仓库事实；分析结论与下一步请写入 docs/交接文档.md。',
  '',
].join('\n');

const snapshotDir = join(projectDir, '.claude', 'handover', 'snapshots');
mkdirSync(snapshotDir, { recursive: true });
const snapshotPath = join(snapshotDir, `${stamp}.md`);
writeFileSync(snapshotPath, body, 'utf8');

process.stdout.write(JSON.stringify({
  systemMessage: `已写入上下文快照 .claude/handover/snapshots/${stamp}.md`,
}));
