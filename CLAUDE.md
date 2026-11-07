# CLAUDE.md — 数鉴 Agent

项目级约束。开始开发、评审或交付前，先读 [README](README.md) 与 [docs/](docs/README.md) 中与任务相关的部分。

## 项目定位

AI Web 网页开发挑战赛参赛作品，赛道为 **AI 数据分析与可视化**。核心闭环：

> 导入真实文件 → 核对字段与来源 → AI 生成可审查计划 → 浏览器内 SQLite 真实计算 → 图表与证据回查 → 分组追问 → 导出单文件 HTML 报告。

技术栈：React 19 + TypeScript + Vite；sql.js Web Worker；ECharts/SVG；SheetJS、PDF.js；Node 24 同源 AI 接口（OpenAI 兼容 Chat Completions）。

## 不可回退的原则

- 不使用虚构业务数据、假模型回答或模拟执行冒充真实能力；测试替身只能留在自动化测试中。
- 数字只能来自真实计算结果；AI 只负责理解、规划和解释已验证事实。
- 不把描述性统计写成因果结论，不把样本写成总体，不把连接成功写成分析准确性。
- 不为了通过模型输出而放宽字段、聚合、范围、快照或证据校验。
- 不读取、输出或提交 `.local/`、`.env` 中的真实密钥；不把 API Key 写入浏览器存储、日志、截图或报告。
- 不 force push；不擅自购买云服务或修改部署账号。
- 不把 MCP、RAG、多模态或多模型配置当作目的；它们必须服务于数据分析闭环。

## 当前状态（2026-11-07 核对）

- 仓库：`chenxuanmo123-ops/sui`；线上：<https://sui-ae9.pages.dev/>，前端与同源 AI 接口均由 Cloudflare Pages 提供。
- 服务端模型已配置（DeepSeek `deepseek-chat`）；`/api/health` 返回 `aiConfigured:true`。
- 验证基线：`tsc -b` 与 `npm run build` 通过；`test:core` 228、`test:ai` 49、`test:evaluation` 14、`test:production` 33；公网 `verify:public` 7/7。
- 未完成：AI 流式输出、向量语义检索、通用自主 Agent 调度、跨设备云端工作区。MCP 暂缓。
- 测试通过不等于模型对所有数据都准确；对外说明时区分自动测试、测试替身与真实模型验收。

## 常用命令

```sh
npm run dev          # 开发服务（Vite + Node AI 接口）
npm run build        # tsc -b && vite build
npm start            # 生产服务，读取 dist/
npm run test:core    # 解析、SQLite、AI 执行、取消、质量、来源、追问、工作区、图表
npm run test:ai      # 后端契约、模型传输、配置存储、结构化输出
npm run test:evaluation
npm run test:production
npm run verify:public
npm run backup       # 改动前后各留一份时间戳工作副本
```

浏览器脚本使用 Python Playwright，先启动服务并设置 `TEST_BASE_URL`。模型配置相关测试必须使用隔离配置路径，避免改动用户保存的凭据。

## 工作方式

1. 先把「已实现 / 测试替身 / 计划中 / 不可宣称」分开，再写结论。
2. 修改后运行与改动直接相关的测试；涉及共享计算或契约时补跑核心与评测套件。
3. 任何新的真实数据、模型评测或验收，都要保留来源、版本/哈希、失败记录，不把失败改写成成功。
4. 文档中明确当前限制；发现缺口时写影响和下一步，不用营销话术掩盖。
5. 提交前检查 `git status` 与 diff，确认没有密钥、`.local`、`artifacts/` 或临时配置进入提交。
6. 提交或推送前先确认；提交信息一句话说清改了什么，不补造历史。
