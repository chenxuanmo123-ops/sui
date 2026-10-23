import { describe, expect, it } from 'vitest'
import { REFERENCE_LIMITS, chunkText, referenceKey, referenceQuery, referenceTokens, retrieveReferences } from '../src/references'
import type { ReferenceDoc } from '../src/references'

const doc = (overrides: Partial<ReferenceDoc> = {}): ReferenceDoc => ({
  id: 'file-1',
  name: '业务口径说明.txt',
  source: 'file',
  chunks: [{ text: '本季度退款率按订单数计算，分母为已支付订单，未支付订单不计入。' }],
  chars: 31,
  ...overrides,
})

describe('参考资料切分与检索', () => {
  it('长文本按窗口切分，保留重叠且不产生空段', () => {
    const text = ('第一季度收入按已确认订单计算。' + '口径说明需要与财务确认。').repeat(80)
    const chunks = chunkText(text, 200, 40)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= 200)).toBe(true)
    expect(chunks.slice(1).every((chunk, index) => chunk.startsWith(chunks[index].slice(-40)))).toBe(true)
    expect(chunkText('短文本', 200, 40)).toEqual(['短文本'])
  })

  it('中文按二元词组、英文按单词切词，保留数字', () => {
    const tokens = referenceTokens('缺失值 CSV missing 2024')
    expect(tokens).toContain('缺失')
    expect(tokens).toContain('失值')
    expect(tokens).toContain('missing')
    expect(tokens).toContain('2024')
    expect(tokens).not.toContain('缺')
  })

  it('与缺失值相关的问题优先召回缺失说明', () => {
    const hits = retrieveReferences([], '这些空值缺失值该怎么处理，会影响比例吗')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].title).toContain('缺失')
    expect(hits.every(hit => hit.source === 'method' && /^M-[A-F]$/.test(hit.id))).toBe(true)
  })

  it('因果问题召回相关与因果的边界说明', () => {
    const hits = retrieveReferences([], '为什么销量下降，是政策导致的吗')
    expect(hits.map(hit => hit.title).join(' ')).toContain('因果')
  })

  it('上传资料与问题直接匹配时排在方法提示之前', () => {
    const hits = retrieveReferences([doc()], '退款率的分母到底怎么算，未支付订单算吗')
    expect(hits[0].source).toBe('file')
    expect(hits[0].id).toBe('R-A')
    expect(hits[0].title).toBe('业务口径说明.txt')
  })

  it('没有匹配词时返回空数组，不拿低相关段落凑数', () => {
    expect(retrieveReferences([], '')).toEqual([])
    expect(retrieveReferences([], '量子色动力学的胶子禁闭')).toEqual([])
  })

  it('限制条数、每篇最多两段、编号稳定且不重复', () => {
    const long: ReferenceDoc = {
      ...doc({ id: 'file-long', name: '长文.txt', chars: 4000 }),
      chunks: Array.from({ length: 6 }, (_, index) => ({ page: index + 1, text: '退款率按订单数计算，分母为已支付订单。' + index })),
    }
    const hits = retrieveReferences([long, doc()], '退款率的分母怎么算')
    expect(hits.length).toBeLessThanOrEqual(REFERENCE_LIMITS.retrieved)
    expect(hits.filter(hit => hit.source === 'file').length).toBeLessThanOrEqual(3)
    expect(hits.filter(hit => hit.source === 'method').length).toBeLessThanOrEqual(2)
    expect(new Set(hits.map(hit => hit.id)).size).toBe(hits.length)
    for (const hit of hits) expect(hit.id).toMatch(/^[RM]-[A-F]$/)
    expect(hits.find(hit => hit.source === 'file')?.page).toBe(1)
  })

  it('参考资料与检索问题变化会改变计划指纹', () => {
    const base = doc()
    const other = doc({ id: 'file-2', name: '另一份.txt' })
    expect(referenceKey([base])).not.toBe(referenceKey([base, other]))
    expect(referenceKey([base])).toBe(referenceKey([{ ...base }]))
    const query = referenceQuery('销量下降', '业务背景', { goal: '找原因', scene: '月度复盘', tasks: [{ title: '按地区分组' }] })
    expect(query).toContain('销量下降')
    expect(query).toContain('按地区分组')
  })
})
