import { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, AriaComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { formatNumber } from './data'
import type { ConsoleRow } from './sql-console'
import { numericColumns, sqlChartDefaults, sqlChartSeries } from './sql-chart'
import type { SqlChartSpec } from './sql-chart'

echarts.use([BarChart,LineChart,GridComponent,TooltipComponent,DataZoomComponent,AriaComponent,SVGRenderer])

export default function SqlResultChart({ columns, rows }: { columns: string[]; rows: ConsoleRow[] }) {
  const defaults = useMemo(() => sqlChartDefaults(columns, rows), [columns, rows])
  const [spec, setSpec] = useState<SqlChartSpec>(defaults)
  useEffect(() => setSpec(defaults), [defaults])
  const numericOptions = useMemo(() => numericColumns(columns, rows), [columns, rows])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || spec.y < 0) return
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' })
    const { labels, values } = sqlChartSeries(spec, rows)
    const zoom = rows.length > 24
    const text = { color: '#d9c2ad', fontSize: 12, fontFamily: 'system-ui, sans-serif' }
    const seriesColor = '#ff8a3d'
    const animate = rows.length <= 240 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chart.setOption({
      animation: animate,
      animationDuration: 520,
      animationEasing: 'cubicOut',
      animationDelay: (index: number) => Math.min(index * 14, 240),
      color: [seriesColor],
      textStyle: { fontFamily: 'system-ui, sans-serif' },
      aria: { enabled: true },
      tooltip: {
        trigger: 'item', renderMode: 'richText', confine: true, backgroundColor: '#111720', borderColor: 'rgba(255,170,115,.42)', textStyle: { color: '#ffe8d2', fontSize: 12.5 }, padding: 14,
        formatter: (params: unknown) => {
          const item = params as { dataIndex: number }
          const row = rows[item.dataIndex]
          if (!row) return ''
          return (spec.x >= 0 ? columns[spec.x] + '：' + String(row[spec.x] ?? '（空）') + '\n' : '') + columns[spec.y] + '：' + formatNumber(values[item.dataIndex], 8) + '\n第 ' + (item.dataIndex + 1) + ' 行（按查询结果顺序）'
        },
      },
      grid: { left: 76, right: 28, top: 34, bottom: 62 },
      xAxis: { type: 'category', data: labels, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { ...text, hideOverlap: true, overflow: 'truncate', width: 90 }, name: spec.x >= 0 ? columns[spec.x] : '结果行号', nameLocation: 'middle', nameGap: 34, nameTextStyle: text },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { ...text, formatter: (value: number) => formatNumber(value, 2) }, splitLine: { lineStyle: { color: 'rgba(255,175,120,.18)', type: 'dashed' } }, name: columns[spec.y], nameGap: 22, nameTextStyle: text },
      ...(zoom ? { dataZoom: [{ type: 'inside', start: 0, end: Math.min(100, 24 / rows.length * 100), filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false }] } : {}),
      series: [{
        type: spec.kind,
        data: values,
        barMaxWidth: 26,
        ...(spec.kind === 'bar' ? { itemStyle: { borderRadius: [3, 3, 0, 0], shadowBlur: 10, shadowColor: 'rgba(255,138,61,.3)' }, label: { show: rows.length <= 12, position: 'top', fontSize: 12, fontWeight: 600, color: '#ffe2c4', formatter: (params: { value: unknown }) => params.value == null ? '' : formatNumber(Number(params.value), 2) } } : {}),
        ...(spec.kind === 'line' ? { lineStyle: { width: 3, shadowBlur: 10, shadowColor: 'rgba(255,138,61,.42)' }, symbol: 'circle', symbolSize: 8, itemStyle: { shadowBlur: 8, shadowColor: 'rgba(255,138,61,.5)' }, label: { show: rows.length <= 12, position: 'top', fontSize: 12, fontWeight: 600, color: '#ffe2c4' }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255,138,61,.24)' }, { offset: .12, color: 'rgba(255,138,61,.03)' }, { offset: .3, color: 'rgba(255,138,61,0)' }, { offset: 1, color: 'rgba(255,138,61,0)' }] } } } : {}),
        emphasis: { itemStyle: { color: '#ffb066' } },
      }],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(ref.current)
    return () => { observer.disconnect(); chart.dispose() }
  }, [spec, columns, rows])

  if (spec.y < 0) return <div className="sql-chart-empty"><p>结果中没有可作为纵轴的数值列。图表不会把文本或 <code>∅</code> 当作 0，也不会把无法解析的金额字符串当成数字。</p><p>请让 SQL 返回明确数值，例如 <code>COUNT(*)</code>、<code>SUM(strict_number(列))</code> 或 <code>AVG(strict_number(列))</code>。</p></div>

  return <div className="sql-result-chart">
    <div className="viz-toolbar"><div className="viz-controls">
      <label>图表<select aria-label="查询结果图表类型" value={spec.kind} onChange={e => setSpec({ ...spec, kind: e.target.value as SqlChartSpec['kind'] })}><option value="bar">柱形图</option><option value="line">折线图</option></select></label>
      <label>横轴<select aria-label="查询结果横轴" value={spec.x} onChange={e => setSpec({ ...spec, x: Number(e.target.value) })}><option value={-1}>结果行号</option>{columns.map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label>
      <label>纵轴<select aria-label="查询结果纵轴" value={spec.y} onChange={e => setSpec({ ...spec, y: Number(e.target.value) })}>{numericOptions.map(index => <option key={index} value={index}>{columns[index]}</option>)}</select></label>
      <span className="viz-order-note">按查询结果顺序；不重新聚合，也不插补缺失值</span>
    </div></div>
    <div ref={ref} className="exploration-chart" role="img" aria-label="查询结果图表。悬停查看对应行与数值；完整数据以下方结果表为准。" />
    <p className="viz-footer">{rows.length > 24 ? '按住 Ctrl 并滚轮缩放，拖动图表可平移。' : ''}图表只重绘本次 SQL 返回的行，不新增统计；要回查记录，请在 SQL 中选择 <code>_record</code>。</p>
  </div>
}
