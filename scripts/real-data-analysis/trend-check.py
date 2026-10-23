"""End-to-end check of the descriptive time trend on real OWID data."""
import csv
import os
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
data = root / "tests/fixtures/owid-China-2015-2022.csv"
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5175")
xs, ys = [], []
with data.open(encoding="utf-8-sig", newline="") as handle:
    for row in csv.DictReader(handle):
        xs.append(int(row["year"]))
        ys.append(float(row["renewables_electricity"]))
mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
sxx = sum((x - mean_x) ** 2 for x in xs)
sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
expected = sxy / sxx


def check(text):
    print("PASS " + text, flush=True)


def shown_slope(page):
    text = page.locator(".explore-trend").inner_text()
    match = re.search(r"平均每年变化\s*([+-]?[\d,]+(?:\.\d+)?)", text)
    assert match, text
    return float(match.group(1).replace(",", ""))


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="load", timeout=120000)
    page.locator("#file-upload").set_input_files(str(data))
    expect(page.locator(".dataset-name strong")).to_have_text("owid-China-2015-2022.csv")

    page.get_by_role("button", name="探索分析", exact=True).click()
    expect(page.get_by_role("heading", name="探索分析与可视化")).to_be_visible()
    page.get_by_role("button", name="折线图", exact=True).click()
    page.get_by_label("探索分组字段").select_option("year")
    page.get_by_label("探索指标字段").select_option("renewables_electricity")
    page.get_by_label("探索统计方式").select_option("sum")
    page.get_by_label("探索时间分桶").select_option("year")
    page.get_by_label("探索排序").select_option("label")
    page.get_by_role("button", name="执行探索分析", exact=True).click()
    expect(page.locator(".explore-trend")).to_be_visible()
    expect(page.locator(".explore-trend")).to_contain_text("8 个时间点")
    expect(page.locator(".explore-trend")).to_contain_text("不是预测、显著性检验或因果结论")
    slope = shown_slope(page)
    assert abs(slope - expected) < 0.01, (slope, expected)
    check(f"真实年度折线显示描述性趋势，斜率 {slope} 与独立 OLS 计算一致")

    page.get_by_label("探索排序").select_option("desc")
    page.get_by_role("button", name="执行探索分析", exact=True).click()
    expect(page.locator(".explore-trend")).to_be_visible()
    assert abs(shown_slope(page) - expected) < 0.01
    check("切换为结果降序后趋势斜率不变，趋势按时间索引计算")

    page.get_by_label("探索时间分桶").select_option("none")
    page.get_by_role("button", name="执行探索分析", exact=True).click()
    expect(page.locator(".exploration-results")).to_be_visible()
    expect(page.locator(".explore-trend")).to_have_count(0)
    check("不按时间分桶时不显示趋势，分类序列不被当成时间趋势")

    assert not errors, errors
    print("PASS 趋势端到端检查全部通过")
    browser.close()
