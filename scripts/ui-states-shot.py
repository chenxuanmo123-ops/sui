"""Capture the new shell states that the flow screenshot does not cover."""
from pathlib import Path
import json, os, sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

out = root / os.environ.get('SHOT_DIR', 'artifacts/precision-instrument')
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:4173')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')

    # Welcome at narrow widths.
    for width in (768, 390):
        page = browser.new_page(viewport={'width': width, 'height': 900}, reduced_motion='reduce')
        page.route('**/api/ai/status', lambda r: r.fulfill(json={'configured': False, 'providers': [], 'canManage': True}))
        page.goto(base + '/', wait_until='networkidle')
        page.screenshot(path=str(out / f'welcome-{width}.png'), full_page=True)
        page.close()

    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/api/ai/status', lambda r: r.fulfill(json={'configured': False, 'providers': [], 'canManage': True}))
    page.goto(base + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/uci-online-shoppers.csv'))
    expect(page.locator('.data-review')).to_be_visible(timeout=60000)

    # Rail at viewport only (full-page screenshots stretch fixed elements).
    page.screenshot(path=str(out / 'rail-1440.png'), clip={'x': 0, 'y': 0, 'width': 260, 'height': 1000})

    # Command palette, opened through the real shortcut.
    page.keyboard.press('Control+k')
    expect(page.get_by_role('dialog', name='命令面板')).to_be_visible()
    page.wait_for_timeout(200)
    page.screenshot(path=str(out / 'command-1440.png'))
    page.locator('.command-input-row input').fill('导出')
    page.wait_for_timeout(150)
    page.screenshot(path=str(out / 'command-filter-1440.png'))
    page.keyboard.press('Escape')

    # AI assistant: real unconfigured state.
    page.get_by_role('button', name='打开 AI 分析助手', exact=True).first.click()
    expect(page.locator('#ai-assistant-window')).to_be_visible()
    page.wait_for_timeout(250)
    page.screenshot(path=str(out / 'assistant-1440.png'))
    print('dialog open errors', errors)
    browser.close()
