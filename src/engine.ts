import type { Analysis, AnalysisScope, Dataset, Mapping } from './data'
import type { ExploreResult, ExploreSpec, ComparisonSpec, ComparisonResult } from './analytics'
let worker: Worker | undefined, sequence=0
let queue: Promise<unknown> = Promise.resolve()
function request<T>(payload: object): Promise<T> {
 const work = queue.catch(()=>{}).then(()=>new Promise<T>((resolve,reject)=>{
  worker ??= new Worker(new URL('./engine.worker.ts',import.meta.url),{type:'module'})
  const current=worker,id=++sequence
  const cleanup=()=>{clearTimeout(timer);current.removeEventListener('message',message);current.removeEventListener('error',error)}
  const fail=(reason:string)=>{cleanup();current.terminate();if(worker===current)worker=undefined;reject(new Error(reason))}
  const message=(e:MessageEvent)=>{if(e.data.id!==id)return;cleanup();if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.result as T)}
  const error=()=>fail('SQL 引擎启动失败，请刷新后重试。')
  const timer=setTimeout(()=>fail('SQL 查询超过 30 秒，已终止独立计算线程；请缩小数据范围。'),30000)
  current.addEventListener('message',message);current.addEventListener('error',error);current.postMessage({...payload,id})
 }))
 queue=work;return work
}
export const aggregateDataset=(dataset:Dataset,mapping:Mapping,question:string,analysisId:number,scope?:AnalysisScope)=>request<Analysis>({type:'aggregate',dataset,mapping,question,analysisId,scope})
export const exploreDataset=(dataset:Dataset,spec:ExploreSpec)=>request<ExploreResult>({type:'explore',dataset,spec})

export const compareDataset=(dataset:Dataset,spec:ComparisonSpec)=>request<ComparisonResult>({type:"compare",dataset,spec})
