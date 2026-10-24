import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parseCSV, PUBLIC_DATA_COMMIT, PUBLIC_DATA_URL, PUBLIC_SOURCE_LEGACY, PUBLIC_SOURCE_URL } from '../src/data'
import type { Dataset } from '../src/data'
import { sourceInfo, sourceRows, sourceHTML, safeSourceURL, UCI_CSV_HASH, UCI_SOURCE, validateSourceNotes } from '../src/provenance'
const bytes = readFileSync('tests/fixtures/uci-online-shoppers.csv')
const data: Dataset = { ...parseCSV(bytes.toString('utf8')), title: 'uci-online-shoppers.csv', sourceUrl: '', loadedAt: '2026-10-19T00:00:00Z', fingerprint: createHash('sha256').update(bytes).digest('hex'), isPublic: false }
describe('真实公开数据出处与上传者声明', () => {
 it('只在原文件指纹精确匹配时提供预先核验的UCI引用；文件名或来源URL不能冒充核验', () => {
  expect(data.fingerprint).toBe(UCI_CSV_HASH)
  expect(sourceInfo(data).citation).toContain('10.24432/C5F88Q')
  expect(sourceInfo(data).status).toContain('已核验公开')
  const changed = {...data, fingerprint: 'different-file', sourceUrl: UCI_SOURCE.url}
  expect(sourceInfo(changed).status).toBe('用户提供 · 未核验出处')
  expect(sourceInfo(changed).citation).toBe('')
 })
 it('处理后仍引用原文件，分别展示原文件、父快照和当前快照指纹', () => {
  const clean = {...data, originalFileHash: data.fingerprint, fingerprint:'cleaned-snapshot', preparation:{parentHash:data.fingerprint, steps:['用户确认修剪空白']}}
  expect(sourceInfo(clean).status).toContain('已核验公开')
  expect(Object.fromEntries(sourceRows(clean))['原文件 SHA-256']).toBe(UCI_CSV_HASH)
  expect(sourceHTML(clean)).toContain('cleaned-snapshot')
  expect(sourceHTML(clean)).toContain('用户确认修剪空白')
  expect(sourceInfo({...clean, originalFileHash:undefined}).status).toBe('用户提供 · 未核验出处')
 })
 it('自行填写的引用有明确声明状态；未知许可不能写成可自由使用', () => {
  expect(sourceInfo({...data,sourceNotes:{...UCI_SOURCE,publisher:'上传者备注'}}).status).toBe('上传者备注 · 未独立核验')
  expect(sourceHTML({...data,fingerprint:'unknown'})).toContain('不能默认允许公开再分发')
 })
 it('报告转义恶意文本并拒绝脚本、文件及含密码的链接', () => {
  for (const url of ['javascript:alert(1)','data:text/html,test','file:///C:/secret','https://user:password@example.com/']) expect(safeSourceURL(url)).toBeUndefined()
  const html = sourceHTML({...data, sourceNotes:{...UCI_SOURCE,title:'<script>alert(1)</script>',url:'javascript:alert(1)',downloadUrl:'file:///secret'}})
  expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('href="javascript:');expect(html).not.toContain('href="file:')
  expect(sourceHTML(data)).toContain('rel="noopener noreferrer"')
 })
 it('公开 OWID 数据固定到上游提交，旧工作区仍能识别出处', () => {
  expect(PUBLIC_DATA_URL).toContain('/' + PUBLIC_DATA_COMMIT + '/')
  expect(PUBLIC_SOURCE_URL).toContain(PUBLIC_DATA_COMMIT)
  const pinned = {...data, fingerprint: 'owid-test-snapshot', isPublic: true, sourceUrl: PUBLIC_SOURCE_URL}
  expect(sourceInfo(pinned).notes).toContain(PUBLIC_DATA_COMMIT.slice(0, 7))
  expect(sourceInfo(pinned).status).toContain('固定提交')
  expect(sourceInfo({...pinned, sourceUrl: PUBLIC_SOURCE_LEGACY}).status).toContain('固定提交')
  expect(sourceInfo({...pinned, sourceUrl: PUBLIC_SOURCE_LEGACY}).notes).toContain('尚未固定')
 })
 it('备注校验限制链接、日期和长度，不把载入日期当作采集时间', () => {
  expect(validateSourceNotes(UCI_SOURCE)).toBe('')
  expect(validateSourceNotes({...UCI_SOURCE,url:'javascript:alert(1)'})).toContain('http')
  expect(validateSourceNotes({...UCI_SOURCE,accessedAt:'2026-02-30'})).toContain('日期')
  expect(validateSourceNotes({...UCI_SOURCE,notes:'x'.repeat(2001)})).toContain('2,000')
  expect(sourceHTML(data)).toContain('不是采集日期')
 })
})
