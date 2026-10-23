"""Independent local diagnostics over the unchanged, public UCI fixture. No AI calls."""
import csv, json, os, sys, hashlib
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools/python'))
from playwright.sync_api import sync_playwright, expect
sys.stdout.reconfigure(encoding='utf-8')
fixture = root / 'tests/fixtures/uci-online-shoppers.csv'
assert hashlib.sha256(fixture.read_bytes()).hexdigest() == 'b3055ee355f59134d851d32641183cb4a8b45def7124d2f50442a042f358e0d9'
rows = list(csv.DictReader(fixture.open(encoding='utf-8')))
values = sorted(float(row['ProductRelated_Duration']) for row in rows)
def quantile(p):
    index = (len(values) - 1) * p
    low = int(index)
    return values[low] * (1 - (index - low)) + values[min(low + 1, len(values) - 1)] * (index - low)
q1, q3 = quantile(.25), quantile(.75)
outliers = [i for i, row in enumerate(rows) if float(row['ProductRelated_Duration']) < q1 - 1.5 * (q3 - q1) or float(row['ProductRelated_Duration']) > q3 + 1.5 * (q3 - q1)]
seen, duplicates = set(), []
for i, row in enumerate(rows):
    key = tuple(row.values())
    if key in seen: duplicates.append(i)
    seen.add(key)
checks, requests = [], []
def passed(message):
    checks.append(message)
    print('PASS ' + message, flush=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='msedge')
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def intercept(route):
        if route.request.url.endswith('/status'):
            return route.fulfill(json={'providers': [], 'configured': False, 'canManage': False})
        requests.append(route.request.url)
        return route.fulfill(status=503, json={'error': 'This independent analysis test forbids model requests'})
    page.route('**/api/ai/**', intercept)
    page.goto(os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5174'), wait_until='networkidle')
    page.locator('#file-upload').set_input_files(str(fixture))
    expect(page.locator('.dataset-name strong')).to_contain_text('uci-online-shoppers')
    page.get_by_role('button', name='数据处理', exact=True).click()
    page.get_by_label('处理字段', exact=True).select_option('ProductRelated_Duration')
    inspector = page.locator('.quality-inspector')
    expect(inspector).to_contain_text('本地计算 · 无需 AI')
    expect(inspector).to_contain_text('12,330')
    expect(inspector.locator('.quality-distribution tbody tr')).to_have_count(8)
    counts = [int(text.replace(',', '')) for text in inspector.locator('.quality-distribution tbody tr td:last-child').all_text_contents()]
    assert sum(counts) == len(rows)
    passed('真实 UCI 12330 行完整数值分箱，频数守恒，无 AI 配置')
    page.get_by_label('检查记录', exact=True).select_option('outlier')
    expect(inspector.get_by_role('status')).to_contain_text(f'{len(outliers):,}')
    expect(inspector.locator('.quality-records tbody tr')).to_have_count(25)
    first_ids = [int(v) for v in inspector.locator('.quality-records tbody tr td:first-child').all_text_contents()]
    assert first_ids == [i + 2 for i in outliers[:25]]
    page.get_by_role('button', name='下一页', exact=True).click()
    next_ids = [int(v) for v in inspector.locator('.quality-records tbody tr td:first-child').all_text_contents()]
    assert next_ids == [i + 2 for i in outliers[25:50]]
    passed('IQR 异常候选由 Python 独立核算，分页来源记录不重不漏')
    page.get_by_label('检查记录', exact=True).select_option('duplicate')
    expect(inspector.get_by_role('status')).to_contain_text(f'{len(duplicates):,}')
    duplicate_ids = [int(v) for v in inspector.locator('.quality-records tbody tr td:first-child').all_text_contents()]
    assert duplicate_ids == [i + 2 for i in duplicates[:25]]
    passed('整行重复候选与原 CSV 独立比较一致，不把首条当成重复')
    page.get_by_label('处理字段', exact=True).select_option('VisitorType')
    expect(inspector).to_contain_text('本列没有可解析数值')
    page.get_by_label('检查记录', exact=True).select_option('nonnumeric')
    expect(inspector.get_by_role('status')).to_contain_text('12,330')
    expect(inspector).to_contain_text('文本字段出现非数值是正常现象')
    expect(inspector.get_by_role('button', name='上一页', exact=True)).to_be_disabled()
    passed('切换文本字段不伪造数值分布，清空旧分页，提示核查边界')
    out = root / 'artifacts/quality-diagnostics'
    out.mkdir(parents=True, exist_ok=True)
    for width in [390, 768, 1440]:
        page.set_viewport_size({'width': width, 'height': 1100})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
        page.screenshot(path=str(out / f'quality-{width}.png'), animations='disabled')
    passed('手机、平板、桌面均无整体横向溢出，保留真实来源表横向滚动')
    assert not errors, errors
    assert not requests, requests
    passed('全程未调用模型，无未捕获浏览器错误')
    (out / 'checks.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'outliers': len(outliers), 'duplicates': len(duplicates), 'aiRequests': len(requests)}, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
