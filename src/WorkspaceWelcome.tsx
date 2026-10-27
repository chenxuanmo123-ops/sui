import { useState } from 'react'
import { ArrowRight, ArrowUpRight, FileSpreadsheet, FileText, Gauge, ScanSearch, ShieldCheck, Table2, Upload } from 'lucide-react'

type Props = {
  onPick: (accept?: string) => void
  onFile: (file: File) => void
  busy: boolean
  configured: boolean
  onConfigure: () => void
  onPublic: () => void
}

const FORMATS = [
  { accept: '.xlsx,.xls', Icon: FileSpreadsheet, title: 'Excel', detail: '选择工作表与表头' },
  { accept: '.csv', Icon: Table2, title: 'CSV', detail: '读取并检查原值' },
  { accept: '.pdf', Icon: FileText, title: 'PDF', detail: '提取表格后核对' },
]

const STEPS = [
  { title: '读取并体检', detail: '字段类型、空值、时间范围' },
  { title: '提问或手动计算', detail: '每一步都先确认口径' },
  { title: '核对来源再导出', detail: '图表能回到原始记录' },
]

export default function WorkspaceWelcome({ onPick, onFile, busy, configured, onConfigure, onPublic }: Props) {
  const [dragging, setDragging] = useState(false)

  return <section className="workspace-welcome" aria-label="开始数据分析">
    <div className="welcome-field" aria-hidden="true"><span className="welcome-glow welcome-glow-a" /><span className="welcome-glow welcome-glow-b" /></div>

    <div className="welcome-bar">
      <span className="welcome-bar-title"><i />数鉴 · 数据分析工作台</span>
      <span className="welcome-bar-state">本地运行 · 原文件不上传</span>
    </div>

    <div className="welcome-main">
      <div className="welcome-copy">
        <span className="welcome-eyebrow">从一份真实文件开始</span>
        <h1>把数据放进来，<br /><span>从第一个问题开始。</span></h1>
        <p>拖入一份表格或报告，几秒内完成读取与体检。图表、结论和原始记录互相对应，每个数字都能找到出处。</p>

        <ol className="welcome-steps">
          {STEPS.map((step, index) => <li key={step.title}>
            <span className="step-index">{index + 1}</span>
            <div><strong>{step.title}</strong><small>{step.detail}</small></div>
          </li>)}
        </ol>
      </div>

      <div className="welcome-features">
        <article>
          <span className="feature-icon"><ScanSearch size={18} /></span>
          <h3>先诊断，再说话</h3>
          <p>导入后先检查字段、空值与时间范围，不把编号当指标。</p>
        </article>
        <article>
          <span className="feature-icon"><Gauge size={18} /></span>
          <h3>计算与图表同步</h3>
          <p>每次分析先落到可核对的 SQL，再生成图表和来源记录。</p>
        </article>
        <article>
          <span className="feature-icon"><ShieldCheck size={18} /></span>
          <h3>结论带证据</h3>
          <p>点击任意分组，回到构成它的原始记录，导出完整报告。</p>
        </article>
      </div>
    </div>

    <div className="intake-area">
      <div className="intake-head">
        <span>导入数据</span>
        <small>支持 CSV、Excel、PDF</small>
      </div>

      <div
        className={'file-dropzone' + (dragging ? ' dragging' : '')}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) onFile(file)
        }}
      >
        <span className="drop-scan" aria-hidden="true" />
        <span className="intake-aperture" aria-hidden="true">
          <span className="aperture-ring" />
          <span className="aperture-core">
            <span className="intake-glyph"><Table2 size={26} strokeWidth={1.4} /><span>+</span></span>
          </span>
        </span>
        <span className="dropzone-kicker">拖入文件</span>
        <h2>把文件放在这里</h2>
        <p>也可以从电脑中选取，全程在本机读取</p>
        <button className="primary" disabled={busy} onClick={() => onPick()}><Upload size={17} />选择文件<ArrowRight size={17} /></button>
        <small>CSV · XLSX · XLS · PDF　最大 30 MB</small>
      </div>

      <div className="format-options">
        {FORMATS.map(({ accept, Icon, title, detail }) => <button key={title} onClick={() => onPick(accept)} disabled={busy} title={detail}>
          <Icon size={17} />
          <span><strong>{title}</strong><small>{detail}</small></span>
          <ArrowUpRight size={13} />
        </button>)}
      </div>

      <button className="public-entry text-button" onClick={onPublic} disabled={busy}>
        手边没有文件？从网页直接下载公开数据<ArrowUpRight size={15} />
      </button>
      <small className="public-entry-source">OWID Energy Data · GitHub 原始 CSV · 载入时计算 SHA-256</small>

      <div className="intake-trust">
        <span><ShieldCheck size={14} />原文件不会上传</span>
        <button className="text-button" onClick={onConfigure}>
          {configured ? 'AI 已连接' : '连接 AI 助手'}
          <ArrowUpRight size={13} />
        </button>
      </div>
    </div>

    <div className="welcome-bottom">
      <div className="welcome-trust">
        <span>导入先体检</span>
        <span>计算可复现</span>
        <span>来源可回查</span>
      </div>
      <div className="welcome-connection">
        <span className="connection-indicator" />
        <span>{configured ? 'AI 助手可用' : '未连接 AI 也能完成本地计算'}</span>
        <button className="text-button" onClick={onConfigure}>{configured ? '查看模型' : '配置模型'}<ArrowUpRight size={13} /></button>
      </div>
    </div>
  </section>
}
