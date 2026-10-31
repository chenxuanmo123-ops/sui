import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart, HeatmapChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent, AriaComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { ExploreResult } from './analytics'
import { formatNumber } from './data'
import { CHART_ACCENT, CHART_ACCENT_BRIGHT, CHART_GRID, CHART_INK, CHART_TOOLTIP_BG, CHART_TOOLTIP_BORDER, CHART_TOOLTIP_TEXT, CHART_VALUE, HEAT_RAMP_NEGATIVE, HEAT_RAMP_POSITIVE, PIE_COLORS } from './chart-palette'
import { useLabels } from './labels'
echarts.use([BarChart,LineChart,ScatterChart,HeatmapChart,PieChart,GridComponent,TooltipComponent,VisualMapComponent,DataZoomComponent,AriaComponent,SVGRenderer])
export default function ExplorationChart({result,onSelect,selected=null}:{result:ExploreResult;onSelect:(index:number)=>void;selected?:number|null}) {
 const ref=useRef<HTMLDivElement>(null),instance=useRef<echarts.ECharts|null>(null),callback=useRef(onSelect);callback.current=onSelect
 const [horizontal,setHorizontal]=useState(result.spec.kind==='bar'),[labels,setLabels]=useState(result.rows.length<=12)
 const names=useLabels()
 // A pie cannot show negative or all-zero parts: shares would be undefined.
 const pieValues=result.spec.kind==='pie'?result.rows.map(r=>Number(r.at(-1))):[]
 const pieBlocked=result.spec.kind==='pie'&&(pieValues.some(v=>!Number.isFinite(v)||v<0)||pieValues.reduce((a,b)=>a+b,0)<=0)
 useEffect(()=>{
  if(!ref.current)return
  const chart=echarts.init(ref.current,undefined,{renderer:'svg'});instance.current=chart
  const kind=result.spec.kind,heat=kind==='heatmap',scatter=kind==='scatter',pie=kind==='pie',sideways=kind==='bar'&&horizontal
  const xs=[...new Set(result.rows.map(r=>String(r[0])))],ys=[...new Set(result.rows.map(r=>String(r[1])))],values=result.rows.map(r=>Number(r.at(-1)))
  const zoom=!heat&&!pie&&result.rows.length>12
  const text={color:CHART_INK,fontSize:11,fontFamily:'sans-serif'}
  const valueLabel={color:CHART_VALUE,fontSize:11,fontFamily:'sans-serif',fontWeight:600 as const}
  // Display names only: series data, indices and values stay exactly as computed.
  const colName=(c:string)=>{const i=c.indexOf(' · ');return i>0?c.slice(0,i)+' · '+names.field(c.slice(i+3)):names.field(c)}
  const groupValue=(field:string,v:unknown)=>names.value(field,String(v??''))
  const catLabel=(field:string)=>({...text,hideOverlap:true,overflow:'truncate' as const,width:sideways?135:85,formatter:(v:string)=>groupValue(field,v)})
  const category={type:'category' as const,data:xs,axisTick:{show:false},axisLine:{show:false},axisLabel:catLabel(result.spec.x)}
  const categoryY={type:'category' as const,data:ys,axisTick:{show:false},axisLine:{show:false},axisLabel:catLabel(result.spec.y)}
  const numeric={type:'value' as const,scale:scatter,axisLine:{show:false},axisTick:{show:false},axisLabel:{...text,formatter:(v:number)=>formatNumber(v,2)},splitLine:{lineStyle:{color:CHART_GRID,type:'dashed' as const}}}
  // Draw the marks in rather than snapping them onto the plate. Large results
  // skip it so a 400-row bar chart does not animate for a second, and reduced
  // motion keeps the chart static.
  const animate=result.rows.length<=240&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches
  chart.setOption({animation:animate,animationDuration:520,animationEasing:'cubicOut',animationDelay:(idx:number)=>Math.min(idx*14,240),color:pie?PIE_COLORS:[CHART_ACCENT],textStyle:{fontFamily:'sans-serif'},aria:{enabled:true},
   tooltip:{trigger:'item',renderMode:'richText',confine:true,backgroundColor:CHART_TOOLTIP_BG,borderColor:CHART_TOOLTIP_BORDER,textStyle:{color:CHART_TOOLTIP_TEXT,fontSize:12},padding:14,formatter:(params:unknown)=>{
    const p=params as {dataIndex:number},row=result.rows[p.dataIndex];if(!row)return ''
    return row.map((v,i)=>{const col=result.columns[i];const isGroup=col===result.spec.x||col===result.spec.y;return colName(col)+'：'+(typeof v==='number'?formatNumber(v,8):isGroup?groupValue(col,v):String(v??'（空）'))}).join('\n')+'\n来源记录：'+result.rowIds[p.dataIndex].length+' 条\n点击图形核查来源'
   }},
   ...(pie?{}:{grid:{left:sideways?154:80,right:sideways?82:32,top:38,bottom:heat?100:zoom?86:66},
   xAxis:sideways?{...numeric,name:colName(result.columns[1]),nameLocation:'middle',nameGap:32}:scatter?{...numeric,name:colName(result.columns[0]),nameLocation:'middle',nameGap:36}:{...category,name:colName(result.columns[0]),nameLocation:'middle',nameGap:36},
   yAxis:sideways?{...category,inverse:true}:heat?{...categoryY,name:colName(result.columns[1]),nameGap:18}: {...numeric,name:colName(result.columns[1]),nameGap:20}}),
   ...(heat?{visualMap:{min:Math.min(0,...values),max:Math.max(...values)||1,calculable:true,orient:'horizontal',left:'center',bottom:10,itemWidth:12,textStyle:text,inRange:{color:Math.min(...values)<0?HEAT_RAMP_NEGATIVE:HEAT_RAMP_POSITIVE}}}:{}),
   ...(zoom?{dataZoom:[{type:'slider',...(sideways?{yAxisIndex:0,right:10,width:14,top:40,bottom:65}:{xAxisIndex:0,bottom:8,height:16}),start:0,end:scatter?100:Math.min(100,12/result.rows.length*100),filterMode:'none',borderColor:'rgba(125,211,252,.32)',fillerColor:'rgba(45,212,191,.14)',handleStyle:{color:CHART_ACCENT},textStyle:text},{type:'inside',...(sideways?{yAxisIndex:0}:{xAxisIndex:0}),filterMode:'none',zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false}]}:{}),
   series:[pie?{type:'pie',radius:['42%','74%'],center:['50%','50%'],data:result.rows.map(r=>({name:groupValue(result.spec.x,String(r[0])),value:Number(r[1])})),label:{show:labels,color:CHART_VALUE,fontSize:11,formatter:(p:{name:string;percent:number})=>p.name+' '+formatNumber(p.percent,1)+'%'},labelLine:{lineStyle:{color:'rgba(148,197,255,.5)'}},itemStyle:{borderColor:'#0b1018',borderWidth:2},emphasis:{label:{show:true}}}:{type:kind,data:scatter?result.rows.map(r=>[r[0],r[1]]):heat?result.rows.map(r=>[xs.indexOf(String(r[0])),ys.indexOf(String(r[1])),r[2]]):result.rows.map(r=>r[1]),symbolSize:scatter?9:7,barMaxWidth:26,
    ...(kind==='bar'?{itemStyle:{borderRadius:sideways?[0,3,3,0]:[3,3,0,0]},label:{show:labels,position:sideways?'right':'top',...valueLabel,formatter:(p:{value:unknown})=>formatNumber(Number(p.value),2)}}:{}),
    ...(kind==='line'?{lineStyle:{width:2.5},symbol:'circle',label:{show:labels,position:'top',...valueLabel},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(45,212,191,.24)'},{offset:.12,color:'rgba(45,212,191,.03)'},{offset:.3,color:'rgba(45,212,191,0)'},{offset:1,color:'rgba(45,212,191,0)'}]},opacity:1}}:{}),
    ...(scatter?{itemStyle:{opacity:.8,borderColor:'#0b1018',borderWidth:1}}:{}),
    ...(heat?{label:{show:labels,color:CHART_VALUE,fontSize:11},itemStyle:{borderColor:'#0b1018',borderWidth:2}}:{}),
    emphasis:{itemStyle:{color:heat?undefined:CHART_ACCENT_BRIGHT,borderColor:CHART_ACCENT_BRIGHT,borderWidth:1},focus:'none'}
   }]
  })
  chart.on('click',params=>{if(typeof params.dataIndex==='number')callback.current(params.dataIndex)})
  const observer=new ResizeObserver(()=>chart.resize());observer.observe(ref.current)
  return ()=>{observer.disconnect();instance.current=null;chart.dispose()}
 },[result,horizontal,labels,names])
 useEffect(()=>{const chart=instance.current;if(!chart)return;chart.dispatchAction({type:'downplay',seriesIndex:0});if(selected!==null)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected})},[selected,result,horizontal,labels])
 return <div className="exploration-viz"><div className="viz-toolbar"><div className="viz-controls">{result.spec.kind==='bar'&&<label><select aria-label="探索图表方向" value={horizontal?'horizontal':'vertical'} onChange={e=>setHorizontal(e.target.value==='horizontal')}><option value="horizontal">横向条形</option><option value="vertical">纵向柱形</option></select></label>}{result.spec.kind!=='scatter'&&<label className="viz-check"><input type="checkbox" checked={labels} onChange={e=>setLabels(e.target.checked)}/>数值标签</label>}<span className="viz-order-note">{result.spec.kind==='scatter'?'每个点对应原始记录，不拟合因果关系':result.spec.kind==='heatmap'?'空白组合未返回数据，不按 0 补齐':result.spec.kind==='pie'?'占比按当前筛选下各分组值计算，范围外记录不计入':'按已执行 SQL 顺序显示'}</span></div><button className="icon-button" aria-label="重置探索图表缩放" title="重置缩放" onClick={()=>instance.current?.dispatchAction({type:'dataZoom',start:0,end:100})}><RotateCcw size={14}/></button></div>{pieBlocked?<p className="core-warning" role="status">当前分组结果包含负数或全部为 0，占比无法定义，因此不绘制饼图。请改用柱状图，或检查汇总口径与单位。</p>:<div ref={ref} className="exploration-chart" role="img" aria-label="探索图表。悬停查看完整数值，点击图形核查来源；也可使用下方结果表。"/>}<p className="viz-footer">{result.rows.length>12&&result.spec.kind!=='heatmap'&&result.spec.kind!=='pie'?'拖动缩放条浏览；按住 Ctrl 并滚轮缩放。':''} 点击图形与下方来源记录联动。{result.truncated?'查询存在未展示结果，请结合展示上限理解。':''}</p></div>
}
