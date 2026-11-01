import { useEffect, useState } from 'react'
import { buildCheckup } from './checkup'
import type { Checkup, CheckupOverrides } from './checkup'
import type { Dataset } from './data'

/**
 * Build the deterministic data checkup once per dataset/correction change.
 * App owns the result so the checkup, field shelf, data table and role dialog
 * all describe the same corrected roles instead of running separate detections.
 */
export function useCheckup(dataset: Dataset | null, overrides: CheckupOverrides, name: (key: string) => string = key => key) {
  const [inspection, setInspection] = useState<{ dataset: Dataset; checkup: Checkup } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!dataset) { setInspection(null); setError(''); return }
    let cancelled = false
    setError('')
    // Let the first paint show the imported file before a full quality pass.
    const timer = setTimeout(() => {
      try {
        // The sentences this builds are reader-facing, so they follow the
        // column-name toggle; mappings and SQL still carry the raw keys.
        const next = buildCheckup(dataset, overrides, name)
        if (!cancelled) setInspection({ dataset, checkup: next })
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '无法完成数据体检')
      }
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [dataset, overrides, name])

  // Keep the previous inspection while a correction recomputes, so the role
  // dialog does not unmount under the user's cursor. A result built for another
  // dataset is never shown.
  return { checkup: inspection?.dataset === dataset ? inspection.checkup : null, error }
}
