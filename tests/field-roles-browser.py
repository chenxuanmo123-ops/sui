"""Browser check for manual field-role corrections.

Uses the real UCI fixture in the real UI. Corrections are validated against the
imported values, persisted in the local workspace, and never touch cell values.
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
    checks.append(name)
    print('PASS ' + name, flush=True)

def counts(page):
    return [int(value.replace(',', '')) for value in page.locator('.checkup-role-counts span strong').all_text_contents()]

def chip(page, field):
    return page.locator('.review-fields button').filter(has_text=field).first

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)

    admin = chip(page, 'Administrative')
    expect(admin.locator('small')).to_have_text('数值指标')
    before = counts(page)
    assert before[0] >= 1 and before[1] >= 1, before
    checked('导入后 Administrative 自动判为数值指标，体检计数可用')

    page.get_by_role('button', name='类型不对？纠正', exact=True).click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    expect(dialog).to_be_visible()
    row = dialog.locator('.field-role-row').filter(has_text='Administrative').first
    expect(row).to_be_visible()
    select = row.locator('select')
    expect(select).to_have_value('')
    select.select_option('category')
    expect(row.locator('.field-role-reason')).to_contain_text('27 个不同取值')
    checked('纠正面板只允许数据支持的角色，并给出实际取值数')

    expect(chip(page, 'Administrative').locator('small')).to_have_text('分类维度')
    expect(chip(page, 'Administrative').locator('em')).to_have_text('已纠正')
    after = counts(page)
    assert after[0] == before[0] - 1, (before, after)
    assert after[1] == before[1] + 1, (before, after)
    expect(row).to_have_class('field-role-row corrected')
    checked('改为分类维度后计数与字段速览同步，纠正面板保持打开')

    visitor = dialog.locator('.field-role-row').filter(has_text='VisitorType').first
    measure_option = visitor.locator('option[value="measure"]')
    assert measure_option.get_attribute('disabled') is not None
    assert '不支持' in measure_option.inner_text()
    checked('无法解析为数值的文本列禁用“数值指标”，不靠声明伪造指标')

    row.locator('select').select_option('')
    expect(chip(page, 'Administrative').locator('small')).to_have_text('数值指标')
    expect(chip(page, 'Administrative').locator('em')).to_have_count(0)
    expect(page.locator('.checkup-role-counts span strong').first).to_have_text(str(before[0]))
    checked('恢复自动判断后角色与计数还原')

    dialog.locator('.field-role-row').filter(has_text='Administrative').first.locator('select').select_option('category')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    page.wait_for_timeout(1200)
    page.reload(wait_until='networkidle')
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)
    expect(chip(page, 'Administrative').locator('small')).to_have_text('分类维度')
    expect(chip(page, 'Administrative').locator('em')).to_have_text('已纠正')
    checked('纠正随本机工作区恢复，刷新后仍生效')

    page.get_by_role('button', name='类型不对？纠正', exact=True).click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    expect(dialog).to_be_visible()
    page.set_viewport_size({'width': 375, 'height': 900})
    page.wait_for_timeout(400)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('document.documentElement.scrollWidth')
    size = dialog.evaluate('(el)=>({cw:el.clientWidth,sw:el.scrollWidth})')
    assert size['sw'] <= size['cw'] + 1, size
    page.screenshot(path=str(root / 'artifacts/field-roles-mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1100})
    page.screenshot(path=str(root / 'artifacts/field-roles-dialog.png'), full_page=True)
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    assert not errors, errors
    checked('手机宽度无横向溢出，Esc 关闭；无页面脚本错误')

    # Second scenario: a bare-year column named "period" is not guessed as time
    # by header alone; declaring it as time must produce a runnable trend.
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url + '/', wait_until='networkidle')
    period_fixture = root / 'tests/fixtures/field-roles-period.csv'
    page.locator('#file-upload').set_input_files(str(period_fixture))
    expect(page.locator('.dataset-name strong')).to_have_text('field-roles-period.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)
    trend_title = '按 period 看 sales 怎么变化'
    expect(page.locator('.question-card').filter(has_text=trend_title)).to_have_count(0)

    page.get_by_role('button', name='类型不对？纠正', exact=True).click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    row = dialog.locator('.field-role-row').filter(has_text='period').first
    row.locator('select').select_option('time')
    expect(row.locator('.field-role-reason')).to_contain_text('8 个时间值（2015–2022）')
    checked('裸年份列默认不猜为时间；声明后给出可识别的时间范围')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)

    card = page.locator('.question-card').filter(has_text=trend_title)
    expect(card).to_be_visible()
    card.get_by_role('button', name='直接算给我看').click()
    expect(page.locator('.insight-brief')).to_be_visible(timeout=30000)
    expect(page.locator('.chart-meta')).to_contain_text('8 个分组')
    labels = page.locator('.chart-panel svg text').all_text_contents()
    assert any('2015' in label for label in labels) and any('2022' in label for label in labels), labels
    checked('纠正为时间后生成趋势问题并完成真实计算，分组覆盖 2015–2022')
    assert not errors, errors
    context.close()

    browser.close()
print({'checks': checks, 'passed': True})
