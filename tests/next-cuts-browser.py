"""Browser check for the deterministic "next cuts" feature.

Uses the real UCI fixture in the real UI. Nothing is mocked and no model is
called: the alternative cut is another local SQLite computation, checked against
an independent Python aggregation of the same CSV.
"""
import csv, io, os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5175')
fixture = root / 'tests/fixtures/uci-online-shoppers.csv'
checks = []
(root / 'artifacts').mkdir(exist_ok=True)

def checked(name):
    checks.append(name)
    print('PASS ' + name, flush=True)

rows = list(csv.DictReader(io.StringIO(fixture.read_text(encoding='utf-8'))))
expected = {}
for row in rows:
    group = row['VisitorType']
    expected[group] = expected.get(group, 0) + float(row['Administrative'])
assert len(expected) == 3, expected

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    page.get_by_role('button', name='手动选择字段与计算', exact=True).click()
    page.locator('.manual-mapping > summary').click()
    page.get_by_label('分组 / 时间字段', exact=True).select_option('Month')
    page.get_by_label('数值指标', exact=True).select_option('Administrative')
    page.get_by_label('汇总方式', exact=True).select_option('sum')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()
    expect(page.locator('.insight-brief')).to_be_visible(timeout=30000)
    expect(page.locator('.next-cuts')).to_be_visible()
    checked('真实数据计算完成后出现“换一个维度”入口')

    page.locator('.next-cuts > summary').click()
    cut = page.locator('.next-cut-list button').filter(has_text='按「VisitorType」看')
    expect(cut).to_be_visible()
    cut.click()
    dialog = page.get_by_role('dialog', name='换维度对照：按「VisitorType」看')
    expect(dialog).to_be_visible()
    expect(dialog.locator('.cut-scope')).to_contain_text('分组字段：VisitorType')
    expect(dialog.locator('.cut-scope')).to_contain_text('汇总：求和')
    expect(dialog.locator('.cut-scope')).to_contain_text('12,330 条记录')
    checked('换维度入口打开对照面板，明确显示新分组、汇总方式与纳入记录数')

    dialog.locator('.bundle-table tbody tr').first.wait_for(timeout=30000)
    table = {}
    for row in dialog.locator('.bundle-table tbody tr').all():
        cells = row.locator('td').all_text_contents()
        table[cells[0]] = float(cells[1].replace(',', ''))
    assert set(table) == set(expected), (table, expected)
    for group, value in expected.items():
        assert abs(table[group] - value) < 1e-6, (group, table[group], value)
    checked('对照结果与独立 Python 对同一 CSV 的分组求和逐项一致')

    dialog.locator('.group-select').first.click()
    sources = dialog.locator('.cut-sources')
    expect(sources).to_be_visible()
    expect(sources).to_contain_text('条匹配记录')
    assert sources.locator('li').count() > 0
    dialog.locator('.cut-sql > summary').click()
    expect(dialog.locator('.cut-sql pre').first).to_contain_text('GROUP BY')
    page.screenshot(path=str(root / 'artifacts/next-cuts-dialog.png'), full_page=True)
    checked('对照面板可下钻来源记录并显示本次真实 SQL')

    page.set_viewport_size({'width': 375, 'height': 900})
    page.wait_for_timeout(400)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('document.documentElement.scrollWidth')
    size = dialog.evaluate('(el)=>({cw:el.clientWidth,sw:el.scrollWidth})')
    assert size['sw'] <= size['cw'] + 1, size
    page.screenshot(path=str(root / 'artifacts/next-cuts-mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1100})
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    expect(page.locator('.next-cuts')).to_be_visible()
    assert not errors, errors
    checked('手机宽度无横向溢出，Esc 关闭对照面板，原结果保留')

    browser.close()
print({'checks': checks, 'passed': True})
