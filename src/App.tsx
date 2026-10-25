import AnalysisStart from './AnalysisStart'
import FieldShelf from './FieldShelf'
import { createFollowUpScope } from './follow-up'
import { bundleKey, readWorkspace, saveWorkspace, clearWorkspace } from './workspace'
import type { WorkspaceState, WorkspaceView } from './workspace'
import type { AssistantSeed } from './follow-up'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { AlertCircle, ArrowDownToLine, ArrowUpRight, BarChart3, Check, ChevronRight, CircleHelp, Database, FileSpreadsheet, GitBranch, Layers3, ListChecks, LoaderCircle, MessageSquareText, Plus, RefreshCcw, Search, Settings2, ShieldCheck, Table2, Upload, X } from 'lucide-react'
import DataChart from './DataChart'
import { SourceSummary, SourceDetails, SourceEditor } from './DatasetSource'
import { sourceHTML, sourceInfo } from './provenance'
import { fileHash } from './importers'
import { AnalysisResults } from './AnalysisResults'
import type { AnalysisBundle } from './AnalysisResults'
import PreparationView from './PreparationView'
import ExploreView from './ExploreView'
import type { ExploreSession } from './ExploreView'
import SqlConsole from './SqlConsole'
import type { ExtraTable } from './sql-console'
import type { CompareSession } from './CompareView'
import CompareView from './CompareView'
import { buildBundle, workspaceReproResult } from './reproducible'
import './core.css'
import AiWorkbench from './AiWorkbench'
import AssistantWindow from './AssistantWindow'
import InitialAnalysis from './InitialAnalysis'
import ImportDialog from './ImportDialog'
import WorkspaceWelcome from './WorkspaceWelcome'
import ModelManager from './ModelManager'
import { useModelProfiles } from './models'
import { executePlan } from './ai'
import type { ExecutionOptions, PlanExecution } from './ai'
import type { PlanResponse } from './ai'
import { aggregateNames, analyze, decodeTextBytes, defaultMapping, detectDelimiter, download, escapeHTML, fingerprint, formatNumber, initialQuestion, normalizeUnit, parseCSV, parsePublicQuestion, profileDataset, PUBLIC_DATA_URL, PUBLIC_SOURCE_URL, withDeclaredUnit } from './data'
import type { Analysis, Dataset, Mapping } from './data'
import { queryResultRows, sortResultRows } from './result-rows'
import type { ResultSort } from './result-rows'
import type { ExploreSpec } from './analytics'
import { exploreDataset } from './engine'
import type { CheckupOverrides, CheckupQuestion } from './checkup'
import { useCheckup } from './useCheckup'
import FieldRoles from './FieldRoles'
import InsightBrief from './InsightBrief'
import NextCuts from './NextCuts'
import { UnitDeclaration } from './UnitDeclaration'

type View = WorkspaceView
type Chat = { text: string; answer: string; run?: number }
type ReplaceRequest = { kind: 'file'; file: File } | { kind: 'public' } | { kind: 'dataset'; dataset: Dataset }
const blankMapping: Mapping = { x: '', metric: '', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum' }
const metricNames: Record<string, string> = { renewables_electricity: '可再生能源发电量', solar_electricity: '太阳能发电量', wind_electricity: '风能发电量' }

function PDFSourcePage({ image, onClose }: { image: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return <dialog ref={ref} className="page-overlay" aria-label="PDF 原始页" onCancel={onClose} onClose={onClose}><button className="secondary" autoFocus onClick={onClose}><X size={17} />关闭原页</button><img src={image} alt="当前分析数据的 PDF 来源原页" /></dialog>
}

export default function App() {
  const models = useModelProfiles()
  const [workspaceReady,setWorkspaceReady]=useState(false)
  const [allowAutoInspection,setAllowAutoInspection]=useState(true)
  const [saveRetry,setSaveRetry]=useState(0)
  const [storageBlocked,setStorageBlocked]=useState(false)
  const [storageError,setStorageError]=useState('')
  const [saveState,setSaveState]=useState<'empty'|'pending'|'saving'|'saved'|'error'>('empty')
  const [savedAt,setSavedAt]=useState('')
  const [showClear,setShowClear]=useState(false)
  const [clearing,setClearing]=useState(false)
  const clearRef=useRef<HTMLDialogElement>(null)
  const clearInProgress=useRef(false)
  const saveRevision=useRef(0)
  const cancelPendingSave=useRef<()=>void>(()=>{})
  const [exploreSession,setExploreSession]=useState<ExploreSession|null>(null)
  const [compareSession,setCompareSession]=useState<CompareSession|null>(null)
  // Session-only JOIN table for the SQL console; deliberately not persisted.
  const [consoleTable,setConsoleTable]=useState<ExtraTable|null>(null)
  const [showModels, setShowModels] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [showPage, setShowPage] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantSeed, setAssistantSeed] = useState<AssistantSeed>()
  const [preparationHistory, setPreparationHistory] = useState<Dataset[]>([])
  const [fieldRoles, setFieldRoles] = useState<CheckupOverrides>({})
  const [rolesOpen, setRolesOpen] = useState(false)
  const [runningQuestion, setRunningQuestion] = useState<string | null>(null)
  const [questionError, setQuestionError] = useState<{ id: string; message: string } | null>(null)
  const [pendingReplace, setPendingReplace] = useState<ReplaceRequest | null>(null)
  const replaceRef = useRef<HTMLDialogElement>(null)
  const datasetRef = useRef<Dataset | null>(null)
  const [computing, setComputing] = useState(false)
  const computeLock = useRef(false)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mapping, setMapping] = useState<Mapping>(blankMapping)
  const [question, setQuestion] = useState(initialQuestion)
  const [inspectorOpen,setInspectorOpen]=useState(false)
  const [bundle,setBundle]=useState<AnalysisBundle|null>(null)
  const [bundleHistory,setBundleHistory]=useState<AnalysisBundle[]>([])
  const bundleRegistry=useRef(new Map<string,AnalysisBundle>())
  const [history, setHistory] = useState<Analysis[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [view, setView] = useState<View>('workspace')
  const [workspaceSection, setWorkspaceSection] = useState<'analysis' | 'data' | 'evidence'>('analysis')
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [analysisDraft, setAnalysisDraft] = useState('')
  const [dataTab, setDataTab] = useState<'fields' | 'raw' | 'result'>('fields')
  const [evidenceTab, setEvidenceTab] = useState<'method' | 'rows'>('method')
  const [selectedPoint, setSelectedPoint] = useState('')
  const [chartKind, setChartKind] = useState<'line' | 'bar'>('line')
  const [fieldSearch, setFieldSearch] = useState('')
  const [resultQuery, setResultQuery] = useState('')
  const [resultSort, setResultSort] = useState<ResultSort>('original')
  const [chatInput, setChatInput] = useState('')
  const [chat, setChat] = useState<Chat[]>([])
  const [showHelp, setShowHelp] = useState(false)
  const helpRef = useRef<HTMLDialogElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const profiles = useMemo(() => dataset ? profileDataset(dataset) : [], [dataset])
  const { checkup, error: checkupError } = useCheckup(dataset, fieldRoles)
  const numericFields = useMemo(() => profiles.filter(p => p.kind === '数值' || (p.nonempty > 0 && p.numeric / p.nonempty >= .9)), [profiles])
  const active = history.find(h => h.id === activeId) ?? null
  const filterValues = useMemo(() => dataset && mapping.filter ? [...new Set(dataset.rows.map(r => r[mapping.filter]).filter((v): v is string => v !== null))].sort((a, b) => a.localeCompare(b, 'zh-CN')).slice(0, 500) : [], [dataset, mapping.filter])
  const resultRows = useMemo(() => active ? sortResultRows(queryResultRows(active.points, resultQuery), resultSort) : [], [active, resultQuery, resultSort])
  const scopedRowIds = active?.points.find(p => p.label === selectedPoint)?.rowIds ?? active?.points.flatMap(p => p.rowIds) ?? []
  const displayMetric = active ? (active.ai ? active.ai.taskTitle : dataset?.isPublic ? metricNames[active.mapping.metric] ?? active.mapping.metric : active.mapping.rate ? '按 '+active.mapping.x+' 分组的 '+active.mapping.metric+' = '+active.mapping.rate.successValue+' 比例' : active.mapping.aggregate==='count' ? '按 '+active.mapping.x+' 分组的记录数' : active.mapping.metric) : '等待生成分析结果'
  const pending = Boolean(active && JSON.stringify(active.mapping) !== JSON.stringify(mapping))

  useEffect(() => {
    let cancelled=false
    readWorkspace().then(snapshot=>{
      if(cancelled)return
      if(snapshot){
        const s=snapshot.state
        setAllowAutoInspection(false)
        datasetRef.current=s.dataset;setDataset(s.dataset);setAssistantOpen(false);setPreparationHistory(s.preparationHistory);setFieldRoles(s.fieldRoles??{})
        setHistory(s.history);setActiveId(s.activeId);setMapping(s.mapping);setQuestion(s.question)
        setBundleHistory(s.bundles);bundleRegistry.current=new Map(s.bundles.map(item=>[bundleKey(item),item]))
        setBundle(s.bundles.find(item=>bundleKey(item)===s.currentBundleKey)||null)
        setChartKind(s.chartKind);setView(s.view);setDataTab(s.dataTab);setInspectorOpen(s.inspectorOpen)
        setExploreSession(s.exploreSession);setCompareSession(s.compareSession)
        setSavedAt(snapshot.savedAt);setSaveState('saved')
        setNotice('已恢复本机数据与 '+s.history.length+' 项计算；未重新调用 AI。未提交的助手草稿和运行中任务不恢复。')
      }
    }).catch(e=>{if(!cancelled){setStorageError(e instanceof Error?e.message:'本机工作区恢复失败。');setStorageBlocked(true);setSaveState('error')}}).finally(()=>{if(!cancelled)setWorkspaceReady(true)})
    return()=>{cancelled=true}
  },[])
  const workspaceState=useMemo<WorkspaceState|null>(()=>dataset?({dataset,preparationHistory,fieldRoles,history,bundles:bundleHistory,currentBundleKey:bundle?bundleKey(bundle):null,activeId,mapping,question,chartKind,view,dataTab,inspectorOpen,exploreSession,compareSession}):null,[dataset,preparationHistory,fieldRoles,history,bundleHistory,bundle,activeId,mapping,question,chartKind,view,dataTab,inspectorOpen,exploreSession,compareSession])
  useEffect(()=>{
    if(!workspaceReady||storageBlocked||!workspaceState)return
    const version=++saveRevision.current
    let started=false
    setSaveState('pending')
    const persist=()=>{
      if(started||clearInProgress.current)return
      started=true;clearTimeout(timer);setSaveState('saving')
      saveWorkspace(workspaceState).then(time=>{if(version===saveRevision.current){setSavedAt(time);setSaveState('saved');setStorageError('')}}).catch(e=>{if(version===saveRevision.current){setSaveState('error');setStorageError(e instanceof Error?e.message:'本机保存失败，请先导出报告。')}})
    }
    const timer=setTimeout(persist,400)
    const hidden=()=>{if(document.visibilityState==='hidden')persist()}
    cancelPendingSave.current=()=>{started=true;clearTimeout(timer)}
    window.addEventListener('pagehide',persist);document.addEventListener('visibilitychange',hidden)
    return()=>{clearTimeout(timer);window.removeEventListener('pagehide',persist);document.removeEventListener('visibilitychange',hidden)}
  },[workspaceReady,storageBlocked,workspaceState,saveRetry])
  useEffect(()=>{if(showClear)clearRef.current?.showModal();else clearRef.current?.close()},[showClear])
  useEffect(()=>{if(pendingReplace)replaceRef.current?.showModal();else replaceRef.current?.close()},[pendingReplace])
  useEffect(()=>{setRolesOpen(false)},[dataset])
  async function discardWorkspace(){
    if(clearInProgress.current||computing||loading)return
    clearInProgress.current=true;setClearing(true);cancelPendingSave.current();saveRevision.current++
    try{
      await clearWorkspace()
      request.current++;abort.current?.abort();datasetRef.current=null
      setDataset(null);setHistory([]);setBundle(null);setBundleHistory([]);bundleRegistry.current.clear()
      setPreparationHistory([]);setFieldRoles({});setRolesOpen(false);setQuestionError(null);setRunningQuestion(null);setPendingReplace(null);setExploreSession(null);setCompareSession(null);setConsoleTable(null);setActiveId(null)
      setMapping(blankMapping);setQuestion(initialQuestion);setChat([]);setChatInput('');setSelectedPoint('');setAssistantSeed(undefined)
      setInspectorOpen(false);setAssistantOpen(false);setImportFile(null);setShowPage(false);setView('workspace');setDataTab('fields')
      setAllowAutoInspection(true);setSavedAt('');setSaveState('empty');setStorageError('');setStorageBlocked(false);setShowClear(false);setError('')
      setNotice('本机工作区已清除，模型连接配置保留。可以重新导入真实数据。')
    }catch(e){setStorageError(e instanceof Error?e.message:'清除失败，原工作区保持可用。');setSaveState('error')}
    finally{clearInProgress.current=false;setClearing(false)}
  }

  function installDataset(next: Dataset) {
    setAllowAutoInspection(true)
    next = { ...next, originalFileHash: next.originalFileHash || next.origin?.fileHash || (!next.preparation ? next.fingerprint : undefined), originalFileName: next.originalFileName || next.title }
    setWorkspaceSection('analysis'); setAnalysisDraft(''); setAssistantOpen(false); setFieldsOpen(false); datasetRef.current = next; setBundle(null); setBundleHistory([]); bundleRegistry.current.clear(); setInspectorOpen(false); setExploreSession(null); setCompareSession(null); setConsoleTable(null); setPreparationHistory([]); setFieldRoles({}); setRolesOpen(false); setQuestionError(null); setRunningQuestion(null); setPendingReplace(null); setShowPage(false); setDataset(next); setMapping(defaultMapping(next, profileDataset(next))); setHistory([]); setActiveId(null)
    setQuestion(next.isPublic ? initialQuestion : ''); setChat([]); setChatInput(''); setSelectedPoint('')
    setFieldSearch(''); setResultQuery(''); setResultSort('original'); setDataTab('fields'); setEvidenceTab('method'); setView('workspace'); setNotice('数据已读取。请先说明分析目标、业务背景与字段口径。')
  }
  function loadPublicDataset() {
    if (dataset) { setPendingReplace({ kind: 'public' }); return }
    void fetchPublicDataset()
  }
  async function fetchPublicDataset() {
    const version = ++request.current
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller
    setLoading(true); setError(''); setNotice('')
    try {
      const response = await fetch(PUBLIC_DATA_URL, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) })
      if (!response.ok) throw new Error(`公开来源返回 HTTP ${response.status}`)
      const text = await response.text(), parsed = parseCSV(text), hash = await fingerprint(text)
      if (version !== request.current) return
      installDataset({ title: 'OWID Energy Data', sourceUrl: PUBLIC_SOURCE_URL, originalFileHash: hash, originalFileName: 'owid-energy-data.csv', ...parsed, loadedAt: new Date().toISOString(), fingerprint: hash, isPublic: true })
    } catch (e) {
      if (version === request.current && !(e instanceof DOMException && e.name === 'AbortError')) setError(`公开数据加载失败：${e instanceof Error ? e.message : '网络异常'}。可重试，或导入自己的 CSV、Excel 或 PDF。`)
    } finally { if (version === request.current) setLoading(false) }
  }
  useEffect(() => () => { request.current++; abort.current?.abort() }, [])
  useEffect(() => { if (showHelp) helpRef.current?.showModal(); else helpRef.current?.close() }, [showHelp])
  function pickFile(accept = '.csv,.xlsx,.xls,.pdf') {
    if (!uploadRef.current || loading) return
    uploadRef.current.accept = accept
    uploadRef.current.click()
  }
  async function importSelectedFile(file: File) {
    if (!/\.(csv|xlsx|xls|pdf)$/i.test(file.name)) { setError('支持 CSV、Excel（.xlsx / .xls）和 PDF 文件，请选择对应文件。'); return }
    if (file.size > 30 * 1024 * 1024) { setError('文件超过 30 MB，请拆分后重试。'); return }
    if (!/\.csv$/i.test(file.name)) { setImportFile(file); return }
    if (dataset) { setPendingReplace({ kind: 'file', file }); return }
    await loadCSVFile(file)
  }
  async function loadCSVFile(file: File) {
    const version = ++request.current; abort.current?.abort(); setError(''); setLoading(false)
    setLoading(true)
    try {
      const bytes = await file.arrayBuffer(), decoded = decodeTextBytes(new Uint8Array(bytes)), text = decoded.text
      let parsed
      try { parsed = parseCSV(text) }
      catch (e) {
        if (version !== request.current) return
        // A standard CSV imports in one step. When the first record cannot be a
        // header (preamble rows, ragged columns, duplicate names), offer the same
        // header/range preview as Excel instead of guessing or rejecting outright.
        setNotice(`CSV 首行不能直接作为表头（${e instanceof Error ? e.message : '格式不符合标准 CSV'}）。已打开导入预览：请选择表头所在行与数据截止行，确认后再导入。`)
        setImportFile(file)
        return
      }
      const separator = detectDelimiter(text), [hash, originalFileHash] = await Promise.all([fingerprint(text), fileHash(bytes)])
      if (version !== request.current) return
      installDataset({ title: file.name, sourceUrl: '', originalFileHash, originalFileName: file.name, ...parsed, fingerprint: hash, loadedAt: new Date().toISOString(), isPublic: false })
      const notes = [decoded.warning, separator === ',' ? '' : '已识别为' + (separator === '\t' ? '制表符' : '分号') + '分隔的 CSV。'].filter(Boolean)
      if (notes.length) setNotice('数据已读取。' + notes.join(' ') + ' 请先说明分析目标、业务背景与字段口径。')
    } catch (e) { if (version === request.current) setError(`导入失败：${e instanceof Error ? e.message : '无法读取文件'}。请检查文件编码与分隔符，或将文件另存为标准 CSV。`) }
    finally { if (version === request.current) setLoading(false) }
  }
  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''; if (file) void importSelectedFile(file)
  }
  function confirmReplace() {
    const action = pendingReplace
    setPendingReplace(null)
    if (!action) return
    if (action.kind === 'file') void loadCSVFile(action.file)
    else if (action.kind === 'public') void fetchPublicDataset()
    else installDataset(action.dataset)
  }
  async function run(nextMapping: Mapping, text: string) {
    if (!dataset || loading || computeLock.current) throw new Error('请等待当前数据或计算就绪。')
    computeLock.current = true; setComputing(true)
    const snapshot = dataset
    let result: Analysis
    try { result = await analyze(dataset, nextMapping, text || '按已确认字段口径分析', (history.at(-1)?.id ?? 0) + 1, active?.scope) } finally { computeLock.current = false; setComputing(false) }
    if (datasetRef.current !== snapshot) throw new Error('数据已变化，旧计算结果已丢弃。')
    setMapping(nextMapping); setHistory(h => [...h, result]); setActiveId(result.id); setInspectorOpen(true); setSelectedPoint('')
    document.querySelector('.manual-mapping')?.removeAttribute('open'); document.querySelector('.workbench')?.scrollTo({top:0});
    setError(''); setNotice(`分析 #${result.id} 完成：${result.usedRows} 条有效来源记录，${result.points.length} 个分组。`); setView('workspace')
    return result
  }
  async function executeAi(response: PlanResponse, goal: string, options?: ExecutionOptions): Promise<PlanExecution> {
    if (!dataset || loading || computeLock.current) throw new Error('请等待有效数据和当前计算。')
    computeLock.current = true; setComputing(true); const snapshot = dataset
    let execution: PlanExecution
    try { execution = await executePlan(dataset, response, goal, (history.at(-1)?.id ?? 0) + 1, options) } finally { computeLock.current = false; setComputing(false) }
    if (datasetRef.current !== snapshot) throw new Error('数据已变化，旧计划计算结果已丢弃。')
    const results = execution.results
    const first = results[0]
    if (!first) { setNotice(execution.cancelled ? '计算已停止，未完成的任务没有生成结果。可在 AI 助手中继续。' : '本轮任务未得到可计算结果，请在 AI 助手中查看错误并修正计划。'); return execution }
    setHistory(h => [...h, ...results]); setActiveId(first.id); setMapping(first.mapping); setQuestion(goal)
    setChartKind(response.plan.tasks.find(task => task.id === first.ai?.taskId)?.chart ?? 'bar'); setSelectedPoint(''); setDataTab('result'); setError('')
    setNotice((execution.cancelled ? '计算已停止，保留 ' : '已完成 ') + results.length + ' 个 AI 计划任务的真实计算。' + (execution.failures.length ? execution.failures.length + ' 个任务失败，详情见 AI 助手。' : '') + '点击任务查看相应图表与来源。')
    return execution
  }
  async function runCheckupQuestion(question: CheckupQuestion) {
    if (question.execution.kind !== 'aggregate' || computing) return
    setRunningQuestion(question.id); setQuestionError(null)
    try { await run(question.execution.mapping, question.question); setChartKind(question.chart) }
    catch (e) {
      const message = e instanceof Error ? e.message : '计算失败'
      setError(message); setQuestionError({ id: question.id, message })
    }
    finally { setRunningQuestion(null) }
  }
  async function exploreCheckupQuestion(question: CheckupQuestion) {
    if (!dataset || question.execution.kind !== 'explore' || computeLock.current) return
    computeLock.current = true; setComputing(true); setRunningQuestion(question.id); setQuestionError(null)
    const snapshot = dataset
    try {
      const next = await exploreDataset(dataset, question.execution.spec)
      if (datasetRef.current !== snapshot) throw new Error('数据已变化，旧探索结果已丢弃。')
      setExploreSession({ datasetHash: dataset.fingerprint, spec: question.execution.spec, result: next, selected: null })
      setView('explore'); setError(''); setNotice(`已执行“${question.title}”的真实探索计算。`)
    } catch (e) {
      const message = e instanceof Error ? e.message : '探索计算失败'
      setError(message); setQuestionError({ id: question.id, message })
    }
    finally { computeLock.current = false; setComputing(false); setRunningQuestion(null) }
  }
  function askFromCheckup(question: string) {
    setAssistantSeed({ question, context: '来自数据体检。字段角色与问题由本地规则判断；业务含义、单位与统计范围仍需你确认。', nonce: Date.now() })
    setAssistantOpen(true)
  }
  function receiveBundle(next: AnalysisBundle) {
    if(datasetRef.current?.fingerprint!==next.response.datasetHash)return
    const key=next.id||next.response.generatedAt
    const isNew=!bundleRegistry.current.has(key)
    if(isNew){setView('workspace');setWorkspaceSection('analysis')}
    bundleRegistry.current.set(key,next)
    setBundleHistory([...bundleRegistry.current.values()])
    setBundle(current=>isNew || (current?.id||current?.response.generatedAt)===key ? next : current)
  }
  function declareUnit(id: number, unit: string) {
    const next = normalizeUnit(unit)
    const apply = (items: Analysis[]) => items.map(item => item.id === id ? withDeclaredUnit(item, next) : item)
    const applyBundle = (item: AnalysisBundle): AnalysisBundle => {
      const results = apply(item.results)
      const declared = results.find(result => result.id === id)
      const scope = declared?.scope && item.response.scope
        ? { ...item.response.scope, baseline: { ...item.response.scope.baseline, unit: declared.mapping.unit } }
        : item.response.scope
      return { ...item, results, response: scope ? { ...item.response, scope } : item.response }
    }
    setHistory(apply)
    setBundleHistory(items => items.map(applyBundle))
    setBundle(current => current ? applyBundle(current) : current)
    bundleRegistry.current = new Map([...bundleRegistry.current].map(([key, item]) => [key, applyBundle(item)]))
    if (activeId === id) setMapping(current => ({ ...current, unit: next }))
    setNotice(next ? `已记录指标单位“${next}”：由你声明，计算值与来源没有改变；图表、结论和导出会使用该标注。` : '已撤回指标单位声明：图表与导出只显示数值；计算值与来源没有改变。')
  }
  function showBundle(next: AnalysisBundle) {
    setBundle(next); setInspectorOpen(false); setWorkspaceSection('analysis'); setView('workspace'); setSelectedPoint('')
    const first=next.results[0]
    if(first){setActiveId(first.id);setMapping(first.mapping);setQuestion(first.question)}
    requestAnimationFrame(()=>document.querySelector('.analysis-bundle')?.scrollIntoView({behavior:'smooth',block:'start'}))
  }
  function showParent(id:number) {
    const parent=[...bundleRegistry.current.values()].find(item=>item.results.some(r=>r.id===id))
    if(parent)showBundle(parent)
  }
  function askSelected(result:Analysis,label:string) {
    if(!dataset)return
    try {
      const scope=createFollowUpScope(dataset,result,label)
      setAssistantSeed({question:'请在选定分组内，进一步比较其他合适维度的表现，并说明数据能支持的观察与限制。',context:'原问题：'+(bundle?.response.plan.goal||result.question).slice(0,800)+'\n已确认的来源口径：'+JSON.stringify(result.mapping).slice(0,1500)+'\n原分析假设：'+JSON.stringify(bundle?.response.plan.assumptions||[]).slice(0,900),scope,nonce:Date.now()})
      setAssistantOpen(true)
    }catch(error){setError(error instanceof Error?error.message:'无法创建追问')}
  }
  function openAiEvidence(id: number, label?: string) {
    setInspectorOpen(true)
    const item = history.find(h => h.id === id); if (!item) return
    restore(item); setWorkspaceSection('evidence'); setDataTab('result'); setEvidenceTab(label ? 'rows' : 'method'); setSelectedPoint(label ?? '')
    requestAnimationFrame(() => document.getElementById('workspace-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  async function executeManual() {
    try { await run(mapping, question ? `用户备注：${question}（本次按字段口径执行）` : '按已确认字段口径分析') }
    catch (e) { setError(e instanceof Error ? e.message : '计算失败') }
  }
  async function submitQuestion(e: FormEvent) {
    e.preventDefault()
    if (!dataset || !question.trim()) return
    try {
      if (!dataset.isPublic) throw new Error('此处是公开能源规则工具。上传数据请打开右下角 AI 助手，或在手动区确认口径后分析。')
      await run(parsePublicQuestion(question, active?.mapping ?? mapping), question)
    } catch (e) { setError(e instanceof Error ? e.message : '问题未识别') }
  }
  async function followUp(e: FormEvent) {
    e.preventDefault(); const text = chatInput.trim(); if (!text || !active || !dataset) return
    try {
      if (!dataset.isPublic) throw new Error('这里是公开能源数据的规则工具。上传文件请在右下角 AI 助手中更新目标与背景后重新规划，或调整手动口径。')
      const result = await run(parsePublicQuestion(text, active.mapping), text)
      setChat(c => [...c, { text, answer: result!.finding, run: result!.id }]); setChatInput('')
    } catch (e) { const answer = e instanceof Error ? e.message : '未能执行'; setChat(c => [...c, { text, answer }]); setChatInput('') }
  }
  function restore(item: Analysis) { setWorkspaceSection('analysis'); setInspectorOpen(true); setActiveId(item.id); setMapping(item.mapping); setQuestion(item.question); setSelectedPoint(''); setView('workspace'); setNotice(`已切换至分析 #${item.id} 的结果快照。`) }
  function backToCheckup() {
    if (!dataset) return
    setBundle(null); setActiveId(null); setWorkspaceSection('analysis'); setInspectorOpen(false); setSelectedPoint(''); setView('workspace'); setQuestionError(null)
    setNotice('已回到数据体检；已有结果仍保留在“分析分支”，可随时切回。')
    requestAnimationFrame(() => document.getElementById('workspace-analysis')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
  }
  function newAnalysis() { setWorkspaceSection('analysis'); setAnalysisDraft(''); setBundle(null); setInspectorOpen(false); if (dataset) { setAssistantSeed({ question: '', context: '', nonce: Date.now() }); setAssistantOpen(true); } else pickFile(); setActiveId(null); setQuestion(''); setSelectedPoint(''); setError(''); setNotice('已创建空白分析，现有分支保留。'); setView('workspace') }
  function showRows(label: string) { setWorkspaceSection('evidence'); setSelectedPoint(label); setEvidenceTab('rows'); requestAnimationFrame(()=>document.getElementById('evidence')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' })) }
  function openInExplore() {
    if (!dataset || !active || active.mapping.rate || active.mapping.conditions?.length) return
    const spec: ExploreSpec = { kind: chartKind, x: active.mapping.x, y: numericFields.find(p => p.key !== active.mapping.metric)?.key ?? active.mapping.metric, metric: active.mapping.metric, aggregate: active.mapping.aggregate, filter: active.mapping.filter, value: active.mapping.value, bucket: active.mapping.timeBucket ?? 'none', sort: 'label', limit: 100 }
    setExploreSession({ datasetHash: dataset.fingerprint, spec, result: null, selected: null })
    setView('explore')
    setNotice('已把当前分组、指标与筛选带入探索分析。图表类型、第二维度和排序可在那里调整；重新执行后才会生成结果。')
  }
  function chartSVG() { const svg = document.querySelector('.chart-panel svg.data-chart') ?? document.querySelector('.bundle-result:not([hidden]) svg.data-chart') ?? document.querySelector('.analysis-bundle svg.data-chart'); return svg?.outerHTML.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ') ?? '' }
  function exportResultCSV() {
    if (!active) return
    const quote = (v: string) => `"${v.replace(/"/g, '""')}"`
    download('\uFEFF' + [['group', active.mapping.metric + (active.mapping.unit ? `（${active.mapping.unit}）` : ''), ...(active.mapping.rate ? ['numerator','denominator','excluded'] : []), 'source_record_ids'].map(quote).join(','), ...active.points.map(p => [p.label, String(p.value), ...(p.rate ? [String(p.rate.numerator),String(p.rate.denominator),String(p.rate.excluded)] : []), p.rowIds.join(';')].map(quote).join(','))].join('\r\n'), 'text/csv;charset=utf-8', `数鉴-分析${active.id}-结果.csv`); setNotice('结果 CSV 已导出，含来源记录号；指标列名会带上当前单位标注。')
  }
  function exportReproBundle() {
    if (!active || !dataset) return
    if (!active.sql) { setNotice('当前结果没有可执行的 SQL，无法导出复现包。'); return }
    try {
      const bundle = buildBundle(dataset, {
        kind: 'workspace',
        title: `${active.question} · 分析 #${active.id}`,
        question: active.question,
        spec: active.mapping,
        sql: active.sql,
        parameters: (active.parameters ?? []) as (string | number | null)[],
        ...workspaceReproResult(active),
      })
      download(bundle.zip, 'application/zip', bundle.name)
      setNotice('可复现 SQL 包已导出：含清洗后 CSV、schema.sql、analysis.sql、expected.json 与本地复跑脚本。')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '复现包生成失败')
    }
  }
  function exportReport() {
    if (!active || !dataset) return
    const h = escapeHTML, ids = active.points.flatMap(p => p.rowIds), columns = [...new Set([active.mapping.x, active.mapping.filter, active.mapping.metric, ...(active.mapping.conditions ?? []).map(c => c.field)].filter(Boolean))]
    const report = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>数鉴分析报告</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#14213d;max-width:1000px;margin:auto;padding:40px}h1{font-size:30px}h2{margin-top:32px}small{color:#52627a}svg{width:100%;max-height:400px}table{width:100%;border-collapse:collapse;margin:20px 0;display:block;overflow:auto}th,td{text-align:left;padding:8px 12px;border:1px solid #dce3ed;white-space:nowrap}pre{background:#f4f7fb;padding:16px;white-space:pre-wrap;word-break:break-all}a{color:#2563eb}.chart-hit{display:none}@media print{body{padding:0}}</style><h1>数鉴 · 数据分析报告</h1><small>${active.ai ? `AI 辅助规划（${h(active.ai.model)}）· 程序计算结果` : '手动 / 规则计算 · 未调用大模型'} · 分析 #${active.id}</small>${active.ai ? `<h2>已确认的分析方向</h2><p>${h(active.ai.goal)}</p><p>任务：${h(active.ai.taskTitle)}；规划时间：${h(active.ai.plannedAt)}</p><p>本报告导出当前任务的程序计算与证据；AI 定性解读请在工作台核对，未包含在本报告中。</p>` : ''}${active.scope ? `<h2>分组追问范围</h2><p>来源分析 #${active.scope.parentAnalysisId}；分组 ${h(active.scope.label)}；锁定 ${active.scope.rowIds.length} 条匹配记录。原分组结果 ${h(String(active.scope.baseline.value))}${h(active.scope.baseline.unit)}。</p><details><summary>完整快照记录索引</summary><pre>${h(active.scope.rowIds.join(', '))}</pre></details>` : ''}<h2>分析问题与口径</h2><p>${h(active.question)}</p><pre>${h(JSON.stringify(active.mapping, null, 2))}</pre><h2>计算结论</h2><p>${h(active.finding)}</p><p>有效来源 ${active.usedRows} 条；跳过空分组或非数值 ${active.skipped} 条。指标单位${active.mapping.rate ? '：%（条件比例定义）' : active.mapping.unit ? `：${h(active.mapping.unit)}（${active.unitSource === 'user' ? '由你声明' : '来自当前分析口径，未独立核验'}，不参与计算）` : '未声明'}。</p><h2>可视化</h2>${chartSVG()}<h2>实际执行 SQL</h2><pre>${h(active.sql ?? '')}</pre><pre>参数：${h(JSON.stringify(active.parameters ?? []))}</pre><h2>数据处理记录</h2><pre>${h(JSON.stringify(dataset.preparation ?? {steps: []}, null, 2))}</pre><h2>执行方法</h2><pre>${h(active.operations.join('\n'))}</pre><p>计算引擎：SQLite / sql.js，独立线程执行参数化只读 SQL。</p><h2>结果与来源记录号</h2><table><thead><tr><th>分组</th><th>结果${active.mapping.unit ? `（${h(active.mapping.unit)}）` : ''}</th>${active.mapping.rate ? '<th>分子</th><th>分母</th><th>排除</th>' : ''}<th>来源记录号</th></tr></thead><tbody>${active.points.map(p => `<tr><td>${h(p.label)}</td><td>${h(String(p.value))}</td>${p.rate ? `<td>${p.rate.numerator}</td><td>${p.rate.denominator}</td><td>${p.rate.excluded}</td>` : ''}<td>${p.rowIds.map(id => dataset.sourceRecords?.[id - 2] ?? id).join(', ')}</td></tr>`).join('')}</tbody></table><h2>当前快照证据（前 1,000 条有效记录）</h2><p>来源记录号保留处理前映射，从 2 开始计数；来源位置以原文件工作表 / PDF 页码标记，CSV 按非空记录计数。完整数据请以原文件为准。</p><table><thead><tr><th>记录号</th>${columns.map(c => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${ids.slice(0, 1000).map(id => `<tr><td>${dataset.sourceRecords?.[id - 2] ?? id}${dataset.origin ? ` · ${h(dataset.origin.locations[id - 2] || '')}` : ''}</td>${columns.map(c => `<td>${h(dataset.rows[id - 2][c] ?? '（空值）')}</td>`).join('')}</tr>`).join('')}</tbody></table>${sourceHTML(dataset)}<h2>文件解析与快照</h2><p>${h(dataset.title)}</p>${dataset.origin ? `<p>格式：${h(dataset.origin.format)}；方式：${h(dataset.origin.method)}；表头原行：${dataset.origin.headerRow}</p><pre>原文件 SHA-256: ${h(dataset.origin.fileHash)}</pre><ul>${dataset.origin.warnings.map(w => `<li>${h(w)}</li>`).join('')}</ul>${dataset.origin.pageImage ? `<h2>选中 PDF 原始页面</h2><img alt="PDF 来源原页" style="max-width:100%" src="${dataset.origin.pageImage}">` : ''}` : ''}<p>载入：${h(dataset.loadedAt)}<br>计算：${h(active.createdAt)}</p><pre>SHA-256: ${h(active.datasetHash)}</pre><p>报告反映当前已加载数据与所选汇总口径。缺失数据不作为 0；端点差异不代表连续增长，不构成因果证明。</p></html>`
    download(report, 'text/html;charset=utf-8', `数鉴-分析${active.id}-证据报告.html`); setNotice('单文件 HTML 报告已导出，图表和证据内嵌，打开报告无需联网。')
  }


  useEffect(() => { setFieldsOpen(false); if (view !== 'workspace') setAssistantOpen(false) }, [view])
  const studio = view === 'workspace' && !!dataset
  if(!workspaceReady)return <main className="workspace-restoring" aria-busy="true"><LoaderCircle className="spin" size={28}/><h1>正在恢复本机工作区</h1><p>检查已保存的数据、分析结果与来源关联…</p></main>
  return <div className={"app-shell"+(studio?" is-studio":"")+(studio&&assistantOpen?" has-ai-dock":"")}>
    <a className="skip-link" href="#main">跳转到分析内容</a>
    <input ref={uploadRef} id="file-upload" className="sr-only" aria-label="导入 CSV、Excel 或 PDF 文件" type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={e => void handleFile(e)} />
    <header className="app-header">
      <a className="brand" href="#main" onClick={() => setView('workspace')}><span className="brand-mark"><Layers3 size={22}/></span><span><strong>数鉴</strong><small>让分析有据可查</small></span></a>
      <nav className="primary-navigation" aria-label="功能导航">{[{key:'workspace',label:'分析工作台'},{key:'prepare',label:'数据处理'},{key:'explore',label:'探索分析'},{key:'compare',label:'对比诊断'},{key:'query',label:'SQL 查询'},{key:'source',label:'数据与来源'},{key:'branches',label:'分析分支'}].map(({key,label})=><button key={key} className={'nav-item'+(view===key?' active':'')} aria-current={view===key?'page':undefined} onClick={()=>setView(key as View)}>{label}{key==='branches'&&history.length>0&&<b>{history.length}</b>}</button>)}</nav>
      <div className="header-actions"><button className="new-analysis secondary" onClick={newAnalysis}><Plus size={16}/><span>新建分析</span></button><button className="icon-button" aria-label="使用说明" onClick={()=>setShowHelp(true)}><CircleHelp size={19}/></button><button className={'model-trigger'+(models.ready?' connected':'')} onClick={()=>setShowModels(true)}><span className="connection-dot"/><span>{models.selected?.name||'连接 AI'}</span><Settings2 size={15}/></button></div>
    </header>
    <main id="main" className="main" tabIndex={-1}>
      {dataset && <header className="topbar dataset-ribbon"><div className="dataset-ribbon-name"><FileSpreadsheet size={20}/><div className="dataset-name"><strong title={dataset.title}>{dataset.title}</strong><span>{dataset.rows.length.toLocaleString()} 行 · {dataset.headers.length} 个字段</span></div></div><div className="top-actions"><button className="text-button" aria-expanded={fieldsOpen} aria-controls="dataset-field-drawer" onClick={()=>setFieldsOpen(!fieldsOpen)}><Table2 size={16}/>字段与质量</button><button className="text-button" onClick={()=>setView('source')}><ShieldCheck size={16}/>来源</button><button className="secondary top-import" onClick={()=>pickFile()} disabled={loading}><Upload size={16}/>更换文件</button><button className="text-button top-public" onClick={()=>void loadPublicDataset()} disabled={loading}>公开数据</button></div></header>}
      <div className="content">
        {view !== 'workspace' && <div className="page-heading"><div><h1>{view === 'prepare' ? '数据处理' : view === 'explore' ? '探索分析' : view === 'compare' ? '对比诊断' : view === 'query' ? 'SQL 查询' : view === 'branches' ? '分析分支' : '数据与来源'}</h1><p>{view === 'branches' ? '每次计算保存独立结果，切换分支即可对照原来的口径。' : '检查字段质量、公开来源与本次载入的数据快照。'}</p></div><div className="heading-actions"><button className="secondary" onClick={() => pickFile()} disabled={loading}><Upload size={17} />导入文件</button><button className="text-button" onClick={() => void loadPublicDataset()} disabled={loading}><RefreshCcw size={16} className={loading ? 'spin' : ''} />{loading ? '加载数据中' : '加载公开数据'}</button></div></div>}

        {error && <div className="banner error" role="alert"><AlertCircle size={19} /><span>{error}</span><button aria-label="关闭错误提示" className="icon-button" onClick={() => setError('')}><X size={17} /></button></div>}
        <div className="status-message" role="status" aria-live="polite">{notice && <><Check size={15} /><span>{notice}</span></>}</div>

        {fieldsOpen && dataset && <div className="field-drawer" id="dataset-field-drawer"><header><strong>核对字段与质量</strong><button className="icon-button" aria-label="关闭字段面板" onClick={()=>setFieldsOpen(false)}><X size={18}/></button></header><FieldShelf dataset={dataset} profiles={profiles} checkup={checkup} search={fieldSearch} onSearch={setFieldSearch} onData={field=>{setView('workspace');setWorkspaceSection('data');setDataTab('fields');if(field)setFieldSearch(field);setFieldsOpen(false)}} onPrepare={()=>setView('prepare')} onSource={()=>setView('source')} onRoles={()=>setRolesOpen(true)} onCheckup={active||bundle?()=>{setFieldsOpen(false);backToCheckup()}:undefined}/></div>}

        {dataset && view !== 'source' && view !== 'workspace' && <SourceSummary dataset={dataset} onOpen={() => setView('source')} />}
        {(view === 'prepare' || view === 'explore' || view === 'compare') && !dataset && <section className="panel core-panel"><p>先导入真实文件，再检查质量与执行探索。</p><button className="primary" onClick={() => pickFile()}>导入数据</button></section>}
        {view === 'prepare' && dataset && <PreparationView key={dataset.fingerprint} dataset={dataset} canUndo={preparationHistory.length > 0} onCommit={next => { const previous = dataset; const past = preparationHistory; installDataset(next); setPreparationHistory([...past, previous]); setView('prepare'); setNotice('处理已应用，旧分析已清空，可撤销本次处理。') }} onUndo={() => { const past = preparationHistory; const previous = past.at(-1); if (previous) { installDataset(previous); setPreparationHistory(past.slice(0,-1)); setView('prepare'); setNotice('已恢复上一份数据快照，分析需重新执行。') } }} onExplore={() => setView('explore')} />}
        {view === 'compare' && dataset && <CompareView key={dataset.fingerprint} session={compareSession} onSessionChange={setCompareSession} dataset={dataset} onAsk={(question, context) => { setAssistantSeed({question,context,nonce:Date.now()}); setAssistantOpen(true) }} />}
        {view === 'explore' && dataset && <ExploreView key={dataset.fingerprint} session={exploreSession} onSessionChange={setExploreSession} dataset={dataset} onAsk={(question, context) => { setAssistantSeed({question,context,nonce:Date.now()}); setAssistantOpen(true) }} />}
        {view === 'query' && dataset && <SqlConsole key={dataset.fingerprint} dataset={dataset} table={consoleTable} onTable={setConsoleTable} />}
        {view === 'query' && !dataset && <section className="panel core-panel"><p>先导入真实文件，再在本地 SQLite 上运行只读查询。</p><button className="primary" onClick={() => pickFile()}>导入数据</button></section>}

        {view === 'workspace' && !dataset && <WorkspaceWelcome onPick={pickFile} onFile={file => void importSelectedFile(file)} busy={loading} configured={!!models.defaultProfile} onConfigure={() => setShowModels(true)} onPublic={()=>void loadPublicDataset()} />}
        <div className="workbench" hidden={view !== 'workspace' || !dataset}>
          <div className="workbench-toolbar">
            <div className="workbench-sections" role="group" aria-label="工作台功能分区">
              {([{key:'analysis',label:'分析与图表',icon:BarChart3},{key:'data',label:'数据预览',icon:Table2},{key:'evidence',label:'证据与报告',icon:ShieldCheck}] as const).map(({key,label,icon:Icon})=><button key={key} aria-pressed={workspaceSection===key} aria-controls={'workspace-'+key} className={workspaceSection===key?'active':''} onClick={()=>setWorkspaceSection(key)}><Icon size={17}/>{label}</button>)}
            </div>
            <button className="text-button" onClick={()=>setView('explore')}><Layers3 size={16}/>自由探索<ArrowUpRight size={14}/></button>
          </div>
          <section id="workspace-analysis" className="workspace-section" aria-label="分析与图表" hidden={workspaceSection!=='analysis'}>
            {dataset && !bundle && !active && <AnalysisStart dataset={dataset} profiles={profiles} checkup={checkup} error={checkupError} computing={computing} runningQuestion={runningQuestion} questionError={questionError} onPrepare={()=>setView('prepare')} onExplore={()=>setView('explore')} onData={()=>{setWorkspaceSection('data');setDataTab('raw')}} onField={field=>{setFieldSearch(field);setWorkspaceSection('data');setDataTab('fields')}} onRoles={()=>setRolesOpen(true)} onRunQuestion={question=>void runCheckupQuestion(question)} onRunExploreQuestion={question=>void exploreCheckupQuestion(question)} onAsk={askFromCheckup} />}

          {dataset && bundleHistory.length>0 && <nav className="analysis-thread" aria-label="分析路径"><div><strong>分析路径</strong><small>保留每次计算，可切换对照</small></div><div className="analysis-thread-items">{bundleHistory.map((item,index)=><button key={item.id||item.response.generatedAt} aria-current={bundle?.id===item.id?'step':undefined} className={bundle?.id===item.id?'is-current':''} onClick={()=>showBundle(item)}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{item.response.scope?'追问 · '+item.response.scope.label:'起始分析'}</strong><small>{item.response.scope?'来源 #'+item.response.scope.parentAnalysisId+' · ':''}{item.results.length} 项计算</small></div></button>)}</div></nav>}
          {dataset && bundle && <AnalysisResults key={bundle.id||bundle.response.generatedAt} bundle={bundle} dataset={dataset} overrides={fieldRoles} onEvidence={openAiEvidence} onFollowUp={askSelected} onParent={showParent} onBackToCheckup={backToCheckup} onRoles={()=>setRolesOpen(true)} onUnit={declareUnit}/>}
          {!bundle && <div className="studio-layout"><div className="canvas-column">
              <details className="dataset-orientation" open={bundle ? inspectorOpen : undefined}><summary><Database size={17}/><span>AI 数据定位与授权</span><small>理解字段 · 确认分析边界</small><ChevronRight size={16}/></summary>
            <InitialAnalysis allowAutomatic={allowAutoInspection} dataset={dataset} profile={models.defaultProfile} loading={loading} onConfigure={() => setShowModels(true)} onQuestion={(question, context) => { setAssistantSeed({ question, context, nonce: Date.now() }); setAssistantOpen(true); }} />
              </details>
              {!active && <button className="manual-start text-button" onClick={()=>setInspectorOpen(!inspectorOpen)} aria-expanded={inspectorOpen}><Table2 size={16}/>{inspectorOpen?'收起手动计算':'手动选择字段与计算'}<ArrowUpRight size={15}/></button>}
              <div hidden={(!active && !inspectorOpen) || (!!bundle && !inspectorOpen)}>
            <div className="canvas-title"><span><BarChart3 size={17} />分析画布</span><span className="canvas-state">{active ? `分析 #${active.id} · 已绑定来源` : dataset ? '数据已就绪 · 等待分析' : '等待导入数据'}</span></div>
          <details className="manual-rules" hidden={!dataset?.isPublic}><summary>公开能源数据的规则工具（手动辅助）</summary><form className="question-panel" onSubmit={submitQuestion}><label htmlFor="question"><MessageSquareText size={17} />你想了解什么？</label><div className="question-row"><input id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder={dataset?.isPublic ? '例如：2018—2022 年中国太阳能发电量如何变化？' : '记录你的分析问题，然后在下方确认字段口径'} /><button className="primary" type="submit" disabled={!dataset?.isPublic || !question.trim() || loading}><ArrowUpRight size={17} />解析并分析</button></div><p>当前使用规则解析器，公开能源数据支持地区、年份和三类发电指标。上传数据请通过字段口径分析；此处不调用 LLM。</p>{dataset?.isPublic && <div className="suggestions">{['2015—2022 年中国可再生能源发电量如何变化？', '2018—2022 年中国太阳能发电量如何变化？'].map((text, i) => <button type="button" key={text} onClick={() => setQuestion(text)}>{i === 0 ? '可再生能源趋势' : '切换太阳能指标'}<ChevronRight size={13} /></button>)}</div>}</form></details>
          <div className="workspace">
            <div className="results-column">
              <details className="manual-mapping"><summary><Table2 size={16} />手动计算 / 查看执行口径<ChevronRight size={15} /></summary><section className="panel mapping-panel"><div className="section-heading"><div><h2>手动计算 / 查看执行口径</h2><p>可手动计算；AI 任务执行后也会在这里显示所选口径。</p></div><span className={`tag ${pending ? 'amber' : ''}`}>{pending ? '口径已修改' : '人工可确认'}</span></div>
                {mapping.rate && <p className="bundle-formula">比例口径：{mapping.metric} = {JSON.stringify(mapping.rate.successValue)} 的记录数 ÷ {JSON.stringify(mapping.rate.eligibleValues)} 的记录数 × 100。<button className="text-button" onClick={()=>setMapping(m=>({...m,rate:undefined,unit:'条'}))}>改为普通汇总</button></p>}<div className="mapping-grid"><div className="mapping-field"><label htmlFor="group-field">分组 / 时间字段</label><select id="group-field" value={mapping.x} onChange={e => setMapping(m => ({ ...m, x: e.target.value }))} disabled={!dataset}>{dataset?.headers.map(c => <option key={c}>{c}</option>)}</select></div><div className="mapping-field"><label htmlFor="metric-field">数值指标</label><select id="metric-field" value={mapping.metric} onChange={e => setMapping(m => ({ ...m, metric: e.target.value, rate:undefined }))} disabled={!dataset}><option value="">请选择数值列</option>{(['count','distinct'].includes(mapping.aggregate) ? profiles : numericFields).map(p => <option key={p.key}>{p.key}</option>)}</select></div><div className="mapping-field"><label htmlFor="aggregate-method">汇总方式</label><select id="aggregate-method" value={mapping.aggregate} onChange={e => setMapping(m => ({ ...m, aggregate: e.target.value as Mapping['aggregate'], rate:undefined }))}>{Object.entries(aggregateNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div><div className="mapping-field"><label htmlFor="filter-field">筛选字段</label><select id="filter-field" value={mapping.filter} onChange={e => setMapping(m => ({ ...m, filter: e.target.value, value: '' }))} disabled={!dataset}><option value="">不筛选</option>{dataset?.headers.map(c => <option key={c}>{c}</option>)}</select></div><div className="mapping-field"><label htmlFor="filter-value">精确筛选值</label><select id="filter-value" value={mapping.value} onChange={e => setMapping(m => ({ ...m, value: e.target.value }))} disabled={!mapping.filter}><option value="">请选择</option>{filterValues.map(v => <option key={v}>{v}</option>)}</select></div><div className="mapping-field"><label htmlFor="metric-unit">指标单位</label><input id="metric-unit" value={mapping.unit} onChange={e => setMapping(m => ({ ...m, unit: e.target.value }))} placeholder="未声明" maxLength={40} /></div><div className="mapping-field"><label htmlFor="range-from">分组起点</label><input id="range-from" value={mapping.from} onChange={e => setMapping(m => ({ ...m, from: e.target.value }))} placeholder="不限，例如 2015" /></div><div className="mapping-field"><label htmlFor="range-to">分组终点</label><input id="range-to" value={mapping.to} onChange={e => setMapping(m => ({ ...m, to: e.target.value }))} placeholder="不限，例如 2022" /></div></div>
                <div className="mapping-extras"><label htmlFor="time-bucket">时间分桶</label><select id="time-bucket" value={mapping.timeBucket ?? 'none'} onChange={e => setMapping(m => ({ ...m, timeBucket: e.target.value as Mapping['timeBucket'] }))}><option value="none">保持原始分组</option><option value="month">按月（需要标准日期）</option><option value="year">按年（需要标准日期）</option></select>{!!mapping.conditions?.length && <div><p>附加条件：{mapping.conditions.map(c => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`).join('；')}</p><button type="button" className="text-button" onClick={() => setMapping(m => ({ ...m, conditions: [] }))}>清除附加条件</button></div>}</div>
                <div className="mapping-bottom"><span>空值不当作 0 · 单位不自动猜测</span><button className="primary" onClick={executeManual} disabled={!dataset || !mapping.metric || loading}><BarChart3 size={16} />按确认口径分析</button></div>
              </section></details>
              {active && <div className="result-checkup-links"><button className="text-button" onClick={backToCheckup}><ListChecks size={15}/>回到数据体检</button><button className="text-button" onClick={()=>setRolesOpen(true)}>纠正字段类型</button><span>结果保留在“分析分支”，切换不会丢失。</span></div>}
              {active && !active.mapping.rate && <UnitDeclaration id={active.id} unit={active.mapping.unit} source={active.unitSource} onSave={unit=>declareUnit(active.id,unit)} />}
              {active && <InsightBrief result={active} />}
              {active && dataset && <NextCuts dataset={dataset} result={active} overrides={fieldRoles} />}
              <section className={"panel chart-panel"+(!active?" is-empty":"")}><div className="section-heading"><div><h2>{displayMetric}</h2><p>{active ? `${active.mapping.value || '全部记录'} · ${active.mapping.from || '不限'} — ${active.mapping.to || '不限'} · ${active.mapping.rate ? '条件计数比例（%）' : aggregateNames[active.mapping.aggregate]}` : '完成一次真实计算后，图表和证据会同时出现。'}</p></div><div className="segmented" aria-label="图表类型"><button aria-pressed={chartKind === 'line'} className={chartKind === 'line' ? 'active' : ''} onClick={() => setChartKind('line')}>折线</button><button aria-pressed={chartKind === 'bar'} className={chartKind === 'bar' ? 'active' : ''} onClick={() => setChartKind('bar')}>柱状</button></div></div>
                {active ? <><div className="chart-meta"><span className="legend"><i />{displayMetric}</span><span>分析 #{active.id} · {active.points.length} 个分组{pending ? ' · 显示上次结果' : ''}</span></div><DataChart points={active.points} metric={displayMetric} unit={active.mapping.unit} kind={chartKind} selected={selectedPoint} onSelect={showRows} /><div className="chart-bottom"><span>点击数据点查看对应来源记录</span><div className="chart-bottom-actions">{!active.mapping.rate && !active.mapping.conditions?.length && <button className="text-button" onClick={openInExplore} title="带入当前分组、指标与筛选，在散点、热力或表格中继续查看"><Layers3 size={16} />在探索分析中打开<ArrowUpRight size={14} /></button>}<button className="text-button" onClick={() => { download(chartSVG(), 'image/svg+xml', `数鉴-分析${active.id}.svg`); setNotice('当前图表 SVG 已导出。') }}><ArrowDownToLine size={16} />导出 SVG</button></div></div><div className="finding"><span><ShieldCheck size={17} />计算结论</span><p>{active.finding}</p><small>有效来源 {active.usedRows} 条；跳过空分组 / 非数值 {active.skipped} 条。字段候选不等同业务语义已自动确认。</small></div></> : <div className="chart-empty"><div className="canvas-emblem"><FileSpreadsheet size={36} strokeWidth={1.3} /><span><Settings2 size={16} /></span></div><span className="empty-kicker">你的数据，你的分析方向</span><h3>{dataset ? (models.ready ? '数据已就绪，先问一个好问题。' : '数据已就绪，可以从字段开始。') : '让一份数据，回答一个真实问题。'}</h3><p>{dataset ? (models.ready ? '在 AI 助手中说明你想解决的问题与业务口径。确认计划后，计算结果将显示在这里。' : '当前站点尚未配置 AI 模型。先选分组与指标做一次真实计算，图表、来源与报告同样可用；配置模型后再让 AI 规划。') : '导入 CSV，告诉 AI 你关心什么。从理解数据到图表与证据，在同一个工作台完成。'}</p><div className="empty-actions">{dataset && !models.ready ? <><button className="primary" onClick={() => setInspectorOpen(true)}><Table2 size={17} />手动选择字段与计算</button><button className="text-button" onClick={() => models.profiles.length ? setAssistantOpen(true) : setShowModels(true)}>{models.profiles.length ? '改用 AI 规划' : '配置分析模型'}<ArrowUpRight size={15} /></button></> : <><button className="primary" onClick={() => dataset ? setAssistantOpen(true) : pickFile()}>{dataset ? <MessageSquareText size={17} /> : <Upload size={17} />}{dataset ? '开始 AI 分析' : '导入我的数据'}</button><button className="text-button" disabled={loading} onClick={() => dataset ? setShowModels(true) : void loadPublicDataset()}>{dataset ? '配置分析模型' : '使用可验证的公开数据'}<ArrowUpRight size={15} /></button></>}</div><div className="canvas-principles"><span><Database size={15} />原始记录保留</span><span><Check size={15} />确认口径后计算</span><span><ShieldCheck size={15} />结论有据可查</span></div></div>}
              </section>
              </div></div></div></div></div>}
          </section>
          <section id="workspace-data" className="workspace-section" aria-label="数据预览" hidden={workspaceSection!=='data'}>
            <div className="workspace-section-heading"><div><h2>检查数据，确认分析口径</h2><p>字段类型是候选判断；原始值与来源位置保持可回查。</p></div><div className="heading-actions">{checkup&&<button className="text-button" onClick={()=>setRolesOpen(true)}><ListChecks size={16}/>纠正字段类型</button>}{(active||bundle)&&<button className="text-button" onClick={backToCheckup}>回到数据体检</button>}<button className="secondary" onClick={()=>setView('prepare')}><Settings2 size={16}/>清理与处理</button></div></div>
              <section className="panel data-panel"><div className="data-toolbar"><div className="tabs" aria-label="数据查看方式">{([{ key: 'fields', label: '字段质量' }, { key: 'raw', label: '原始记录' }, { key: 'result', label: '计算结果' }] as const).map(t => <button key={t.key} aria-pressed={dataTab === t.key} className={dataTab === t.key ? 'active' : ''} onClick={() => setDataTab(t.key)}>{t.label}</button>)}</div>{dataTab === 'fields' ? <input aria-label="搜索字段" className="search-input" value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="搜索字段" /> : dataTab === 'result' && <div className="result-table-controls"><label className="result-table-search"><Search size={14} /><span className="sr-only">搜索计算结果分组</span><input aria-label="搜索计算结果分组" value={resultQuery} onChange={e => setResultQuery(e.target.value)} placeholder="搜索分组" /></label><label>排序<select aria-label="计算结果排序" value={resultSort} onChange={e => setResultSort(e.target.value as ResultSort)}><option value="original">计算顺序</option><option value="desc">数值从高到低</option><option value="asc">数值从低到高</option><option value="label">分组名排序</option></select></label>{active && <span>{resultQuery.trim() ? `显示 ${resultRows.length} / ${active.points.length} 个分组` : `共 ${active.points.length} 个分组`}</span>}<button className="text-button" disabled={!active} onClick={exportResultCSV}><ArrowDownToLine size={15} />CSV</button></div>}</div>
                <div className="table-scroll">{dataTab === 'fields' ? <table><thead><tr><th>字段名</th><th>类型候选</th><th>判断依据</th><th>非空记录</th><th>空值率</th></tr></thead><tbody>{(checkup ? checkup.all.map(f => ({ key: f.key, role: f.roleLabel, nonempty: f.nonempty, missing: f.missing, overridden: !!f.overridden, autoLabel: f.autoRoleLabel, detail: f.detail, numeric: f.role === 'measure' })) : profiles.map(p => ({ key: p.key, role: p.kind, nonempty: p.nonempty, missing: p.missing, overridden: false, autoLabel: undefined, detail: '按原始取值分布自动判断', numeric: p.kind === '数值' }))).filter(f => f.key.toLowerCase().includes(fieldSearch.toLowerCase())).slice(0, 200).map(f => <tr key={f.key}><td className="mono">{f.key}</td><td><span className={`type-label ${f.numeric ? 'numeric' : ''}`}>{f.role}</span>{f.overridden && <em className="field-role-corrected" title={'自动判断为 ' + (f.autoLabel ?? '其他')}>已纠正</em>}</td><td className="field-cell-detail">{f.detail}</td><td>{formatNumber(f.nonempty, 0)}</td><td>{formatNumber(f.missing / dataset!.rows.length * 100, 1)}%</td></tr>)}</tbody></table> : dataTab === 'raw' ? <table><thead><tr><th>记录号</th>{dataset?.headers.slice(0, 8).map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{dataset?.rows.slice(0, 20).map((r, i) => <tr key={i}><td>{i + 2}</td>{dataset.headers.slice(0, 8).map(c => <td key={c}>{r[c] ?? <span className="null-value">空值</span>}</td>)}</tr>)}</tbody></table> : active ? <table><thead><tr><th>{active.mapping.x}</th><th>{active.mapping.metric}{active.mapping.unit ? `（${active.mapping.unit}）` : ''}</th><th>来源记录</th></tr></thead><tbody>{resultRows.map(p => <tr key={p.label}><td>{p.label}</td><td>{formatNumber(p.value)}</td><td><button className="table-link" onClick={() => showRows(p.label)}>{p.rowIds.length} 条 <ArrowUpRight size={13} /></button></td></tr>)}{resultRows.length === 0 && <tr><td colSpan={3} className="result-table-empty">没有匹配的分组，请换一个关键词。</td></tr>}</tbody></table> : <div className="small-empty">尚未执行分析，没有计算结果。</div>}</div><p className="table-note">{dataTab === 'raw' ? '预览前 20 条记录和前 8 列；来源位置可在证据检查器与报告中查看。' : dataTab === 'fields' ? '数值候选：非空值中至少 90% 可解析为数值。标识符仍保留原文，请人工确认；“已纠正”只影响体检建议与后续分组候选，不改原值，也不改写已算出的结果。' : '完整分组结果；缺失和非数值不会作为 0 参与计算。'}</p>
              </section>
          </section>
          <section id="workspace-evidence" className="workspace-section" aria-label="证据与报告" hidden={workspaceSection!=='evidence'}>
            <div className="workspace-section-heading"><div><h2>每个结果，都有计算依据</h2><p>核对执行口径、SQL 与原始记录，再导出证据报告。</p></div><button className="text-button" onClick={()=>setView('source')}><Database size={16}/>数据出处<ChevronRight size={14}/></button></div>
            <aside className="evidence-column" aria-label="分析过程与证据">
              <section className="panel process-panel"><div className="section-heading"><h2>分析执行记录</h2><span className="tag">{active ? `#${active.id}` : '待执行'}</span></div><ol className="process-list">{[{ title: '检查数据', detail: dataset ? `${dataset.rows.length} 行，${dataset.headers.length} 列，保留原始值` : '等待导入', done: !!dataset }, { title: '确认字段口径', detail: active ? `${active.mapping.x} → ${active.mapping.metric}` : '等待选择并执行', done: !!active }, { title: '执行本地计算', detail: active ? `${active.usedRows} 条有效记录 → ${active.points.length} 个分组` : '尚未执行', done: !!active }, { title: '绑定图表与证据', detail: active ? '图表、结论与来源记录共用结果' : '等待真实结果', done: !!active }].map((s, i) => <li key={s.title}><span className={`step-icon ${s.done ? 'done' : ''}`}>{s.done ? <Check size={13} /> : i + 1}</span><div><strong>{s.title}</strong><p>{s.detail}</p></div></li>)}</ol><p className="process-note">此处记录当前计算结果；AI 请求状态与澄清问题见右下角 AI 助手。</p></section>
              <section id="evidence" className="panel evidence-panel"><div className="section-heading"><h2>证据检查器</h2><ShieldCheck size={18} /></div><div className="tabs" aria-label="证据类型"><button aria-pressed={evidenceTab === 'method'} className={evidenceTab === 'method' ? 'active' : ''} onClick={() => setEvidenceTab('method')}>计算方法</button><button aria-pressed={evidenceTab === 'rows'} className={evidenceTab === 'rows' ? 'active' : ''} onClick={() => setEvidenceTab('rows')}>来源记录</button></div>{active ? <div className="evidence-body">{evidenceTab === 'method' ? <><div className="engine-label">SQLite / sql.js 执行 · 参数化只读 SQL</div><pre className="sql-code">{active.sql}</pre><pre className="sql-code">参数：{JSON.stringify(active.parameters)}</pre><ol className="method-list">{active.operations.map((op, i) => <li key={i}>{op}</li>)}</ol><div className="snapshot"><span>数据 SHA-256</span><code title={active.datasetHash}>{active.datasetHash.slice(0, 16)}…</code><span>计算于 {new Date(active.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}</span></div></> : <><label className="evidence-filter">分组<select value={selectedPoint} onChange={e => setSelectedPoint(e.target.value)}><option value="">全部有效来源</option>{active.points.map(p => <option key={p.label}>{p.label}</option>)}</select></label><p className="subtle">共 {scopedRowIds.length} 条，预览前 8 条</p><div className="source-list">{scopedRowIds.slice(0, 8).map(id => <div key={id}><span>{dataset?.origin?.locations[id - 2] || `来源记录 #${dataset?.sourceRecords?.[id - 2] ?? id}`}</span><strong>{dataset!.rows[id - 2][active.mapping.x]} · {dataset!.rows[id - 2][active.mapping.metric]} {active.mapping.unit}</strong>{active.mapping.filter && <small>{active.mapping.filter} = {dataset!.rows[id - 2][active.mapping.filter]}</small>}</div>)}</div><p className="subtle">来源位置随导入方式保留。完整绑定信息可导出报告查看。</p></>}</div> : <div className="small-empty"><ShieldCheck size={23} /><p>执行分析后，检查每个结果的计算方法与来源记录。</p></div>}</section>
              <section className="panel followup-panel" hidden={!dataset?.isPublic}><div className="section-heading"><h2>公开数据规则追问</h2><GitBranch size={18} /></div><div className="chat-thread" aria-live="polite">{!chat.length && <p className="subtle">公开数据可追问“改看风能”或“2018—2020 年呢”，继承上一口径并真实重算。</p>}{chat.map((item, i) => <div className="chat-pair" key={i}><p className="user-message">{item.text}</p><p className="agent-message"><span>{item.run ? `规则分析 · #${item.run}` : '未执行计算'}</span>{item.answer}</p></div>)}</div><form className="followup-input" onSubmit={followUp}><label className="sr-only" htmlFor="followup">输入追问</label><input id="followup" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder={active ? '改看风能' : '先完成一次分析'} disabled={!active} /><button className="primary icon-only" type="submit" aria-label="发送追问" disabled={!active || !chatInput.trim() || loading}><ArrowUpRight size={18} /></button></form></section>
              <div className="report-action"><button className="secondary" onClick={exportReport} disabled={!active}><ArrowDownToLine size={18} />导出证据报告</button><button className="secondary" style={{ marginTop: 8 }} onClick={exportReproBundle} disabled={!active}><ArrowDownToLine size={18} />导出可复现 SQL 包</button><p>单文件 HTML · 内嵌 SVG 与来源记录；SQL 包含清洗后数据与预期结果</p></div>
            </aside>
          </section>
        </div>
        {view === 'branches' && <section className="panel branch-panel"><div className="section-heading"><h2>已保存的计算分支</h2><span className="tag">{history.length} 个</span></div>{history.length ? <div className="branch-list">{[...history].reverse().map(item => <button key={item.id} onClick={() => restore(item)} className={activeId === item.id ? 'current' : ''}><span className="branch-number">#{item.id}</span><div><strong>{item.question}</strong><p>{item.mapping.metric} · {item.mapping.from || '不限'} → {item.mapping.to || '不限'} · {item.points.length} 个分组</p><small>{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.usedRows} 条有效来源</small></div><ArrowUpRight size={18} /></button>)}</div> : <div className="small-empty"><GitBranch size={30} /><p>还没有计算分支。执行分析或追问后，会在这里保留结果。</p><button className="secondary" onClick={() => setView('workspace')}>开始分析</button></div>}<p className="table-note">当前工作区会保存到此浏览器，显示“已保存到本机”后刷新可恢复。更换数据集会替换当前工作区；请先导出需要保留的报告。</p></section>}
        {view === 'source' && <section className="panel provenance-panel"><div className="section-heading"><h2>来源与数据快照</h2><span className="tag">{dataset ? (sourceInfo(dataset).status.includes('已核验公开') ? '公开文件匹配' : dataset.sourceNotes ? '上传者备注' : dataset.isPublic ? '公开来源' : '上传文件') : '未载入'}</span></div>{dataset ? <><SourceDetails dataset={dataset}/><SourceEditor key={dataset.fingerprint} dataset={dataset} onSave={sourceNotes => { const next = {...dataset, sourceNotes}; datasetRef.current = next; setDataset(next); setPreparationHistory(past => past.map(d => ({...d, sourceNotes}))); setNotice('出处备注已更新，分析结果与数据快照保持绑定。') }}/><p className="source-handling">文件在浏览器内读取与计算；PDF 视觉识别需另外授权发送当前页图像。AI 的字段摘要、样本与类别字典按独立授权发送。来源备注不会自动发送给模型；数据与备注自动保存于此浏览器，可通过“清除本机工作区”删除。</p>{dataset.origin && <section className="import-origin"><h3>文件解析与核对记录</h3><p>{dataset.origin.format} · {dataset.origin.method} · 表头原行 {dataset.origin.headerRow}</p><code>原文件 SHA-256: {dataset.origin.fileHash}</code><ul>{dataset.origin.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>{dataset.origin.pageImage && <button className="secondary" onClick={() => setShowPage(true)}>查看 PDF 原始页</button>}</section>}<div className="source-limit"><AlertCircle size={18} /><p>类型扫描只提供候选，不保证识别财务口径、统计范围或单位。数值字段可能是编号，汇总前需要人工确认；Excel 可选择工作表与表头；PDF 文字与视觉提取均需核对。暂不支持跨表联结与因果推断。</p></div><button className="secondary" onClick={() => { setDataTab('fields'); setWorkspaceSection('data'); setView('workspace') }}><Table2 size={16} />检查字段质量</button></> : <div className="small-empty">尚未载入数据，可导入 CSV、Excel、PDF 或重试公开来源。</div>}</section>}
        {studio && workspaceSection==='analysis' && <form className="investigation-composer" aria-label="分析问题" onSubmit={e=>{e.preventDefault();setAssistantSeed({question:analysisDraft.trim(),context:'',nonce:Date.now()});setAssistantOpen(true)}}><div className="composer-label"><button type="button" className="icon-button composer-open" aria-label={assistantOpen?'收起 AI 分析助手':'打开 AI 分析助手'} onClick={()=>setAssistantOpen(!assistantOpen)}><MessageSquareText size={18}/></button><label htmlFor="analysis-draft">{bundle||active?'沿着发现，继续追问':'从这份数据中，你想了解什么？'}</label><span>{models.ready ? '理解 → 确认口径 → 真实计算' : '未配置模型 · 本地手动计算仍可用'}</span></div><div className="composer-entry"><textarea id="analysis-draft" value={analysisDraft} onChange={e=>setAnalysisDraft(e.target.value)} maxLength={4000} rows={1} placeholder={bundle||active?'提出新问题，或点选图表分组限定追问范围…':'输入分析问题；也可以留空，让 AI 先帮你理解数据…'}/><button className="primary" type="submit">与 AI 一起分析<ArrowUpRight size={17}/></button></div></form>}
        <section className={'workspace-storage'+(saveState==='error'?' has-error':'')} aria-label="本机工作区"><div><span className="storage-state" role="status">{saveState==='saved'?<ShieldCheck size={16}/>:saveState==='pending'||saveState==='saving'?<LoaderCircle size={16} className="spin"/>:<Database size={16}/>}<strong>{saveState==='saved'?'已保存到本机':saveState==='saving'?'正在保存…':saveState==='pending'?'等待保存…':saveState==='error'?'本机保存不可用':'本机工作区'}</strong>{savedAt&&saveState==='saved'&&<time dateTime={savedAt}>{new Date(savedAt).toLocaleTimeString('zh-CN',{hour12:false})}</time>}</span>{storageError?<p role="alert">{storageError}</p>:<details className="storage-details"><summary>保存说明</summary><p>数据、来源备注与计算记录保存在此浏览器；刷新可恢复，不会因保存而上传。新导入会替换当前工作区。</p></details>}</div>{saveState==='error'&&!storageBlocked&&dataset&&<button className="text-button" onClick={()=>setSaveRetry(value=>value+1)} disabled={clearing}>重试保存</button>}{(dataset||storageError)&&<button className="text-button" onClick={()=>setShowClear(true)} disabled={computing||loading||clearing}>清除本机工作区</button>}</section>
        <footer><span>数鉴 Agent · 本地工作台 0.7</span><span>真实数据 · 明确口径 · 可回查证据</span></footer>
      </div>
    </main>
    <button hidden={studio && workspaceSection==='analysis'} className={'assistant-launcher' + (assistantOpen ? ' is-open' : '')} aria-label={assistantOpen ? '收起 AI 分析助手' : '打开 AI 分析助手'} aria-expanded={assistantOpen} aria-controls="ai-assistant-window" onClick={() => setAssistantOpen(!assistantOpen)}><MessageSquareText size={21} /><span>AI 分析助手</span><span className="launcher-dot" /></button>
    <AssistantWindow docked open={assistantOpen} onClose={() => setAssistantOpen(false)}><AiWorkbench seed={assistantSeed} dataset={dataset} loading={loading || computing} onExecute={executeAi} onBundle={receiveBundle} onEvidence={(id, label) => { openAiEvidence(id, label); }} profiles={models.profiles} selected={models.selected} onSelect={models.setSelectedId} onConfigure={() => setShowModels(true)} status={models.status} ready={models.ready} /></AssistantWindow>
    {importFile && <ImportDialog key={importFile.name + importFile.lastModified} file={importFile} models={models.profiles} selected={models.selected} onSelect={models.setSelectedId} onConfigure={() => setShowModels(true)} onClose={() => setImportFile(null)} onImport={next => { setImportFile(null); if (dataset) setPendingReplace({ kind: 'dataset', dataset: next }); else installDataset(next) }} />}
    {dataset && checkup && rolesOpen && <FieldRoles dataset={dataset} fields={checkup.all} overrides={fieldRoles} onChange={setFieldRoles} onClose={() => setRolesOpen(false)} />}
    {pendingReplace && <dialog ref={replaceRef} className="workspace-clear-dialog" aria-labelledby="replace-workspace-title" onCancel={event=>{event.preventDefault();setPendingReplace(null)}}>
      <h2 id="replace-workspace-title">替换当前工作区？</h2>
      <p>将用「{pendingReplace.kind === 'file' ? pendingReplace.file.name : pendingReplace.kind === 'public' ? 'OWID 公开能源数据' : pendingReplace.dataset.title}」替换当前数据。当前数据、{history.length} 个计算分支、{bundleHistory.length} 项 AI 分析{bundleHistory.length ? '' : '（暂无）'}、{Object.keys(fieldRoles).length} 项字段纠正与 {preparationHistory.length} 步处理记录会从本机工作区清除。</p>
      <p>原文件与已导出的报告不受影响。如仍需当前结果，请先取消并导出报告。</p>
      <div><button className="secondary" autoFocus onClick={()=>setPendingReplace(null)}>保留当前工作区</button><button className="primary" onClick={confirmReplace}>替换并导入</button></div>
    </dialog>}
    {showClear&&<dialog ref={clearRef} className="workspace-clear-dialog" aria-labelledby="clear-workspace-title" onCancel={event=>{event.preventDefault();if(!clearing)setShowClear(false)}}><h2 id="clear-workspace-title">清除本机工作区？</h2><p>将删除此浏览器保存的当前数据、来源备注、处理撤销记录、分析路径和计算结果。请先导出需要保留的报告。</p><p>原文件、已导出的报告和 AI 模型连接配置不受影响。</p><div><button className="secondary" autoFocus disabled={clearing} onClick={()=>setShowClear(false)}>保留工作区</button><button className="primary" disabled={clearing} onClick={()=>void discardWorkspace()}>{clearing?'正在清除…':'确认清除工作区'}</button></div></dialog>}
    {showPage && dataset?.origin?.pageImage && <PDFSourcePage image={dataset.origin.pageImage} onClose={() => setShowPage(false)} />}
    <ModelManager open={showModels} onClose={() => setShowModels(false)} profiles={models.profiles} selectedId={models.selectedId} onSelect={models.setSelectedId} onSave={models.save} onRemove={models.remove} defaultId={models.defaultId} canManage={models.canManage} onDefault={models.setDefault} />
    {loading && <div className="loading-indicator" role="status"><LoaderCircle size={18} className="spin" />正在读取真实数据</div>}
    <dialog ref={helpRef} className="help-dialog" onCancel={() => setShowHelp(false)} onClose={() => setShowHelp(false)}><div className="section-heading"><h2>工作台使用指南</h2><button className="icon-button" aria-label="关闭使用说明" onClick={() => setShowHelp(false)}><X size={20} /></button></div><ol><li>导入 CSV、Excel（XLSX / XLS）、PDF；也可读取 OWID 真实公开数据。</li><li>检查字段质量，确认分组、指标、筛选和单位。</li><li>执行求和、均值、计数、去重数或极值；探索页支持折线、柱状、散点、热力与结果表。</li><li>点选图表或结果表中的分组，查看来源记录。</li><li>使用公开数据的有限中文规则追问，保存计算分支。</li><li>导出 SVG、结果 CSV 或单文件 HTML 证据报告。</li></ol><p>AI 辅助分析可在网页“模型连接”中填写接口地址、API Key 和模型 ID，先理解目标与背景，存在歧义时先澄清，确认计划后真实计算并生成带引用解读。计算已接入 SQLite / sql.js 独立线程；SQL 与参数可查看，MCP 暂未接入。Excel 选择工作表、表头与范围后确认；PDF 支持文字提取和需授权的视觉转录，当前每次导入一页中的一张表，必须核对。当前限制：30 MB、100,000 行、200 列、200 个结果分组；筛选值展示前 500 个不同值。CSV 自动识别 UTF-8 / UTF-16 / GBK(GB18030) 编码与逗号、分号、制表符分隔；原始值保留，类型候选不是准确性承诺。</p><button className="primary" onClick={() => setShowHelp(false)}>返回工作台</button></dialog>
  </div>
}
