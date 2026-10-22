"""UCI real CSV, real SQLite and selected-group follow-up. --real uses the saved model.
Default mode uses explicitly labeled plan/review doubles for UI mechanics, not model quality.
Never reads, changes or prints saved model credentials.
"""
import csv,json,os,sys,time
from pathlib import Path
from collections import defaultdict
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright,expect
sys.stdout.reconfigure(encoding='utf-8')
real='--real' in sys.argv
workspace='--workspace' in sys.argv
out=root/'artifacts/visualization-acceptance'
out.mkdir(exist_ok=True)
record={'realModel':real,'mockedRoutes':not real,'checks':[],'responses':[],'errors':[]}
requests=[]
inspections=[]
def save():(out/'browser-checks.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
def check(s):record['checks'].append(s);save();print('PASS '+s,flush=True)
raw=list(csv.DictReader((root/'tests/fixtures/uci-online-shoppers.csv').open(encoding='utf-8')))
expected=defaultdict(lambda:{'numerator':0,'denominator':0})
for row in raw:
 if row['VisitorType']=='New_Visitor':
  expected[row['Weekend']]['denominator']+=1
  expected[row['Weekend']]['numerator']+=row['Revenue']=='TRUE'
base_context='真实来源UCI Online Shoppers Purchasing Intention。每行一次电商访问，不是用户。Revenue精确值TRUE/FALSE表示是否购买，不是营收金额。购买转化率=Revenue=TRUE的记录数 / Revenue属于TRUE、FALSE的记录数 ×100%；未知和缺失排除。VisitorType是访客类型，Weekend是否周末。只做描述性分析，不推断因果或当前市场。'
base_question='仅生成一个任务：按VisitorType全量分组计算购买转化率，分母同时表示访问量，不要额外筛选。'
follow_question='仅生成一个任务：在当前选中的新访客范围内，按Weekend分组计算购买转化率，不增加其他筛选和时间限制。保持Revenue的TRUE/FALSE分母口径。'
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge')
 page=browser.new_page(viewport={'width':1440,'height':1080},accept_downloads=True,reduced_motion='reduce')
 page.on('pageerror',lambda e:record['errors'].append(str(e)))
 def capture(response):
  action=response.url.rsplit('/',1)[-1]
  if response.request.method=='POST' and '/api/ai/' in response.url and action in ('plan','review'):
   body=response.json();record['responses'].append({'action':action,'status':response.status,'body':body});save()
   requests.append(response.request.post_data_json)
   print(('REAL MODEL ' if real else 'EXPLICIT UI DOUBLE ')+action+' HTTP '+str(response.status),flush=True)
 page.on('response',capture)
 page.on('request',lambda r:inspections.append(r.url) if r.method=='POST' and r.url.endswith('/api/ai/inspect') else None)
 def wait_response(action,n):
  start=time.monotonic();notice=20
  while len([r for r in record['responses'] if r['action']==action])<n:
   page.wait_for_timeout(300)
   elapsed=time.monotonic()-start
   if elapsed>notice:print('等待 '+action+' '+str(round(elapsed))+' 秒',flush=True);notice+=20
   assert elapsed<210,'模型请求超时'
  item=[r for r in record['responses'] if r['action']==action][n-1]
  assert item['status']==200,item
  return item['body']
 if not real:
  state={'plans':0}
  def intercept(route):
   action=route.request.url.rsplit('/',1)[-1]
   if action=='status':return route.fulfill(json={'configured':True,'providers':[{'id':'test','name':'明确的UI测试替身','model':'ui-only'}],'defaultProviderId':'test'})
   payload=route.request.post_data_json
   if action=='plan':
    state['plans']+=1
    x=state.get('dimension','VisitorType')
    title='访客类型购买转化率' if state['plans']==1 else '新访客周末购买转化率'
    mapping={'x':x,'metric':'Revenue','aggregate':'count','filter':'','value':'','from':'','to':'','unit':'%','timeBucket':'none','conditions':[],'rate':{'successValue':'TRUE','eligibleValues':['TRUE','FALSE']}}
    plan={'goal':payload['question'],'scene':'UCI电商访问','grain':'每行一次访问','fieldRoles':[],'assumptions':[],'questions':[],'limitations':['明确UI测试替身；不评价模型能力'],'tasks':[{'id':'rate','title':title,'rationale':'比较真实条件计数比例','chart':'bar','mapping':mapping}]}
    if state.get('multi'):
     plan['tasks'].append({'id':'weekend','title':'按周末分组核算','rationale':'核对不同维度的真实比例','chart':'bar','mapping':{**mapping,'x':'Weekend'}})
    return route.fulfill(json={'plan':plan,'datasetHash':payload['dataset']['hash'],'providerName':'明确的UI测试替身','model':'ui-only','generatedAt':'2026-10-19T00:00:00Z'})
   if action=='review':return route.fulfill(json={'review':{'answerability':'descriptive_only','findings':[],'limitations':['明确UI测试替身；不评价模型能力'],'nextQuestions':[]}})
   return route.fulfill(status=400,json={'error':'UI验收不允许额外模型请求'})
  page.route('**/api/ai/**',intercept)
 try:
  page.goto(os.environ.get('TEST_BASE_URL','http://127.0.0.1:5174')+'/',wait_until='networkidle')
  page.locator('#file-upload').set_input_files(str(root/'tests/fixtures/uci-online-shoppers.csv'))
  expect(page.locator('.dataset-name strong')).to_contain_text('uci-online-shoppers')
  if not page.get_by_role('dialog',name='数鉴 AI 助手').is_visible():
   page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
  page.get_by_label('分析目标',exact=True).fill(base_question)
  page.locator('.ai-optional > summary').click()
  page.locator('#business-context').fill(base_context)
  page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
  first=wait_response('plan',1)
  tasks=first['plan']['tasks'];assert len(tasks)==1 and tasks[0]['mapping']['x']=='VisitorType',tasks
  page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
  page.get_by_role('button',name='确认计划并计算',exact=True).click()
  wait_response('review',1)
  expect(page.locator('.bundle-review')).to_be_attached()
  if page.get_by_role('dialog',name='数鉴 AI 助手').is_visible():page.get_by_role('button',name='收起 AI 助手',exact=True).click()
  expect(page.locator('.rate-summary')).to_contain_text('15.47')
  viz=page.locator('.bundle-result .analysis-viz').first
  expect(viz.get_by_label('图表方向',exact=True)).to_have_value('horizontal')
  assert not page.locator('.result-data-details').evaluate('(el)=>el.open')
  viz.locator('.chart-hit').filter(has_text='New_Visitor').hover()
  expect(viz.locator('.viz-tooltip')).to_contain_text('422 / 1,694')
  expect(viz.locator('.viz-tooltip')).to_contain_text('9.44 个百分点')
  expect(viz.locator('.viz-reference-key')).to_contain_text('15.47')
  check('真实比例悬停显示完整分子分母与百分点差；参考线为全表加权比例，非分组均值')
  viz.get_by_label('图表排序',exact=True).select_option('asc')
  titles=viz.locator('.chart-hit title').all_text_contents()
  assert titles[0].startswith('Returning_Visitor:') and titles[-1].startswith('New_Visitor:'),titles
  viz.locator('.chart-hit').filter(has_text='Returning_Visitor').click()
  expect(page.get_by_label('已选分组',exact=True)).to_contain_text('10,551')
  expect(viz.locator('.viz-tooltip')).to_have_count(0)
  assert page.get_by_role('button',name='围绕此分组追问',exact=True).is_visible()
  page.get_by_label('定位图表分组',exact=True).select_option('New_Visitor')
  expect(page.get_by_label('已选分组',exact=True)).to_contain_text('1,694')
  check('排序后点击仍关联正确原始记录；选择旁直接显示追问入口；定位框与图表同步')
  viz.get_by_role('button',name='放大查看图表',exact=True).click()
  dialog=page.get_by_role('dialog',name='放大图表',exact=True)
  expect(dialog).to_be_visible()
  expect(dialog.get_by_label('图表排序',exact=True)).to_have_value('asc')
  expect(dialog.get_by_label('图表方向',exact=True)).to_have_value('horizontal')
  dialog.locator('.chart-hit').filter(has_text='Other').click()
  expect(dialog).to_have_count(0)
  expect(viz.get_by_role('button',name='放大查看图表',exact=True)).to_be_focused()
  viz.get_by_role('button',name='放大查看图表',exact=True).click()
  page.keyboard.press('Escape')
  expect(dialog).to_have_count(0)
  expect(viz.get_by_role('button',name='放大查看图表',exact=True)).to_be_focused()
  expect(page.get_by_label('已选分组',exact=True)).to_contain_text('85 条匹配记录')
  viz.locator('.chart-hit').filter(has_text='New_Visitor').focus()
  page.keyboard.press('Enter')
  expect(page.get_by_label('已选分组',exact=True)).to_contain_text('1,694')
  check('放大保留排序与方向；点选或Escape返回且焦点恢复；键盘 Enter 可选择图形')
  viz.get_by_label('图表方向',exact=True).select_option('vertical')
  viz.locator('.viz-display > summary').click()
  viz.get_by_role('checkbox',name='参考线',exact=True).uncheck()
  expect(viz.locator('.chart-reference')).to_have_count(0)
  page.keyboard.press('Escape')
  assert not viz.locator('.viz-display').evaluate('(el)=>el.open')
  expect(viz.locator('.viz-display > summary')).to_be_focused()
  viz.locator('.viz-display > summary').click()
  page.locator('.bundle-result > header').click()
  assert not viz.locator('.viz-display').evaluate('(el)=>el.open')
  viz.get_by_role('button',name='重置图表显示',exact=True).click()
  expect(viz.get_by_label('图表方向',exact=True)).to_have_value('horizontal')
  expect(viz.locator('.chart-reference')).to_have_count(1)
  page.locator('.result-data-details > summary').click()
  expect(page.locator('.bundle-result tbody tr')).to_have_count(3)
  for tr in page.locator('.bundle-result tbody tr').all():
   cells=tr.locator('td').all_text_contents();group=[r for r in raw if r['VisitorType']==cells[0]]
   assert int(cells[2])==sum(r['Revenue']=='TRUE' for r in group) and int(cells[3])==len(group),cells
  page.locator('.result-data-details > summary').click()
  page.get_by_label('定位图表分组',exact=True).select_option('New_Visitor')
  page.locator('.bundle-heading').hover()
  page.locator('.analysis-bundle').screenshot(path=str(out/'01-chart-selection.png'))
  page.locator('.bundle-result').first.screenshot(path=str(out/'04-group-interaction.png'))
  with page.expect_download() as event:viz.get_by_role('button',name='导出当前图表视图 SVG',exact=True).click()
  event.value.save_as(str(out/'selected-view.svg'))
  svg=(out/'selected-view.svg').read_text(encoding='utf-8')
  assert 'xmlns="http://www.w3.org/2000/svg"' in svg and 'New_Visitor' in svg
  check('方向切换、参考线开关和重置可用；结果表数字与独立 CSV 核算一致；SVG 可独立导出')
  state['dimension']='TrafficType'
  if not page.get_by_role('dialog',name='数鉴 AI 助手').is_visible():
   page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
  page.get_by_label('分析目标',exact=True).fill('按TrafficType统计购买转化率；保留编码原值，不推断渠道名称。')
  page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
  wait_response('plan',2)
  page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
  page.get_by_role('button',name='确认计划并计算',exact=True).click();wait_response('review',2)
  if page.get_by_role('dialog',name='数鉴 AI 助手').is_visible():page.get_by_role('button',name='收起 AI 助手',exact=True).click()
  viz=page.locator('.bundle-result .analysis-viz').first
  expect(viz.locator('.chart-hit')).to_have_count(12)
  expect(viz.locator('.viz-footer')).to_contain_text('1–12 / 20')
  grid=lambda:viz.locator('svg > g > line[stroke="#e6edf5"]').evaluate_all('els=>els.map(e=>e.getAttribute("x1"))')
  before=grid()
  viz.get_by_role('button',name='下一段',exact=True).click()
  expect(viz.locator('.chart-hit')).to_have_count(8)
  expect(viz.locator('.viz-footer')).to_contain_text('13–20 / 20')
  assert before==grid(),'分页不能改变全组坐标范围'
  last_label=viz.locator('.chart-hit title').last.text_content().split(':')[0]
  viz.get_by_role('button',name='上一段',exact=True).click()
  page.get_by_label('定位图表分组',exact=True).select_option(last_label)
  assert any(t.startswith(last_label+':') for t in viz.locator('.chart-hit title').all_text_contents())
  with page.expect_download() as event:page.get_by_role('button',name='导出完整分析报告',exact=True).click()
  event.value.save_as(str(out/'all-groups-report.html'))
  html=(out/'all-groups-report.html').read_text(encoding='utf-8')
  assert html.count('class="chart-hit"')==20 and '当前范围总体比例' in html and '10.24432/C5F88Q' in html
  assert '<select' not in html,'静态报告不包含无效交互配置框'
  check('真实20组分段浏览不丢组且坐标不变；定位自动切段；完整HTML仍导出全部20组与引用')
  for width in [390,768,1440]:
   page.set_viewport_size({'width':width,'height':1080})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  page.set_viewport_size({'width':1440,'height':1080})
  if not real:
   state['multi']=True
   page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
   page.get_by_label('分析目标',exact=True).fill('按TrafficType与Weekend分别计算购买转化率')
   page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
   wait_response('plan',3)
   page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
   page.get_by_role('button',name='确认计划并计算',exact=True).click()
   wait_response('review',3)
   expect(page.locator('.bundle-result:visible')).to_have_count(1)
   page.locator('.result-navigation button').nth(1).click()
   expect(page.locator('.bundle-result:visible')).to_have_count(1)
   expect(page.locator('.bundle-result:visible h3')).to_contain_text('按周末分组核算')
   expect(page.locator('.bundle-result:visible .rate-summary')).to_contain_text('15.47')
   page.locator('.bundle-result:visible .result-data-details > summary').click()
   expected_weekend=defaultdict(lambda:{'numerator':0,'denominator':0})
   for r in raw:
    expected_weekend[r['Weekend']]['denominator']+=1
    expected_weekend[r['Weekend']]['numerator']+=r['Revenue']=='TRUE'
   for tr in page.locator('.bundle-result:visible tbody tr').all():
    cells=tr.locator('td').all_text_contents();e=expected_weekend[cells[0]]
    assert int(cells[2])==e['numerator'] and int(cells[3])==e['denominator'],cells
   page.locator('.result-navigation button').nth(0).click()
   expect(page.locator('.bundle-result:visible')).to_have_count(1)
   with page.expect_download() as event:page.get_by_role('button',name='导出完整分析报告',exact=True).click()
   event.value.save_as(str(out/'multi-task-report.html'))
   multi_html=(out/'multi-task-report.html').read_text(encoding='utf-8')
   assert '按周末分组核算' in multi_html and multi_html.count('class="chart-hit"')==22
   page.locator('.analysis-bundle').screenshot(path=str(out/'05-focused-tasks.png'))
   check('两项真实SQL按任务聚焦切换，隐藏任务仍保留完整结果；导出包含全部22个分组')
  page.get_by_role('button',name='探索分析',exact=True).click()
  page.get_by_label('探索分组字段',exact=True).select_option('VisitorType')
  page.get_by_label('探索统计方式',exact=True).select_option('count')
  page.get_by_label('探索指标字段',exact=True).select_option('Revenue')
  page.get_by_role('button',name='执行探索分析',exact=True).click()
  expect(page.locator('.exploration-chart svg')).to_have_count(1)
  expect(page.locator('.exploration-results tbody tr')).to_have_count(3)
  page.get_by_label('探索图表方向',exact=True).select_option('vertical')
  page.locator('.exploration-results tbody tr').filter(has_text='New_Visitor').get_by_role('button').click()
  expect(page.locator('.explore-evidence')).to_contain_text('1694')
  page.locator('.explore-output > section').first.screenshot(path=str(out/'02-explore-bars.png'))
  for kind in ['折线图','散点图','热力图']:
   page.get_by_role('button',name=kind,exact=True).click()
   if kind=='散点图':
    page.get_by_label('探索分组字段',exact=True).select_option('ProductRelated_Duration')
    page.get_by_label('探索第二字段',exact=True).select_option('BounceRates')
   if kind=='热力图':
    page.get_by_label('探索分组字段',exact=True).select_option('VisitorType')
    page.get_by_label('探索第二字段',exact=True).select_option('Weekend')
   page.get_by_role('button',name='执行探索分析',exact=True).click()
   expect(page.locator('.core-warning').filter(has_text='配置已变化')).to_have_count(0)
   expect(page.locator('.exploration-chart svg')).to_have_count(1)
   if kind=='热力图':
    expect(page.locator('.exploration-results tbody tr')).to_have_count(6)
    expect(page.locator('.exploration-viz')).to_contain_text('不按 0 补齐')
    page.locator('.explore-output > section').first.screenshot(path=str(out/'03-heatmap.png'))
  check('探索柱图/折线/散点/热力图真实SQL后渲染；来源选择可用；热力图明确缺失组合语义')
  with page.expect_download() as event:page.get_by_role('button',name='导出 HTML 证据报告',exact=True).click()
  event.value.save_as(str(out/'explore-report.html'))
  assert '图表保留导出时的方向和缩放视图' in (out/'explore-report.html').read_text(encoding='utf-8')
  page.get_by_role('button',name='对比诊断',exact=True).click()
  page.get_by_label('对比期间字段',exact=True).select_option('Month')
  page.get_by_label('对比拆解维度',exact=True).select_option('VisitorType')
  page.get_by_label('对比分析指标',exact=True).select_option('Revenue')
  page.get_by_label('对比统计方式',exact=True).select_option('count')
  for field,value in [('基准期起点','Feb'),('基准期终点','Feb'),('当前期起点','Mar'),('当前期终点','Mar')]:page.get_by_label(field,exact=True).fill(value)
  page.get_by_role('checkbox',name='我已确认两期可比、行粒度与可加口径',exact=True).check()
  page.get_by_role('button',name='执行期间对比',exact=True).click()
  expect(page.locator('.exploration-chart svg')).to_have_count(1)
  comparable=page.locator('.explore-output > section').first
  for tr in comparable.locator('tbody tr').all():
   cells=tr.locator('td').all_text_contents()
   a=sum(r['Month']=='Feb' and r['VisitorType']==cells[0] for r in raw)
   b=sum(r['Month']=='Mar' and r['VisitorType']==cells[0] for r in raw)
   assert float(cells[1].replace(',',''))==a and float(cells[2].replace(',',''))==b,cells
  row=comparable.locator('tbody tr').filter(has_text='New_Visitor')
  row.get_by_role('button',name='核对两期来源',exact=True).click()
  expect(row).to_have_class('is-selected')
  expect(page.get_by_role('heading',name='New_Visitor · 两期来源记录',exact=True)).to_be_visible()
  with page.expect_download() as event:page.get_by_role('button',name='导出对比证据报告',exact=True).click()
  event.value.save_as(str(out/'compare-report.html'))
  assert '本次查询返回的完整结果见上表' in (out/'compare-report.html').read_text(encoding='utf-8')
  check('期间对比表格选择与来源同步；真实2月/3月访问计数与独立CSV核算一致；探索和对比报告注明缩放视图')
  assert not record['errors'],record['errors']
  check('390/768/1440宽度无整页溢出，无浏览器运行错误')
  record['status']='passed';save()
 except Exception:
  page.screenshot(path=str(out/'failure.png'),full_page=True);save();raise
 finally:browser.close()
