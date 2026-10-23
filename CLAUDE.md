# CLAUDE.md — 数鉴 Agent

本文件是给后续 AI 开发者的项目级约束。开始任何开发、评审或交付前，先读：

1. [项目长期上下文](docs/数鉴Agent-项目长期上下文.md)（最重要的状态与决策记录）
2. [README](README.md)
3. 与当前任务直接相关的代码、测试和 `docs/archive/` 验收记录

## 项目定位

AI Web 网页开发挑战赛参赛作品，赛道为 **AI 数据分析与可视化**。核心闭环：

> 导入真实文件 → 核对字段与来源 → AI 生成可审查计划 → 浏览器内 SQLite 真实计算 → 图表与证据回查 → 分组追问 → 导出单文件 HTML 报告。

技术栈：React 19 + TypeScript + Vite；sql.js Web Worker；ECharts/SVG；SheetJS、PDF.js；Node 24 同源 AI 接口（OpenAI 兼容 Chat Completions）。

## 不可回退的原则

- 不使用虚构业务数据、假模型回答或模拟执行冒充真实能力；测试替身只能留在自动化测试中。
- 数字只能来自真实计算结果；AI 只负责理解、规划和解释已验证事实。
- 不把描述性统计写成因果结论，不把样本写成总体，不把连接成功写成分析准确。
- 不为了通过模型输出而放宽字段、聚合、范围、快照或证据校验。
- 不读取、输出或提交 `.local/`、`.env` 中的真实密钥；不把 API Key 写入浏览器存储、日志、截图或报告。
- 不 force push；不擅自购买云服务或修改部署账号。
- 不把 MCP、RAG、多模态或多模型配置当作目的；它们必须服务于数据分析闭环。

## 当前状态（2026-10-23 18:56 核对）

- 仓库：`chenxuanmo123-ops/sui`。`4cb004c`、`d46c56d`、`86a9479`、`3ec8eb0`、`945124a`、`1226de1`、`917de33`、`3579bc1`、`29f1a2b` 均已推送；Pages Functions 已随 `86a9479` 部署生效。
- 2026-10-23 18:56 代码提交后工作区只有交接/部署文档更新；不要重置用户文件。
- 已核对的本地结果：`test:core` 96 项、`test:ai` 31 项（含 Pages Functions 8 项与 dev-server 1 项）、`test:evaluation` 14 项、`test:production` 33 项通过；`npm run build` 通过（仍有 >500 kB 分包警告）。
- 本轮浏览器回归全部通过：`core-browser-acceptance.py` 16、`import-browser-acceptance.py` 14（末尾直接导入 `/src/importers.ts`，必须对 `npm run dev` 运行）、`ai-partial-execution-browser.py` 13、`follow-up-browser.py` 7、`quality-diagnostics-browser.py` 6、`ai-cancellation-browser.py` 4、`analysis-usability-browser.py` 6。不能用这些结果声称真实模型质量或公网可用。
- `29f1a2b` 增加：结果表分组搜索/排序（不改变计算值）、未配置模型时手动计算为首要入口、当前口径带入探索分析、顶层错误边界；归档 `docs/比赛规则与评分标准-2026.md`。仍未实现流式输出、RAG、MCP。
- `scripts/dev.mjs` 曾因缺少 `createProfileStore()` 导致 `npm run dev` 启动崩溃，已在 `3579bc1` 修复；`tests/dev-server.test.mjs` 覆盖该入口。
- Cloudflare Pages 站点 `https://sui-ae9.pages.dev/` 在 2026-10-23 18:56 的公网资源为 `index-BZmg_Z_l.js` / `index-C8EXOo8P.css`，与本地 `dist` 一致，确认推送会触发自动构建。
- 仓库新增 `functions/api/`：`/api/ai/*`、`/api/health`、未知 `/api/*` 的 JSON 404 由 Pages Functions 处理，与 Node 服务共用 `server/ai.mjs`。2026-10-23 18:56 公网实测：健康检查与状态接口返回 JSON，未知 API 返回 404 JSON，未配置模型时计划接口返回 503 JSON；`npm run verify:public` 7/7 通过（首次因网络超时 0/1，重试通过）。
- 公网 `/api/health` 当前为 `aiConfigured:false`：Cloudflare Pages 还没有配置 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，AI 不可用。配置后应复跑 `npm run verify:public` 并做一次真实模型计划；在此之前不能声称公网 AI 已上线。
- Pages Functions 没有文件系统：公网保存/删除模型连接返回 403 属预期；自带密钥需要 `LLM_ALLOWED_HOSTS`。`render.yaml` 与 Dockerfile 仍保留，Docker 镜像未实际构建。
- 健康检查返回 JSON 只证明后端存在；AI 是否可用以 `aiConfigured:true` 与一次真实模型计划为准。

## 上下文交接自动化

- 交接文档：`docs/项目进度与交接说明.md`，是后续会话的唯一完整入口；`docs/数鉴Agent-项目长期上下文.md` 是更长的决策记录。
- 手动更新：运行 `/handover`（定义在 `.claude/commands/handover.md`）。
- 自动检查：`.claude/hooks/handover-context.mjs` 在 `SessionStart` 提供文档位置与新鲜度，在 `UserPromptSubmit` 检查是否超过 12 小时或 HEAD 是否变化；到期时向模型注入更新指令。
- 自动留痕：`.claude/hooks/handover-snapshot.mjs` 在 `PreCompact` 与 `SessionEnd` 把 git 状态写入 `.claude/handover/snapshots/`；快照只记录事实，不替代交接文档。
- 配置：`.claude/handover.json`。可调 `intervalHours`、`docPath`、`minNudgeMinutes`、`headChangeMinMinutes`。
- 运行态文件 `.claude/handover-state.json` 与 `snapshots/` 已忽略，不提交；配置、脚本、命令和交接文档应入库。
- 自动检查只负责提醒，不会在后台调用模型；真正的更新由当前会话完成，必须遵守“不编造测试/部署/模型能力”的约束。

## 常用命令

```sh
npm run dev          # 开发服务（Vite + Node AI 接口）
npm run build        # tsc -b && vite build
npm start            # 生产服务，读取 dist/
npm run test:core    # 解析、SQLite、AI 执行、取消、质量、来源、追问、工作区、图表
npm run test:ai      # 后端契约、模型传输、配置存储、结构化输出
npm run test:evaluation
npm run test:production
npm run evaluate:plan -- --case=<case-id> --input=<plan.json>
npm run evaluate:model -- --case=<case-id> --base-url=http://127.0.0.1:5174
```

浏览器脚本使用 Python Playwright，先启动服务并设置 `TEST_BASE_URL`（常用 `http://127.0.0.1:5174`）。模型配置相关测试必须使用隔离配置路径，避免改动用户保存的凭据。

## 工作方式

1. 先把“已实现 / 测试替身 / 计划中 / 不可宣称”分开，再写结论。
2. 修改后运行与改动直接相关的测试；涉及共享计算或契约时补跑核心与评测套件。
3. 任何新的真实数据、模型评测或验收，都要保留来源、版本/哈希、失败记录，不把失败改写成成功。
4. 文档中明确当前限制；发现缺口时写影响和下一步，不用营销话术掩盖。
5. 提交前检查 `git status` 与 diff，确认没有密钥、`.local`、`artifacts/` 或临时配置进入提交。
6. 需要提交或推送时先确认；提交信息说明实际改动，不补造历史。
