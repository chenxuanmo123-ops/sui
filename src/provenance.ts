import type { Dataset } from './data'
import { escapeHTML, PUBLIC_DATA_URL, PUBLIC_SOURCE_URL } from './data'

export type SourceNotes = {
  title: string; publisher: string; url: string; downloadUrl: string;
  citation: string; license: string; accessedAt: string; coverage: string; notes: string;
}
export const UCI_CSV_HASH = 'b3055ee355f59134d851d32641183cb4a8b45def7124d2f50442a042f358e0d9'
export const UCI_SOURCE: SourceNotes = {
  title: 'Online Shoppers Purchasing Intention Dataset', publisher: 'UCI Machine Learning Repository',
  url: 'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset',
  downloadUrl: 'https://archive.ics.uci.edu/static/public/468/online+shoppers+purchasing+intention+dataset.zip',
  citation: 'Sakar, C. & Kastro, Y. (2018). Online Shoppers Purchasing Intention Dataset. UCI Machine Learning Repository. https://doi.org/10.24432/C5F88Q',
  license: 'CC BY 4.0（署名 4.0 国际）；再分发或改编须保留署名与许可说明。',
  accessedAt: '2026-10-19', coverage: '历史电商访问样本；一行一次访问。具体采集年份和总体代表性未核实，不代表当前市场或全网用户。',
  notes: 'Revenue 为是否购买 TRUE/FALSE，不是营收金额。TrafficType 为未解释的类型代码，不能补造广告、搜索等名称。Month 没有年份，不能补造日期。原始 CSV 未修改，12,330 条记录、18 列。获取日期是本项目核验日期，不是采集日期。'
}
export function safeSourceURL(value: string): string | undefined {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined } catch { return undefined }
}
export function originalHash(d: Dataset) { return d.originalFileHash || d.origin?.fileHash || (!d.preparation ? d.fingerprint : '') }
export function sourceInfo(d: Dataset): SourceNotes & { status: string } {
  if (d.sourceNotes) return { ...d.sourceNotes, status: '上传者备注 · 未独立核验' }
  if (originalHash(d) === UCI_CSV_HASH) return { ...UCI_SOURCE, status: '原文件 SHA-256 与已核验公开 CSV 一致' }
  if (d.isPublic && d.sourceUrl === PUBLIC_SOURCE_URL) return {
    title: 'OWID Energy Data', publisher: 'Our World in Data', url: PUBLIC_SOURCE_URL, downloadUrl: PUBLIC_DATA_URL,
    citation: 'Our World in Data. Energy Data. 来源与上游引用请以仓库 README 和字段文档为准。',
    license: '不同字段可能引用不同上游来源；使用前核对仓库和原始提供方许可，不能统一推定所有数据均为同一许可。',
    accessedAt: d.loadedAt.slice(0, 10), coverage: '全球能源历史数据；覆盖范围、年份和单位按字段文档与实际记录确认。',
    notes: '从公开仓库地址读取；该地址可能更新。报告保存当前快照指纹，未固定上游提交版本。', status: '从公开仓库载入 · 未独立核验各上游记录'
  }
  return { title: d.title, publisher: '', url: d.sourceUrl || '', downloadUrl: '', citation: '', license: '', accessedAt: '', coverage: '', notes: '', status: '用户提供 · 未核验出处' }
}
export function sourceRows(d: Dataset): [string, string][] {
  const s = sourceInfo(d)
  return [['原文件', d.originalFileName || d.title], ['数据集名称', s.title], ['发布机构 / 平台', s.publisher || '未提供'], ['出处状态', s.status], ['来源页面', s.url || '未提供'], ['原始下载地址', s.downloadUrl || '未提供'], ['推荐引用', s.citation || '未提供'], ['许可与使用条件', s.license || '未提供；不能默认允许公开再分发'], ['获取 / 核验日期', s.accessedAt || '未提供；载入时间不等于采集时间'], ['数据范围与时效', s.coverage || '未说明；不能据此推断总体代表性'], ['来源备注', s.notes || '未提供'], ['本次载入时间', d.loadedAt], ['原文件 SHA-256', originalHash(d) || '未记录；不能用处理后快照代替'], ['当前数据快照 SHA-256', d.fingerprint], ...(d.preparation ? [['处理前快照 SHA-256', d.preparation.parentHash] as [string, string], ['已确认处理', d.preparation.steps.join('；')] as [string, string]] : [])]
}
export function sourceHTML(d: Dataset) {
  const h = escapeHTML
  return '<section class="report-source" style="overflow-wrap:anywhere"><h2>数据出处与引用</h2><dl>' + sourceRows(d).map(([k,v]) => '<dt>'+h(k)+'</dt><dd>' + ((k === '来源页面' || k === '原始下载地址') && safeSourceURL(v) ? '<a href="'+h(safeSourceURL(v)!)+'" target="_blank" rel="noopener noreferrer">'+h(v)+'</a>' : h(v)) + '</dd>').join('') + '</dl><p>原文件指纹只能确认文件一致性，不能证明每条记录无误。来源备注不替代数据质量核查；处理后数据与原文件通过指纹和记录索引区分。</p></section>'
}
export function validateSourceNotes(s: SourceNotes): string {
  for (const key of ['url', 'downloadUrl'] as const) if (s[key] && !safeSourceURL(s[key])) return '来源和下载地址只接受不含账号密码的 http / https 链接。'
  if (s.accessedAt && (!/^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt) || Number.isNaN(Date.parse(s.accessedAt)) || new Date(s.accessedAt).toISOString().slice(0,10)!==s.accessedAt)) return '请填写有效的获取日期。'
  for (const value of Object.values(s)) if (value.length > 2000) return '每项来源备注最多 2,000 个字符。'
  return ''
}
