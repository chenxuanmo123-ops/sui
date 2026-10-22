"""UI regression with an explicit plan/review test double and real SEC SQLite results.
No model credentials are read or changed. This test does not measure LLM accuracy.
"""
import json, os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
(root / 'artifacts').mkdir(exist_ok=True)
url = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5174')
fixture = root / 'tests/fixtures/evaluation/financial/apple-sec-company-facts-fy2021-2023.csv'
plan = {
    'goal': '按年度分别查看收入和期末现金', 'scene': 'SEC Apple 披露事实', 'grain': '每行一个指标的一个披露期间',
    'fieldRoles': [], 'assumptions': [], 'questions': [], 'limitations': ['期末余额不能跨年累加，描述变化不能证明因果'],
    'tasks': [
        {'id': 'revenue', 'title': '年度收入', 'rationale': '这里故意复现真实模型的筛选值拼写错误', 'chart': 'line',
         'mapping': {'x': 'period_label', 'metric': 'value', 'aggregate': 'sum', 'filter': 'metric', 'value': 'revenues', 'from': '', 'to': '', 'unit': 'USD', 'timeBucket': 'none', 'conditions': []}},
        {'id': 'cash', 'title': '期末现金', 'rationale': '按披露年度保留余额，不跨年度求和', 'chart': 'bar',
         'mapping': {'x': 'period_label', 'metric': 'value', 'aggregate': 'sum', 'filter': 'metric', 'value': 'cash_and_cash_equivalents', 'from': '', 'to': '', 'unit': 'USD', 'timeBucket': 'none', 'conditions': []}},
    ],
}
checks, reviews, repairs, plans = [], [], [], []
all_fail = False
def checked(message):
    checks.append(message)
    print('PASS ' + message, flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def intercept(route):
        action = route.request.url.split('/api/ai/')[-1]
        if action == 'status':
            return route.fulfill(json={'configured': True, 'providers': [{'id': 'test', 'name': '明确的测试替身', 'model': 'ui-regression'}], 'defaultProviderId': 'test'})
        if action == 'plan':
            plans.append(route.request.post_data_json)
            active_plan = json.loads(json.dumps(plan))
            if all_fail:
                active_plan['tasks'] = active_plan['tasks'][:1]
            return route.fulfill(json={'plan': active_plan, 'datasetHash': route.request.post_data_json['dataset']['hash'], 'providerName': '明确的测试替身', 'model': 'ui-regression', 'generatedAt': '2026-10-17T00:00:00Z'})
        if action == 'repair-plan':
            repairs.append(route.request.post_data_json)
            fixed = json.loads(json.dumps(plan))
            fixed['tasks'] = fixed['tasks'][:1]
            fixed['tasks'][0]['mapping']['value'] = 'revenue'
            return route.fulfill(json={'plan': fixed, 'datasetHash': route.request.post_data_json['dataset']['hash'], 'providerName': '明确的测试替身', 'model': 'ui-regression', 'generatedAt': '2026-10-19T00:00:00Z'})
        if action == 'review':
            reviews.append(route.request.post_data_json)
            return route.fulfill(json={'review': {'answerability': 'partial', 'findings': [{'statement': '当前只能描述已成功计算的期末现金，收入尚未验证。', 'evidenceIds': ['cash:fact0'], 'interpretation': 'observation'}], 'limitations': ['收入任务执行失败，不能推断其变化。'], 'nextQuestions': []}})
        # Unexpected AI endpoints must not call the user's configured model during this UI test.
        return route.fulfill(status=400, json={'error': '本验收不允许额外模型请求：' + action})
    page.route('**/api/ai/**', intercept)
    page.goto(url + '/', wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    page.wait_for_function("document.querySelector('.dataset-name strong')?.textContent==='apple-sec-company-facts-fy2021-2023.csv'")
    page.get_by_role('button', name='打开 AI 分析助手', exact=True).click()
    page.get_by_label('分析目标', exact=True).fill(plan['goal'])
    page.get_by_role('button', name='理解数据并提出分析计划').click()
    expect(page.locator('.ai-preflight-warnings')).to_contain_text('metric = "revenues"')
    expect(page.locator('.ai-preflight-warnings')).to_contain_text('没有精确匹配记录')
    checked('确认计算前显示真实筛选问题，未自动把 revenues 改成 revenue')
    page.get_by_role('checkbox', name='我已核对行粒度', exact=False).check()
    page.get_by_role('button', name='确认计划并计算', exact=True).click()
    expect(page.locator('.ai-failure-recovery')).to_contain_text('年度收入')
    expect(page.locator('.ai-result-links button')).to_have_count(1)
    expect(page.locator('.ai-result-links button')).to_contain_text('期末现金')
    expect(page.locator('.ai-review')).to_contain_text('当前只能描述')
    checked('首任务失败单独显示，后续成功的现金任务和解读保留')
    assert len(reviews) == 1, reviews
    facts = reviews[0]['facts']
    assert {fact['taskId'] for fact in facts} == {'cash'}, facts
    assert {fact['analysisId'] for fact in facts} == {2}, facts
    assert {fact['label'] for fact in facts} == {'FY2022', 'FY2023'}, facts
    assert all(fact['text'].startswith('期末现金；') for fact in facts)
    checked('交给 review 的事实只包含成功任务，标题、分析 ID 和期间正确')
    page.screenshot(path=str(root / 'artifacts/ai-partial-execution.png'), full_page=True)
    page.locator('.ai-result-links button').click()
    expect(page.get_by_role('button', name='柱状', exact=True)).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#analysis-svg')).to_contain_text('FY2022')
    expect(page.locator('.data-panel')).to_contain_text('23,646,000,000')
    expect(page.locator('.data-panel')).to_contain_text('29,965,000,000')
    expect(page.locator('#evidence')).to_contain_text('cash_and_cash_equivalents')
    checked('主图表跟随成功任务的柱状设置，SQL 参数和真实数值正确')
    page.get_by_role('button', name='来源记录', exact=True).click()
    expect(page.locator('.source-list')).to_contain_text('来源记录 #4')
    expect(page.locator('.source-list')).to_contain_text('来源记录 #5')
    expect(page.locator('.source-list')).to_contain_text('cash_and_cash_equivalents')
    expect(page.locator('.source-list')).not_to_contain_text('metric = revenue')
    checked('证据来源为现金原始记录 #4/#5，未错绑收入记录')
    for width in [375, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1100})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
    checked('移动与桌面宽度无横向溢出')
    page.get_by_role('button', name='打开 AI 分析助手', exact=True).click()
    page.get_by_role('button', name='让 AI 修正失败任务', exact=True).click()
    expect(page.locator('.ai-repair-changes')).to_contain_text('revenues')
    expect(page.locator('.ai-repair-changes')).to_contain_text('revenue')
    expect(page.get_by_role('button', name='确认修正并重算失败任务', exact=True)).to_be_disabled()
    assert len(repairs) == 1
    assert {failure['taskId'] for failure in repairs[0]['failures']} == {'revenue'}
    assert repairs[0]['attempt'] == 1
    assert len(reviews) == 1
    expect(page.locator('.ai-repair-changes pre')).to_have_count(0)
    expect(page.locator('.ai-repair-mapping').first).to_contain_text('汇总：')
    checked('真实错误反馈触发修正，以中文口径对照，未确认前不执行或解读')
    page.get_by_role('checkbox', name='我已核对行粒度', exact=False).check()
    page.get_by_role('button', name='确认修正并重算失败任务', exact=True).click()
    expect(page.locator('.ai-result-links button')).to_have_count(2)
    expect(page.locator('.ai-failure-recovery')).to_have_count(0)
    expect(page.locator('.ai-review')).to_be_visible()
    assert len(reviews) == 2
    repaired_facts = reviews[-1]['facts']
    assert {fact['analysisId'] for fact in repaired_facts if fact['taskId'] == 'cash'} == {2}
    assert {fact['analysisId'] for fact in repaired_facts if fact['taskId'] == 'revenue'} == {3}
    checked('确认后只重算失败收入，现金原结果 ID 保留，合并证据绑定正确')
    for width in [375, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1100})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
    checked('包含口径 JSON 对照的恢复界面在手机和桌面均无横向溢出')
    page.screenshot(path=str(root / 'artifacts/ai-repair-execution.png'), full_page=True)
    all_fail = True
    page.get_by_role('button', name='理解数据并提出分析计划').click()
    expect(page.locator('.ai-tasks li')).to_have_count(1)
    page.get_by_role('checkbox', name='我已核对行粒度', exact=False).check()
    page.get_by_role('button', name='确认计划并计算', exact=True).click()
    expect(page.locator('.ai-error')).to_contain_text('全部任务计算失败')
    expect(page.get_by_role('button', name='让 AI 修正失败任务', exact=True)).to_be_enabled()
    assert len(reviews) == 2
    checked('全部任务失败时仍有修正入口，未向模型发送空事实冒充解读')
    page.get_by_role('button', name='让 AI 修正失败任务', exact=True).click()
    expect(page.locator('.ai-repair-changes')).to_be_visible()
    page.get_by_role('checkbox', name='我已核对行粒度', exact=False).check()
    page.get_by_role('button', name='确认修正并重算失败任务', exact=True).click()
    expect(page.locator('.ai-result-links button')).to_have_count(1)
    expect(page.locator('.ai-failure-recovery')).to_have_count(0)
    checked('全部失败的一轮可修正后恢复真实收入计算')
    page.get_by_label('分析目标', exact=True).fill('新目标使旧计划失效')
    expect(page.get_by_role('button', name='确认计划并计算', exact=True)).to_be_disabled()
    checked('输入变化使旧修正计划失效，不能继续执行旧计划')
    assert all(not request['includeCategories'] and not request['includeSamples'] for request in plans)
    assert all(not request['includeCategories'] and not request['includeSamples'] for request in repairs)
    checked('默认规划与修正请求均未授权发送样本或类别原值')
    assert not errors, errors
    print(json.dumps({'checks': checks, 'errors': errors, 'modelQualityEvaluation': False}, ensure_ascii=False))
    browser.close()
