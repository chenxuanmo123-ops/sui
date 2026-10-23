#!/usr/bin/env node
// 上下文交接检查：SessionStart 提供入口，UserPromptSubmit 在到期时提醒更新文档。
// 只读 git 与文件时间，不调用模型、不发送网络请求、不读取 .local 或 .env。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const args = new Set(process.argv.slice(2));
const configPath = join(projectDir, '.claude', 'handover.json');

let config = {};
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  // 配置缺失时使用安全默认值。
}

const intervalHours = Number(config.intervalHours) > 0 ? Number(config.intervalHours) : 12;
const docRel = typeof config.docPath === 'string' && config.docPath ? config.docPath : 'docs/交接文档.md';
const docPath = resolve(projectDir, docRel);
const statePath = join(projectDir, '.claude', 'handover-state.json');
const minNudgeMinutes = Number(config.minNudgeMinutes) > 0 ? Number(config.minNudgeMinutes) : 30;
const headChangeMinMinutes = Number(config.headChangeMinMinutes) > 0 ? Number(config.headChangeMinMinutes) : 30;

function readState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  mkdirSync(join(projectDir, '.claude'), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function git(...gitArgs) {
  try {
    return execFileSync('git', gitArgs, {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const now = Date.now();
const docExists = existsSync(docPath);
const docMtime = docExists ? statSync(docPath).mtimeMs : 0;
const ageMinutes = docExists ? Math.max(0, Math.round((now - docMtime) / 60000)) : Infinity;
const head = git('rev-parse', '--short', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const state = readState();

if (args.has('--session-start')) {
  if (!state.lastSeenHead && head) writeState({ ...state, lastSeenHead: head });
  const ageText = docExists
    ? `${ageMinutes} 分钟前更新${ageMinutes >= intervalHours * 60 ? `，已超过 ${intervalHours} 小时阈值` : ''}`
    : '尚不存在';
  const context = [
    '本项目已启用上下文交接机制。开始工作前先读 CLAUDE.md、' + docRel + ' 和 docs/数鉴Agent-项目长期上下文.md。',
    `交接文档：${docRel}（${ageText}）。`,
    `当前分支 ${branch || '未知'}，HEAD ${head || '未知'}。`,
    '若交接文档超过阈值或工作区有重大变化，按 /handover 的规则先更新，再继续用户请求。',
  ].join('');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  }));
  process.exit(0);
}

const lastNudged = state.lastNudgedAt ? Date.parse(state.lastNudgedAt) : 0;
if (lastNudged && now - lastNudged < minNudgeMinutes * 60000) process.exit(0);

const reasons = [];
if (!docExists) {
  reasons.push(`交接文档 ${docRel} 不存在`);
} else if (ageMinutes >= intervalHours * 60) {
  reasons.push(`交接文档已 ${Math.floor(ageMinutes / 60)} 小时未更新（阈值 ${intervalHours} 小时）`);
}
if (state.lastSeenHead && head && state.lastSeenHead !== head && ageMinutes >= headChangeMinMinutes) {
  reasons.push(`HEAD 已从 ${state.lastSeenHead} 变为 ${head}`);
}
if (args.has('--force')) reasons.push('手动强制检查');

if (reasons.length === 0) process.exit(0);

writeState({
  ...state,
  lastNudgedAt: new Date(now).toISOString(),
  lastSeenHead: head || state.lastSeenHead,
  lastReasons: reasons,
});

const instruction = [
  `【自动交接检查】${reasons.join('；')}。请在本轮回答前，用不超过 3 分钟更新 ${docRel}。`,
  '1. 先读 CLAUDE.md、' + docRel + '、docs/数鉴Agent-项目长期上下文.md，并运行 git status --short、git log -5 --oneline、git diff --stat 获取事实。',
  '2. 保持文档现有章节与历史，不要改写成固定模板；至少更新：第 1 节当前事实、第 7 节最新未提交改动、第 8 节验证结果、第 10 节公网/Git 状态、第 12 节优先级、第 15 节交付记录（追加一条）。',
  '3. 已验证结果必须写明命令与数量，未运行就写未运行；绝对更新时间；保留失败记录，不把失败改写成成功。',
  '4. 只写能从代码、diff、测试输出或用户消息中核实的内容；不编造测试、部署或模型能力，不把测试替身写成真实 AI。',
  '5. 不删除尚未解决的事项和历史变更日志；更新后不必运行其他命令，文件修改时间会自动作为下次检查依据。',
  '完成后在回答中用一句话说明已更新交接文档，再继续用户请求。',
].join('\n');

process.stdout.write(JSON.stringify({
  systemMessage: `交接文档到期：${reasons.join('；')}`,
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: instruction,
  },
}));
