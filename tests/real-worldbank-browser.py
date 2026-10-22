"""Live acceptance: original World Bank XLS + saved real model + browser SQLite.
No HTTP routes are mocked. Calls the user's configured default model.
Only public dataset, plan, computed facts, and review are captured; no credentials.
"""
import json, os, sys, time, traceback
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
out = root / 'artifacts/real-data-acceptance'
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5174')
question = '对比中国和美国2023、2024年的GDP现价美元值。分别展示两个年份的国家对比，不要把跨年金额相加，也不要据此判断实际经济增速或解释原因。'
context = '来源为世界银行World Development Indicators，指标NY.GDP.MKTP.CD（GDP，现价美元）。每行一个国家，年份横向排列，单位USD。'
record = {'realModel': True, 'mockedRoutes': False, 'question': question, 'context': context, 'includeSamples': False, 'includeCategories': False, 'checks': [], 'responses': {}, 'browserErrors': []}
def save(): (out/'browser-acceptance.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
def check(text): record['checks'].append(text); save(); print('PASS '+text, flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width':1440,'height':1100}, accept_downloads=True)
    page.on('pageerror', lambda e: record['browserErrors'].append(str(e)))
    def capture(response):
        action = response.url.split('/api/ai/')[-1]
        if action not in ('plan', 'review'): return
        try:
            record['responses'][action] = {'status':response.status, 'body':response.json()}
            request = response.request.post_data_json
            if action == 'review': record['computedFacts'] = request.get('facts')
            save()
            print('REAL MODEL '+action+' HTTP '+str(response.status), flush=True)
        except Exception as e: print('Capture failed: '+type(e).__name__, flush=True)
    page.on('response', capture)
    def wait_response(action):
        started=time.monotonic(); next_update=20
        while action not in record['responses']:
            page.wait_for_timeout(500)
            elapsed=time.monotonic()-started
            if elapsed >= next_update:
                print('等待真实模型 '+action+' '+str(round(elapsed))+' 秒', flush=True); next_update+=20
            if elapsed>200: raise AssertionError('真实模型响应超时：'+action)
        response=record['responses'][action]
        assert response['status']==200, response
        return response['body']
    try:
        page.goto(base+'/', wait_until='networkidle')
        page.locator('#file-upload').set_input_files(str(out/'worldbank-gdp-original.xls'))
        expect(page.locator('#import-sheet')).to_be_visible()
        expect(page.locator('.import-progress')).to_have_count(0, timeout=30000)
        assert page.locator('#import-sheet option').count()==3
        page.locator('#import-sheet').select_option(index=0)
        record['autoHeaderRow']=page.locator('#import-header-row').input_value()
        if record['autoHeaderRow']!='4': page.locator('#import-header-row').fill('4')
        page.locator('#import-last-row').fill('6')
        page.screenshot(path=str(out/'01-original-xls-import.png'), full_page=True)
        page.locator('#confirm-import').check()
        page.get_by_role('button',name='确认导入并分析',exact=True).click()
        expect(page.locator('.import-dialog')).to_have_count(0)
        check('原始XLS直接上传；3个工作表；Data表第4行表头、第5/6行两国数据')
        page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
        page.get_by_label('分析目标',exact=True).fill(question)
        page.locator('.ai-optional > summary').click()
        page.locator('#business-context').fill(context)
        page.get_by_role('button',name='理解数据并提出分析计划').click()
        body=wait_response('plan'); plan=body['plan']; tasks=plan['tasks']
        print('真实模型计划：'+json.dumps(plan,ensure_ascii=False),flush=True)
        gdp_tasks=[(i,t) for i,t in enumerate(tasks) if t['mapping']['aggregate']!='count']
        assert len(gdp_tasks)==2, 'GDP比较任务应有两个：'+str(len(gdp_tasks))
        assert {t['mapping']['metric'] for _,t in gdp_tasks}=={'2023','2024'}, tasks
        for _,task in gdp_tasks:
            m=task['mapping']
            assert m['x']=='Country Name' and m['aggregate'] in ('sum','average','max','min'), m
            assert not m['filter'] and not m.get('conditions'), m
            assert m['timeBucket']=='none' and not m['from'] and not m['to'],m
        check('真实模型分别规划2023和2024两个任务，按国家比较，未跨年加总')
        page.screenshot(path=str(out/'02-real-model-plan.png'),full_page=True)
        page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
        page.get_by_role('button',name='确认计划并计算',exact=True).click()
        wait_response('review')
        expect(page.locator('.ai-review')).to_be_visible(timeout=10000)
        expect(page.locator('.ai-result-links button')).to_have_count(len(tasks))
        record['reviewText']=page.locator('.ai-review').inner_text()
        print('真实模型解读：'+record['reviewText'],flush=True)
        check('确认后执行真实SQLite并返回真实模型解读，未拦截或伪造任何AI响应')
        page.screenshot(path=str(out/'03-real-model-review.png'),full_page=True)
        gold=json.loads((out/'gold.json').read_text(encoding='utf-8'))
        record['taskResults']=[]
        for i, task in gdp_tasks:
            if not page.locator('.ai-result-links button').first.is_visible():
                page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
            page.locator('.ai-result-links button').nth(i).click()
            page.get_by_role('button',name='计算结果',exact=True).click()
            expect(page.locator('.data-panel tbody tr')).to_have_count(2)
            rows=[]
            year=task['mapping']['metric']
            expected={r['country']:r['value'] for r in gold if r['year']==year}
            for tr in page.locator('.data-panel tbody tr').all():
                cells=tr.locator('td').all_text_contents(); rows.append(cells)
                assert cells[0] in expected, cells
                assert abs(float(cells[1].replace(',',''))-expected[cells[0]])<1, (cells,expected)
            assert page.locator('#analysis-svg').count()==1
            page.get_by_role('button',name='来源记录',exact=True).click()
            source_text=page.locator('.source-list').inner_text()
            evidence=page.locator('#evidence').inner_text()
            record['taskResults'].append({'taskId':task['id'],'year':year,'renderedRows':rows,'sourceText':source_text,'evidenceText':evidence})
            page.screenshot(path=str(out/('04-result-'+year+'.png')),full_page=True)
            with page.expect_download() as download_event:
                page.get_by_role('button',name='导出证据报告',exact=True).click()
            target=out/('worldbank-gdp-'+year+'-report.html'); download_event.value.save_as(str(target))
            html=target.read_text(encoding='utf-8')
            for country,value in expected.items():
                assert country in html and str(value) in html, (country,value)
            assert '<svg' in html and 'SELECT' in html and 'Data' in html
            check(year+'图表和结果两国金额均与世界银行原始值误差小于1美元；导出含真实SQL、SVG与来源')
        assert not record['browserErrors'],record['browserErrors']
        record['status']='passed'; save()
        print('REAL ACCEPTANCE PASSED',flush=True)
    except Exception as error:
        record['status']='failed'; record['failure']=str(error); save()
        page.screenshot(path=str(out/'failure.png'),full_page=True)
        print('REAL ACCEPTANCE FAILED: '+str(error),flush=True)
        raise
    finally: browser.close()
