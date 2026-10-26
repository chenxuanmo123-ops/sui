"""Capture the rebuilt workbench at desktop and mobile widths."""
from pathlib import Path
import os, sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

out = root / 'artifacts/ui-rebuild/after'
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5175')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
    page.route('**/api/ai/status', lambda r: r.fulfill(json={'configured': False, 'providers': [], 'canManage': True}))
    page.goto(base + '/', wait_until='networkidle')
    page.screenshot(path=str(out / 'welcome-1440.png'), full_page=True)
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/uci-online-shoppers.csv'))
    expect(page.locator('.data-review')).to_be_visible(timeout=60000)
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(400)
    page.screenshot(path=str(out / 'review-1440.png'), full_page=True)
    print('review height', page.evaluate('document.documentElement.scrollHeight'))
    # Real local calculation via the first checkup question.
    page.locator('.question-card').first.locator('button.primary').click()
    expect(page.locator('.chart-panel .finding')).to_be_visible(timeout=120000)
    page.wait_for_timeout(600)
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / 'result-1440.png'), full_page=True)
    for width in (1024, 768, 390):
        page.set_viewport_size({'width': width, 'height': 900 if width != 390 else 844})
        page.evaluate('window.scrollTo(0,0)')
        page.wait_for_timeout(500)
        page.screenshot(path=str(out / f'result-{width}.png'), full_page=True)
    print('errors', errors)
    print('scrollWidth/390', page.evaluate('document.documentElement.scrollWidth'), page.evaluate('innerWidth'))
    browser.close()
