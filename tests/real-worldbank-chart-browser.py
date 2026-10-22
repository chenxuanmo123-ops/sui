"""Chart regression with the unchanged World Bank original XLS and real SQL.
Uses manual confirmed mappings, makes no model requests, does not mock any route.
The separate real-worldbank-browser.py is the live model acceptance.
"""
import json, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
out=root/'artifacts/real-data-acceptance'
gold=json.loads((out/'gold.json').read_text(encoding='utf-8'))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge')
 page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True,reduced_motion='reduce')
 page.goto('http://127.0.0.1:5174/',wait_until='networkidle')
 page.locator('#file-upload').set_input_files(str(out/'worldbank-gdp-original.xls'))
 expect(page.locator('#import-sheet')).to_be_visible()
 expect(page.locator('.import-progress')).to_have_count(0)
 assert page.locator('#import-header-row').input_value()=='4', 'World Bank表头应自动建议第4行'
 assert page.locator('#import-last-row').input_value()=='6'
 page.locator('#confirm-import').check();page.get_by_role('button',name='确认导入并分析',exact=True).click()
 page.locator('.manual-mapping > summary').click()
 page.get_by_label('分组 / 时间字段',exact=True).select_option('Country Name')
 page.get_by_label('数值指标',exact=True).select_option('2024')
 page.get_by_label('指标单位',exact=True).fill('USD')
 page.get_by_role('button',name='按确认口径分析',exact=True).click()
 page.get_by_role('button',name='计算结果',exact=True).click()
 page.get_by_role('button',name='柱状',exact=True).click()
 expect(page.locator('.data-panel tbody tr')).to_have_count(2)
 expected={r['country']:r['value'] for r in gold if r['year']=='2024'}
 for tr in page.locator('.data-panel tbody tr').all():
  cells=tr.locator('td').all_text_contents()
  assert abs(float(cells[1].replace(',',''))-expected[cells[0]])<1
 expect(page.locator('#analysis-svg')).to_contain_text('USD（刻度：万亿）')
 labels=page.locator('#analysis-svg text').all_text_contents()
 assert '29.3' in labels,labels
 assert page.locator('#analysis-svg text').evaluate_all('els=>els.every(el=>el.getBBox().x>=0 && el.getBBox().x+el.getBBox().width<=760)'),labels
 page.locator('#analysis-svg').screenshot(path=str(out/'05-fixed-large-value-chart.png'))
 for width in [375,768,1440]:
  page.set_viewport_size({'width':width,'height':1000})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
 with page.expect_download() as event:page.get_by_role('button',name='导出证据报告',exact=True).click()
 target=out/'worldbank-gdp-2024-chart-fixed-report.html';event.value.save_as(str(target))
 html=target.read_text(encoding='utf-8')
 assert 'USD（刻度：万亿）' in html
 for value in expected.values():assert str(value) in html
 result={'status':'passed','autoHeaderRow':4,'realSQL':True,'modelCalled':False,'mockedRoutes':False,'axisLabels':labels,'viewportWidths':[375,768,1440],'fullValuesPreserved':True}
 (out/'chart-regression.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(result,ensure_ascii=False),flush=True)
 browser.close()
