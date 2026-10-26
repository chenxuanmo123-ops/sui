import type { Analysis } from './data'

export const BRANCH_TITLE_LIMIT = 80

export function normalizeBranchTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ').slice(0, BRANCH_TITLE_LIMIT)
}

/** Renames only the branch label; mapping, points, evidence and SQL stay untouched. */
export function renameBranch(history: Analysis[], id: number, title: string): Analysis[] {
  const next = normalizeBranchTitle(title)
  if (!next) throw new Error('分支名称不能为空')
  if (!history.some(item => item.id === id)) throw new Error('没有找到要重命名的分析分支')
  return history.map(item => item.id === id ? { ...item, question: next } : item)
}

/**
 * Deleting a branch also removes its follow-up branches and every AI bundle
 * that contains one of them: partial bundles would leave evidence citations
 * and review statements pointing at results the user can no longer inspect.
 */
export function planBranchRemoval(history: Analysis[], bundles: { key: string; results: Analysis[] }[], id: number) {
  const ids = new Set([id])
  const keys = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const item of history) {
      if (!ids.has(item.id) && item.scope && ids.has(item.scope.parentAnalysisId)) { ids.add(item.id); changed = true }
    }
    for (const bundle of bundles) {
      if (keys.has(bundle.key) || !bundle.results.some(result => ids.has(result.id))) continue
      keys.add(bundle.key); changed = true
      for (const result of bundle.results) if (!ids.has(result.id)) { ids.add(result.id); changed = true }
    }
  }
  return { ids, keys }
}

export function removeBranches(history: Analysis[], ids: Set<number>): Analysis[] {
  return history.filter(item => !ids.has(item.id))
}
