"""Original UCI CSV + real saved model + browser SQL. No mocked routes."""
import json,sys,time,os
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright,expect
sys.stdout.reconfigure(encoding='utf-8')
out=root/'artifacts/real-ecommerce-acceptance'
out.mkdir(exist_ok=True)
oracle=json.loads((out/'independent-python-oracle.json').read_text(encoding='utf-8'))
record={'realModel':True,'mockedRoutes':False,'responses':{},'checks':[],'errors':[]}
def save():(out/'browser-acceptance.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
def check(s):record['checks'].append(s);save();print('PASS '+s,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge')
 page=browser.new_page(viewport={'width':1440,'height':1080},accept_downloads=True)
 page.on('pageerror',lambda e:record['errors'].append(str(e)))
 def capture(response):
  if response.request.method=='POST' and response.url.rsplit('/',1)[-1] in ('plan','review'):
   action=response.url.rsplit('/',1)[-1]
   record['responses'][action]={'status':response.status,'body':response.json()};save();print('REAL MODEL '+action+' HTTP '+str(response.status),flush=True)
 page.on('response',capture)
 def wait_model(action):
  start=time.monotonic();update=20
  while action not in record['responses']:
   page.wait_for_timeout(400)
   elapsed=time.monotonic()-start
   if elapsed>update:print('等待真实模型 '+action+' '+str(round(elapsed))+'秒',flush=True);update+=20
   assert elapsed<210,'模型超时'
  item=record['responses'][action];assert item['status']==200,item
  return item['body']
 try:
  page.goto(os.environ.get('TEST_BASE_URL','http://127.0.0.1:5174')+'/',wait_until='networkidle')
  page.locator('#file-upload').set_input_files(str(root/'tests/fixtures/uci-online-shoppers.csv'))
  expect(page.locator('.dataset-name strong')).to_contain_text('uci-online-shoppers')
  page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
  page.get_by_label('分析目标',exact=True).fill('比较不同访客类型、流量类型代码和周末与非周末的购买转化率，同时给出对应访问量，帮助判断哪些群体值得继续研究。不要将相关性说成原因。仅生成三个任务：分别按VisitorType、TrafficType、Weekend全量分组计算转化率，分母同时作为对应访问量。不要交叉筛选或增加月份分析。')
  page.locator('.ai-optional > summary').click()
  page.locator('#business-context').fill('公开来源：UCI Online Shoppers Purchasing Intention。每行一次电商访问，不是用户。Revenue是是否产生购买，精确原值TRUE/FALSE，不是营收金额。购买转化率定义：Revenue=TRUE的访问记录数 / Revenue属于TRUE、FALSE的访问记录数 ×100%；其他值排除并说明。VisitorType是访客类型，TrafficType仅是来源类型代码，不能虚构广告/搜索名称。Weekend是是否周末。数据为历史样本，不推断当前市场或因果。')
  assert not page.get_by_role('checkbox',name='附带每列最多三个原始值样本',exact=False).is_checked()
  assert not page.get_by_role('checkbox',name='授权发送低基数文本列的类别字典',exact=False).is_checked()
  page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
  response=wait_model('plan');tasks=response['plan']['tasks'];rates=[t for t in tasks if t['mapping'].get('rate')]
  assert {'VisitorType','TrafficType','Weekend'} <= {t['mapping']['x'] for t in rates},tasks
  for t in rates:
   m=t['mapping'];assert m['metric']=='Revenue' and m['aggregate']=='count' and m['unit']=='%'
   assert m['rate']['successValue']=='TRUE' and set(m['rate']['eligibleValues'])=={'TRUE','FALSE'}
   assert not m['filter'] and not m['conditions']
  check('真实模型为三个维度生成明确的比例口径；样本和类别字典授权均保持关闭')
  page.screenshot(path=str(out/'01-real-plan.png'),full_page=True)
  page.get_by_role('checkbox',name='我已核对行粒度',exact=False).check()
  page.get_by_role('button',name='确认计划并计算',exact=True).click()
  wait_model('review')
  expect(page.locator('.bundle-result')).to_have_count(len(tasks))
  page.get_by_role('button',name='收起 AI 分析助手',exact=True).click()
  for t in rates:
   card=page.locator('.bundle-result').filter(has=page.get_by_role('heading',name=t['title'],exact=True))
   rows=card.locator('tbody tr')
   expected=oracle['groups'][t['mapping']['x']]
   assert rows.count()==len(expected)
   for row in rows.all():
    cells=row.locator('td').all_text_contents();g=expected[cells[0]]
    assert abs(float(cells[1].replace(',',''))-g['value'])<0.0001,cells
    assert int(cells[2].replace(',',''))==g['numerator'],cells
    assert int(cells[3].replace(',',''))==g['denominator'],cells
    assert int(cells[4])==g['excluded'],cells
   assert '15.47' in card.locator('.rate-summary').inner_text()
  check('三个维度全部分组的比例、分子、分母与独立Python核算一致，总体1908/12330=15.47%')
  page.evaluate('window.scrollTo(0,0)')
  page.screenshot(path=str(out/'02-complete-analysis.png'),full_page=True)
  page.locator('.analysis-bundle').screenshot(path=str(out/'analysis-results.png'))
  with page.expect_download() as event:page.get_by_role('button',name='导出完整分析报告',exact=True).click()
  target=out/'real-ecommerce-complete-report.html';event.value.save_as(str(target))
  html=target.read_text(encoding='utf-8')
  assert html.count('<svg ')==len(tasks)
  assert 'SQL' in html and 'SELECT' in html and '10551' in html and '422' in html
  assert 'AI 定性解读与引用' in html
  assert '数据出处与引用' in html and '10.24432/C5F88Q' in html and 'CC BY 4.0' in html
  assert '原文件 SHA-256' in html and '原文件 SHA-256 与已核验公开 CSV 一致' in html
  check('单文件报告包含本轮全部任务SVG、真实SQL、原始记录索引、数值和AI证据引用')
  page.locator('.bundle-result').first.get_by_role('button',name='检查 SQL 与来源',exact=True).click()
  expect(page.locator('.chart-panel')).to_be_in_viewport()
  check('分析卡片可进入已有SQL与来源检查器')
  page.set_viewport_size({'width':390,'height':844})
  page.locator('.analysis-bundle').scroll_into_view_if_needed()
  page.screenshot(path=str(out/'03-mobile-analysis.png'),full_page=True)
  overflow=page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
  assert not overflow,'手机页面横向溢出'
  assert not record['errors'],record['errors']
  record['status']='passed';save();print('REAL ECOMMERCE ACCEPTANCE PASSED',flush=True)
 except Exception as e:
  record['status']='failed';record['failure']=str(e);save();page.screenshot(path=str(out/'failure.png'),full_page=True);print('FAILED '+str(e),flush=True);raise
 finally:browser.close()
