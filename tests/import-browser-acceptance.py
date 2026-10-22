"""Import acceptance using a faithful conversion of the real OWID subset, not invented business data.
Requires artifacts/owid-real-subset.xlsx/.xls/.pdf and owid-real-scan.pdf.
Vision responses are explicit HTTP test doubles; this is not a model accuracy evaluation.
"""
import csv, io, json, os, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
(root/'artifacts').mkdir(exist_ok=True)
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5180');checks=[]
def passed(t): checks.append(t);print('PASS '+t,flush=True)
source=list(csv.DictReader(io.StringIO((root/'tests/fixtures/owid-China-2015-2022.csv').read_text(encoding='utf-8'))))
expected={r['year']:float(r['renewables_electricity']) for r in source}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge');page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True);errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base,wait_until='networkidle')
 expect(page.locator('.workspace-welcome')).to_be_visible();assert page.locator('#analysis-svg').count()==0
 for width in [375,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':950});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(root/'artifacts/new-workspace-1440.png'),full_page=True)
 passed('新空工作台提供 Excel / PDF / CSV 入口，四种宽度无页面横向溢出')
 page.get_by_role('button',name='Excel 工作簿',exact=False).click()
 # Clicked input itself is verified through filechooser interception below, avoid platform dialogs in headless.
 page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-real-subset.xlsx'))
 expect(page.locator('#import-sheet')).to_be_visible();expect(page.locator('.import-progress')).to_have_count(0)
 assert page.locator('#import-sheet option').count()==2;assert page.locator('#import-header-row').input_value()=='2'
 assert '合并单元格' in page.locator('.import-warnings').inner_text()
 expect(page.get_by_role('button',name='确认导入并分析',exact=True)).to_be_disabled()
 assert page.locator('.dataset-name strong').count()==0 or 'owid-real' not in page.locator('.dataset-name strong').inner_text()
 passed('XLSX 读取双工作表及合并标题，真正表头第 2 行，核对前不替换数据')
 page.locator('#import-sheet').select_option(index=1);assert page.locator('#import-header-row').input_value()=='1'
 page.locator('#import-sheet').select_option(index=0);assert page.locator('#import-header-row').input_value()=='2'
 page.get_by_label('第2行第2列',exact=True).fill('year');expect(page.get_by_role('button',name='确认导入并分析',exact=True)).to_be_disabled();assert '重复' in page.locator('.import-validation').inner_text()
 page.get_by_label('第2行第2列',exact=True).fill('country')
 page.locator('#import-last-row').fill('999');assert '有效' in page.locator('.import-validation').inner_text();page.locator('#import-last-row').fill('10')
 passed('工作表切换、重复表头阻止导入、范围越界明确拒绝')
 for width in [375,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':950});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert page.locator('.import-footer button.primary').is_visible()
 page.locator('#confirm-import').check();page.get_by_role('button',name='确认导入并分析',exact=True).click();expect(page.locator('.import-dialog')).to_have_count(0)
 assert 'Energy' in page.locator('.dataset-name strong').inner_text();assert page.locator('#analysis-svg').count()==0
 passed('确认后真实安装 Excel 数据，仍等待分析目标与口径，不擅自生成业务结论')
 page.get_by_role('button',name='开始 AI 分析',exact=True).click();expect(page.locator('.assistant-window')).to_be_visible();page.locator('.assistant-window-actions button').last.click()
 passed('开始 AI 分析按钮确实打开窗口助手，收起保留工作台')
 def calculate():
  if not page.locator('.manual-mapping').evaluate('el=>el.open'):page.locator('.manual-mapping > summary').click()
  page.get_by_label('分组 / 时间字段',exact=True).select_option('year');page.get_by_label('数值指标',exact=True).select_option('renewables_electricity');page.get_by_label('指标单位',exact=True).fill('TWh')
  page.get_by_role('button',name='按确认口径分析',exact=True).click();page.get_by_role('button',name='计算结果',exact=True).click()
  expect(page.locator('.data-panel tbody tr')).to_have_count(8)
  for tr in page.locator('.data-panel tbody tr').all():
   text=tr.locator('td').all_text_contents();assert abs(float(text[1].replace(',',''))-expected[text[0]])<0.011,(text,expected)
 calculate();passed('Excel 导入后 8 年计算值逐项等于真实 OWID 来源数据')
 page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-real-subset.xls'));expect(page.locator('#import-sheet')).to_be_visible();expect(page.locator('.import-progress')).to_have_count(0)
 page.get_by_role('button',name='取消',exact=True).click();assert 'xlsx' in page.locator('.dataset-name strong').inner_text();assert page.locator('#analysis-svg').count()==1
 passed('旧版 XLS 可预览，取消导入保留上一份文件与图表')
 page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-real-subset.pdf'));expect(page.locator('#import-page')).to_be_visible();expect(page.locator('.import-progress')).to_have_count(0)
 expect(page.locator('.document-page img')).to_be_visible();assert page.locator('#import-page option').count()==2
 assert '8 条记录' in page.locator('.import-valid').inner_text();assert page.locator('#import-header-row').input_value()=='2'
 page.locator('#import-page').select_option('2');expect(page.locator('.import-progress')).to_have_count(0);assert '2 页' in page.locator('.document-page img').get_attribute('alt')
 assert not page.locator('.vision-panel input[type=checkbox]').is_checked()
 page.screenshot(path=str(root/'artifacts/new-pdf-import.png'),full_page=True)
 passed('PDF 实际提取文字与原页，切换第 2 页，视觉上传默认未授权')
 page.locator('#confirm-import').check();page.get_by_role('button',name='确认导入并分析',exact=True).click();calculate()
 passed('PDF 表格确认后 8 年逐项计算与来源一致')
 page.get_by_role('button',name='数据与来源',exact=True).click();assert 'PDF' in page.locator('.import-origin').inner_text();assert len(page.locator('.import-origin code').inner_text().split(': ')[-1])==64
 page.get_by_role('button',name='查看 PDF 原始页',exact=True).click();expect(page.locator('.page-overlay')).to_be_visible();page.get_by_role('button',name='关闭原页',exact=True).click()
 passed('导入来源记录原文件哈希与解析方式，可重新打开 PDF 来源原页')
 page.get_by_role('button',name='分析工作台',exact=True).click()
 with page.expect_download() as d:page.get_by_role('button',name='导出证据报告',exact=True).click()
 report=Path(d.value.path()).read_text(encoding='utf-8');assert 'data:image/jpeg;base64' in report;assert 'PDF' in report
 passed('单文件 HTML 报告含 PDF 原页及解析来源')
 page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-real-scan.pdf'));expect(page.locator('.import-progress')).to_have_count(0)
 expect(page.locator('.no-text')).to_be_visible();expect(page.get_by_role('button',name='确认导入并分析',exact=True)).to_be_disabled();expect(page.locator('.document-page img')).to_be_visible()
 passed('扫描 PDF 不虚构文字或数据，显示原图与视觉识别入口，禁止直接导入')
 page.get_by_role('button',name='取消',exact=True).click()
 # Browser-level invariants protect numeric strings and do not silently discard extra cells.
 result=page.evaluate(r'''async () => {
  const i=await import('/src/importers.ts');const make=c=>({name:'contract-test',method:'test only',warnings:[],lines:c.map((cells,k)=>({cells,sourceRow:k+1}))});
  let reject=0;for(const args of [[make([['a','a'],['1','2']]),0,1],[make([['a','b'],['1','2','3']]),0,1],[make([['a','b'],['1','2']]),0,99]]){try{i.prepareTable(...args)}catch{reject++}}
  const t=i.prepareTable(make([['id','value'],['001',''],['002','2']]),0,2);return {reject,id:t.rows[0].id,empty:t.rows[0].value,source:t.locations[0]};
 }''');assert result['reject']==3 and result['id']=='001' and result['empty'] is None
 passed('解析约束保留编号前导零和缺失值，拒绝列溢出、重复字段、越界范围')
 financial=page.evaluate(r'''async () => {
  const i=await import('/src/importers.ts'), x=await import('/node_modules/xlsx/xlsx.mjs');
  // Parser contract inputs only; deliberately not a business dataset or a product fixture.
  const ws=x.utils.aoa_to_sheet([['id','error','when','ratio','formula'],['placeholder','','','',''],['another','','','','']]);
  ws.A2={t:'n',v:1,z:'0000'};ws.B2={t:'e',v:7};ws.C2={t:'d',v:new Date(2026,0,1,13,45,0)};ws.D2={t:'n',v:.15,z:'0%'};ws.E2={t:'n',f:'SUM(1,2)'};
  const wb=x.utils.book_new();x.utils.book_append_sheet(wb,ws,'contract');const d=await i.readWorkbook(new File([x.write(wb,{type:'array',bookType:'xlsx'})],'contract-only.xlsx'));
  const t=d.tables[0], v=i.prepareTable(t,0,2);return {row:v.rows[0],warnings:t.warnings};
 }''')
 assert financial['row']['id']=='0001' and financial['row']['error'].startswith('#'),financial
 assert 'T13:45:00' in financial['row']['when'] and financial['row']['ratio']=='0.15',financial
 assert financial['row']['formula'] is None and any('没有缓存值' in w for w in financial['warnings']),financial
 passed('Excel 解析契约：前导零、错误单元格、日期时刻、百分比底层值和无缓存公式均保留正确边界')
 assert not errors,errors
 (root/'artifacts/import-acceptance.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'basis':'real OWID subset converted to XLSX, XLS, PDF; no real model accuracy measured'},ensure_ascii=False,indent=2),encoding='utf-8')
 browser.close()
print(f'{len(checks)} checks passed.')
