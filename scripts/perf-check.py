"""Local production-build performance baseline. Real UI, real fixture, no mocked data.

Run against `npm run preview` (default http://127.0.0.1:4173):
    python scripts/perf-check.py
"""
import json, os, statistics, sys, time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
BASE_URL = os.environ.get('PERF_BASE_URL', 'http://127.0.0.1:4173')
out = root / 'artifacts/perf'
out.mkdir(parents=True, exist_ok=True)

FPS_SCRIPT = """async () => {
  const marks = [];
  await new Promise(resolve => {
    let last = performance.now();
    function frame(now) {
      marks.push(now - last); last = now;
      if (marks.length >= 150) resolve(); else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  const sorted = marks.slice(5).sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    samples: sorted.length,
    avgFrameMs: +avg.toFixed(2),
    p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
    maxFrameMs: +sorted[sorted.length - 1].toFixed(2),
    droppedOver20ms: sorted.filter(x => x > 20).length
  };
}"""


def ms(start):
    return round((time.monotonic() - start) * 1000, 1)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script("""
      window.__longTasks = [];
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.__longTasks.push({start: entry.startTime, duration: entry.duration});
        }).observe({entryTypes: ['longtask']});
      } catch (e) {}
    """)
    record = {'url': BASE_URL, 'viewport': '1440x1000', 'checks': {}, 'errors': errors}

    started = time.monotonic()
    page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
    record['checks']['initialLoadMs'] = ms(started)
    page.wait_for_function("!document.querySelector('.loading-indicator')", timeout=30000)

    nav = page.evaluate("""() => {
      const n = performance.getEntriesByType('navigation')[0];
      const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
      const resources = performance.getEntriesByType('resource');
      return {
        domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
        loadMs: Math.round(n.loadEventEnd),
        domInteractiveMs: Math.round(n.domInteractive),
        firstPaintMs: paints['first-paint'] || null,
        firstContentfulPaintMs: paints['first-contentful-paint'] || null,
        resourceCount: resources.length,
        transferKB: +(resources.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024).toFixed(1),
        scriptKB: +(resources.filter(r => r.initiatorType === 'script').reduce((a, r) => a + (r.transferSize || 0), 0) / 1024).toFixed(1)
      };
    }""")
    record['navigation'] = nav
    record['checks']['longTasksAfterLoad'] = page.evaluate("window.__longTasks.length")
    record['checks']['fpsIdle'] = page.evaluate(FPS_SCRIPT)

    # Load a real 8-row public CSV fixture (same file the acceptance suite uses).
    started = time.monotonic()
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/owid-China-2015-2022.csv'))
    expect(page.locator('.dataset-name strong')).to_have_text('owid-China-2015-2022.csv', timeout=30000)
    record['checks']['importToDatasetMs'] = ms(started)
    record['checks']['longTasksAfterImport'] = page.evaluate("window.__longTasks.length")
    record['checks']['fpsAfterImport'] = page.evaluate(FPS_SCRIPT)

    # Open the AI assistant: panel animation / mount cost.
    started = time.monotonic()
    page.get_by_role('button', name='打开 AI 分析助手', exact=True).first.click()
    expect(page.locator('#ai-assistant-window')).to_be_visible(timeout=10000)
    record['checks']['openAssistantMs'] = ms(started)
    record['checks']['fpsAssistantOpen'] = page.evaluate(FPS_SCRIPT)
    page.get_by_role('button', name='收起 AI 助手', exact=True).click()

    # Manual analysis canvas: open the mapping and run the real calculation.
    try:
        if page.get_by_role('button', name='分析工作台', exact=True).count():
            page.get_by_role('button', name='分析工作台', exact=True).click()
        if page.locator('.manual-start').count():
            page.locator('.manual-start').click()
        if page.locator('.manual-mapping').count() and not page.locator('.manual-mapping').evaluate('el=>el.open'):
            page.locator('.manual-mapping > summary').click()
        started = time.monotonic()
        submit = page.get_by_role('button', name='解析并分析', exact=True)
        if not submit.count() or not submit.is_visible():
            submit = page.get_by_role('button', name='按确认口径分析', exact=True)
        submit.click()
        expect(page.locator('#analysis-svg')).to_be_visible(timeout=30000)
        record['checks']['manualComputeToChartMs'] = ms(started)
    except Exception as exc:
        record['checks']['manualComputeToChartMs'] = None
        record['checks']['manualComputeNote'] = str(exc).splitlines()[0][:300]
        page.screenshot(path=str(out / 'local-preview-compute-failure.png'), full_page=True)
    record['checks']['fpsWithChart'] = page.evaluate(FPS_SCRIPT)
    record['checks']['longTasksTotal'] = page.evaluate("window.__longTasks.length")
    record['checks']['longTaskMaxMs'] = page.evaluate("Math.max(0, ...window.__longTasks.map(t=>t.duration))")
    record['checks']['heapMB'] = page.evaluate("performance.memory ? +(performance.memory.usedJSHeapSize/1048576).toFixed(1) : null")

    # Mobile layout: same page, no overflow, measure again at 390px.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(250)
    record['checks']['mobileOverflow'] = page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
    record['checks']['fpsMobile'] = page.evaluate(FPS_SCRIPT)

    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.screenshot(path=str(out / 'local-preview-1440.png'), full_page=True)
    record['ok'] = not errors and not record['checks']['mobileOverflow']
    (out / 'local-preview.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False, indent=2))
    browser.close()
