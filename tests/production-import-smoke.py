"""Smoke test built assets, including PDF worker MIME and lazy parser loading."""
import os,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright,expect
expect.set_options(timeout=30000)
sys.stdout.reconfigure(encoding='utf-8');base=os.environ.get('TEST_PRODUCTION_URL','http://127.0.0.1:5181')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='msedge');page=browser.new_page();errors=[];responses=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:responses.append(r));page.goto(base,wait_until='networkidle')
 assert not any('pdf.worker' in r.url or '/xlsx-' in r.url for r in responses)
 for ext in ['xlsx','pdf']:
  page.locator('#file-upload').set_input_files(str(root/f'artifacts/owid-real-subset.{ext}'));expect(page.locator('.import-valid')).to_contain_text('8 条记录')
  page.locator('#confirm-import').check();page.get_by_role('button',name='确认导入并分析',exact=True).click();expect(page.locator('.import-dialog')).to_have_count(0)
  assert ext in page.locator('.dataset-name strong').inner_text()
 worker=[r for r in responses if 'pdf.worker' in r.url and r.url.endswith('.mjs')];assert worker and all('javascript' in r.headers.get('content-type','') for r in worker)
 page.get_by_role('button',name='探索分析',exact=True).click();page.get_by_label('探索分组字段').select_option('year');page.get_by_label('探索指标字段').select_option('renewables_electricity');page.get_by_role('button',name='执行探索分析',exact=True).click();expect(page.locator('.exploration-results tbody tr')).to_have_count(8);expect(page.locator('.exploration-chart svg')).to_be_visible();expect(page.locator('.exploration-results tbody tr').first).to_contain_text('1,393.66')
 wasm=[r for r in responses if r.url.endswith('.wasm')];assert wasm and all('application/wasm' in r.headers.get('content-type','') for r in wasm)
 assert not errors,errors;browser.close();print('PASS production: Excel / PDF import; PDF worker correct MIME; parsers lazy loaded; SQL Worker/WASM computation and chart; no page errors.')
