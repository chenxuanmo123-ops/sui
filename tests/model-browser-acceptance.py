"""Browser -> app backend -> explicit local test upstream. Not a model quality evaluation."""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
url=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5180')
calls=[]
class Upstream(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,body):
        raw=json.dumps(body).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        calls.append({'path':self.path,'key':self.headers.get('Authorization')}); self.reply({'data':[{'id':'contract-one'},{'id':'contract-two'}]})
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        calls.append({'path':self.path,'key':self.headers.get('Authorization'),'model':body['model'],'body':body})
        if body['messages'][0]['content']=='Reply with OK only.': return self.reply({'choices':[{'message':{'content':'OK'}}]})
        data=json.loads(body['messages'][-1]['content'])
        if '数鉴内置的数据初步定位分析师' in body['messages'][0]['content']:
            answer={'summary':'可能是地区年度能源数据，业务范围需确认。','scene':'能源统计候选','grain':'地区与年度组合是否唯一，需要确认。','fields':[{'field':'year','meaning':'可能为统计年度','role':'time'}],'risks':[{'title':'单位待确认','detail':'不能把不同口径直接汇总。','fields':['renewables_electricity']}],'directions':[{'title':'年度能源比较','question':'各年可再生能源发电量如何变化？','requiredContext':'确认数据范围和单位。'}],'questions':['请确认该数据是否只是上传子集。'],'limitations':['只基于元数据和授权样本初步定位，尚未完成业务分析。']}
        else:
            answer={'goal':data['question'],'scene':'公开能源统计','grain':'地区年度','fieldRoles':[{'field':'year','meaning':'年度','role':'time'}],'assumptions':[],'questions':['请确认是否只分析上传子集，不推断全网情况。'],'tasks':[],'limitations':['现有上下文需确认统计范围']}
        self.reply({'choices':[{'message':{'content':json.dumps(answer,ensure_ascii=False)},'finish_reason':'stop'}]})
upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
threading.Thread(target=upstream.serve_forever,daemon=True).start()
endpoint='http://127.0.0.1:'+str(upstream.server_port)+'/v1'
checks=[]; owned=[]
def checked(t): checks.append(t); print('PASS '+t,flush=True)
def inspect_calls(): return [c for c in calls if 'body' in c and '数鉴内置的数据初步定位分析师' in c['body']['messages'][0]['content']]
try:
 with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,channel='msedge')
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    page=context.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(url,wait_until='networkidle')
    expect(page.locator('#ai-assistant-window')).not_to_be_visible()
    page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
    expect(page.get_by_role('dialog',name='数鉴 AI 助手',exact=True)).to_be_visible()
    page.locator('#analysis-goal').fill('窗口状态应保留')
    page.get_by_role('button',name='收起 AI 助手',exact=True).click()
    expect(page.locator('#ai-assistant-window')).not_to_be_visible()
    page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
    expect(page.locator('#analysis-goal')).to_have_value('窗口状态应保留')
    page.get_by_role('button',name='展开助手窗口',exact=True).click()
    assert 'expanded' in page.locator('#ai-assistant-window').get_attribute('class')
    page.get_by_role('button',name='还原助手窗口',exact=True).click()
    page.get_by_role('button',name='收起 AI 助手',exact=True).click()
    checked('助手按需打开、收起保留输入，支持展开和还原')
    page.locator('.model-trigger').click()
    if page.locator('.model-item').count(): page.get_by_role('button',name='添加连接',exact=True).click()
    page.locator('#model-name').fill('本机契约测试一'); page.locator('#model-base').fill(endpoint); page.locator('#model-key').fill('BROWSER_TEST_ONLY_SECRET')
    assert page.locator('#model-key').get_attribute('type')=='password'
    page.get_by_role('button',name='显示 API Key',exact=True).click(); assert page.locator('#model-key').get_attribute('type')=='text'
    page.get_by_role('button',name='隐藏 API Key',exact=True).click()
    page.get_by_role('button',name='获取列表',exact=True).click()
    expect(page.locator('.connection-feedback')).to_contain_text('已获取 2 个模型')
    page.locator('#model-id').fill('contract-one')
    page.get_by_role('button',name='测试连接',exact=True).click(); expect(page.locator('.connection-feedback')).to_contain_text('连接成功')
    page.get_by_label('设为内置 AI 的默认分析模型',exact=False).check()
    page.get_by_role('button',name='保存并使用',exact=True).click()
    expect(page.locator('.model-trigger')).to_contain_text('本机契约测试一')
    status=page.request.get(url+'/api/ai/status').json(); owned.append(next(x['id'] for x in status['providers'] if x['name']=='本机契约测试一'))
    assert 'BROWSER_TEST_ONLY_SECRET' not in json.dumps(status)
    assert 'BROWSER_TEST_ONLY_SECRET' not in page.evaluate('JSON.stringify(localStorage)')
    checked('模型列表与连接测试实际转发，密钥保存在本机但不回传网页或 localStorage')
    page.reload(wait_until='networkidle'); expect(page.locator('.model-trigger')).to_contain_text('本机契约测试一')
    page.locator('.model-trigger').click(); expect(page.locator('#model-key')).to_have_value('')
    page.locator('#model-name').fill('本机契约测试一已修改'); page.locator('#model-id').fill('contract-one-edited')
    page.get_by_role('button',name='保存并使用',exact=True).click(); expect(page.locator('.model-trigger')).to_contain_text('已修改')
    checked('刷新自动恢复连接，编辑名称与模型时留空保留原密钥')
    page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-China-2015-2022.csv'))
    expect(page.locator('.dataset-name strong')).to_have_text('owid-China-2015-2022.csv')
    assert len(inspect_calls())==0
    page.locator('.dataset-orientation > summary').click()
    page.get_by_role('button',name='授权并开始初步定位',exact=True).click()
    expect(page.locator('.initial-summary')).to_contain_text('地区年度能源')
    initial=inspect_calls()[-1]
    assert initial['model']=='contract-one-edited' and initial['key']=='Bearer BROWSER_TEST_ONLY_SECRET'
    sent=json.loads(initial['body']['messages'][-1]['content'])
    assert 'rows' not in sent['dataset'] and all('examples' not in c for c in sent['dataset']['columns'])
    assert page.locator('#analysis-svg').count()==0
    checked('导入真实数据不擅自调用模型，授权定位使用默认模型且默认不传单元格')
    page.locator('.initial-options summary').click(); page.locator('#initial-background').fill('OWID 公开能源子集，地区年度粒度，发电量单位 TWh。')
    page.get_by_label('本次手动定位附带每列最多三个原始值样本',exact=False).check()
    page.get_by_role('button',name='授权并开始初步定位',exact=True).click(); expect(page.locator('.initial-summary')).to_be_visible()
    sent=json.loads(inspect_calls()[-1]['body']['messages'][-1]['content'])
    assert 'OWID' in sent['context'] and all(len(c.get('examples',[]))<=3 for c in sent['dataset']['columns'])
    assert any('examples' in c for c in sent['dataset']['columns'])
    page.locator('.initial-directions button').first.click()
    expect(page.locator('#analysis-goal')).to_have_value('各年可再生能源发电量如何变化？')
    expect(page.locator('#business-context')).to_have_value('OWID 公开能源子集，地区年度粒度，发电量单位 TWh。')
    page.locator('.ai-optional summary').click()
    page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click()
    expect(page.locator('.ai-questions')).to_contain_text('上传子集')
    assert calls[-1]['model']=='contract-one-edited' and calls[-1]['key']=='Bearer BROWSER_TEST_ONLY_SECRET'
    checked('可补充业务背景与授权样本，建议问题和真实背景带入助手并使用已保存密钥规划')
    page.locator('.model-trigger').click(); page.get_by_role('button',name='添加连接',exact=True).click()
    page.locator('#model-name').fill('本机契约测试二'); page.locator('#model-base').fill(endpoint); page.locator('#model-key').fill('SECOND_BROWSER_TEST_SECRET'); page.locator('#model-id').fill('contract-two')
    page.get_by_role('button',name='保存并使用',exact=True).click(); expect(page.locator('.model-trigger')).to_contain_text('本机契约测试二')
    status=page.request.get(url+'/api/ai/status').json(); owned.append(next(x['id'] for x in status['providers'] if x['name']=='本机契约测试二'))
    expect(page.locator('.ai-warning')).to_contain_text('旧计划')
    page.get_by_role('button',name='理解数据并提出分析计划',exact=True).click(); expect(page.locator('.ai-plan-title small')).to_contain_text('contract-two')
    assert calls[-1]['key']=='Bearer SECOND_BROWSER_TEST_SECRET'
    assert page.request.get(url+'/api/ai/status').json()['defaultProviderId']==owned[0]
    checked('助手模型可切换并使旧计划失效，默认定位模型保持独立')
    page.get_by_role('button',name='收起 AI 助手',exact=True).click()
    page.reload(wait_until='networkidle'); expect(page.locator('.model-trigger')).to_contain_text('本机契约测试二')
    # The redesigned empty workspace exposes intake first; consent lives with a loaded dataset.
    expect(page.locator('.dataset-name strong')).to_have_text('owid-China-2015-2022.csv', timeout=30000)
    page.locator('#file-upload').set_input_files(str(root/'artifacts/owid-China-2015-2022.csv'))
    page.get_by_role('dialog',name='替换当前工作区？').get_by_role('button',name='替换并导入',exact=True).click()
    page.locator('.dataset-orientation > summary').click()
    page.get_by_label('允许上传后自动发送字段与质量摘要给默认模型',exact=True).check()
    expect(page.locator('.initial-summary')).to_be_visible()
    count=len(inspect_calls())
    original=(root/'artifacts/owid-China-2015-2022.csv').read_text(encoding='utf-8')
    smaller='\n'.join([line for line in original.splitlines() if line.strip()][:-1])+'\n'
    with page.expect_response(lambda r: '/api/ai/inspect' in r.url and r.request.method == 'POST') as observed:
        page.locator('#file-upload').set_input_files({'name':'owid-real-shorter-subset.csv','mimeType':'text/csv','buffer':smaller.encode('utf-8')})
        page.get_by_role('dialog',name='替换当前工作区？').get_by_role('button',name='替换并导入',exact=True).click()
    assert observed.value.status == 200
    expect(page.locator('.initial-summary')).to_be_visible()
    assert len(inspect_calls())==count+1 and inspect_calls()[-1]['model']=='contract-one-edited'
    page.get_by_label('允许上传后自动发送字段与质量摘要给默认模型',exact=True).uncheck()
    checked('模型选择跨刷新保留，明确授权后上传自动定位且仍使用默认模型')
    page.get_by_role('button',name='打开 AI 分析助手',exact=True).click()
    for width in [375,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
        rect=page.locator('#ai-assistant-window').bounding_box()
        assert rect['x']>=0 and rect['x']+rect['width']<=width+1,rect
    page.set_viewport_size({'width':1440,'height':1000})
    page.screenshot(path=str(root/'artifacts/window-assistant-desktop.png'),full_page=True)
    page.get_by_role('button',name='收起 AI 助手',exact=True).click()
    page.screenshot(path=str(root/'artifacts/window-canvas-desktop.png'),full_page=True)
    page.locator('.model-trigger').click()
    for width in [375,768,1024,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
        assert page.locator('.model-dialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),width
    page.get_by_role('button',name='删除此连接',exact=True).click()
    expect(page.locator('.model-item')).to_have_count(len(status['providers'])-1)
    page.get_by_role('button',name='关闭模型连接',exact=True).click()
    assert not errors,errors
    checked('窗口和模型面板四档宽度不溢出，删除连接生效，无浏览器运行异常')
    for id in owned: page.request.post(url+'/api/ai/connections',data={'action':'delete','id':id})
    browser.close()
finally:
    import urllib.request
    for id in owned:
        try:
            req=urllib.request.Request(url+'/api/ai/connections',data=json.dumps({'action':'delete','id':id}).encode(),headers={'Content-Type':'application/json'},method='POST'); urllib.request.urlopen(req,timeout=5).close()
        except Exception: pass
    upstream.shutdown(); upstream.server_close()
print(json.dumps({'checks':len(checks),'passed':True,'upstream':'explicit local test substitute; no live model quality claim'},ensure_ascii=False))
