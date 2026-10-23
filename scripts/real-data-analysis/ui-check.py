"""End-to-end check of the real Airbnb CSV through the actual web UI."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5173")
data = root / "demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv"
shots = root / "demo-data/airbnb-amsterdam-2026-09-16/screenshots"
shots.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=120000)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    page.locator("#file-upload").set_input_files(str(data))
    expect(page.locator(".dataset-name strong")).to_have_text("listings.csv")

    page.get_by_role("button", name="数据处理", exact=True).click()
    expect(page.get_by_role("heading", name="数据质量与处理")).to_be_visible()
    page.get_by_label("处理字段", exact=True).select_option("price")
    numeric = page.locator("label.core-check").filter(has_text="规范常见数字格式").locator("input")
    numeric.check()
    page.get_by_role("button", name="预览处理影响", exact=True).click()
    preview = page.locator(".cleaning-preview")
    expect(preview).to_contain_text("6039 个单元格")
    expect(preview).to_contain_text("所选字段的非空值都已规范为数字")
    page.screenshot(path=str(shots / "01-数字规范化预览.png"), full_page=True)

    page.locator("label.core-check").filter(has_text="我已核对处理影响与数据粒度").locator("input").check()
    page.get_by_role("button", name="应用处理", exact=True).click()
    expect(page.locator(".status-message")).to_contain_text("处理已应用")
    price_row = page.locator(".core-table-wrap tbody tr").filter(has_text="price").first
    expect(price_row).to_contain_text("6039 / 6039")
    price_row.get_by_role("button", name="price", exact=True).click()
    price_row.scroll_into_view_if_needed()
    page.screenshot(path=str(shots / "02-处理后字段画像.png"), full_page=True)

    page.get_by_role("button", name="探索分析", exact=True).click()
    expect(page.get_by_role("heading", name="探索分析与可视化")).to_be_visible()
    page.get_by_label("探索分组字段").select_option("neighbourhood_cleansed")
    page.get_by_label("探索指标字段").select_option("price")
    page.get_by_label("探索统计方式").select_option("average")
    page.get_by_label("探索排序").select_option("desc")
    page.get_by_role("button", name="执行探索分析", exact=True).click()
    rows = page.locator(".exploration-results tbody tr")
    expect(rows).to_have_count(22)
    expect(page.locator(".exploration-results")).to_contain_text("De Baarsjes")
    page.locator(".exploration-chart svg").first.wait_for(state="visible", timeout=60000)
    page.screenshot(path=str(shots / "03-街区均价探索.png"), full_page=True)

    assert not errors, errors
    print("PASS 26 MB real CSV: 6,039 prices normalized; 22 neighbourhood groups computed.")
    print("screenshots:", shots)
    browser.close()
