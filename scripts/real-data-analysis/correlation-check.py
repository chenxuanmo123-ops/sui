"""End-to-end check of the descriptive Pearson correlation on real OWID data."""
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
        xs.append(float(row["renewables_electricity"]))
        ys.append(float(row["solar_electricity"]))
mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
sxx = sum((x - mean_x) ** 2 for x in xs)
syy = sum((y - mean_y) ** 2 for y in ys)
sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
expected = sxy / (sxx * syy) ** 0.5


def check(text):
    print("PASS " + text, flush=True)


def shown_r(page):
    text = page.locator(".explore-correlation").inner_text()
    match = re.search(r"r\s*=\s*([+-]?\d+(?:\.\d+)?)", text)
    assert match, text
    return float(match.group(1))


def run(page):
    page.get_by_role("button", name="执行探索分析", exact=True).click()


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
    page.get_by_role("button", name="散点图", exact=True).click()
    page.get_by_label("探索分组字段").select_option("renewables_electricity")
    page.get_by_label("探索第二字段").select_option("solar_electricity")
    run(page)
    expect(page.locator(".explore-correlation")).to_be_visible()
    expect(page.locator(".explore-correlation")).to_contain_text("8 对有效数值")
    expect(page.locator(".explore-correlation")).to_contain_text("不是因果结论")
    r = shown_r(page)
    assert abs(r - expected) < 0.0001, (r, expected)
    check(f"真实散点显示 Pearson r={r}，与独立计算一致")

    page.get_by_label("探索筛选字段").select_option("year")
    page.get_by_label("探索筛选值").fill("2020")
    run(page)
    expect(page.locator(".explore-correlation")).to_have_count(0)
    check("有效配对不足三个时不显示相关系数")

    # A large real file: the chart caps points, the coefficient does not.
    uci = root / "tests/fixtures/uci-online-shoppers.csv"
    page.get_by_label("探索筛选字段").select_option("")
    page.locator("#file-upload").set_input_files(str(uci))
    expect(page.locator(".dataset-name strong")).to_have_text("uci-online-shoppers.csv")
    page.get_by_role("button", name="探索分析", exact=True).click()
    page.get_by_role("button", name="散点图", exact=True).click()
    page.get_by_label("探索分组字段").select_option("PageValues")
    page.get_by_label("探索第二字段").select_option("ProductRelated_Duration")
    page.get_by_label("探索显示上限").select_option("20")
    run(page)
    expect(page.locator(".explore-correlation")).to_contain_text("12330 对有效数值")
    expect(page.locator(".explore-correlation")).to_contain_text("图中只画了前 20 条记录")
    check("大数据下展示上限只限制画点，相关系数仍按全部 12330 对有效值计算并说明范围")

    assert not errors, errors
    print("PASS 相关系数端到端检查全部通过")
    browser.close()
