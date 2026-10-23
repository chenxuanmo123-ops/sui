import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
expect.set_options(timeout=30000)
checks = []


def passed(text):
    checks.append(text)
    print('PASS ' + text, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url, wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/messy-amounts.csv'))
    expect(page.locator('.dataset-name strong')).to_have_text('messy-amounts.csv')

    page.get_by_role('button', name='数据处理', exact=True).click()
    page.get_by_label('处理字段', exact=True).select_option('金额')
    page.locator('label.core-check').filter(has_text='规范常见数字格式').locator('input').check()
    page.get_by_role('button', name='预览处理影响', exact=True).click()
    preview = page.locator('.cleaning-preview')
    expect(preview).to_contain_text('将修改 3 个单元格')
    expect(preview).to_contain_text('2 个值仍无法识别为数字，原值保持不动，不替换为零')
    expect(preview).to_contain_text('1.2万元')
    expect(preview).to_contain_text('N/A')
    expect(preview).to_contain_text('1 个百分号按原数值保留')
    passed('预览区分可识别格式与无法识别的原值')

    page.locator('label.core-check').filter(has_text='仍无法识别的值置空').locator('input').check()
    page.get_by_role('button', name='预览处理影响', exact=True).click()
    expect(preview).to_contain_text('将修改 5 个单元格')
    expect(preview).to_contain_text('其中 2 个已按你的选择置空')
    passed('置空是显式选项，预览写明不当作零')

    page.locator('label.core-check').filter(has_text='我已核对处理影响与数据粒度').locator('input').check()
    page.get_by_role('button', name='应用处理', exact=True).click()
    expect(page.locator('.status-message')).to_contain_text('处理已应用')
    row = page.locator('.core-table-wrap tbody tr').filter(has_text='金额').first
    expect(row).to_contain_text('3 / 3')
    expect(page.get_by_text('已确认的处理记录')).to_be_visible()
    expect(page.get_by_text('将仍无法识别的值置空（不计入数值，不当作零）')).to_be_visible()
    passed('应用后金额成为数值字段，处理步骤可追溯')

    assert not errors, errors
    passed('无未捕获浏览器错误')
    print(f'{len(checks)} checks passed.')
    browser.close()
