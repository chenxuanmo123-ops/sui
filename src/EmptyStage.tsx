import { ArrowRight, ArrowUpRight, BarChart3, Database, GitBranch, Globe2, ListChecks, ScanLine, Settings2, ShieldCheck, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * Shared "no real data yet" stage.
 *
 * It deliberately shows no sample figures, charts or query output: before a
 * real file or public download is loaded the app has nothing to compute, and a
 * decorative number would read as a result. The art is pure CSS.
 */
export type EmptyStageView = 'prepare' | 'explore' | 'compare' | 'query' | 'source' | 'branches'

type Copy = {
  eyebrow: string
  title: string
  lead: string
  Icon: LucideIcon
  steps: { title: string; detail: string }[]
}

const COPY: Record<EmptyStageView, Copy> = {
  prepare: {
    eyebrow: 'PROCESSING LINE · IDLE',
    title: '先放一份真实表格，再开始处理。',
    lead: '空行、重复、数字格式和文本清洗都针对当前快照执行。原值保留，处理步骤可撤销，结果不会凭空出现。',
    Icon: Settings2,
    steps: [
      { title: '读取原值', detail: '先看字段、空值和时间范围' },
      { title: '预览再处理', detail: '每一步都先显示影响的行数' },
      { title: '保留快照', detail: '处理前后都可以回到来源' },
    ],
  },
  explore: {
    eyebrow: 'EXPLORATION DECK · STANDBY',
    title: '把数据放进来，先看分布，再找关系。',
    lead: '选择维度、指标和图表类型，系统在浏览器内执行真实 SQL。折线、柱状、散点与热力图都绑定同一份快照。',
    Icon: BarChart3,
    steps: [
      { title: '确认维度与指标', detail: '不把编号或编码当数值' },
      { title: '查看真实结果', detail: '图表旁保留 SQL 与参数' },
      { title: '回到来源', detail: '点击图形可核对原始记录' },
    ],
  },
  compare: {
    eyebrow: 'COMPARISON DECK · STANDBY',
    title: '同一口径，换一个维度再看看。',
    lead: '固定两段期间、一个拆解维度和一种统计方式，比较差额集中在哪些分组。相关与差额不会被写成原因。',
    Icon: ListChecks,
    steps: [
      { title: '先确认可比性', detail: '币种、时长、行粒度逐项核对' },
      { title: '拆解差额', detail: '按分组查看贡献与变化率' },
      { title: '标记证据不足', detail: '只有一期有值时不自动补零' },
    ],
  },
  query: {
    eyebrow: 'QUERY DECK · NO SNAPSHOT',
    title: '没有数据快照，查询不会凭空执行。',
    lead: '导入 CSV、Excel、PDF，或从公开链接直接下载原始数据。之后可以在本地 SQLite 上运行只读 SELECT / WITH。',
    Icon: Database,
    steps: [
      { title: '建立快照', detail: '读取时计算 SHA-256 指纹' },
      { title: '只读执行', detail: '写操作、多条语句与参数会被拒绝' },
      { title: '结果可回查', detail: '保留 SQL、耗时分页与来源记录号' },
    ],
  },
  source: {
    eyebrow: 'PROVENANCE LEDGER · EMPTY',
    title: '每一份数据，都应该说得清从哪里来。',
    lead: '载入后这里会记录发布方、原始链接、文件指纹和解析方式。来源备注不会被自动发送给模型。',
    Icon: ScanLine,
    steps: [
      { title: '出处', detail: '公开链接或本地上传的原始文件' },
      { title: '指纹', detail: 'SHA-256 用于确认每次计算对应哪份快照' },
      { title: '解析记录', detail: '表头行、编码与警告逐条保留' },
    ],
  },
  branches: {
    eyebrow: 'ANALYSIS THREAD · EMPTY',
    title: '第一次计算之后，这里会留下可回查的分支。',
    lead: '每次手动计算或 AI 追问都会保存独立结果。切换分支即可对照原来的字段口径、SQL 和来源记录。',
    Icon: GitBranch,
    steps: [
      { title: '独立保存', detail: '每次计算保留自己的口径与结果' },
      { title: '随时切换', detail: '不覆盖上一轮，可并排对照' },
      { title: '可重命名', detail: '删除会同时移除该分支的追问结果' },
    ],
  },
}

type Props = {
  view: EmptyStageView
  onImport: () => void
  onPublic: () => void
  onWorkspace: () => void
  hasData?: boolean
  loading?: boolean
  compact?: boolean
}

export default function EmptyStage({ view, onImport, onPublic, onWorkspace, hasData = false, loading = false, compact = false }: Props) {
  const copy = COPY[view]
  const Icon = copy.Icon
  const branchesHaveData = view === 'branches' && hasData

  return <section className={'empty-stage' + (compact ? ' is-compact' : '')} data-stage={view} aria-label={copy.title}>
    <div className="empty-stage-grid" aria-hidden="true" />
    <div className="empty-stage-glow" aria-hidden="true" />

    <header className="empty-stage-bar">
      <span className="empty-stage-signal"><i />等待真实数据</span>
      <span className="empty-stage-mode">本地运行 · 原文件不上传</span>
    </header>

    <div className="empty-stage-body">
      <div className="empty-stage-copy">
        <span className="empty-stage-kicker">{copy.eyebrow}</span>
        <h2>{copy.title}</h2>
        <p>{copy.lead}</p>

        <ol className="empty-stage-steps">
          {copy.steps.map((step, index) => <li key={step.title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{step.title}</strong><small>{step.detail}</small></div>
          </li>)}
        </ol>

        <div className="empty-stage-actions">
          {branchesHaveData
            ? <button className="primary" onClick={onWorkspace} disabled={loading}>回到分析工作台<ArrowRight size={16} /></button>
            : <button className="primary" onClick={onImport} disabled={loading}><Upload size={16} />导入文件</button>}
          {branchesHaveData
            ? <button className="secondary" onClick={onImport} disabled={loading}>导入另一份文件</button>
            : <button className="secondary" onClick={onPublic} disabled={loading}><Globe2 size={16} />{loading ? '正在下载…' : '从网页载入公开数据'}<ArrowUpRight size={14} /></button>}
        </div>

        <p className="empty-stage-note"><ShieldCheck size={14} />公开数据由浏览器直接下载固定提交的 CSV，校验 SHA-256 后载入；未载入前不生成示例数字、图表或查询结果。</p>
      </div>

      <div className="empty-stage-art" aria-hidden="true">
        <span className="stage-orbit stage-orbit-a" />
        <span className="stage-orbit stage-orbit-b" />
        <span className="stage-orbit stage-orbit-c" />
        <span className="stage-sweep" />
        <span className="stage-core"><Icon size={38} strokeWidth={1.4} /></span>
        <span className="stage-node stage-node-a" />
        <span className="stage-node stage-node-b" />
        <span className="stage-node stage-node-c" />
        <div className="stage-readout stage-readout-a"><span>SNAPSHOT</span><strong>未载入</strong></div>
        <div className="stage-readout stage-readout-b"><span>ENGINE</span><strong>本地只读</strong></div>
        <div className="stage-readout stage-readout-c"><span>INPUT</span><strong>等待文件</strong></div>
      </div>
    </div>
  </section>
}
