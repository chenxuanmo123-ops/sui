"""Task-driven interface acceptance: original UCI data, actual SQLite, AI disabled.
No model accuracy claims or business data substitutes.
"""
from pathlib import Path
from collections import Counter
import sys,os,json,csv
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright,expect
sys.stdout.reconfigure(encoding='utf-8')
out=root/'artifacts/investigation-redesign'
out.mkdir(parents=True,exist_ok=True)
checks=[]
def passed(s):
 checks.append(s)
 print('PASS '+s,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge')
 page=browser.new_page(viewport={'width':1440,'height':1000},reduced_motion='reduce',accept_downloads=True)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('**/api/ai/status',lambda r:r.fulfill(json={'configured':False,'providers':[],'canManage':True}))
 page.goto(os.environ.get('TEST_BASE_URL','http://127.0.0.1:5174')+'/',wait_until='networkidle')
 expect(page.get_by_role('heading',name='把数据放进来， 从第一个问题开始。')).to_be_visible()
 assert page.locator('.sidebar').count()==0
 page.screenshot(path=str(out/'welcome.png'),full_page=True)
 page.locator('#file-upload').set_input_files(str(root/'tests/fixtures/uci-online-shoppers.csv'))
 expect(page.locator('.dataset-name strong')).to_contain_text('uci-online-shoppers')
 expect(page.locator('.data-review')).to_be_visible()
 expect(page.locator('.review-facts')).to_contain_text('12,330')
 expect(page.locator('.canvas-data-preview tbody tr')).to_have_count(5)
 assert not page.get_by_role('dialog',name='数鉴 AI 助手').is_visible()
 assert page.locator('.field-drawer').count()==0
 expect(page.locator('.storage-state')).to_contain_text('已保存到本机')
 page.screenshot(path=str(out/'data-review.png'),full_page=True)
 passed('文件导入后先核对真实数据：12330行、18字段、5条原始预览；无常驻字段或助手侧栏')
 page.get_by_role('button',name='字段与质量',exact=True).click()
 expect(page.locator('.field-drawer')).to_be_visible()
 page.get_by_label('搜索数据字段',exact=True).fill('Revenue')
 expect(page.locator('.shelf-field')).to_have_count(1)
 page.locator('.shelf-field').click()
 expect(page.locator('#workspace-data')).to_be_visible()
 expect(page.get_by_label('搜索字段',exact=True)).to_have_value('Revenue')
 assert page.locator('.field-drawer').count()==0
 page.get_by_role('button',name='分析与图表',exact=True).click()
 draft='请先理解这份访问数据，再比较访客类型的表现'
 page.locator('#analysis-draft').fill(draft)
 page.get_by_role('button',name='与 AI 一起分析',exact=True).click()
 expect(page.get_by_label('分析目标',exact=True)).to_have_value(draft)
 page.get_by_role('dialog',name='数鉴 AI 助手').press('Escape')
 expect(page.locator('#analysis-draft')).to_have_value(draft)
 passed('字段检查按需展开并定位字段；问题原文传入助手，收起后保留草稿')
 page.get_by_role('button',name='手动选择字段与计算',exact=True).click()
 page.locator('.manual-mapping > summary').click()
 page.get_by_label('分组 / 时间字段',exact=True).select_option('VisitorType')
 page.get_by_label('汇总方式',exact=True).select_option('count')
 page.get_by_label('数值指标',exact=True).select_option('Revenue')
 page.get_by_label('指标单位',exact=True).fill('次访问')
 page.get_by_role('button',name='按确认口径分析',exact=True).click()
 expect(page.locator('.finding')).to_be_visible()
 page.get_by_role('button',name='柱状',exact=True).click()
 page.evaluate('window.scrollTo(0,0)')
 assert page.evaluate("document.querySelector('.investigation-composer').getBoundingClientRect().top >= document.querySelector('.chart-panel').getBoundingClientRect().bottom"),'提问区不应覆盖图表'
 page.screenshot(path=str(out/'manual-result.png'),full_page=True)
 page.get_by_role('button',name='数据预览',exact=True).click()
 page.get_by_role('button',name='计算结果',exact=True).click()
 rows=list(csv.DictReader((root/'tests/fixtures/uci-online-shoppers.csv').open(encoding='utf-8')))
 counts=Counter(r['VisitorType'] for r in rows)
 for tr in page.locator('.data-panel tbody tr').all():
  cells=tr.locator('td').all_text_contents()
  assert int(cells[1].replace(',',''))==counts[cells[0]],cells
 page.locator('.data-panel tbody tr').filter(has_text='New_Visitor').get_by_role('button').click()
 expect(page.locator('#workspace-evidence')).to_be_visible()
 expect(page.locator('.evidence-panel')).to_contain_text('共 1694 条')
 page.get_by_role('button',name='计算方法',exact=True).click()
 expect(page.locator('.sql-code').first).to_contain_text('SELECT')
 page.evaluate('window.scrollTo(0,0)')
 page.screenshot(path=str(out/'evidence.png'),full_page=True)
 with page.expect_download() as download:page.get_by_role('button',name='导出证据报告',exact=True).click()
 download.value.save_as(str(out/'real-uci-evidence.html'))
 passed('真实SQL逐组对照CSV核算一致，1694条来源、SQL和单文件HTML报告可回查')
 page.get_by_role('button',name='分析与图表',exact=True).click()
 expect(page.locator('.finding')).to_be_visible()
 page.get_by_role('button',name='清除本机工作区',exact=True).click()
 page.get_by_role('button',name='保留工作区',exact=True).click()
 expect(page.locator('.dataset-name strong')).to_contain_text('uci-online-shoppers')
 passed('清除工作区的确认保护保留，取消后数据与结果完整')
 for width in [390,768,1280,1440]:
  page.set_viewport_size({'width':width,'height':844 if width==390 else 1000})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  assert page.evaluate("[...document.querySelectorAll('.primary-navigation .nav-item')].every(el => el.scrollWidth <= el.clientWidth + 1)"),'导航文字不能溢出按钮'
  # ResizeObserver redraws on the next frame; wait for that frame instead of
  # racing the viewport change.
  page.wait_for_function("()=>{const el=document.querySelector('.chart-panel .data-chart');return !!el&&Math.abs(el.getBoundingClientRect().width-el.viewBox.baseVal.width)<2}",timeout=8000)
  assert page.evaluate("Math.abs(document.querySelector('.chart-panel .data-chart').getBoundingClientRect().width - document.querySelector('.chart-panel .data-chart').viewBox.baseVal.width) < 2"),'图表按容器尺寸绘制，避免文字整体缩小'
  assert page.evaluate("document.querySelector('.investigation-composer').getBoundingClientRect().top >= document.querySelector('.chart-panel').getBoundingClientRect().bottom"),width
  page.evaluate('window.scrollTo(0,0)')
  page.screenshot(path=str(out/f'result-{width}.png'),full_page=True)
 assert not errors,errors
 passed('390/768/1280/1440无整页横向溢出，无浏览器运行错误')
 browser.close()
(out/'acceptance.json').write_text(json.dumps({'status':'passed','data':'Original UCI Online Shoppers fixture','ai':'disabled; no model quality claims','checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
