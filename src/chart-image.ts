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

/** Standalone SVG that keeps the on-screen colors and fonts. */
export function chartSVGMarkup(svg: SVGSVGElement) {
  return new XMLSerializer().serializeToString(preparedClone(svg).clone)
}

export async function downloadChartPNG(svg: SVGSVGElement, filename: string, scale = 2) {
  const { clone, width, height } = preparedClone(svg)
  const background = surfaceColor(svg)
  const markup = new XMLSerializer().serializeToString(clone)
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
    download(await blob.arrayBuffer(), 'image/png', filename)
  } finally {
    URL.revokeObjectURL(source)
  }
}

/** PNG for an ECharts container, which renders its own <svg> child. */
export async function downloadContainerPNG(container: HTMLElement | null, filename: string, scale = 2) {
  const svg = container?.querySelector('svg')
  if (!svg) throw new Error('图表尚未渲染完成，请稍后重试。')
  await downloadChartPNG(svg, filename, scale)
}
