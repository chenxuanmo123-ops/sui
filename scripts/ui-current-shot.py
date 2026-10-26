"""Capture the current UI at three widths for the rebuild comparison record."""
from pathlib import Path
import sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

out = root / 'artifacts/ui-rebuild/before'
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    page.route('**/api/ai/status', lambda r: r.fulfill(json={'configured': False, 'providers': [], 'canManage': True}))
    page.goto('http://127.0.0.1:5175/', wait_until='networkidle')
    page.screenshot(path=str(out / 'welcome-1440.png'), full_page=True)
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/uci-online-shoppers.csv'))
    expect(page.locator('.data-review')).to_be_visible(timeout=60000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / 'review-1440.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / 'review-390.png'), full_page=True)
    browser.close()
print('done')
