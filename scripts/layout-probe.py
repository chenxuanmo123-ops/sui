"""Measure the real layout at narrow widths and name any element that overflows."""
import json, os, sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:4173')
out = root / 'artifacts/precision-instrument'
out.mkdir(parents=True, exist_ok=True)

PROBE = """() => {
  const rows = [];
  const vw = innerWidth;
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      rows.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 90)) || '',
        id: el.id || '',
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        text: (el.textContent || '').trim().slice(0, 40)
      });
    }
  });
  const pick = sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {w: Math.round(r.width), x: Math.round(r.x), display: cs.display,
            cols: cs.gridTemplateColumns, maxW: cs.maxWidth, overflowX: cs.overflowX};
  };
  return {
    vw, scrollWidth: document.documentElement.scrollWidth,
    content: pick('.content'),
    review: pick('.review-workbench'),
    resultStage: pick('.result-stage'),
    resultSide: pick('.result-stage-side'),
    chart: pick('.chart-panel'),
    insight: pick('.result-insight, .result-stage-side > *'),
    header: pick('.app-header'),
    ribbon: pick('.topbar.dataset-ribbon'),
    rail: pick('.app-rail'),
    overflows: rows.slice(0, 25)
  };
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.route('**/api/ai/status', lambda r: r.fulfill(json={'configured': False, 'providers': [], 'canManage': True}))
    page.goto(base + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/uci-online-shoppers.csv'))
    expect(page.locator('.data-review')).to_be_visible(timeout=60000)
    report = {'review': {}}
    for width in (768, 390):
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_timeout(300)
        report['review'][width] = page.evaluate(PROBE)

    page.locator('.question-card').first.locator('button.primary').click()
    expect(page.locator('.chart-panel .finding')).to_be_visible(timeout=120000)
    page.wait_for_timeout(400)
    report['result'] = {}
    for width in (768, 390):
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_timeout(300)
        report['result'][width] = page.evaluate(PROBE)
        page.screenshot(path=str(out / f'probe-result-{width}.png'), full_page=True)

    (out / 'layout-probe.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    browser.close()
