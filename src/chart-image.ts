// Chart exports. The charts paint with CSS custom properties and inherit the
// page font, so a raw serialized SVG would lose both once it leaves the page.
// Both exports therefore clone the node and inline the computed paint first.
import { download } from './data'

const PAINT = ['fill', 'stroke', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor'] as const
const NUMERIC = ['stroke-width', 'stroke-dasharray'] as const

function inlinePaint(source: SVGSVGElement, clone: SVGSVGElement) {
  const originals = [source, ...source.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  originals.forEach((element, index) => {
    const target = copies[index]
    if (!target) return
    const computed = getComputedStyle(element)
    for (const property of PAINT) {
      const resolved = computed.getPropertyValue(property)
      if (!resolved || resolved === 'none' || resolved === 'normal' || resolved === 'auto') continue
      if (property === 'opacity' && resolved === '1') continue
      target.setAttribute(property, resolved)
    }
    for (const property of NUMERIC) {
      const resolved = computed.getPropertyValue(property)
      if (resolved && resolved !== 'none') target.setAttribute(property, resolved.replace(/px$/, ''))
    }
  })
}

/** The first painted surface behind the chart, so PNG text stays legible. */
function surfaceColor(element: Element) {
  let node: Element | null = element.parentElement
  while (node) {
    const color = getComputedStyle(node).backgroundColor
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
    node = node.parentElement
  }
  return '#ffffff'
}

/** Text that travels with the chart: a bare plot does not say what it is. */
export type ChartFrame = { title?: string; subtitle?: string; footnote?: string }

const escapeXML = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

function inkFor(background: string) {
  const values = (background.match(/[\d.]+/g) ?? []).map(Number)
  if (values.length < 3) return '#111827'
  return 0.299 * values[0] + 0.587 * values[1] + 0.114 * values[2] < 140 ? '#f3f4f6' : '#111827'
}

/** Truncate to the drawn width; CJK glyphs are about one font-size wide. */
function fitText(text: string, size: number, maxWidth: number) {
  let width = 0, kept = ''
  for (const char of text) {
    const advance = char.charCodeAt(0) > 255 ? size : size * 0.58
    if (width + advance > maxWidth) return kept.replace(/[\s·,，。]+$/, '') + '…'
    width += advance
    kept += char
  }
  return text
}

/**
 * Draw the chart inside a titled plate. The clone keeps its own viewBox and is
 * nested at its natural size, so the plot itself is untouched.
 */
function framed(svg: SVGSVGElement, frame: ChartFrame, prepared: { clone: SVGSVGElement; width: number; height: number }) {
  const { clone, width, height } = prepared
  const background = surfaceColor(svg)
  const title = frame.title ? fitText(frame.title, 18, width) : ''
  const subtitle = frame.subtitle ? fitText(frame.subtitle, 12, width) : ''
  const footnote = frame.footnote ? fitText(frame.footnote, 11, width - 90) : ''
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
  const serialized = new XMLSerializer().serializeToString(clone)
  if (!title && !subtitle && !footnote) return { markup: declaration + serialized, width, height, background }

  const pad = 28, titleH = title ? 26 : 0, subtitleH = subtitle ? 20 : 0, headGap = title || subtitle ? 14 : 0, footH = footnote ? 26 : 0
  const outerWidth = width + pad * 2, outerHeight = height + pad * 2 + titleH + subtitleH + headGap + footH
  const chartY = pad + titleH + subtitleH + headGap
  const ink = inkFor(background)
  const head: string[] = [`<rect width="${outerWidth}" height="${outerHeight}" fill="${escapeXML(background)}"/>`]
  if (title) head.push(`<text x="${pad}" y="${pad + 17}" font-family="sans-serif" font-size="18" font-weight="700" fill="${ink}">${escapeXML(title)}</text>`)
  if (subtitle) head.push(`<text x="${pad}" y="${pad + titleH + 14}" font-family="sans-serif" font-size="12" fill="${ink}" opacity="0.72">${escapeXML(subtitle)}</text>`)
  if (title || subtitle) head.push(`<line x1="${pad}" x2="${outerWidth - pad}" y1="${chartY - 8}" y2="${chartY - 8}" stroke="${ink}" opacity="0.16"/>`)
  const foot: string[] = []
  if (footnote) foot.push(
    `<text x="${pad}" y="${outerHeight - 12}" font-family="sans-serif" font-size="11" fill="${ink}" opacity="0.6">${escapeXML(footnote)}</text>`,
    `<text x="${outerWidth - pad}" y="${outerHeight - 12}" text-anchor="end" font-family="sans-serif" font-size="11" fill="${ink}" opacity="0.6">数鉴 Agent</text>`,
  )
  // Flatten the chart into a translated group instead of nesting a second
  // <svg>. Nested SVG renders in browsers but is unreliable in Office,
  // Illustrator and some SVG previewers.
  const inner = serialized.slice(serialized.indexOf('>') + 1, serialized.lastIndexOf('</svg>'))
  const markup = declaration + `<svg xmlns="http://www.w3.org/2000/svg" width="${outerWidth}" height="${outerHeight}" viewBox="0 0 ${outerWidth} ${outerHeight}">${head.join('')}<g transform="translate(${pad}, ${chartY})">${inner}</g>${foot.join('')}</svg>`
  return { markup, width: outerWidth, height: outerHeight, background }
}

function preparedClone(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement
  inlinePaint(svg, clone)
  const box = svg.viewBox.baseVal
  const width = Math.max(1, Math.round(box?.width || svg.clientWidth || 640))
  const height = Math.max(1, Math.round(box?.height || svg.clientHeight || 400))
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.removeAttribute('style')
  return { clone, width, height }
}

/** Standalone SVG that keeps the on-screen colors, fonts and title block. */
export function chartSVGMarkup(svg: SVGSVGElement, frame: ChartFrame = {}) {
  return framed(svg, frame, preparedClone(svg)).markup
}

/** Rasterized chart plus the logical size it should occupy in a document. */
export type ChartImageData = { data: Uint8Array; width: number; height: number }

export async function chartPNG(svg: SVGSVGElement, scale = 2, frame: ChartFrame = {}): Promise<ChartImageData> {
  const { markup, width, height, background } = framed(svg, frame, preparedClone(svg))
  const source = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('图表无法渲染为图片，请改用 SVG 导出。'))
      image.src = source
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器不支持导出 PNG，请改用 SVG 导出。')
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG 编码失败，请改用 SVG 导出。')
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height }
  } finally {
    URL.revokeObjectURL(source)
  }
}

export async function downloadChartPNG(svg: SVGSVGElement, filename: string, scale = 2, frame: ChartFrame = {}) {
  const image = await chartPNG(svg, scale, frame)
  download(image.data.buffer as ArrayBuffer, 'image/png', filename)
}

/** PNG for an ECharts container, which renders its own <svg> child. */
export async function downloadContainerPNG(container: HTMLElement | null, filename: string, scale = 2, frame: ChartFrame = {}) {
  const svg = container?.querySelector('svg')
  if (!svg) throw new Error('图表尚未渲染完成，请稍后重试。')
  await downloadChartPNG(svg, filename, scale, frame)
}
