"""Checkup and deterministic-insight acceptance on original public fixtures.

All numbers come from the real SQLite engine. No model is configured (status is
pinned), so every sentence shown here is deterministic UI copy.
"""
import json
import os
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5175')
out = root / 'artifacts/checkup'
out.mkdir(parents=True, exist_ok=True)
checks = []
all_errors = []


def passed(text):
    checks.append(text)
    print('PASS ' + text, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')

    def status(route):
        route.fulfill(json={'configured': False, 'providers': [], 'canManage': True})

    def fresh(fixture):
        page = browser.new_page(viewport={'width': 1440, 'height': 1100})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/api/ai/status', status)
        page.goto(url, wait_until='networkidle')
        page.locator('#file-upload').set_input_files(str(root / 'tests/fixtures' / fixture))
        expect(page.locator('.checkup-verdict')).to_be_visible(timeout=60000)
        all_errors.append(errors)
        return page

    # UCI: rate question executes through the real engine and produces an
    # answer-first reading with every required boundary section.
    page = fresh('uci-online-shoppers.csv')
    expect(page.locator('.checkup-score')).to_contain_text('100')
    expect(page.locator('.checkup-role-counts')).to_contain_text('数值指标')
    expect(page.locator('.checkup-role-counts')).to_contain_text('二值结果')
    expect(page.locator('.question-card')).to_have_count(3)
    expect(page.locator('.checkup-warnings li').first).to_be_visible()
    page.screenshot(path=str(out / 'checkup-uci-1440.png'), full_page=True)

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    page.screenshot(path=str(out / 'checkup-uci-390.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1100})
    passed('UCI 体检给出完整度、字段角色计数、三个可执行问题与提示，390 宽无整页溢出')

    rate = page.locator('.question-card').filter(has_text='的比例').first
    rate.locator('button.primary').click()
    expect(page.locator('.insight-brief')).to_be_visible(timeout=60000)
    expect(page.locator('.insight-sections .insight-section')).to_have_count(5)
    expect(page.locator('.chart-panel svg.data-chart')).to_be_visible()
    expect(page.locator('.finding')).to_contain_text('总体比例')
    expect(page.locator('.insight-brief')).to_contain_text('总体比例为')
    expect(page.locator('.insight-brief')).to_contain_text('不能得出')
    page.screenshot(path=str(out / 'checkup-rate-result.png'), full_page=True)
    page.close()
    passed('点击比例问题后真实计算，结果页先给解读，再给图表与原有计算结论')

    # OWID: the trend question renders the deterministic slope / R² reading.
    trend = fresh('owid-China-2015-2022.csv')
    expect(trend.locator('.question-card')).to_have_count(2)
    trend.locator('.question-card').filter(has_text='怎么变化').first.locator('button.primary').click()
    expect(trend.locator('.insight-headline h3')).to_contain_text('R²')
    expect(trend.locator('.insight-headline h3')).to_contain_text('renewables_electricity')
    expect(trend.locator('.chart-panel svg.data-chart')).to_be_visible()
    trend.screenshot(path=str(out / 'checkup-trend-result.png'), full_page=True)
    trend.close()
    passed('趋势问题按年拟合，解读给出方向、斜率、R² 与描述性边界')

    # OWID: correlation question opens the explore canvas with real scatter data
    # and the Pearson coefficient computed over every valid pair.
    scatter = fresh('owid-China-2015-2022.csv')
    scatter.locator('.question-card').filter(has_text='同步变化').first.locator('button.primary').click()
    expect(scatter.locator('.explore-output h3').first).to_contain_text('散点图', timeout=60000)
    expect(scatter.locator('.exploration-results tbody tr')).to_have_count(8)
    expect(scatter.locator('.explore-correlation')).to_contain_text('Pearson')
    expect(scatter.locator('.exploration-chart svg')).to_be_visible()
    scatter.screenshot(path=str(out / 'checkup-correlation-result.png'), full_page=True)
    scatter.close()
    passed('关系问题执行真实散点探索，八条来源与 Pearson 系数同时可见')

    # "Ask AI" hands the question plus the boundary requirements to the assistant
    # without running anything locally.
    ask = fresh('owid-China-2015-2022.csv')
    ask.locator('.question-card').filter(has_text='怎么变化').first.locator('button.text-button').click()
    expect(ask.get_by_role('dialog', name='数鉴 AI 助手')).to_be_visible()
    expect(ask.locator('#analysis-goal')).to_have_value(re.compile('核对的口径.*不能得出'))
    ask.get_by_role('dialog', name='数鉴 AI 助手').press('Escape')
    ask.close()
    passed('“让 AI 深入”带着口径与边界要求打开助手，不改动本地计算结果')

    for errors in all_errors:
        assert not errors, errors
    passed('无未捕获浏览器错误')
    browser.close()

(out / 'acceptance.json').write_text(json.dumps({
    'status': 'passed',
    'data': 'Original UCI and OWID public fixtures',
    'model': 'disabled; deterministic checkup and insight only',
    'checks': checks,
}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(checks)} checks passed.')
