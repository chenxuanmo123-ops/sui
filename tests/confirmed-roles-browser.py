"""Browser check: user-corrected field roles reach AI planning as metadata.

The AI endpoint is an explicit contract double installed by this test; the
dataset, the role correction and its validation are real UI and real local
computation state. Only columns the user actually corrected may carry
confirmedRole; automatic guesses must stay typeCandidate.
"""
import os, sys, json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
fixture = root / 'tests/fixtures/owid-China-2015-2022.csv'
checks = []
def checked(name):
    checks.append(name); print('PASS ' + name, flush=True)
mapping = {'x': 'year', 'metric': 'renewables_electricity', 'filter': '', 'value': '', 'from': '', 'to': '', 'aggregate': 'sum', 'timeBucket': 'year', 'conditions': []}
plan = {'goal': '查看年度可再生能源发电量', 'scene': '公开能源统计', 'grain': '每行一个地区一年', 'fieldRoles': [], 'assumptions': [], 'questions': [], 'tasks': [{'id': 'annual', 'title': '年度发电量', 'rationale': '按年分组求和', 'chart': 'line', 'mapping': mapping}], 'limitations': ['描述统计不证明因果']}
requests = {'plan': []}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/api/ai/status', lambda route: route.fulfill(json={'configured': True, 'providers': [{'id': 'contract', 'name': '仅测试替身', 'model': 'test-contract'}], 'canManage': True}))
    def on_plan(route):
        body = route.request.post_data_json
        requests['plan'].append(body)
        return route.fulfill(json={'plan': plan, 'datasetHash': body['dataset']['hash'], 'providerName': '仅测试替身', 'model': 'test-contract', 'generatedAt': '2026-10-26T00:00:00Z'})
    page.route('**/api/ai/plan', on_plan)
    page.goto(url + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    expect(page.locator('.dataset-name strong')).to_have_text('owid-China-2015-2022.csv', timeout=30000)
    expect(page.locator('.checkup-role-counts')).to_be_visible(timeout=30000)

    page.get_by_role('button', name='类型不对？纠正', exact=True).click()
    dialog = page.get_by_role('dialog', name='纠正字段角色')
    row = dialog.locator('.field-role-row').filter(has_text='year').first
    row.locator('select').select_option('category')
    expect(row).to_have_class('field-role-row corrected')
    page.keyboard.press('Escape')
    expect(dialog).to_have_count(0)
    checked('用户把 year 从自动判断纠正为分类维度，界面标记已纠正')

    page.get_by_role('button', name='打开 AI 分析助手', exact=True).first.click()
    page.get_by_label('分析目标', exact=True).fill('按年份查看可再生能源发电量的描述性变化。')
    page.get_by_role('button', name='理解数据并提出分析计划').click()
    expect(page.locator('.ai-events')).to_contain_text('已应用 1 项你确认的字段类型纠正。', timeout=30000)
    assert requests['plan'], '没有捕获到规划请求'
    sent = requests['plan'][-1]
    columns = {column['field']: column for column in sent['dataset']['columns']}
    assert columns['year']['confirmedRole'] == 'category', columns['year']
    assert columns['year']['typeCandidate'] == '时间候选', columns['year']
    assert all('confirmedRole' not in columns[field] for field in ('country', 'renewables_electricity', 'solar_electricity', 'wind_electricity')), columns
    assert 'rows' not in sent['dataset'] and all('examples' not in column for column in sent['dataset']['columns'])
    checked('规划请求只给用户纠正过的 year 带 confirmedRole，其余列保持类型候选，且不发送原始数据')

    expect(page.locator('.ai-plan')).to_contain_text('年度发电量')
    checked('带纠正面板时规划流程正常返回任务')
    assert not errors, errors
    browser.close()
print('ALL ' + str(len(checks)) + ' CHECKS PASSED')
