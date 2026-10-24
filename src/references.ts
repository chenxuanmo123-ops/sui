import { openPDF } from './importers'

// Reference material is retrieved locally in the browser. Only the excerpts
// listed in `retrieveReferences` are sent with a model request, never a whole
// uploaded document. The built-in notes are original method reminders, not
// data, and never contribute a statistic.
export type ReferenceSource = 'file' | 'method'
export type ReferenceChunk = { page?: number; text: string }
export type ReferenceDoc = { id: string; name: string; source: ReferenceSource; chunks: ReferenceChunk[]; chars: number }
// Only fields the server accepts are kept in an excerpt. The BM25 score is an
// internal ranking detail; sending it made /api/ai/plan reject every request
// that carried a retrieved reference.
export type ReferenceExcerpt = { id: string; title: string; source: ReferenceSource; page?: number; text: string }

export const REFERENCE_LIMITS = {
  files: 5,
  fileBytes: 2 * 1024 * 1024,
  chars: 300_000,
  chunks: 120,
  chunk: 700,
  overlap: 100,
  retrieved: 4,
  sentChars: 6000,
} as const

type Note = { key: string; title: string; body: string }

// Concise, deliberately conservative reminders. They are written for this
// project and are retrieved by keyword; they do not encode business facts.
const METHOD_NOTES: Note[] = [
  { key: 'sample', title: '样本代表性：这份数据代表谁', body: '平台记录、问卷回答和截取时段都是可得样本，不等于目标总体。先确认谁被纳入、谁被排除、覆盖什么时间；结论写成“在这份样本中”，不写成“用户普遍”。检查：分母覆盖哪些人，缺失群体的结果是否不同。' },
  { key: 'missing', title: '缺失值不是零', body: '空值、未知、未填与真实的零含义不同。删行、保留在分母、只对非空值求均值会得到不同结果。报告空值和无法解析的数值各有多少，并写明处理方式；不要用零填补比例的分母。检查：空值、非法数值、未识别类别分别有多少。' },
  { key: 'denominator', title: '比率的分母口径', body: '转化率、通过率、退货率的分母应当是“有资格进入该步骤”的记录。先按结果列筛选会改变分母；分子必须包含在分母内；未知结果单独计数，不并入失败。检查：分子、分母、因未知而排除各多少。' },
  { key: 'grain', title: '行粒度与重复记录', body: '一行可能是一条记录、一个商品、一次快照或一个人。重复行会放大计数和求和；聚合前确认主键与时间戳，写清去重规则。检查：完全重复行、同一主键多行、跨期快照是否被当成同一对象。' },
  { key: 'center', title: '均值、中位数与极端值', body: '金额、时长、次数常有长尾，均值和总和容易被极端值拉动；中位数与 P25/P75 更能描述典型水平。报告单位、范围与样本数，不因为均值更高就断言普遍更高。检查：最大最小值、IQR 候选、零值占比。' },
  { key: 'units', title: '单位与币种不能混用', body: '元与万元、件与箱、小时与分钟混在一起会直接改变量级；不同币种需要汇率和换算日期。同一张图只用一种口径；单位无法确认时标注“未确认”，不要自行猜测百万或十亿。检查：数值量级、货币符号、单位后缀。' },
  { key: 'time', title: '时间比较要看完整序列', body: '不同长度的月份、缺失日期、累计值与当期值不能直接比较；同比与环比需要同一口径。趋势描述需要完整时间序列，不能只看首尾两点。检查：时间覆盖范围、重复日期、字段是状态量还是期间量。' },
  { key: 'small', title: '小样本分组不稳定', body: '只有几条记录的分组，比例和均值波动很大。不要挑差异最大的小组讲故事；合并分组或同时显示每组记录数。检查：每组 n、最小分组、排序时是否把 n 藏起来。' },
  { key: 'multiple', title: '多重比较与事后挑选', body: '扫描很多分组和指标后再挑“最显著”的差异，容易把噪声当成发现。重要差异应在独立数据或新时间窗复核，并说明一共比较了多少种切法。检查：比较次数、是否为看到结果后才提出的假设。' },
  { key: 'simpson', title: '分组构成与辛普森悖论', body: '总体比例与各分组比例可能方向相反，原因是各组权重发生变化。比较总体比率前先看分组构成；必要时分层报告，不把总体变化直接归因于个体行为。检查：各组占比是否随时间变化。' },
  { key: 'causal', title: '相关不等于因果', body: '同时变化或先后发生都不能证明因果；可能存在共同原因、选择偏差或反向影响。用户问“为什么”“是什么导致”时，只能列出待验证机制。描述使用“相关”“同时出现”，候选解释明确标为待验证；只有对照、干预或可靠识别策略才讨论因果。检查：时间顺序、对照组、是否有第三变量。' },
  { key: 'chart', title: '图表刻度与视觉诚实', body: '柱形图应当从零开始，截断纵轴会夸大差异；双轴图容易制造虚假关联。折线适合有序时间，分类比较用柱形；面积与三维效果会扭曲感知。检查：轴范围、是否双轴、点数与缺失。' },
  { key: 'provenance', title: '来源、快照与可复现', body: '记录文件、快照哈希、筛选条件、单位、SQL 与生成时间。没有来源的数字不能当作证据；结果只对当前快照成立，换数据后必须重新执行，不把旧结论直接搬过去。检查：源文件、下载日期、口径与执行记录。' },
  { key: 'stock', title: '余额与流量的区别', body: '余额、库存、累计人数是时点状态量，不能跨期相加；收入、访问量、发电量是期间量，可以按期求和。先判断字段语义再选聚合方式，不把库存总和当成期间产量。检查：字段是时点快照还是期间发生。' },
  { key: 'points', title: '百分点与百分比', body: '从 5% 到 7% 是上升 2 个百分点，相对上升约 40%。报告时写清基数和说法，不混用“比例变化”和“数量变化”；百分比的分母也要说明。检查：基数、绝对变化、相对变化。' },
  { key: 'quality', title: '先做质量检查再分组', body: '先看行数、列数、缺失、类型、重复与取值范围，再做聚合。异常值先核对录入单位和业务规则，不自动删除；清理步骤保留记录，保证可以从原文件复核。检查：每列有效值、异常候选、清洗前后行数。' },
]

const methodDocs: ReferenceDoc[] = METHOD_NOTES.map((note, index) => {
  const chunks = chunkText(note.body, 500, 0)
  return { id: 'method-' + note.key + '-' + index, name: note.title, source: 'method', chunks: chunks.map(text => ({ text })), chars: note.body.length }
})

const STOP = new Set(['数据', '分析', '如何', '什么', '怎么', '是否', '可以', '一个', '这个', '哪些', '问题', '情况', 'the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'from'])

export function chunkText(input: string, max: number = REFERENCE_LIMITS.chunk, overlap: number = REFERENCE_LIMITS.overlap): string[] {
  const text = input.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return []
  if (text.length <= max) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + max)
    if (end < text.length) {
      const window = text.slice(start, end)
      const cut = Math.max(window.lastIndexOf('。'), window.lastIndexOf('\n'), window.lastIndexOf('；'), window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
      if (cut >= Math.floor(max * 0.45)) end = start + cut + 1
    }
    const slice = text.slice(start, end).trim()
    if (slice) chunks.push(slice)
    if (end >= text.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks
}

export function referenceTokens(input: string): string[] {
  const text = input.normalize('NFKC').toLowerCase()
  const tokens: string[] = []
  for (const match of text.matchAll(/[a-z0-9]+/g)) {
    const token = match[0]
    if (token.length > 1 || /\d/.test(token)) tokens.push(token)
  }
  for (const match of text.matchAll(/[㐀-鿿]+/g)) {
    const run = match[0]
    if (run.length === 1) tokens.push(run)
    else for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

function count(tokens: string[]) {
  const map = new Map<string, number>()
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1)
  return map
}

// BM25 over chunks. Title tokens are indexed twice so a note whose title names
// the topic wins over a passing mention, while body evidence still decides ties.
export function retrieveReferences(files: ReferenceDoc[], query: string, limit = REFERENCE_LIMITS.retrieved): ReferenceExcerpt[] {
  const terms = [...new Set(referenceTokens(query).filter(token => !STOP.has(token)))]
  if (!terms.length) return []
  const docs = [...methodDocs, ...files]
  const entries = docs.flatMap(doc => doc.chunks.map(chunk => ({
    doc, chunk,
    tokens: [...referenceTokens(chunk.text), ...referenceTokens(doc.name), ...referenceTokens(doc.name)],
  })))
  if (!entries.length) return []
  const lengths = entries.map(entry => entry.tokens.length)
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length || 1
  const frequencies = entries.map(entry => count(entry.tokens))
  const documentFrequency = new Map<string, number>()
  for (const term of terms) documentFrequency.set(term, frequencies.reduce((n, frequency) => n + (frequency.has(term) ? 1 : 0), 0))
  const k1 = 1.2, b = 0.75
  const scored = entries.map((entry, index) => {
    let score = 0
    for (const term of terms) {
      const tf = frequencies[index].get(term) ?? 0
      if (!tf) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (entries.length - df + 0.5) / (df + 0.5))
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * lengths[index] / average))
    }
    return { ...entry, score }
  }).filter(entry => entry.score >= 1.1).sort((a, b) => b.score - a.score)
  const picked: typeof scored = []
  const perDoc = new Map<string, number>()
  const perSource = { file: 0, method: 0 }
  for (const candidate of scored) {
    if (picked.length >= limit) break
    if ((perDoc.get(candidate.doc.id) ?? 0) >= 2) continue
    if (perSource[candidate.doc.source] >= (candidate.doc.source === 'file' ? 3 : 2)) continue
    picked.push(candidate)
    perDoc.set(candidate.doc.id, (perDoc.get(candidate.doc.id) ?? 0) + 1)
    perSource[candidate.doc.source]++
  }
  let fileLetter = 0, methodLetter = 0
  return picked.map(candidate => ({
    id: (candidate.doc.source === 'file' ? 'R-' : 'M-') + String.fromCharCode(65 + (candidate.doc.source === 'file' ? fileLetter++ : methodLetter++)),
    title: candidate.doc.name,
    source: candidate.doc.source,
    ...(candidate.chunk.page ? { page: candidate.chunk.page } : {}),
    text: candidate.chunk.text,
  }))
}

export function referenceKey(docs: ReferenceDoc[]) {
  return docs.map(doc => doc.id + ':' + doc.chars + ':' + doc.chunks.length).join('|')
}

export function referenceQuery(question: string, context: string, plan?: { goal: string; scene: string; tasks: { title: string }[] }) {
  return [question, context, plan?.goal, plan?.scene, ...(plan?.tasks ?? []).map(task => task.title)].filter(Boolean).join('\n')
}

export async function readReferenceFile(file: File): Promise<ReferenceDoc> {
  const name = file.name.replace(/[\r\n]+/g, ' ').trim().slice(0, 160) || '参考资料'
  if (file.size > REFERENCE_LIMITS.fileBytes) throw new Error('单份参考资料不能超过 2 MB。')
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') return readPDFReference(name, file)
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.markdown') || file.type.startsWith('text/')) {
    const text = (await file.text()).replace(/^﻿/, '')
    const chunks = limitChunks(chunkText(text).map(chunk => ({ text: chunk })))
    if (!chunks.length) throw new Error('参考资料没有可检索的文字。')
    return { id: crypto.randomUUID(), name, source: 'file', chunks, chars: text.length }
  }
  throw new Error('参考资料仅支持 PDF、TXT 或 Markdown。CSV 数据请从顶部导入。')
}

async function readPDFReference(name: string, file: File): Promise<ReferenceDoc> {
  const document = await openPDF(file)
  const chunks: ReferenceChunk[] = []
  let chars = 0
  try {
    for (let pageNumber = 1; pageNumber <= document.pdf.numPages; pageNumber++) {
      const page = await document.pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const lines: { y: number; height: number; items: { x: number; str: string }[] }[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const textItem = item as { str: string; transform: number[]; height: number }
        const y = textItem.transform[5]
        let line = lines.find(candidate => Math.abs(candidate.y - y) <= Math.max(2, Math.abs(textItem.height) * 0.25))
        if (!line) { line = { y, height: Math.abs(textItem.height), items: [] }; lines.push(line) }
        line.items.push({ x: textItem.transform[4], str: textItem.str.trim() })
      }
      const text = lines.sort((a, b) => b.y - a.y).map(line => line.items.sort((a, b) => a.x - b.x).map(item => item.str).join(' ').replace(/\s+([,.;:!?，。；：！？])/g, '$1')).join('\n').trim()
      if (!text) continue
      chars += text.length
      if (chars > REFERENCE_LIMITS.chars) throw new Error('PDF 文字超过 30 万字符，请缩小参考资料范围。')
      for (const chunk of chunkText(text)) chunks.push({ page: pageNumber, text: chunk })
      if (chunks.length > REFERENCE_LIMITS.chunks) throw new Error('参考资料切分后超过 120 段，请上传更短的文档。')
    }
  } finally {
    document.close()
  }
  if (!chunks.length) throw new Error('这份 PDF 没有可提取的文字层，无法用于检索。扫描件请先转为可复制文字的 PDF。')
  return { id: crypto.randomUUID(), name, source: 'file', chunks: limitChunks(chunks), chars }
}

function limitChunks(chunks: ReferenceChunk[]) {
  if (chunks.length > REFERENCE_LIMITS.chunks) throw new Error('参考资料切分后超过 120 段，请上传更短的文档。')
  return chunks
}
