import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

// A render error must not leave a blank screen. The saved workspace is separate
// from the running request, so reloading is the safe recovery path.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('数鉴界面异常', error, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return <main className="workspace-restoring app-error" role="alert">
      <h1>界面遇到问题</h1>
      <p>当前操作没有完成。已经保存到本机的数据与计算结果不会因为刷新而丢失；正在进行的模型请求不会自动重试，也不会产生新的结果。</p>
      <details><summary>错误信息</summary><p className="mono">{this.state.error.message || '未知错误'}</p></details>
      <button className="primary" onClick={() => location.reload()}>刷新并恢复工作区</button>
      <p><small>如果刷新后仍然出现此页面，可先导出需要保留的内容；必要时在浏览器设置中清除本站数据。</small></p>
    </main>
  }
}
