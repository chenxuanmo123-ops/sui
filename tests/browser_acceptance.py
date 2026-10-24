import sys, csv, io, json, math, os
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
BASE_URL = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5173')
checks = []
(root / 'artifacts').mkdir(exist_ok=True)

def checked(name):
    checks.append(name)
    print('PASS ' + name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True, reduced_motion='reduce')
    cached_source = os.environ.get('TEST_OWID_FILE')
    if cached_source:
        cached_text = Path(cached_source).read_text(encoding='utf-8')
        context.route('**/owid-energy-data.csv', lambda route: route.fulfill(status=200, content_type='text/csv', body=cached_text))
    page = context.new_page()
    errors = []
    responses = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('response', lambda r: responses.append(r) if 'owid-energy-data.csv' in r.url and r.status == 200 else None)
    page.goto(BASE_URL + '/', wait_until='networkidle', timeout=60000)
    page.wait_for_function("!document.querySelector('.loading-indicator')", timeout=60000)
    if not responses:
        assert page.locator('#analysis-svg').count() == 0
        page.get_by_role('button', name='手边没有文件？载入带来源的公开数据', exact=True).click()
        page.wait_for_function("document.querySelector('.dataset-name strong').textContent==='OWID Energy Data' || document.querySelector('[role=alert]')", timeout=60000)
        assert page.locator('.dataset-name strong').inner_text()=='OWID Energy Data', page.locator('[role=alert]').all_text_contents()
    assert responses, 'public data response absent'
    source_text = responses[-1].text()
    source_rows = list(csv.DictReader(io.StringIO(source_text)))
    selected = [r for r in source_rows if r['country'] == 'China' and '2015' <= r['year'] <= '2022']
    selected.sort(key=lambda r: int(r['year']))
    assert len(selected) == 8
    expected = {r['year']: float(r['renewables_electricity']) for r in selected}
    assert page.locator('#analysis-svg').count() == 0
    checked('初始不伪造分析结果，真实公开数据已加载')
    page.locator('.manual-rules').evaluate("el => el.open = true")
    page.locator('.manual-mapping').evaluate("el => el.open = true")
    page.get_by_role('button', name='解析并分析', exact=True).click()
    expect(page.locator('#analysis-svg')).to_be_visible()
    page.get_by_role('button', name='计算结果', exact=True).click()
    result_rows = page.locator('.data-panel tbody tr')
    assert result_rows.count() == 8
    for i, (year, value) in enumerate(expected.items()):
        cells = result_rows.nth(i).locator('td').all_text_contents()
        assert cells[0] == year
        assert math.isclose(float(cells[1].replace(',', '')), value, abs_tol=.0051), (cells, value)
    checked('8 个年度结果逐项与 Python 独立读取的 OWID 原值一致')
    page.locator('.chart-hit').last.click()
    assert page.locator('.evidence-filter select').input_value() == '2022'
    assert '2022' in page.locator('.source-list').inner_text()
    assert selected[-1]['renewables_electricity'] in page.locator('.source-list').inner_text()
    checked('点击图表定位正确年份和原始数值')
    page.get_by_role('button', name='柱状', exact=True).click()
    assert page.locator('#analysis-svg rect').count() == 8
    page.get_by_role('button', name='折线', exact=True).click()
    with page.expect_download() as dl:
        page.get_by_role('button', name='导出 SVG', exact=True).click()
    dl.value.save_as(str(root / 'artifacts/chart.svg'))
    assert '<svg' in (root / 'artifacts/chart.svg').read_text(encoding='utf-8')
    with page.expect_download() as dl:
        page.get_by_role('button', name='导出证据报告', exact=True).click()
    dl.value.save_as(str(root / 'artifacts/evidence-report.html'))
    report_text = (root / 'artifacts/evidence-report.html').read_text(encoding='utf-8')
    assert '<svg' in report_text and 'SHA-256' in report_text and selected[-1]['renewables_electricity'] in report_text
    report_page = context.new_page()
    report_page.route('**/*', lambda route: route.abort() if route.request.url.startswith('http') else route.continue_())
    report_page.goto((root / 'artifacts/evidence-report.html').as_uri(), wait_until='load')
    expect(report_page.locator('h1')).to_contain_text('数据分析报告')
    expect(report_page.locator('svg')).to_be_visible()
    report_page.close()
    checked('SVG 与内嵌证据 HTML 报告导出并离线打开成功')
    page.get_by_label('输入追问').fill('2018—2020 年中国太阳能发电量如何变化？')
    page.get_by_role('button', name='发送追问', exact=True).click()
    expect(page.locator('.chart-panel h2')).to_have_text('太阳能发电量')
    page.get_by_role('button', name='计算结果', exact=True).click()
    assert page.locator('.data-panel tbody tr').count() == 3
    checked('追问切换太阳能指标及年份，真实重算产生新分支')
    page.get_by_label('输入追问').fill('为什么下降？')
    page.get_by_role('button', name='发送追问', exact=True).click()
    assert '未执行计算' in page.locator('.chat-pair').last.inner_text()
    page.get_by_role('button', name='分析分支', exact=False).click()
    assert page.locator('.branch-list > button').count() == 2
    page.locator('.branch-list > button').last.click()
    expect(page.locator('.chart-panel h2')).to_have_text('可再生能源发电量')
    checked('不支持的归因追问明确拒绝，历史分支可恢复')
    page.screenshot(path=str(root / 'artifacts/desktop-analysis.png'), full_page=True)
    for width in [375, 768, 1024, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        page.evaluate('window.scrollTo(0,0)')
        size = page.evaluate('({w:window.innerWidth,scroll:document.documentElement.scrollWidth})')
        assert size['scroll'] <= size['w'], size
        page.screenshot(path=str(root / f'artifacts/workbench-{width}.png'), full_page=True)
    checked('375 / 768 / 1024 / 1440 像素页面无整体横向溢出')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.get_by_role('button', name='使用说明', exact=True).click()
    expect(page.locator('.help-dialog')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('.help-dialog')).not_to_be_visible()
    page.get_by_role('button', name='数据与来源', exact=True).click()
    assert page.locator('.provenance-panel a').count() == 2
    assert len(page.locator('.provenance-panel .mono').inner_text()) == 64
    checked('帮助键盘关闭，来源链接及 SHA-256 快照可查看')
    invariants = page.evaluate(r"""async () => {
        const d = await import('/src/data.ts');
        const parsed = d.parseCSV('id,note,value\n001,"a,b",\n002,"line1\nline2",2');
        const base = {x:'year',metric:'renewables_electricity',filter:'country',value:'China',from:'2015',to:'2022',unit:'TWh',aggregate:'sum'};
        const rejected = ['中国营收下降多少？', '中国和美国可再生能源趋势', '中国太阳能和风能趋势', '2015、2018、2022年中国趋势', '为什么下降？'].every(q => {try {d.parsePublicQuestion(q,base); return false} catch {return true}});
        return {empty: Number.isNaN(d.numberValue(null)) && Number.isNaN(d.numberValue(' ')), original:parsed.rows[0].id==='001', quotes:parsed.rows[0].note==='a,b' && parsed.rows[1].note==='line1\nline2', missing:parsed.rows[0].value===null, rejected};
    }""")
    assert all(invariants.values()), invariants
    checked('解析器保留标识符和引号内换行，空值不变成零，歧义问题被拒绝（仅测试输入）')
    page.get_by_role('button', name='分析工作台', exact=True).click()
    for unsupported in ['中国营收下降多少？', '中国和美国可再生能源趋势', '中国太阳能和风能趋势']:
        page.locator('#question').fill(unsupported)
        page.get_by_role('button', name='解析并分析', exact=True).click()
        expect(page.get_by_role('alert')).to_be_visible()
        assert page.locator('.data-panel tbody tr').count() == 8
    checked('超范围或多地区、多指标问题报错并保留已有结果')

    subset_cols = ['year', 'country', 'renewables_electricity', 'solar_electricity', 'wind_electricity']
    buf = io.StringIO(); writer = csv.DictWriter(buf, fieldnames=subset_cols)
    writer.writeheader(); writer.writerows({k:r[k] for k in subset_cols} for r in selected)
    subset = buf.getvalue()
    (root / 'artifacts/owid-China-2015-2022.csv').write_text(subset, encoding='utf-8')
    page.locator('#file-upload').set_input_files({'name': 'owid-China-2015-2022.csv', 'mimeType': 'text/csv', 'buffer': subset.encode('utf-8')})
    page.wait_for_function("document.querySelector('.dataset-name strong').textContent==='owid-China-2015-2022.csv' && !document.querySelector('.loading-indicator')")
    assert page.locator('#analysis-svg').count() == 0
    expect(page.locator('.manual-rules')).to_be_hidden()
    assert page.locator('.manual-rules button[type=submit]').is_disabled()
    page.get_by_label('分组 / 时间字段', exact=True).select_option('year')
    page.get_by_label('数值指标', exact=True).select_option('renewables_electricity')
    page.get_by_label('指标单位', exact=True).fill('TWh')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()
    page.get_by_role('button', name='计算结果', exact=True).click()
    assert page.locator('.data-panel tbody tr').count() == 8
    assert selected[-1]['renewables_electricity'][:4] in page.locator('.finding').inner_text().replace(',', '')
    checked('上传真实公开子集后手动映射，得到相同真实结果')
    page.get_by_label('汇总方式', exact=True).select_option('average')
    expect(page.locator('.mapping-panel .tag')).to_have_text('口径已修改')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()
    checked('口径修改有旧结果提示，均值计算可执行')
    page.get_by_label('分组 / 时间字段', exact=True).select_option('country')
    page.get_by_label('汇总方式', exact=True).select_option('sum')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()
    expected_sum = sum(expected.values())
    actual_sum = float(page.locator('.data-panel tbody tr td').nth(1).inner_text().replace(',', ''))
    assert math.isclose(actual_sum, expected_sum, abs_tol=.0051)
    page.get_by_label('汇总方式', exact=True).select_option('average')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()
    actual_avg = float(page.locator('.data-panel tbody tr td').nth(1).inner_text().replace(',', ''))
    assert math.isclose(actual_avg, expected_sum / len(selected), abs_tol=.0051)
    checked('真实八年数据合并为一个地区分组，求和与均值均匹配 Python 独立计算')
    page.get_by_label('分组 / 时间字段', exact=True).select_option('year')
    page.get_by_role('button', name='按确认口径分析', exact=True).click()

    with page.expect_download() as dl:
        page.get_by_role('button', name='CSV', exact=True).click()
    dl.value.save_as(str(root / 'artifacts/result.csv'))
    assert len(list(csv.DictReader(io.StringIO((root / 'artifacts/result.csv').read_text(encoding='utf-8-sig'))))) == 8
    bad = subset.replace('year,country,', 'year,year,', 1)
    page.locator('#file-upload').set_input_files({'name':'duplicate-headers.csv','mimeType':'text/csv','buffer':bad.encode('utf-8')})
    expect(page.get_by_role('alert')).to_contain_text('重复列名')
    assert page.locator('#analysis-svg').count() == 1
    checked('结果 CSV 含 8 个分组；坏文件报错并保留上次有效数据')
    blocked = context.new_page()
    blocked.route('**/owid-energy-data.csv', lambda route: route.abort())
    blocked.goto(BASE_URL + '/', wait_until='networkidle')
    blocked.get_by_role('button', name='手边没有文件？载入带来源的公开数据', exact=True).click()
    expect(blocked.get_by_role('alert')).to_contain_text('公开数据加载失败')
    assert blocked.locator('#analysis-svg').count() == 0
    blocked.close()
    checked('公开源故障显示可恢复错误，没有伪造结果')
    assert not errors, errors
    (root / 'artifacts/validation.json').write_text(json.dumps({'checks':checks,'browser_errors':errors,'source_url':responses[-1].url,'source_validation_mode':'cached real OWID fixture' if cached_source else 'live public network','public_rows':len(source_rows),'subset_rows':len(selected),'expected_values':expected}, ensure_ascii=False, indent=2), encoding='utf-8')
    checked('浏览器没有未捕获异常')
    browser.close()
