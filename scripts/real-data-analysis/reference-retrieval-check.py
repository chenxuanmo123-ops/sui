"""End-to-end check of local reference retrieval on real OWID data, without a model call."""
import os
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5175")
data = root / "tests/fixtures/owid-China-2015-2022.csv"
note = root / "tests/fixtures/reference-energy-note.txt"
expect.set_options(timeout=120000)


def check(text):
    print("PASS " + text, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors, model_calls = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: model_calls.append(request.url) if re.search(r"/api/ai/(plan|review|repair-plan)", request.url) else None)
    page.goto(url, wait_until="load", timeout=120000)
    page.locator("#file-upload").set_input_files(str(data))
    expect(page.locator(".dataset-name strong")).to_have_text("owid-China-2015-2022.csv")

    page.locator(".composer-open").click()
    goal = page.locator("#analysis-goal")
    goal.fill("为什么可再生能源发电量下降？缺失值会不会影响比例？")
    expect(page.locator(".ai-references summary")).to_contain_text("条匹配")
    page.locator(".ai-references summary").click()
    hits = page.locator(".ai-reference-hits article")
    expect(hits.first).to_be_visible()
    expect(hits.first).to_contain_text("内置方法")
    body = page.locator(".ai-reference-hits").inner_text()
    assert "因果" in body or "缺失" in body, body
    ids = page.locator(".ai-reference-hits article code").all_inner_texts()
    assert ids and all(re.fullmatch(r"[RM]-[A-F]", value) for value in ids), ids
    assert len(ids) <= 4, ids
    check("真实数据上本地检索返回内置方法摘录，编号与上限正确")

    page.get_by_label("上传参考资料").set_input_files(str(note))
    expect(page.locator(".ai-reference-docs")).to_contain_text("reference-energy-note.txt")
    goal.fill("发电量单位是什么？缺失值算零吗？")
    first = page.locator(".ai-reference-hits article").first
    expect(first).to_contain_text("上传资料")
    expect(first).to_contain_text("TWh")
    expect(page.locator(".ai-reference-hits article").filter(has_text="上传资料")).to_have_count(1)
    check("上传的 TXT 在浏览器内切分，并按当前问题优先召回")

    page.get_by_role("button", name="移除参考资料 reference-energy-note.txt").click()
    expect(page.locator(".ai-reference-docs")).to_have_count(0)
    expect(page.locator(".ai-reference-hits")).not_to_contain_text("上传资料")
    check("移除参考资料后检索结果同步更新")

    page.get_by_label("上传参考资料").set_input_files(str(root / "tests/fixtures/reference-note.pdf"))
    expect(page.locator(".ai-reference-docs")).to_contain_text("reference-note.pdf")
    goal.fill("What unit is renewable electricity measured in, and are missing values zero?")
    first = page.locator(".ai-reference-hits article").first
    expect(first).to_contain_text("上传资料")
    expect(first).to_contain_text("第 2 页")
    expect(first).to_contain_text("terawatt")
    check("PDF 在浏览器内提取文字、保留页码并召回对应页")

    assert not model_calls, "本地检索不应调用模型：" + "; ".join(model_calls)
    assert not errors, "页面脚本错误：" + "; ".join(errors)
    browser.close()

print("PASS 参考资料本地检索端到端检查全部通过", flush=True)
