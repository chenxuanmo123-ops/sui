"""Browser checks for workspace replacement safety and checkup continuity.

A non-empty workspace must never be silently replaced: CSV, public-data and
previewed Excel/PDF imports all pass through one confirmation. Corrected roles
must read the same in the checkup, field drawer and data table, and results must
offer a way back to the checkup without deleting the calculation.
"""
import os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
period = root / 'tests/fixtures/field-roles-period.csv'
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
    page.locator('#file-upload').set_input_files(str(period))
    expect(page.locator('.dataset-name strong')).to_have_text('field-roles-period.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)

    page.get_by_role('button', name='类型不对？纠正', exact=True).click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    row = dialog.locator('.field-role-row').filter(has_text='period').first
    row.locator('select').select_option('time')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)

    card = page.locator('.question-card').filter(has_text='按 period 看 sales 怎么变化')
    expect(card).to_be_visible(timeout=30000)
    card.get_by_role('button', name='直接算给我看').click()
    expect(page.locator('.insight-brief')).to_be_visible(timeout=30000)
    checked('纠正后的时间字段可以完成真实趋势计算')

    page.get_by_role('button', name='回到数据体检', exact=True).first.click()
    expect(page.locator('.review-intro')).to_be_visible(timeout=30000)
    branches = page.locator('.primary-navigation .nav-item').filter(has_text='分析分支')
    expect(branches.locator('b')).to_have_text('1')
    checked('结果页可回到数据体检，已算结果仍保留在分析分支')

    page.get_by_role('button', name='数据预览', exact=True).click()
    expect(page.get_by_label('搜索字段')).to_be_visible()
    period_row = page.locator('.table-scroll tbody tr').filter(has_text='period').first
    expect(period_row).to_contain_text('时间字段')
    expect(period_row).to_contain_text('已纠正')
    expect(period_row).to_contain_text('按年分组')
    expect(period_row).to_contain_text('2015–2022')
    checked('数据页字段表沿用同一份纠正结果并给出判断依据')

    page.get_by_role('button', name='纠正字段类型', exact=True).first.click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    expect(dialog).to_be_visible()
    expect(dialog.locator('.field-role-row').filter(has_text='period').first.locator('select')).to_have_value('time')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    checked('数据页可直接纠正字段类型，面板显示已保存的纠正')

    page.get_by_role('button', name='更换文件', exact=True).click()
    page.locator('#file-upload').set_input_files(str(uci))
    replace = page.get_by_role('dialog', name='替换当前工作区？')
    expect(replace).to_be_visible(timeout=30000)
    expect(replace).to_contain_text('1 个计算分支')
    expect(replace).to_contain_text('1 项字段纠正')
    expect(replace).to_contain_text('替换并导入')
    replace.get_by_role('button', name='保留当前工作区', exact=True).click()
    expect(replace).to_have_count(0)
    expect(page.locator('.dataset-name strong')).to_have_text('field-roles-period.csv')
    expect(page.locator('.primary-navigation .nav-item').filter(has_text='分析分支').locator('b')).to_have_text('1')
    checked('CSV 替换前先确认；取消后原数据、计算和纠正都保留')

    page.locator('.top-public').click()
    replace = page.get_by_role('dialog', name='替换当前工作区？')
    expect(replace).to_be_visible()
    expect(replace).to_contain_text('OWID 公开能源数据')
    expect(page.locator('.dataset-name strong')).to_have_text('field-roles-period.csv')
    replace.get_by_role('button', name='保留当前工作区', exact=True).click()
    expect(replace).to_have_count(0)
    checked('加载公开数据同样先确认，取消时不会发起替换或丢失工作区')

    page.get_by_role('button', name='更换文件', exact=True).click()
    page.locator('#file-upload').set_input_files(str(uci))
    replace = page.get_by_role('dialog', name='替换当前工作区？')
    expect(replace).to_be_visible(timeout=30000)
    replace.get_by_role('button', name='替换并导入', exact=True).click()
    expect(page.locator('.dataset-name strong')).to_have_text('uci-online-shoppers.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)
    expect(page.locator('.primary-navigation .nav-item').filter(has_text='分析分支').locator('b')).to_have_count(0)
    expect(page.locator('.review-facts')).not_to_contain_text('2015–2022')
    checked('确认替换后旧计算分支与旧字段纠正被清除，新数据完成体检')

    page.get_by_role('button', name='字段与质量', exact=True).click()
    shelf = page.locator('.field-drawer')
    expect(shelf).to_be_visible()
    admin = shelf.locator('.shelf-field').filter(has_text='Administrative').first
    expect(admin.locator('small')).to_have_text('数值指标')
    shelf.get_by_role('button', name='纠正字段类型', exact=True).click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    dialog.locator('.field-role-row').filter(has_text='Administrative').first.locator('select').select_option('category')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    expect(admin.locator('small')).to_have_text('分类维度')
    expect(admin.locator('em')).to_have_text('已纠正')
    checked('字段抽屉使用纠正后的角色，并可直接打开同一纠正面板')

    page.get_by_role('button', name='关闭字段面板', exact=True).click()
    page.get_by_role('button', name='数据预览', exact=True).click()
    page.get_by_label('搜索字段').fill('Administrative')
    rows = page.locator('.table-scroll tbody tr')
    expect(rows.first.locator('td.mono')).to_have_text('Administrative')
    expect(rows.first).to_contain_text('分类维度')
    expect(rows.first).to_contain_text('已纠正')
    expect(rows.first).to_contain_text('27 个不同取值')
    checked('数据页字段表与抽屉、体检页对同一字段给出一致角色')

    for width in (375, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
    page.set_viewport_size({'width': 1440, 'height': 1100})
    assert not errors, errors
    checked('375/768/1440 无整体横向溢出，无页面脚本错误')
    page.screenshot(path=str(root / 'artifacts/workspace-field-roles.png'), full_page=True)
    browser.close()
print({'checks': checks, 'passed': True})
