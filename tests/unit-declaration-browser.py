"""Real-data browser check for user-declared units.

The UCI fixture is imported and summed locally with SQLite. The test then
declares a unit, verifies chart/table/conclusion/report/CSV labels, checks that
every calculated value is unchanged, and confirms the declaration survives a
workspace restore. No model is called and no value is mocked.
"""
import csv, io, json, os, sys, zipfile
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
fixture = root / 'tests/fixtures/uci-online-shoppers.csv'
out = root / 'artifacts'
out.mkdir(exist_ok=True)
checks = []

def checked(name):
    checks.append(name)
    print('PASS ' + name, flush=True)

# Independent aggregation of the same CSV, not the application's result.
rows = list(csv.DictReader(io.StringIO(fixture.read_text(encoding='utf-8'))))
expected = {}
for row in rows:
    month = row['Month']
    expected[month] = expected.get(month, 0) + float(row['Administrative'])
assert len(expected) == 10, expected
assert expected['June'] > 0

def chart_values(page):
    values = {}
    for title in page.locator('#analysis-svg .chart-hit title').all_text_contents():
        label, rest = title.split(': ', 1)
        values[label] = float(rest.split(' ')[0].replace(',', ''))
    return values

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
    unit = page.locator('.unit-declaration')
    expect(unit).to_be_visible(timeout=30000)
    expect(unit.locator('.unit-declaration-heading span')).to_have_text('未声明')
    expect(unit).to_contain_text('由你声明，不是系统推断')
    before = chart_values(page)
    assert set(before) == set(expected), (set(before), set(expected))
    for label, value in expected.items():
        assert before[label] == value, (label, before[label], value)
    assert '单位 未声明' in page.locator('#analysis-svg').get_attribute('aria-label')
    checked('导入真实 CSV 后，结果卡以“未声明”显示单位，图表数值与独立 Python 汇总一致')

    unit.locator('input').fill('次点击')
    unit.get_by_role('button', name='记录单位', exact=True).click()
    expect(unit.locator('.unit-declaration-heading span')).to_have_text('已声明 次点击')
    expect(page.locator('.status-message')).to_contain_text('计算值与来源没有改变')
    axis = page.locator('#analysis-svg').text_content()
    assert '次点击' in axis, axis
    assert '单位 次点击' in page.locator('#analysis-svg').get_attribute('aria-label')
    finding = page.locator('.chart-panel .finding p').text_content()
    assert '次点击' in finding and '次点击 的汇总结果' not in finding, finding
    for label, value in expected.items():
        assert before[label] == value
    after = chart_values(page)
    assert after == before, (after, before)
    checked('声明单位后图表坐标轴、无障碍标签与计算结论同步标注，全部数值保持不变')

    page.get_by_role('button', name='数据预览', exact=True).click()
    page.get_by_role('button', name='计算结果', exact=True).click()
    headers = page.locator('#workspace-data table thead th').all_text_contents()
    assert headers[1] == 'Administrative（次点击）', headers
    table = {}
    for row in page.locator('#workspace-data table tbody tr').all():
        cells = row.locator('td').all_text_contents()
        table[cells[0]] = float(cells[1].replace(',', ''))
    for label, value in expected.items():
        assert abs(table[label] - value) < 1e-9, (label, table[label], value)
    with page.expect_download() as event:
        page.get_by_role('button', name='CSV', exact=True).click()
    event.value.save_as(str(out / 'unit-declared-result.csv'))
    text = (out / 'unit-declared-result.csv').read_text(encoding='utf-8-sig')
    parsed = list(csv.reader(io.StringIO(text)))
    assert parsed[0][:2] == ['group', 'Administrative（次点击）'], parsed[0]
    exported = {row[0]: float(row[1]) for row in parsed[1:]}
    assert exported == expected, (exported, expected)
    checked('计算结果表头与结果 CSV 列名带上用户声明单位，数值仍为真实 SQL 汇总')

    page.get_by_role('button', name='证据与报告', exact=True).click()
    with page.expect_download() as event:
        page.get_by_role('button', name='导出证据报告', exact=True).click()
    event.value.save_as(str(out / 'unit-declared-report.html'))
    html = (out / 'unit-declared-report.html').read_text(encoding='utf-8')
    assert '指标单位：次点击（由你声明，不参与计算）' in html, '报告缺少单位声明'
    assert '<th>结果（次点击）</th>' in html, '报告结果表缺少单位'
    assert '单位 次点击' in html, '报告图表缺少单位'
    checked('单文件证据报告注明单位由用户声明并同步图表与结果表')

    with page.expect_download() as event:
        page.get_by_role('button', name='导出可复现 SQL 包', exact=True).click()
    event.value.save_as(str(out / 'unit-declared-repro.zip'))
    with zipfile.ZipFile(out / 'unit-declared-repro.zip') as package:
        expected_spec = json.loads(package.read('expected.json'))['result']['spec']
    assert expected_spec['unit'] == '次点击', expected_spec
    assert expected_spec['metric'] == 'Administrative'
    checked('可复现 SQL 包记录用户声明的单位，复算口径与数值不变')

    expect(page.locator('.storage-state strong')).to_have_text('已保存到本机', timeout=30000)
    page.reload(wait_until='networkidle')
    unit = page.locator('.unit-declaration')
    expect(unit.locator('input')).to_have_value('次点击', timeout=30000)
    expect(unit.locator('.unit-declaration-heading span')).to_have_text('已声明 次点击')
    expect(page.locator('#analysis-svg')).to_be_visible(timeout=30000)
    assert '单位 次点击' in page.locator('#analysis-svg').get_attribute('aria-label')
    checked('刷新后从本机工作区恢复单位声明，图表仍使用同一标注')

    for width in [375, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1000})
        page.wait_for_timeout(300)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (width, page.evaluate('document.documentElement.scrollWidth'))
    checked('375 / 768 / 1440 宽度下单位声明区域不造成横向溢出')
    page.screenshot(path=str(out / 'unit-declaration.png'), full_page=True)

    unit.locator('input').fill('')
    unit.get_by_role('button', name='更新单位', exact=True).click()
    expect(unit.locator('.unit-declaration-heading span')).to_have_text('未声明')
    expect(page.locator('.status-message')).to_contain_text('已撤回指标单位声明')
    assert '单位 未声明' in page.locator('#analysis-svg').get_attribute('aria-label')
    assert chart_values(page) == after
    checked('留空保存可撤回单位，图表数值保持不变')

    assert not errors, errors
    assert len(checks) == 8
    print('ALL PASS ' + str(len(checks)), flush=True)
    browser.close()
