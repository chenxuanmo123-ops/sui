"""Browser checks for pinned public data and full-series trend fitting.

The trend CSV is a generated test fixture (y = t²), never demo data. The public
load is intercepted so the check verifies the requested URL and provenance UI
without downloading the full upstream file; the URL and source page are real.
"""
import os
import re
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5175")
fixtures = Path(tempfile.mkdtemp(prefix="shujian-audit-"))
trend_csv = fixtures / "trend-demo.csv"
values = [t * t for t in range(30)]
trend_csv.write_text("year,value\n" + "\n".join(f"{1995 + t},{v}" for t, v in enumerate(values)) + "\n", encoding="utf-8")
x_mean = sum(range(30)) / 30
y_mean = sum(values) / 30
slope = sum((t - x_mean) * (v - y_mean) for t, v in enumerate(values)) / sum((t - x_mean) ** 2 for t in range(30))


def check(text):
    print("PASS " + text, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_context(viewport={"width": 1440, "height": 1200}).new_page()
    page.set_default_timeout(30000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="load", timeout=120000)

    page.locator("#file-upload").set_input_files(str(trend_csv))
    expect(page.locator(".dataset-name strong")).to_have_text("trend-demo.csv")
    page.get_by_role("button", name="探索分析", exact=True).click()
    page.get_by_role("button", name="折线图", exact=True).click()
    page.get_by_label("探索分组字段").select_option("year")
    page.get_by_label("探索指标字段").select_option("value")
    page.get_by_label("探索时间分桶").select_option("year")
    page.get_by_label("探索显示上限").select_option("20")
    page.get_by_role("button", name="执行探索分析", exact=True).click()
    expect(page.locator(".explore-trend")).to_be_visible()
    expect(page.locator(".core-warning")).to_contain_text("仅展示前 20 项")
    trend_text = page.locator(".explore-trend").inner_text()
    assert "30 个时间点" in trend_text, trend_text
    assert "全部时间聚合值" in trend_text, trend_text
    assert "未显示的点也参与拟合" in trend_text, trend_text
    shown = float(re.search(r"变化\s*([+-]?\d[\d,]*(?:\.\d+)?)", trend_text).group(1).replace(",", ""))
    assert abs(shown - slope) < 0.001, (shown, slope)
    check(f"展示上限 20 时趋势仍按全部 30 个时间桶拟合（斜率 {shown:.4f}）")

    seen = []
    fixture = (root / "tests/fixtures/owid-China-2015-2022.csv").read_text(encoding="utf-8")

    def pinned(route):
        seen.append(route.request.url)
        route.fulfill(status=200, content_type="text/csv; charset=utf-8", body=fixture)

    public = browser.new_context(viewport={"width": 1440, "height": 1200}).new_page()
    public.set_default_timeout(30000)
    public.on("pageerror", lambda error: errors.append(str(error)))
    public.route("https://raw.githubusercontent.com/**", pinned)
    public.goto(url, wait_until="load", timeout=120000)
    public.get_by_role("button", name=re.compile("载入带来源的公开数据")).click()
    expect(public.locator(".dataset-name strong")).to_have_text("OWID Energy Data")
    assert seen and "/e7897aed55b514b8d16e0a3d8f1518789ac3de31/" in seen[0], seen
    public.get_by_role("button", name="来源", exact=True).click()
    expect(public.locator("body")).to_contain_text("e7897ae")
    expect(public.locator("body")).to_contain_text("固定提交")
    check("公开数据请求固定 commit，来源页显示固定提交与短哈希")

    assert not errors, errors
    print("PASS 公开数据固定与趋势口径端到端检查全部通过")
    browser.close()
