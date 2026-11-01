import { openPDF } from './importers'
import { KNOWLEDGE_BASE } from './knowledge'

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

// The assistant's own knowledge base lives in knowledge.ts. Retrieval is the
// same keyword ranking used for uploaded files; only matched excerpts travel.
const methodDocs: ReferenceDoc[] = KNOWLEDGE_BASE.entries.map((note, index) => {
  const chunks = chunkText(note.body, 500, 0)
  return { id: 'knowledge-' + note.key + '-' + index, name: note.title, source: 'method' as const, chunks: chunks.map(text => ({ text })), chars: note.body.length }
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
