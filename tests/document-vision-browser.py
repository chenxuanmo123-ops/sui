"""Verify vision UI -> real app backend -> explicitly labelled local HTTP substitute.
This proves request wiring/consent/validation, not OCR accuracy of a real provider.
The returned rows are the exact cached real OWID subset, never business sample data in the product.
"""
import csv,io,json,os,sys,threading,uuid,urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright,expect
sys.stdout.reconfigure(encoding='utf-8');base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5180')
rows=[r for r in csv.reader(io.StringIO((root/'artifacts/owid-China-2015-2022.csv').read_text(encoding='utf-8'))) if r];calls=[];reject=False
class Upstream(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append(body)
  if reject:self.send_response(422);self.end_headers();return
  result={'columns':rows[0],'rows':rows[1:],'warnings':['协议测试替身：原样返回真实 OWID 子集，不代表模型视觉准确率']}
  raw=json.dumps({'choices':[{'message':{'content':json.dumps(result)},'finish_reason':'stop'}]}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream);threading.Thread(target=upstream.serve_forever,daemon=True).start()
id='user_vision_'+uuid.uuid4().hex
profile={'id':id,'name':'视觉协议测试替身','baseURL':f'http://127.0.0.1:{upstream.server_port}/v1','apiKey':'LOCAL_CONTRACT_TEST_ONLY','model':'vision-contract','jsonMode':True}
def post(data):
 req=urllib.request.Request(base+'/api/ai/connections',data=json.dumps(data).encode(),headers={'Content-Type':'application/json'});return urllib.request.urlopen(req,timeout=10).read()
checks=[]
def passed(t):checks.append(t);print('PASS '+t,flush=True)
try:
 post({'action':'save','profile':profile})
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,channel='msedge');page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(base,wait_until='networkidle');page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-real-scan.pdf'));expect(page.locator('.import-progress')).to_have_count(0)
  page.locator('#vision-model').select_option(id);expect(page.get_by_role('button',name='识别当前页',exact=True)).to_be_disabled();assert not calls
  page.locator('.vision-panel input[type=checkbox]').check();page.get_by_role('button',name='识别当前页',exact=True).click();expect(page.locator('.import-progress')).to_have_count(0);assert len(calls)==1
  content=calls[0]['messages'][1]['content'];assert content[1]['image_url']['url']==page.locator('.document-page img').get_attribute('src');assert content[0]['type']=='text';assert calls[0]['model']=='vision-contract';assert '8 条记录' in page.locator('.import-valid').inner_text()
  expect(page.locator('#confirm-import')).not_to_be_checked();expect(page.get_by_role('button',name='确认导入并分析',exact=True)).to_be_disabled()
  passed('扫描页经独立授权后，从真实后端向所选接口发送当前页 JPEG；转录结果必须再次核对')
  reject=True;page.get_by_role('button',name='识别当前页',exact=True).click();expect(page.locator('.import-progress')).to_have_count(0);expect(page.locator('.import-error')).to_contain_text('422');assert '8 条记录' in page.locator('.import-valid').inner_text()
  passed('图像接口失败保留已有候选表格，显示实际 HTTP 错误')
  for width in [375,768,1024,1440]:
   page.set_viewport_size({'width':width,'height':950});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.locator('#confirm-import').check();page.get_by_role('button',name='确认导入并分析',exact=True).click();expect(page.locator('.import-dialog')).to_have_count(0);assert 'scan.pdf' in page.locator('.dataset-name strong').inner_text()
  page.get_by_role('button',name='数据与来源',exact=True).click();assert '视觉转录' in page.locator('.import-origin').inner_text();assert 'vision-contract' in page.locator('.import-origin').inner_text();assert not errors,errors
  passed('核对后可导入视觉转录，来源记录模型与方法；四档宽度无整体溢出')
  browser.close()
 (root/'artifacts/vision-browser-acceptance.json').write_text(json.dumps({'checks':checks,'realModelAccuracyEvaluated':False,'upstream':'explicit local HTTP substitute'},ensure_ascii=False,indent=2),encoding='utf-8')
finally:
 try:post({'action':'delete','id':id})
 finally:upstream.shutdown();upstream.server_close()
