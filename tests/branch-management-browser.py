"""Browser check: rename and delete saved analysis branches on real UCI data.

Two branches are produced by the real local engine through the checkup question
cards. No model is configured (status is pinned), so every number stays local.
"""
import os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
fixture = root / 'tests/fixtures/uci-online-shoppers.csv'
checks = []
def checked(name):
    checks.append(name); print('PASS ' + name, flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/ai/status', lambda route: route.fulfill(json={'configured': False, 'providers': [], 'canManage': True}))
    page.goto(url + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    expect(page.locator('.checkup-verdict')).to_be_visible(timeout=60000)

    cards = page.locator('.question-card')
    assert cards.count() >= 2
    cards.nth(0).locator('button.primary').click()
    expect(page.locator('.insight-brief')).to_be_visible(timeout=60000)
    page.locator('.result-checkup-links').get_by_role('button', name='回到数据体检').click()
    expect(page.locator('.question-card')).to_have_count(cards.count())
    page.locator('.question-card').nth(1).locator('button.primary').click()
    expect(page.locator('.insight-brief')).to_be_visible(timeout=60000)
    checked('真实数据连续执行两个体检问题，形成两个计算分支')

    page.locator('.nav-item').filter(has_text='分析分支').click()
    rows = page.locator('.branch-row')
    expect(rows).to_have_count(2)
    expect(page.locator('.branch-panel .section-heading .tag')).to_have_text('2 个')

    newest = rows.first
    newest.locator('button[aria-label^="重命名分析分支"]').click()
    dialog = page.get_by_role('dialog', name='重命名分析分支')
    expect(dialog).to_be_visible()
    expect(dialog.locator('#branch-title')).not_to_have_value('')
    dialog.locator('#branch-title').fill('  我的   对照分支  ')
    dialog.get_by_role('button', name='保存名称').click()
    expect(dialog).to_have_count(0)
    expect(rows.first.locator('strong')).to_have_text('我的 对照分支')
    checked('重命名去除多余空白并即时更新分支名称')

    page.wait_for_timeout(1500)
    page.reload(wait_until='networkidle')
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    page.locator('.nav-item').filter(has_text='分析分支').click()
    rows = page.locator('.branch-row')
    expect(rows).to_have_count(2)
    expect(page.locator('.branch-row').filter(has_text='我的 对照分支')).to_have_count(1)
    checked('重命名随本机工作区恢复，刷新后仍生效')

    other = rows.filter(has_text='我的 对照分支')
    target = rows.nth(1) if other.count() == 1 and rows.first.locator('strong').inner_text() == '我的 对照分支' else rows.first
    target.locator('button[aria-label^="删除分析分支"]').click()
    dialog = page.get_by_role('dialog', name='删除分析分支？')
    expect(dialog).to_contain_text('此操作不可撤销')
    dialog.get_by_role('button', name='保留分支').click()
    expect(rows).to_have_count(2)
    checked('取消删除时分支数量不变')

    target.locator('button[aria-label^="删除分析分支"]').click()
    page.get_by_role('dialog', name='删除分析分支？').get_by_role('button', name='确认删除').click()
    expect(rows).to_have_count(1)
    expect(page.locator('.branch-panel .section-heading .tag')).to_have_text('1 个')
    expect(rows.first.locator('strong')).to_have_text('我的 对照分支')
    checked('确认后只删除目标分支，保留另一个分支及真实结果')

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    expect(rows.first.locator('.branch-actions')).to_be_visible()
    page.set_viewport_size({'width': 1440, 'height': 1100})
    checked('390 宽下分支操作可见且无整页横向溢出')

    page.wait_for_timeout(1500)
    page.reload(wait_until='networkidle')
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    page.locator('.nav-item').filter(has_text='分析分支').click()
    expect(page.locator('.branch-row')).to_have_count(1)
    expect(page.locator('.branch-row strong').first).to_have_text('我的 对照分支')
    assert not errors, errors
    checked('删除结果随工作区恢复，刷新后不出现悬空激活分支')
    browser.close()
print('ALL ' + str(len(checks)) + ' CHECKS PASSED')
