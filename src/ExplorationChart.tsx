import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart, HeatmapChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent, AriaComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { ExploreResult } from './analytics'
import { formatNumber } from './data'
echarts.use([BarChart,LineChart,ScatterChart,HeatmapChart,GridComponent,TooltipComponent,VisualMapComponent,DataZoomComponent,AriaComponent,SVGRenderer])
export default function ExplorationChart({result,onSelect,selected=null}:{result:ExploreResult;onSelect:(index:number)=>void;selected?:number|null}) {
 const ref=useRef<HTMLDivElement>(null),instance=useRef<echarts.ECharts|null>(null),callback=useRef(onSelect);callback.current=onSelect
 const [horizontal,setHorizontal]=useState(result.spec.kind==='bar'),[labels,setLabels]=useState(result.rows.length<=12)
 useEffect(()=>{
  if(!ref.current)return
  const chart=echarts.init(ref.current,undefined,{renderer:'svg'});instance.current=chart
  const kind=result.spec.kind,heat=kind==='heatmap',scatter=kind==='scatter',sideways=kind==='bar'&&horizontal
  const xs=[...new Set(result.rows.map(r=>String(r[0])))],ys=[...new Set(result.rows.map(r=>String(r[1])))],values=result.rows.map(r=>Number(r.at(-1)))
  const zoom=!heat&&result.rows.length>12
  const text={color:'#63758c',fontSize:11,fontFamily:'sans-serif'}
  const category={type:'category' as const,data:xs,axisTick:{show:false},axisLine:{show:false},axisLabel:{...text,hideOverlap:true,overflow:'truncate' as const,width:sideways?135:85}}
  const numeric={type:'value' as const,scale:scatter,axisLine:{show:false},axisTick:{show:false},axisLabel:{...text,formatter:(v:number)=>formatNumber(v,2)},splitLine:{lineStyle:{color:'#e6edf5',type:'dashed' as const}}}
  chart.setOption({animation:false,color:['#3971e8'],textStyle:{fontFamily:'sans-serif'},aria:{enabled:true},
   tooltip:{trigger:'item',renderMode:'richText',confine:true,backgroundColor:'#fff',borderColor:'#d5dfec',textStyle:{color:'#172d4e',fontSize:12},padding:14,formatter:(params:unknown)=>{
    const p=params as {dataIndex:number},row=result.rows[p.dataIndex];if(!row)return ''
    return row.map((v,i)=>result.columns[i]+'：'+(typeof v==='number'?formatNumber(v,8):String(v??'（空）'))).join('\n')+'\n来源记录：'+result.rowIds[p.dataIndex].length+' 条\n点击图形核查来源'
   }},
   grid:{left:sideways?154:80,right:sideways?82:32,top:38,bottom:heat?100:zoom?86:66},
   xAxis:sideways?{...numeric,name:result.columns[1],nameLocation:'middle',nameGap:32}:scatter?{...numeric,name:result.columns[0],nameLocation:'middle',nameGap:36}:{...category,name:result.columns[0],nameLocation:'middle',nameGap:36},
   yAxis:sideways?{...category,inverse:true}:heat?{...category,data:ys,name:result.columns[1],nameGap:18}: {...numeric,name:result.columns[1],nameGap:20},
   ...(heat?{visualMap:{min:Math.min(0,...values),max:Math.max(...values)||1,calculable:true,orient:'horizontal',left:'center',bottom:10,itemWidth:12,textStyle:text,inRange:{color:Math.min(...values)<0?['#b26c39','#f1f4f8','#3971e8']:['#eef4ff','#b4cdfa','#3971e8','#173b87']}}}:{}),
   ...(zoom?{dataZoom:[{type:'slider',...(sideways?{yAxisIndex:0,right:10,width:14,top:40,bottom:65}:{xAxisIndex:0,bottom:8,height:16}),start:0,end:scatter?100:Math.min(100,12/result.rows.length*100),filterMode:'none',borderColor:'#e0e8f2',fillerColor:'#3971e81a',handleStyle:{color:'#3971e8'},textStyle:text},{type:'inside',...(sideways?{yAxisIndex:0}:{xAxisIndex:0}),filterMode:'none',zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false}]}:{}),
   series:[{type:kind,data:scatter?result.rows.map(r=>[r[0],r[1]]):heat?result.rows.map(r=>[xs.indexOf(String(r[0])),ys.indexOf(String(r[1])),r[2]]):result.rows.map(r=>r[1]),symbolSize:scatter?9:7,barMaxWidth:26,
    ...(kind==='bar'?{itemStyle:{borderRadius:sideways?[0,3,3,0]:[3,3,0,0]},label:{show:labels,position:sideways?'right':'top',fontSize:11,color:'#294468',formatter:(p:{value:unknown})=>formatNumber(Number(p.value),2)}}:{}),
    ...(kind==='line'?{lineStyle:{width:2.5},symbol:'circle',label:{show:labels,position:'top',fontSize:11,color:'#294468'},areaStyle:{color:'#3971e8',opacity:.06}}:{}),
    ...(scatter?{itemStyle:{opacity:.68,borderColor:'#fff',borderWidth:1}}:{}),
    ...(heat?{label:{show:labels,color:'#172d4e',fontSize:11},itemStyle:{borderColor:'#fff',borderWidth:2}}:{}),
    emphasis:{itemStyle:{color:heat?undefined:'#172d4e',borderColor:'#172d4e',borderWidth:1},focus:'none'}
   }]
  })
  chart.on('click',params=>{if(typeof params.dataIndex==='number')callback.current(params.dataIndex)})
  const observer=new ResizeObserver(()=>chart.resize());observer.observe(ref.current)
  return ()=>{observer.disconnect();instance.current=null;chart.dispose()}
 },[result,horizontal,labels])
 useEffect(()=>{const chart=instance.current;if(!chart)return;chart.dispatchAction({type:'downplay',seriesIndex:0});if(selected!==null)chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:selected})},[selected,result,horizontal,labels])
 return <div className="exploration-viz"><div className="viz-toolbar"><div className="viz-controls">{result.spec.kind==='bar'&&<label><select aria-label="探索图表方向" value={horizontal?'horizontal':'vertical'} onChange={e=>setHorizontal(e.target.value==='horizontal')}><option value="horizontal">横向条形</option><option value="vertical">纵向柱形</option></select></label>}{result.spec.kind!=='scatter'&&<label className="viz-check"><input type="checkbox" checked={labels} onChange={e=>setLabels(e.target.checked)}/>数值标签</label>}<span className="viz-order-note">{result.spec.kind==='scatter'?'每个点对应原始记录，不拟合因果关系':result.spec.kind==='heatmap'?'空白组合未返回数据，不按 0 补齐':'按已执行 SQL 顺序显示'}</span></div><button className="icon-button" aria-label="重置探索图表缩放" title="重置缩放" onClick={()=>instance.current?.dispatchAction({type:'dataZoom',start:0,end:100})}><RotateCcw size={14}/></button></div><div ref={ref} className="exploration-chart" role="img" aria-label="探索图表。悬停查看完整数值，点击图形核查来源；也可使用下方结果表。"/><p className="viz-footer">{result.rows.length>12&&result.spec.kind!=='heatmap'?'拖动缩放条浏览；按住 Ctrl 并滚轮缩放。':''} 点击图形与下方来源记录联动。{result.truncated?'查询存在未展示结果，请结合展示上限理解。':''}</p></div>
}
