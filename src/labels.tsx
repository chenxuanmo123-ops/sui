// Display names for fields and values. This is a view layer only: the dataset
// keeps its original keys and values, so SQL, fingerprints and exported reports
// still refer to the pinned upstream file. Components that show a field to the
// reader call useLabels(); anything that computes or queries keeps the raw key.
import { createContext, useContext } from 'react'
import type { Row } from './data'
import { OWID_FIELD_LABELS } from './owid-labels'
import { OWID_COUNTRY_LABELS } from './owid-countries'

export type Labels = {
  /** Chinese name for a column key, or the key itself when there is none. */
  field: (key: string) => string
  /** Chinese name for a cell value (regional/aggregate names), else the value. */
  value: (field: string, value: string | null | undefined) => string
}

/** Append a unit unless the display name already carries it (OWID names do). */
export function withUnit(name: string, unit: string) {
  if (!unit) return name
  return name.includes(unit) ? name : `${name}（${unit}）`
}

export const identityLabels: Labels = {
  field: key => key,
  value: (_field, value) => value ?? '',
}

export const LabelContext = createContext<Labels>(identityLabels)
export const useLabels = () => useContext(LabelContext)

/**
 * Country/region value → Chinese, restricted to the values this snapshot
 * actually contains. The table is static: `Intl.DisplayNames` rejects the
 * three-letter ISO codes OWID ships and throws, so it cannot be used here.
 */
export function countryLabels(rows: Row[]) {
  const map = new Map<string, string>()
  for (const row of rows) {
    const country = row.country
    if (!country || map.has(country)) continue
    const name = OWID_COUNTRY_LABELS[country]
    if (name) map.set(country, name)
  }
  return map
}

export function publicLabels(countries: Map<string, string>): Labels {
  return {
    field: key => OWID_FIELD_LABELS[key] ?? key,
    value: (field, value) => {
      if (!value) return ''
      if (field !== 'country') return value
      return countries.get(value) ?? OWID_COUNTRY_LABELS[value] ?? value
    },
  }
}
