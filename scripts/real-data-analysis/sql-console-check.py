"""End-to-end check of the read-only SQL console on real OWID data."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5175")
data = root / "tests/fixtures/owid-China-2015-2022.csv"
expect.set_options(timeout=120000)


def check(text):
    print("PASS " + text, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="load", timeout=120000)
    page.locator("#file-upload").set_input_files(str(data))
    expect(page.locator(".dataset-name strong")).to_have_text("owid-China-2015-2022.csv")

    page.get_by_role("button", name="SQL 查询", exact=True).click()
    expect(page.locator(".core-heading h2")).to_have_text("SQL 查询")
    expect(page.locator(".sql-schema")).to_contain_text("renewables_electricity")

    textarea = page.get_by_label("查询语句")
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".console-results tbody tr")).to_have_count(8)
    expect(page.locator(".console-results thead")).to_contain_text("renewables_electricity")
    check("默认查询通过 readable 视图返回 8 行真实数据")

    textarea.fill(
        'SELECT "country", COUNT(*) AS n, '
        'ROUND(SUM(strict_number("renewables_electricity")), 3) AS total, '
        'AVG(strict_number("solar_electricity")) AS avg_solar\n'
        'FROM readable\nGROUP BY "country"'
    )
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".console-results tbody tr")).to_have_count(1)
    expect(page.locator(".console-results tbody tr")).to_contain_text("China")
    expect(page.locator(".console-results tbody tr")).to_contain_text("15738.01")
    expect(page.locator(".console-results tbody tr")).to_contain_text("205.01")
    check("聚合、UDF 与 readable 表头在 Worker 中真实执行")

    page.get_by_role("button", name="结果图表", exact=True).click()
    expect(page.locator(".sql-result-chart svg")).to_be_visible()
    expect(page.locator(".sql-result-chart")).to_contain_text("China")
    expect(page.locator(".sql-result-chart")).to_contain_text("total")
    page.get_by_role("button", name="收起图表", exact=True).click()
    expect(page.locator(".sql-result-chart")).to_have_count(0)
    check("查询结果图在浏览器内由真实返回值绘制")

    textarea.fill("DELETE FROM data")
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".ai-error")).to_contain_text("只允许 SELECT")
    textarea.fill("SELECT 1; SELECT 2")
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".ai-error")).to_contain_text("一次只能执行一条语句")
    textarea.fill("SELECT 'DELETE; DROP TABLE data' AS note")
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".console-results tbody tr")).to_contain_text("DELETE; DROP TABLE data")
    check("写操作和多语句被拒绝，字符串中的关键字可正常查询")

    page.get_by_role("button", name="结果图表", exact=True).click()
    expect(page.locator(".sql-chart-empty")).to_contain_text("没有可作为纵轴的数值列")
    page.get_by_role("button", name="收起图表", exact=True).click()
    check("纯文本结果不生成数值图表")

    page.get_by_label("上传关联表 CSV").set_input_files(str(root / "tests/fixtures/country-region.csv"))
    expect(page.locator(".console-table-state")).to_contain_text("1 行 × 2 列")
    page.get_by_role("button", name="填入 JOIN 示例", exact=True).click()
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".console-results tbody tr")).to_have_count(8)
    expect(page.locator(".console-results tbody tr").first).to_contain_text("China")
    check("关联表上传后，界面提供的 JOIN 示例在 Worker 中真实返回 8 行")

    textarea.fill(
        'SELECT d."country" AS country, e."region" AS region, COUNT(*) AS n\n'
        'FROM readable AS d\n'
        'LEFT JOIN extra_readable AS e ON d."country" = e."country"\n'
        'GROUP BY d."country", e."region"'
    )
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".console-results tbody tr")).to_have_count(1)
    expect(page.locator(".console-results tbody tr")).to_contain_text("China")
    expect(page.locator(".console-results tbody tr")).to_contain_text("Asia")
    expect(page.locator(".console-results tbody tr")).to_contain_text("8")
    check("readable 与 extra_readable 按真实表头 JOIN 成功")

    page.get_by_role("button", name="移除关联表", exact=True).click()
    expect(page.locator(".console-table-state")).to_have_count(0)
    textarea.fill("SELECT * FROM extra")
    page.get_by_role("button", name="运行查询", exact=True).click()
    expect(page.locator(".ai-error")).to_contain_text("no such table")
    check("移除关联表后 Worker 中的 extra 同步消失")

    assert not errors, "页面脚本错误：" + "; ".join(errors)
    browser.close()

print("PASS SQL 控制台端到端检查全部通过", flush=True)
