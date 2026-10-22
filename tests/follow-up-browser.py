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
out=root/('artifacts/workspace-acceptance' if workspace else 'artifacts/follow-up-real-acceptance' if real else 'artifacts/follow-up-ui-acceptance')
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
    x='VisitorType' if state['plans']==1 else 'Weekend'
    title='访客类型购买转化率' if state['plans']==1 else '新访客周末购买转化率'
    mapping={'x':x,'metric':'Revenue','aggregate':'count','filter':'','value':'','from':'','to':'','unit':'%','timeBucket':'none','conditions':[],'rate':{'successValue':'TRUE','eligibleValues':['TRUE','FALSE']}}
    plan={'goal':payload['question'],'scene':'UCI电商访问','grain':'每行一次访问','fieldRoles':[],'assumptions':[],'questions':[],'limitations':['明确UI测试替身；不评价模型能力'],'tasks':[{'id':'rate','title':title,'rationale':'比较真实条件计数比例','chart':'bar','mapping':mapping}]}
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
  page.locator('.bundle-result .chart-hit').filter(has_text='New_Visitor').click()
  expect(page.get_by_label('已选分组',exact=True)).to_contain_text('1,694')
  page.locator('.analysis-bundle').screenshot(path=str(out/'01-selected-group.png'))
  check('真实原文件全表计算1908/12330，点击新访客图形后显示1694条匹配记录')
  page.get_by_role('button',name='围绕此分组追问',exact=True).click()
  expect(page.locator('.followup-scope')).to_contain_text('New_Visitor')
  expect(page.locator('.followup-scope')).to_contain_text('1,694')
  page.get_by_label('分析目标',exact=True).fill(follow_question)
  assert not page.get_by_role('checkbox',name='附带每列最多三个原始值样本',exact=False).is_checked()
  assert not page.get_by_role('checkbox',name='授权发送低基数文本列的类别字典',exact=False).is_checked()
  page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
  follow=wait_response('plan',2)
  tasks=follow['plan']['tasks'];assert len(tasks)==1 and tasks[0]['mapping']['x']=='Weekend',tasks
  check('选中范围进入助手；问题可编辑，原始样本和类别字典仍未授权')
  page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
  page.get_by_role('button',name='确认计划并计算',exact=True).click()
  wait_response('review',2)
  expect(page.get_by_label('本次追问范围',exact=True)).to_contain_text('New_Visitor')
  if page.get_by_role('dialog',name='数鉴 AI 助手').is_visible():page.get_by_role('button',name='收起 AI 助手',exact=True).click()
  expect(page.locator('.rate-summary')).to_contain_text('24.91')
  expect(page.locator('.rate-summary')).to_contain_text('422 / 1,694')
  for row in page.locator('.bundle-result tbody tr').all():
   cells=row.locator('td').all_text_contents();g=expected[cells[0]]
   assert int(cells[2])==g['numerator'] and int(cells[3])==g['denominator'],cells
   assert abs(float(cells[1])-100*g['numerator']/g['denominator'])<0.0001,cells
  assert len(page.locator('.analysis-thread-items button').all())==2
  check('追问实际按新访客范围重算：422/1694=24.91%；周末各组与独立Python逐组核算一致')
  for payload in requests:
   assert not payload.get('includeSamples',False) and not payload.get('includeCategories',False)
   assert 'rowIds' not in payload and 'scope' not in payload
   assert 'rowIds' not in json.dumps(payload.get('previous',{}))
  assert '锁定匹配行数=1694' in json.dumps(requests[-1],ensure_ascii=False)
  check('模型收到范围说明和计算事实；完整文件与来源行ID列表未发送')
  page.locator('.analysis-bundle').screenshot(path=str(out/'02-scoped-follow-up.png'))
  with page.expect_download() as event:page.get_by_role('button',name='导出完整分析报告',exact=True).click()
  path=out/'scoped-follow-up-report.html';event.value.save_as(str(path));html=path.read_text(encoding='utf-8')
  assert '追问范围完整快照记录索引' in html and 'New_Visitor' in html and '_record IN (' in html
  assert '10.24432/C5F88Q' in html and '<svg' in html
  check('单文件报告保留追问范围、基准值、真实SQL、来源索引与公开数据出处')
  page.get_by_role('button',name='返回来源分析对照',exact=False).click()
  expect(page.locator('.rate-summary')).to_contain_text('15.47')
  expect(page.locator('.bundle-result tbody tr')).to_have_count(3)
  page.get_by_role('button',name='追问 · New_Visitor',exact=False).click()
  expect(page.locator('.rate-summary')).to_contain_text('24.91')
  check('从追问返回原分析，再通过分析路径切回追问，两份结果保持独立')
  for width in (390,768,1440):
   page.set_viewport_size({'width':width,'height':1000})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
  page.set_viewport_size({'width':390,'height':844})
  page.screenshot(path=str(out/'03-mobile-follow-up.png'),full_page=True)
  assert not record['errors'],record['errors']
  check('390/768/1440宽度无页面横向溢出，无浏览器运行错误')
  if workspace:
   storage=page.get_by_label('本机工作区',exact=True)
   expect(storage).to_contain_text('已保存到本机')
   count=len(record['responses'])
   page.evaluate("localStorage.setItem('shujian.auto-inspection.v1','true')")
   page.reload(wait_until='networkidle')
   expect(storage).to_contain_text('已保存到本机')
   expect(page.locator('.rate-summary')).to_contain_text('422 / 1,694')
   expect(page.get_by_label('本次追问范围',exact=True)).to_contain_text('New_Visitor')
   assert page.locator('.analysis-thread-items button').count()==2
   assert len(record['responses'])==count and not inspections
   expect(page.locator('.initial-analysis')).to_contain_text('本次不会自动调用模型')
   page.get_by_role('button',name='展开单项计算与证据检查器',exact=True).click()
   page.get_by_role('checkbox',name='允许上传后自动发送字段与质量摘要给默认模型',exact=True).uncheck()
   page.get_by_role('button',name='收起单项计算与证据检查器',exact=True).click()
   check('刷新恢复原数据、两轮分析路径、范围1694与真实计算结果；没有额外模型调用')
   page.set_viewport_size({'width':1440,'height':1080})
   page.get_by_role('button',name='返回来源分析对照',exact=False).click()
   expect(page.locator('.rate-summary')).to_contain_text('15.47')
   page.get_by_role('button',name='追问 · New_Visitor',exact=False).click()
   with page.expect_download() as event:page.get_by_role('button',name='导出完整分析报告',exact=True).click()
   restored_report=out/'restored-report.html';event.value.save_as(str(restored_report))
   text=restored_report.read_text(encoding='utf-8')
   assert '_record IN (' in text and '10.24432/C5F88Q' in text and '<svg' in text
   check('恢复后仍可切换原分析并导出含范围、SQL、引用的完整SVG报告')
   page.get_by_role('button',name='数据与来源',exact=True).click()
   page.locator('.source-editor summary').click()
   page.get_by_label('出处：来源备注',exact=True).fill('工作区恢复验收：UCI原文件，保留访问粒度与历史样本限制。')
   page.get_by_role('button',name='保存出处备注',exact=True).click()
   expect(storage).to_contain_text('已保存到本机')
   page.reload(wait_until='networkidle')
   expect(page.get_by_role('heading',name='来源与数据快照',exact=True)).to_be_visible()
   page.locator('.source-editor summary').click()
   expect(page.get_by_label('出处：来源备注',exact=True)).to_have_value('工作区恢复验收：UCI原文件，保留访问粒度与历史样本限制。')
   check('来源备注与当前页面刷新恢复，未被恢复过程自动发送模型')
   page.get_by_role('button',name='分析工作台',exact=True).click()
   page.locator('.result-data-details > summary').click()
   page.locator('.bundle-result .group-select').filter(has_text='FALSE').click()
   page.get_by_role('button',name='围绕此分组追问',exact=True).click()
   expect(page.locator('.followup-scope')).to_contain_text('1,215')
   page.get_by_label('分析目标',exact=True).fill('在当前锁定范围内继续按Weekend计算购买转化率，保持原分子分母。')
   page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
   wait_response('plan',3)
   page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
   page.get_by_role('button',name='确认计划并计算',exact=True).click()
   wait_response('review',3)
   if page.get_by_role('dialog',name='数鉴 AI 助手').is_visible():page.get_by_role('button',name='收起 AI 助手',exact=True).click()
   expect(page.locator('.rate-summary')).to_contain_text('317 / 1,215')
   expect(page.locator('.bundle-result tbody tr')).to_have_count(1)
   assert page.locator('.analysis-thread-items button').count()==3
   page.get_by_role('button',name='返回来源分析对照',exact=False).click()
   expect(page.locator('.rate-summary')).to_contain_text('422 / 1,694')
   check('恢复后从子分组继续追问，实际SQL仅计算1215条匹配记录，编号与父分析关系保留')
   page.get_by_role('button',name='分析工作台',exact=True).click()
   page.locator('.workspace-storage').screenshot(path=str(out/'04-local-save.png'))
   # Explicit fault injection into this isolated browser context; not fake business data.
   page.evaluate("""() => { const original=IDBObjectStore.prototype.put; window.restoreWorkspacePut=()=>{IDBObjectStore.prototype.put=original}; IDBObjectStore.prototype.put=function(){throw new DOMException('Explicit quota fault injection','QuotaExceededError')} }""")
   page.locator('.nav-item').filter(has_text='分析分支').click()
   expect(storage).to_contain_text('浏览器存储空间不足')
   expect(page.locator('.branch-list button')).to_have_count(3)
   page.evaluate('window.restoreWorkspacePut()')
   page.get_by_role('button',name='重试保存',exact=True).click()
   expect(storage).to_contain_text('已保存到本机')
   page.get_by_role('button',name='分析工作台',exact=True).click()
   check('显式注入存储额度错误后提示未保存，当前分析仍可用；下次保存成功后解除错误')
   page.get_by_role('button',name='清除本机工作区',exact=True).click()
   page.get_by_role('button',name='保留工作区',exact=True).click()
   expect(page.locator('.rate-summary')).to_contain_text('24.91')
   page.get_by_role('button',name='清除本机工作区',exact=True).click()
   page.get_by_role('button',name='确认清除工作区',exact=True).click()
   expect(page.get_by_label('开始数据分析',exact=True)).to_be_visible()
   page.reload(wait_until='networkidle')
   expect(page.get_by_label('开始数据分析',exact=True)).to_be_visible()
   expect(page.locator('.analysis-thread')).to_have_count(0)
   expect(page.locator('.model-trigger')).to_contain_text('明确的UI测试替身' if not real else '')
   check('清除前可取消；确认清除后刷新不再恢复旧数据，模型连接仍可用')
   page.locator('#file-upload').set_input_files(str(root/'tests/fixtures/uci-online-shoppers.csv'))
   expect(storage).to_contain_text('已保存到本机')
   page.get_by_role('button',name='数据处理',exact=True).click()
   page.get_by_role('checkbox',name='删除完全相同的整行重复记录，保留首条',exact=True).check()
   page.get_by_role('button',name='预览处理影响',exact=True).click()
   page.get_by_role('checkbox',name='我已核对处理影响与数据粒度',exact=True).check()
   page.get_by_role('button',name='应用处理',exact=True).click()
   expect(page.get_by_role('button',name='撤销上次处理',exact=True)).to_be_enabled()
   expect(storage).to_contain_text('已保存到本机')
   page.reload(wait_until='networkidle')
   expect(page.get_by_role('button',name='撤销上次处理',exact=True)).to_be_enabled()
   page.get_by_role('button',name='撤销上次处理',exact=True).click()
   expect(page.locator('.quality-overview')).to_contain_text('12,330')
   expect(page.get_by_role('button',name='撤销上次处理',exact=True)).to_be_disabled()
   expect(storage).to_contain_text('已保存到本机')
   check('显式确认处理后刷新仍可撤销，恢复UCI原始12330条记录；不把去重判作业务正确结论')
   page.evaluate("""async () => {const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('shujian-workspace',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');const store=tx.objectStore('workspace');const r=store.get('current');r.onsuccess=()=>{const v=r.result;v.version=999;store.put(v,'current')};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close()}""")
   page.reload(wait_until='networkidle')
   expect(storage).to_contain_text('已停止恢复且保留旧记录')
   expect(page.get_by_label('开始数据分析',exact=True)).to_be_visible()
   page.get_by_role('button',name='清除本机工作区',exact=True).click()
   page.get_by_role('button',name='确认清除工作区',exact=True).click()
   page.reload(wait_until='networkidle')
   expect(storage).to_contain_text('本机工作区')
   expect(storage).not_to_contain_text('已停止恢复')
   check('未知版本停止恢复且不覆盖旧记录；用户清除后可重新开始')
   assert not record['errors'],record['errors']
  record['status']='passed';save();print('WORKSPACE ACCEPTANCE PASSED' if workspace else 'FOLLOW-UP ACCEPTANCE PASSED',flush=True)
 except Exception as e:
  record['status']='failed';record['failure']=str(e);save();page.screenshot(path=str(out/'failure.png'),full_page=True);raise
 finally:browser.close()
