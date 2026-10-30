import { Component, type ReactNode } from 'react'
import { RotateCw } from 'lucide-react'
// Chart engines load as separate chunks. If a chunk fails to arrive (offline,
// truncated response), React lazy rejects and an unbounded failure would blank
// the view. Keep the rendered table, SQL and evidence usable and say so.
export default class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.error('图表引擎加载失败', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return <div className="core-warning" role="status"><p>图表引擎加载失败（网络中断或资源被截断）。下方结果表、SQL 与来源记录不受影响，可刷新页面重试。</p><button className="secondary" type="button" onClick={() => window.location.reload()}><RotateCw size={14} />刷新页面</button></div>
  }
}
