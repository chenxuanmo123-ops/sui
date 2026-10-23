import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5174')
checks = []
expect.set_options(timeout=30000)


def passed(text):
    checks.append(text)
    print('PASS ' + text, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url, wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures/owid-China-2015-2022.csv'))
    expect(page.locator('.dataset-name strong')).to_have_text('owid-China-2015-2022.csv')

    # Without a model the manual path is the primary action, not a dead AI CTA.
    expect(page.locator('.manual-start')).to_be_visible()
    expect(page.locator('.composer-label > span')).to_contain_text('本地手动计算仍可用')
    page.locator('.manual-start').click()
    expect(page.locator('.empty-actions .primary')).to_have_text('手动选择字段与计算')
    expect(page.get_by_role('button', name='开始 AI 分析', exact=True)).to_have_count(0)
    expect(page.locator('.chart-empty')).to_contain_text('尚未配置 AI 模型')
    passed('未配置模型时手动计算是首要入口，错误提示明确')

    if not page.locator('.manual-mapping').evaluate('el=>el.open'):
        page.locator('.manual-mapping > summary').click()
    page.get_by_label('分组 / 时间字段', exact=True).select_option('year')
    page.get_by_label('数值指标', exact=True).select_option('renewables_electricity')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()
    expect(page.locator('.chart-panel svg.data-chart')).to_be_visible()
    expect(page.locator('.finding')).to_contain_text('有效来源 8 条')
    passed('手动口径完成真实计算并生成图表与结论')

    page.get_by_role('button', name='数据预览', exact=True).click()
    page.get_by_role('button', name='计算结果', exact=True).click()
    expect(page.locator('.table-scroll tbody tr')).to_have_count(8)
    search = page.get_by_label('搜索计算结果分组', exact=True)
    search.fill('2018')
    expect(page.locator('.table-scroll tbody tr')).to_have_count(1)
    expect(page.locator('.table-scroll tbody tr').first).to_contain_text('2018')
    search.fill('不存在的分组')
    expect(page.locator('.table-scroll tbody')).to_contain_text('没有匹配的分组')
    search.fill('')
    expect(page.locator('.table-scroll tbody tr')).to_have_count(8)
    passed('计算结果支持分组搜索与空结果提示，不改变计算值')

    page.get_by_label('计算结果排序', exact=True).select_option('desc')
    values = [float(text.replace(',', '')) for text in page.locator('.table-scroll tbody tr td:nth-child(2)').all_inner_texts()]
    assert values == sorted(values, reverse=True) and len(values) == 8, values
    page.get_by_label('计算结果排序', exact=True).select_option('asc')
    values = [float(text.replace(',', '')) for text in page.locator('.table-scroll tbody tr td:nth-child(2)').all_inner_texts()]
    assert values == sorted(values) and len(values) == 8, values
    passed('计算结果可按真实数值升降序排序')

    page.get_by_role('button', name='分析与图表', exact=True).click()
    handoff = page.get_by_role('button', name='在探索分析中打开', exact=True)
    expect(handoff).to_be_visible()
    handoff.click()
    expect(page.get_by_label('探索分组字段')).to_have_value('year')
    expect(page.get_by_label('探索指标字段')).to_have_value('renewables_electricity')
    expect(page.locator('.exploration-empty')).to_contain_text('当前未执行查询，不生成示意结果')
    page.get_by_role('button', name='执行探索分析', exact=True).click()
    expect(page.locator('.exploration-results tbody tr')).to_have_count(8)
    passed('当前口径可带入探索分析，重新执行前不生成示意结果')

    for width in (375, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), width
    assert not errors, errors
    passed('375/768/1440 无整体横向溢出，无未捕获浏览器错误')
    print(f'{len(checks)} checks passed.')
    browser.close()
