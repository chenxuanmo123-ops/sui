import { describe, expect, it } from 'vitest'
import { parsePublicQuestion } from '../src/data'
import type { Mapping } from '../src/data'

const base: Mapping = {
  x: 'year',
  metric: 'renewables_electricity',
  filter: 'country',
  value: 'China',
  from: '2015',
  to: '2022',
  unit: 'TWh',
  aggregate: 'sum',
  timeBucket: 'year',
}

describe('公开能源问题的规则解析', () => {
  it('追问「改看风能」切换指标，保留原有地区与年份范围', () => {
    const next = parsePublicQuestion('改看风能', base)
    expect(next.metric).toBe('wind_electricity')
    expect(next.filter).toBe('country')
    expect(next.value).toBe('China')
    expect(next.from).toBe('2015')
    expect(next.to).toBe('2022')
    expect(next.unit).toBe('TWh')
  })

  it('支持换看、改成、切换等追问说法', () => {
    expect(parsePublicQuestion('换成太阳能', base).metric).toBe('solar_electricity')
    expect(parsePublicQuestion('改看印度风电', base)).toMatchObject({ metric: 'wind_electricity', value: 'India' })
    expect(parsePublicQuestion('切换到日本', base).value).toBe('Japan')
    expect(parsePublicQuestion('再看2018到2020的中国风能', base)).toMatchObject({ metric: 'wind_electricity', value: 'China', from: '2018', to: '2020' })
  })

  it('仍然拒绝原因、多地区、多指标、多离散年份和无关内容', () => {
    for (const text of ['为什么下降？', '中国和美国风能趋势', '中国太阳能和风能趋势', '2015、2018、2022年中国趋势', '中国风能的相关新闻'])
      expect(() => parsePublicQuestion(text, base)).toThrow()
  })
})
