import { useEffect, useId, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpDown, Maximize2, RotateCcw, X } from 'lucide-react'
import type { Point } from './data'
import { download, formatNumber } from './data'
import { chartDomain, chartScale, orderPoints, tickPrecision } from './chart-model'
import type { ChartReference, ChartSort } from './chart-model'

type ChartDisplay = { orientation: 'horizontal'|'vertical'; sort: ChartSort; showValues: boolean; showReference: boolean; start: number }
type Props = { initialDisplay?: ChartDisplay; interaction?: 'evidence' | 'select'; compact?: boolean; chartId?: string; points: Point[]; metric: string; unit: string; kind: 'line' | 'bar'; selected: string; onSelect: (label: string) => void; reference?: ChartReference; exportMode?: boolean; detailView?: boolean }
export default function DataChart({ interaction = 'evidence', compact = false, chartId = 'analysis-svg', points, metric, unit, kind, selected, onSelect, reference, exportMode = false, detailView = false, initialDisplay }: Props) {
  const gradient = useId().replace(/:/g, '')
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotWidthPixels,setPlotWidthPixels] = useState(0)
  useEffect(()=>{
    if(exportMode || !plotRef.current)return
    const observer = new ResizeObserver(entries=>{
      const pixels=Math.round(entries[0]?.contentRect.width || 0)
      if(pixels>0)setPlotWidthPixels(pixels)
    })
    observer.observe(plotRef.current)
    return ()=>observer.disconnect()
  },[exportMode])
  const svgRef = useRef<SVGSVGElement>(null), dialogRef = useRef<HTMLDialogElement>(null), displayRef = useRef<HTMLDetailsElement>(null), expandButtonRef = useRef<HTMLButtonElement>(null)
  const [expanded,setExpanded] = useState(false)
  useEffect(()=>{if(expanded)dialogRef.current?.showModal()},[expanded])
  const [orientation,setOrientation] = useState<'horizontal'|'vertical'>(initialDisplay?.orientation??(compact?'horizontal':'vertical'))
  const [sort,setSort] = useState<ChartSort>(initialDisplay?.sort??'original'), [showValues,setShowValues] = useState(initialDisplay?.showValues??true), [showReference,setShowReference] = useState(initialDisplay?.showReference??true)
  const [start,setStart] = useState(initialDisplay?.start??0), [hovered,setHovered] = useState('')
  useEffect(()=>{
    if(exportMode)return
    const dismiss=(event:PointerEvent)=>{if(displayRef.current && !displayRef.current.contains(event.target as Node))displayRef.current.open=false}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape' && displayRef.current?.open){displayRef.current.open=false;displayRef.current.querySelector('summary')?.focus();event.preventDefault();event.stopPropagation()}}
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape,true)
    return ()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape,true)}
  },[exportMode])
  const ordered = orderPoints(points,kind==='line'?'original':sort)
  // A line chart is read as one continuous series. Paging it would make a
  // 24-month rise look like a rise-and-fall and contradict the fitted trend.
  const windowSize = exportMode||kind==='line'?points.length:12
  const offset = exportMode?0:Math.min(start,Math.max(0,Math.floor((ordered.length-1)/windowSize)*windowSize))
  const visible = ordered.slice(offset,offset+windowSize)
  const horizontal = kind==='bar' && orientation==='horizontal'
  const baseline = showReference && reference && Number.isFinite(reference.value)?reference:undefined
  // The domain always includes ALL groups. Paging must never rescale a comparison.
  const domain = chartDomain(points.map(p=>p.value),baseline?.value), scale = chartScale(domain)
  const width = exportMode ? (compact?640:760) : Math.max(360,plotWidthPixels || (compact?640:760))
  const height = horizontal ? Math.max(264,visible.length*38+82) : (compact?336:392)
  const left = horizontal?Math.min(204,Math.max(124,...visible.map(p=>p.label.length*7+22))):72
  const right = horizontal?96:28, top=30, bottom=horizontal?46:64
  const plotWidth=width-left-right, plotHeight=height-top-bottom, range=domain.max-domain.min || 1
  const valueX = (v:number)=>left+(v-domain.min)/range*plotWidth
  const valueY = (v:number)=>top+(domain.max-v)/range*plotHeight
  const categoryX = (i:number)=>left+(i+.5)/Math.max(1,visible.length)*plotWidth
  const categoryY = (i:number)=>top+(i+.5)/Math.max(1,visible.length)*plotHeight
  const barSize = Math.min(horizontal?23:44,(horizontal?plotHeight:plotWidth)/Math.max(1,visible.length)*.6)
  // Keep every point on the line but thin axis labels and value labels so a
  // long series stays readable. Hovering any point still shows its exact value.
  const labelStep = kind==='line'?Math.max(1,Math.ceil(visible.length/Math.max(6,Math.floor(plotWidth/96)))):1
  // The closing date is worth showing, but only if it will not sit on top of
  // the previous tick. A dense monthly axis drops it and keeps the hover label.
  const lastIndex = Math.max(0, visible.length - 1)
  const pointGap = plotWidth / Math.max(1, visible.length)
  const showLastTick = lastIndex % labelStep === 0 || (lastIndex % labelStep) * pointGap >= 64
  // Value labels need more room than month ticks; on a narrow screen they
  // thin out further so two numbers never sit on top of each other.
  const valueStep = kind==='line'?Math.max(labelStep,Math.ceil(visible.length/Math.max(1,Math.floor(plotWidth/64)))):1
  const showLastValue = lastIndex % valueStep === 0 || (lastIndex % valueStep) * pointGap >= 50
  const axisUnit = (unit || '单位未声明') + (scale.label?'（刻度：'+scale.label+'）':'')
  const precision = tickPrecision((domain.ticks[1]-domain.ticks[0])/scale.divisor)
  const line = visible.map((p,i)=>categoryX(i)+','+valueY(p.value)).join(' ')
  const activePoint = visible.find(p=>p.label===hovered && p.label!==selected)
  const activeIndex = activePoint ? visible.findIndex(p=>p.label===activePoint.label) : -1
  const tooltipOnLeft = activeIndex >= 0 && activeIndex > visible.length / 2
  useEffect(()=>{if(!selected||exportMode)return;const index=orderPoints(points,kind==='line'?'original':sort).findIndex(p=>p.label===selected);if(index>=0)setStart(prev=>index<prev||index>=prev+12?Math.floor(index/12)*12:prev)},[selected,points,sort,kind,exportMode])
  const shorten=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s
  const valueLabel=(v:number)=>formatNumber(v/scale.divisor,scale.divisor===1?2:3)+(scale.label||'')+(unit?' '+unit:'')
  function reset(){setSort('original');setOrientation(compact?'horizontal':'vertical');setShowValues(true);setShowReference(true);setStart(0);setHovered('')}
  function exportSVG(){if(svgRef.current)download(new XMLSerializer().serializeToString(svgRef.current),'image/svg+xml','数鉴-图表当前视图.svg')}
  return <div className={'analysis-viz'+(exportMode?' is-export':'')}>
    {!exportMode && <div className="viz-toolbar" aria-label="图表显示设置">
      <div className="viz-controls">{kind==='bar' && <><label><span className="sr-only">图表方向</span><select aria-label="图表方向" value={orientation} onChange={e=>setOrientation(e.target.value as typeof orientation)}><option value="horizontal">横向条形</option><option value="vertical">纵向柱形</option></select></label><label><ArrowUpDown size={13}/><select aria-label="图表排序" value={sort} onChange={e=>{setSort(e.target.value as ChartSort);setStart(0)}}><option value="original">原始顺序</option><option value="desc">数值从高到低</option><option value="asc">数值从低到高</option></select></label></>}{kind==='line'&&<span className="viz-order-note">保留计算顺序</span>}<details ref={displayRef} className="viz-display"><summary>显示设置</summary><div><label className="viz-check"><input type="checkbox" checked={showValues} onChange={e=>setShowValues(e.target.checked)}/>数值标签</label>{reference&&<label className="viz-check"><input type="checkbox" checked={showReference} onChange={e=>setShowReference(e.target.checked)}/>参考线</label>}</div></details></div>
      <div className="viz-actions">{!detailView&&<button ref={expandButtonRef} type="button" className="icon-button" title="放大查看图表" aria-label="放大查看图表" onClick={()=>{setHovered('');setExpanded(true)}}><Maximize2 size={15}/></button>}<button type="button" className="icon-button" title="重置图表显示" aria-label="重置图表显示" onClick={reset}><RotateCcw size={14}/></button><button type="button" className="icon-button" title="导出当前图表视图 SVG" aria-label="导出当前图表视图 SVG" onClick={exportSVG}><ArrowDownToLine size={15}/></button></div>
    </div>}
    <div className="viz-legend"><span><i/>{metric}</span>{baseline&&<span className="viz-reference-key"><i/>{baseline.label} {formatNumber(baseline.value,2)}{unit}</span>}</div>
    <div ref={plotRef} className="chart-scroll viz-plot" onMouseLeave={()=>setHovered('')}><svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" id={chartId} className="data-chart" style={exportMode?undefined:{height, minWidth:360}} viewBox={'0 0 '+width+' '+height} role="img" aria-label={metric+'，共 '+points.length+' 个分组，当前显示 '+visible.length+' 个，单位 '+(unit||'未声明')+'。可点击数据点'+(interaction==='select'?'选择分组并追问':'查看来源')+'，完整数值见结果表。'}>
      <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--viz-mark, #a15c00)" stopOpacity=".24"/><stop offset="10%" stopColor="var(--viz-mark, #a15c00)" stopOpacity=".03"/><stop offset="26%" stopColor="var(--viz-mark, #a15c00)" stopOpacity="0"/><stop offset="100%" stopColor="var(--viz-mark, #a15c00)" stopOpacity="0"/></linearGradient></defs>
      <text x={left} y={15} fontSize="11" fill="var(--viz-axis, #6b7280)">{axisUnit}</text>
      {domain.ticks.map(value=><g key={value}>{horizontal?<><line x1={valueX(value)} x2={valueX(value)} y1={top} y2={height-bottom} stroke="var(--viz-grid, #e5e7eb)" strokeDasharray="3 5"/><text x={valueX(value)} y={height-bottom+23} textAnchor="middle" fontSize="11" fill="var(--viz-axis, #6b7280)">{formatNumber(value/scale.divisor,precision)}</text></>:<><line x1={left} x2={width-right} y1={valueY(value)} y2={valueY(value)} stroke="var(--viz-grid, #e5e7eb)" strokeDasharray="3 5"/><text x={left-12} y={valueY(value)+4} textAnchor="end" fontSize="11" fill="var(--viz-axis, #6b7280)">{formatNumber(value/scale.divisor,precision)}</text></>}</g>)}
      {kind==='line' && visible.length>0 && <><polygon points={categoryX(0)+','+valueY(0)+' '+line+' '+categoryX(visible.length-1)+','+valueY(0)} fill={'url(#'+gradient+')'}/><polyline points={line} fill="none" stroke="var(--viz-mark, #a15c00)" strokeWidth="2.6" strokeLinejoin="round"/></>}
      {visible.map((p,i)=>{const isActive=p.label===selected||p.label===hovered,color=p.label===selected?'var(--viz-mark-active, #1d4ed8)':'var(--viz-mark, #a15c00)',cx=categoryX(i),cy=categoryY(i),vx=valueX(p.value),vy=valueY(p.value),showTick=horizontal||i%labelStep===0||(i===lastIndex&&showLastTick);return <g key={p.label}>
        {horizontal && isActive && <rect x="4" y={cy-17} width={width-8} height="34" fill="var(--viz-band, #f3f4f6)" rx="5"/>}
        {kind==='bar' && <rect x={horizontal?Math.min(valueX(0),vx):cx-barSize/2} y={horizontal?cy-barSize/2:Math.min(valueY(0),vy)} width={horizontal?Math.max(1,Math.abs(vx-valueX(0))):barSize} height={horizontal?barSize:Math.max(1,Math.abs(vy-valueY(0)))} rx="3" fill={color} opacity={hovered && !isActive ? .62 : 1}/>}
        {kind==='line' && <circle cx={cx} cy={vy} r={isActive?6.5:4.5} fill={color} stroke="var(--viz-point-ring, #fff)" strokeWidth="2.2"/>}
        {showTick && (horizontal?<text x={left-13} y={cy+4} textAnchor="end" fontSize="12" fontWeight={isActive?600:400} fill={isActive?'var(--viz-tick-active, #111827)':'var(--viz-tick, #6b7280)'}><title>{p.label}</title>{shorten(p.label,26)}</text>:<text x={cx} y={height-bottom+25} textAnchor="middle" fontSize="11" fill="var(--viz-tick, #6b7280)"><title>{p.label}</title>{shorten(p.label,Math.max(5,Math.min(16,Math.floor(plotWidth/Math.max(1,Math.ceil(visible.length/labelStep))/7))))}</text>)}
        {showValues && (horizontal || i%valueStep===0 || (i===lastIndex&&showLastValue)) && <text x={horizontal?width-8:cx} y={horizontal?cy+4:vy+(p.value<0?17:-10)} textAnchor={horizontal?'end':'middle'} fontSize="11" fontWeight="600" fill="var(--viz-value, #1f2937)">{valueLabel(p.value)}</text>}
        <rect className="chart-hit" x={horizontal?4:cx-plotWidth/Math.max(1,visible.length)/2} y={horizontal?cy-17:top} width={horizontal?width-8:plotWidth/Math.max(1,visible.length)} height={horizontal?34:plotHeight+bottom-8} fill="transparent" role="button" tabIndex={exportMode?-1:0} aria-label={p.label+'：'+formatNumber(p.value,4)+' '+unit+'，'+(interaction==='select'?'选择此分组':'查看 '+p.rowIds.length+' 条来源记录')} aria-pressed={selected===p.label} onMouseEnter={()=>setHovered(p.label)} onFocus={()=>setHovered(p.label)} onBlur={()=>setHovered('')} onClick={()=>{setHovered('');onSelect(p.label)}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(p.label)}if(e.key==='Escape')setHovered('')}}><title>{p.label+': '+formatNumber(p.value,4)+' '+unit}</title></rect>
      </g>})}
      {baseline && <g className="chart-reference" pointerEvents="none">{horizontal?<line x1={valueX(baseline.value)} x2={valueX(baseline.value)} y1={top-2} y2={height-bottom} stroke="var(--viz-reference, #c0392b)" strokeDasharray="6 4" strokeWidth="1.5"/>:<line x1={left} x2={width-right} y1={valueY(baseline.value)} y2={valueY(baseline.value)} stroke="var(--viz-reference, #c0392b)" strokeDasharray="6 4" strokeWidth="1.5"/>}<title>{baseline.label+' '+formatNumber(baseline.value,4)+unit}</title></g>}
    </svg>
    {!exportMode && activePoint && <div className="viz-tooltip" role="status" style={tooltipOnLeft?{left:10,right:'auto'}:undefined}><strong>{activePoint.label}</strong><dl><div><dt>{metric}</dt><dd>{formatNumber(activePoint.value,4)} {unit}</dd></div>{activePoint.rate&&<><div><dt>分子 / 分母</dt><dd>{formatNumber(activePoint.rate.numerator,0)} / {formatNumber(activePoint.rate.denominator,0)}</dd></div><div><dt>未知或缺失</dt><dd>{activePoint.rate.excluded} 条</dd></div></>}<div><dt>匹配记录</dt><dd>{formatNumber(activePoint.scopeRowIds?.length??activePoint.rowIds.length,0)} 条</dd></div>{baseline&&<div><dt>较{baseline.label}</dt><dd>{activePoint.value>baseline.value?'+':''}{formatNumber(activePoint.value-baseline.value,2)}{activePoint.rate?' 个百分点':' '+unit}</dd></div>}</dl><span>{interaction==='select'?'点击选中，继续追问或核查来源':'点击核查来源记录'}</span></div>}
    </div>
    {!exportMode && <div className="viz-footer"><span>{points.length>windowSize?'显示第 '+(offset+1)+'–'+(offset+visible.length)+' / '+points.length+' 个分组；坐标范围覆盖全部分组':'全部 '+points.length+' 个分组 · 完整数值见结果表'}</span>{points.length>windowSize && <div className="viz-paging"><button type="button" disabled={offset===0} onClick={()=>{setStart(Math.max(0,offset-windowSize));setHovered('')}}>上一段</button><button type="button" disabled={offset+windowSize>=points.length} onClick={()=>{setStart(offset+windowSize);setHovered('')}}>下一段</button></div>}</div>}
    {!exportMode && !detailView && expanded && <dialog ref={dialogRef} className="viz-dialog" aria-label="放大图表" onClose={()=>{setExpanded(false);expandButtonRef.current?.focus()}} onClick={e=>{if(e.target===e.currentTarget)dialogRef.current?.close()}}><header><div><h3>{metric}</h3><p>悬停核对数值，点击分组后返回工作台继续分析。</p></div><button type="button" className="icon-button" aria-label="关闭放大图表" onClick={()=>dialogRef.current?.close()}><X size={20}/></button></header><DataChart detailView compact initialDisplay={{orientation,sort,showValues,showReference,start:offset}} chartId={chartId+'-expanded'} points={points} metric={metric} unit={unit} kind={kind} selected={selected} reference={reference} interaction={interaction} onSelect={label=>{onSelect(label);dialogRef.current?.close()}}/></dialog>}
  </div>
}
