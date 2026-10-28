import { describe, expect, it } from 'vitest'
import headers from './fixtures/owid-headers.json'
import countries from './fixtures/owid-countries.json'
import { OWID_COUNTRY_LABELS } from '../src/owid-countries'
import { isOwidHeaders, OWID_FIELD_LABELS, owidFieldLabel } from '../src/owid-labels'
import { countryLabels, identityLabels, publicLabels } from '../src/labels'
import type { Row } from '../src/data'

// Labels are a view only. These tests pin the two properties that keep them
// safe: every column of the pinned file has a name, and no name changes a value.

describe('OWID field labels', () => {
  it('names every column of the pinned header', () => {
    const missing = headers.filter((key: string) => !OWID_FIELD_LABELS[key])
    expect(missing).toEqual([])
    expect(Object.keys(OWID_FIELD_LABELS).sort()).toEqual([...headers].sort())
  })

  it('has no empty or duplicated names', () => {
    const values = Object.values(OWID_FIELD_LABELS)
    expect(values.every(name => name.trim().length > 0)).toBe(true)
    expect(new Set(values).size).toBe(values.length)
  })

  it('keeps units in the name', () => {
    expect(OWID_FIELD_LABELS.renewables_electricity).toBe('可再生能源发电量（TWh）')
    expect(OWID_FIELD_LABELS.renewables_share_elec).toBe('可再生能源占发电量比重（%）')
    expect(OWID_FIELD_LABELS.solar_elec_per_capita).toBe('人均太阳能发电量（kWh/人）')
    expect(OWID_FIELD_LABELS.carbon_intensity_elec).toBe('电力碳强度（gCO₂/kWh）')
  })

  it('returns undefined for a column it does not know', () => {
    expect(owidFieldLabel('made_up_column')).toBeUndefined()
  })

  it('recognizes the pinned snapshot by its columns, not by how it was loaded', () => {
    // The built-in download can fail on a slow network; a copy the reader saved
    // and imported must still get the Chinese names.
    expect(isOwidHeaders(headers)).toBe(true)
    expect(isOwidHeaders(['country', 'year', 'renewables_electricity'])).toBe(false)
    expect(isOwidHeaders(['a', 'b'])).toBe(false)
  })

  it('labels the regional aggregates, not only countries', () => {
    expect(OWID_COUNTRY_LABELS['World']).toBe('全球')
    expect(OWID_COUNTRY_LABELS['European Union (27)']).toBe('欧盟（27 国）')
    expect(OWID_COUNTRY_LABELS['China']).toBe('中国')
    expect(OWID_COUNTRY_LABELS['Africa (EIA)']).toBe('非洲（EIA）')
  })
})

describe('publicLabels', () => {
  const countries = new Map([
    ['China', '中国'],
    ['United States', '美国'],
  ])
  const labels = publicLabels(countries)

  it('names fields in Chinese and falls back to the raw key', () => {
    expect(labels.field('coal_electricity')).toBe('煤炭发电量（TWh）')
    expect(labels.field('vendor_code')).toBe('vendor_code')
  })

  it('translates only the country column', () => {
    expect(labels.value('country', 'China')).toBe('中国')
    expect(labels.value('country', 'World')).toBe('全球')
    // A country name in any other column is data, not a region label.
    expect(labels.value('coal_electricity', 'China')).toBe('China')
    expect(labels.value('coal_electricity', '12.5')).toBe('12.5')
    expect(labels.value('country', '')).toBe('')
    expect(labels.value('country', null)).toBe('')
  })
})

describe('country labels', () => {
  it('names every country/region value in the pinned snapshot', () => {
    const missing = countries.filter((name: string) => !OWID_COUNTRY_LABELS[name])
    expect(missing).toEqual([])
  })

  it('keeps the source tag so different definitions stay distinguishable', () => {
    const names = Object.values(OWID_COUNTRY_LABELS)
    expect(new Set(names).size).toBe(names.length)
    expect(OWID_COUNTRY_LABELS['Europe (EI)']).not.toBe(OWID_COUNTRY_LABELS['Europe (EIA)'])
  })
})

describe('countryLabels', () => {
  it('maps country and aggregate values by name, not by ISO code', () => {
    const rows: Row[] = [
      { country: 'China', iso_code: 'CHN' },
      { country: 'United States', iso_code: 'USA' },
      { country: 'World', iso_code: '' },
      { country: 'China', iso_code: 'CHN' },
    ]
    const map = countryLabels(rows)
    expect(map.get('China')).toBe('中国')
    expect(map.get('United States')).toBe('美国')
    expect(map.get('World')).toBe('全球')
  })
})

describe('identityLabels', () => {
  it('changes nothing for uploaded files', () => {
    expect(identityLabels.field('Amount')).toBe('Amount')
    expect(identityLabels.value('Amount', 'China')).toBe('China')
    expect(identityLabels.value('Amount', null)).toBe('')
  })
})
