import sys, json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:5173/', wait_until='networkidle', timeout=60000)
    page.wait_for_function("!document.querySelector('.loading-indicator')", timeout=60000)
    page.screenshot(path=str(root / 'artifacts/desktop-before-analysis.png'), full_page=True)
    print(json.dumps({'buttons': page.get_by_role('button').all_text_contents(), 'summary': page.locator('.data-summary').inner_text(), 'errors': errors}, ensure_ascii=False))
    browser.close()
