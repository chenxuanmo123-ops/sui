import { describe, expect, it } from 'vitest'
import { BRANCH_TITLE_LIMIT, normalizeBranchTitle, planBranchRemoval, removeBranches, renameBranch } from '../src/branches'
import type { Analysis, AnalysisScope } from '../src/data'

function branch(id: number, question: string, parent?: number): Analysis {
  const scope: AnalysisScope | undefined = parent === undefined ? undefined : {
    datasetHash: 'a'.repeat(64), loadedAt: '2026-10-26T00:00:00.000Z', parentAnalysisId: parent,
    parentTitle: '上级分组', label: 'China', rowIds: [2], baseline: { metric: 'value', aggregate: 'sum', unit: '', value: 1 },
  }
  return {
    id, question, scope,
    mapping: { x: 'year', metric: 'value', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum', conditions: [] },
    points: [{ label: '2020', value: 1, rowIds: [2] }],
    usedRows: 1, skipped: 0, matched: 1, createdAt: '2026-10-26T00:00:00.000Z',
    datasetHash: 'a'.repeat(64), finding: '2020 年为 1', operations: [],
  }
}

describe('分析分支重命名与删除', () => {
  it('名称去首尾空白、压缩空白并限长，空名称拒绝', () => {
    expect(normalizeBranchTitle('  年度   销售额  ')).toBe('年度 销售额')
    expect(normalizeBranchTitle('x'.repeat(120))).toHaveLength(BRANCH_TITLE_LIMIT)
    expect(() => normalizeBranchTitle('   ')).not.toThrow()
  })
  it('只改指定分支的名称，不碰口径、数值与来源，且不修改原数组', () => {
    const history = [branch(1, '原始问题'), branch(2, '另一个问题')]
    const next = renameBranch(history, 2, '  新的   分支名 ')
    expect(next.find(item => item.id === 2)?.question).toBe('新的 分支名')
    expect(next.find(item => item.id === 1)).toBe(history[0])
    expect(next[1].mapping).toBe(history[1].mapping)
    expect(next[1].points).toBe(history[1].points)
    expect(history[1].question).toBe('另一个问题')
    expect(() => renameBranch(history, 2, '   ')).toThrow('分支名称不能为空')
    expect(() => renameBranch(history, 99, '名称')).toThrow('没有找到')
  })
  it('删除分支时一并纳入其追问后代和包含它们的整项 AI 分析', () => {
    const history = [branch(1, '总体'), branch(2, '追问 A', 1), branch(3, '另一个分析'), branch(4, '追问 B', 3), branch(5, '无关分支')]
    const bundles = [{ key: 'bundle-1', results: [branch(1, '总体'), branch(3, '另一个分析')] }]
    const removal = planBranchRemoval(history, bundles, 1)
    expect([...removal.ids].sort()).toEqual([1, 2, 3, 4])
    expect([...removal.keys]).toEqual(['bundle-1'])
    expect(removeBranches(history, removal.ids).map(item => item.id)).toEqual([5])
    expect(history).toHaveLength(5)
  })
  it('删除独立分支不牵连其他分支或 AI 分析', () => {
    const history = [branch(1, '总体'), branch(2, '追问 A', 1), branch(3, '独立')]
    const removal = planBranchRemoval(history, [{ key: 'bundle-1', results: [branch(1, '总体')] }], 3)
    expect([...removal.ids]).toEqual([3])
    expect(removal.keys.size).toBe(0)
  })
})
