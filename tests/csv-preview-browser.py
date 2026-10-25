"""Browser checks for CSV header/range preview and the standard fast path.

A clean CSV still imports in one step. When the first record cannot be a header
(preamble, ragged width, duplicate names), the same preview dialog used for
Excel/PDF opens so the user picks the real header and data range; the selection
is written to the source record with original physical row numbers.
"""
import os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
preamble = root / 'tests/fixtures/preamble-report.csv'
uci = root / 'tests/fixtures/uci-online-shoppers.csv'
checks = []

def checked(name):
    checks.append(name)
    print('PASS ' + name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/', wait_until='networkidle')

    page.locator('#file-upload').set_input_files(str(preamble))
    dialog = page.get_by_role('dialog', name='导入预览与核对')
    expect(dialog).to_be_visible(timeout=30000)
    expect(dialog.locator('#import-header-row')).to_have_value('2')
    expect(dialog.locator('#import-last-row')).to_have_value('7')
    expect(dialog.locator('.import-valid')).to_contain_text('待导入 5 条记录、3 个字段')
    expect(dialog).to_contain_text('单表 CSV · 7 个非空记录')
    expect(dialog).to_contain_text('按逗号分隔读取')
    expect(dialog).to_contain_text('CSV 没有工作表结构')
    chosen = dialog.locator('.chosen-header input')
    expect(chosen.nth(0)).to_have_value('period')
    expect(chosen.nth(1)).to_have_value('sales')
    expect(chosen.nth(2)).to_have_value('region')
    checked('首行不是表头的 CSV 自动打开预览并建议第二行为表头')

    dialog.locator('#import-last-row').fill('6')
    expect(dialog.locator('.import-valid')).to_contain_text('待导入 4 条记录、3 个字段')
    expect(dialog.locator('.excluded-row').last.locator('input').first).to_have_value('合计')
    page.screenshot(path=str(root / 'artifacts/csv-import-preview.png'), full_page=True)
    checked('可调整数据截止行，页脚合计明确排除在导入范围外')

    dialog.locator('#confirm-import').check()
    dialog.get_by_role('button', name='确认导入并分析', exact=True).click()
    expect(dialog).to_have_count(0)
    expect(page.locator('.dataset-name strong')).to_have_text('preamble-report.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)
    checked('预览确认后按选定范围导入，标题保留原文件名')

    page.get_by_role('button', name='数据预览', exact=True).click()
    expect(page.get_by_label('搜索字段')).to_be_visible()
    rows = page.locator('.table-scroll tbody tr')
    period_row = rows.filter(has_text='period').first
    expect(period_row).to_contain_text('分类维度')
    sales_row = rows.filter(has_text='sales').first
    expect(sales_row).to_contain_text('数值指标')
    checked('导入后的字段来自选定表头，未被标题行污染')

    page.get_by_role('button', name='数据与来源', exact=True).click()
    origin = page.locator('.import-origin')
    expect(origin).to_be_visible()
    expect(origin).to_contain_text('CSV')
    expect(origin).to_contain_text('表头原行 2')
    expect(origin).to_contain_text('逗号')
    assert len(origin.locator('code').inner_text().split(': ')[-1]) == 64
    checked('来源记录写明 CSV 格式、原表头行与文件 SHA-256')

    page.get_by_role('button', name='分析工作台', exact=True).click()
    page.locator('#file-upload').set_input_files(str(preamble))
    replace = page.get_by_role('dialog', name='替换当前工作区？')
    expect(replace).to_be_visible(timeout=30000)
    replace.get_by_role('button', name='替换并导入', exact=True).click()
    dialog = page.get_by_role('dialog', name='导入预览与核对')
    expect(dialog).to_be_visible(timeout=30000)
    dialog.get_by_role('button', name='取消', exact=True).click()
    expect(dialog).to_have_count(0)
    expect(page.locator('.dataset-name strong')).to_have_text('preamble-report.csv')
    checked('确认替换后仍可在预览中取消，原工作区保持可用')

    page.locator('#file-upload').set_input_files(str(uci))
    replace = page.get_by_role('dialog', name='替换当前工作区？')
    expect(replace).to_be_visible(timeout=30000)
    replace.get_by_role('button', name='替换并导入', exact=True).click()
    expect(page.locator('.import-dialog')).to_have_count(0)
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)
    checked('标准 CSV 保持一步导入，不额外弹出预览')

    for width in (375, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
    page.set_viewport_size({'width': 1440, 'height': 1100})
    assert not errors, errors
    checked('375/768/1440 无整体横向溢出，无页面脚本错误')
    browser.close()
print({'checks': checks, 'passed': True})
