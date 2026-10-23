"""Explicit model protocol double; actual SQLite calculations over real SEC data.
Only the second Worker request is delayed for deterministic cancellation testing.
Does not measure model quality and never reads model credentials.
"""
import json, os, sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
fixture = root / 'tests/fixtures/evaluation/financial/apple-sec-company-facts-fy2021-2023.csv'
tasks = [{'id': key, 'title': title, 'rationale': '按披露期间查看，不跨期累加余额', 'chart': 'bar', 'mapping': {'x': 'period_label', 'metric': 'value', 'filter': 'metric', 'value': value, 'from': '', 'to': '', 'unit': 'USD', 'aggregate': 'sum', 'timeBucket': 'none', 'conditions': []}} for key, title, value in [('cash', '期末现金', 'cash_and_cash_equivalents'), ('revenue', '年度收入', 'revenue')]]
plan = {'goal': '分别查看年度现金和收入', 'scene': 'SEC 公开披露', 'grain': '每行一个年度指标', 'fieldRoles': [], 'assumptions': [], 'questions': [], 'limitations': ['仅描述当前披露数据'], 'tasks': tasks}
checks, reviews = [], []
def passed(message):
    checks.append(message)
    print('PASS ' + message, flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('''(() => {
      const RealWorker = window.Worker;
      window.workerComputations = []; window.workerTerminations = 0;
      window.Worker = class extends RealWorker {
        postMessage(message, ...args) {
          if (message.type === 'aggregate' && message.analysisId) {
            window.workerComputations.push(message.analysisId);
            if (window.workerComputations.length === 2) { this.testDelay = setTimeout(() => super.postMessage(message, ...args), 15000); return; }
          }
          super.postMessage(message, ...args);
        }
        terminate() { clearTimeout(this.testDelay); window.workerTerminations++; super.terminate(); }
      };
    })();''')
    def intercept(route):
        action = route.request.url.split('/api/ai/')[-1]
        if action == 'status': return route.fulfill(json={'configured': True, 'providers': [{'id': 'test', 'name': '明确的测试替身', 'model': 'ui-cancellation'}], 'defaultProviderId': 'test'})
        if action == 'plan': return route.fulfill(json={'plan': plan, 'datasetHash': route.request.post_data_json['dataset']['hash'], 'model': 'ui-cancellation', 'providerName': '明确的测试替身', 'generatedAt': '2026-10-23T00:00:00Z'})
        if action == 'review':
            reviews.append(route.request.post_data_json)
            return route.fulfill(json={'review': {'answerability': 'descriptive_only', 'findings': [{'statement': '仅描述真实计算的期间数据。', 'evidenceIds': ['cash:fact0'], 'interpretation': 'observation'}], 'limitations': ['不推断因果'], 'nextQuestions': []}})
        return route.fulfill(status=400, json={'error': '禁止额外模型请求'})
    page.route('**/api/ai/**', intercept)
    page.goto(os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5174'), wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    expect(page.locator('.dataset-name strong')).to_contain_text('apple-sec-company-facts')
    page.get_by_role('button', name='打开 AI 分析助手', exact=True).click()
    page.get_by_label('分析目标', exact=True).fill('分别查看每年的期末现金和年度收入。')
    page.get_by_role('button', name='理解数据并提出分析计划', exact=True).click()
    expect(page.locator('.ai-tasks li')).to_have_count(2)
    page.get_by_role('checkbox', name='我已核对行粒度', exact=False).check()
    page.get_by_role('button', name='确认计划并计算', exact=True).click()
    expect(page.locator('.execution-progress [data-state="completed"]')).to_contain_text('期末现金')
    expect(page.locator('.execution-progress [data-state="running"]')).to_contain_text('年度收入')
    expect(page.locator('.request-progress')).to_have_count(0)
    expect(page.get_by_label('分析目标', exact=True)).to_be_disabled()
    page.get_by_role('button', name='停止计算', exact=True).click()
    expect(page.locator('.execution-progress [data-state="cancelled"]')).to_contain_text('年度收入')
    expect(page.locator('.ai-result-links button')).to_have_count(1)
    assert not reviews
    assert page.evaluate('window.workerTerminations') == 1
    passed('停止真正终止计算线程；保留已完成现金结果，不调用 AI 解读')
    expect(page.get_by_role('button', name='确认并继续未完成任务', exact=True)).to_be_disabled()
    page.get_by_role('checkbox', name='我已核对行粒度', exact=False).check()
    page.get_by_role('button', name='确认并继续未完成任务', exact=True).click()
    expect(page.locator('.ai-result-links button')).to_have_count(2)
    expect(page.locator('.ai-review')).to_be_visible()
    assert page.evaluate('window.workerComputations') == [1, 2, 2]
    assert len(reviews) == 1
    facts = reviews[0]['facts']
    assert {fact['analysisId'] for fact in facts if fact['taskId'] == 'cash'} == {1}
    assert {fact['analysisId'] for fact in facts if fact['taskId'] == 'revenue'} == {2}
    passed('继续仅重算被中止任务，原现金结果 ID 和证据保留')
    page.locator('.ai-result-links button').filter(has_text='期末现金').click()
    expect(page.locator('.data-panel')).to_contain_text('23,646,000,000')
    expect(page.locator('.data-panel')).to_contain_text('29,965,000,000')
    passed('现金图表与真实 SEC 披露值一致，停止和继续未改变结果')
    out = root / 'artifacts/ai-cancellation'
    out.mkdir(parents=True, exist_ok=True)
    open_assistant = page.get_by_role('button', name='打开 AI 分析助手', exact=True)
    if open_assistant.count(): open_assistant.click()
    for width in [390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1100})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
        page.screenshot(path=str(out / f'cancellation-{width}.png'), full_page=True, animations='disabled')
    assert not errors, errors
    passed('三种屏幕宽度无整体横向溢出，无浏览器异常')
    (out / 'checks.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'modelQualityEvaluation': False}, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
