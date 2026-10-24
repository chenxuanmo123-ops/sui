"""Browser check: GBK and non-comma CSV import through the real file input.

The three CSV files are test fixtures generated here, never demo data. Run
against a local dev server: TEST_BASE_URL=http://127.0.0.1:5175 python ...py
"""
import os
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5175")
fixtures = Path(tempfile.mkdtemp(prefix="shujian-csv-"))
(fixtures / "gbk-demo.csv").write_bytes("年份,值\r\n2020,3\r\n2021,4\r\n".encode("gbk"))
(fixtures / "semicolon-demo.csv").write_text("年份;值\n2020;3\n2021;4\n", encoding="utf-8")
(fixtures / "tab-demo.csv").write_text("年份\t值\n2020\t3\n2021\t4\n", encoding="utf-8")


def check(text):
    print("PASS " + text, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_context(viewport={"width": 1440, "height": 1100}).new_page()
    page.set_default_timeout(30000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="load", timeout=120000)

    page.locator("#file-upload").set_input_files(str(fixtures / "gbk-demo.csv"))
    expect(page.locator(".dataset-name strong")).to_have_text("gbk-demo.csv")
    expect(page.locator(".status-message")).to_contain_text("GB18030")
    page.get_by_role("button", name="字段与质量").click()
    expect(page.locator("#dataset-field-drawer")).to_contain_text("年份")
    expect(page.locator("#dataset-field-drawer")).to_contain_text("值")
    check("GBK/ANSI CSV 导入成功，提示 GB18030 解码，中文字段正常")

    page.get_by_role("button", name="更换文件").click()
    page.locator("#file-upload").set_input_files(str(fixtures / "semicolon-demo.csv"))
    expect(page.locator(".dataset-name strong")).to_have_text("semicolon-demo.csv")
    expect(page.locator(".status-message")).to_contain_text("分号")
    check("分号分隔 CSV 自动识别并提示")

    page.get_by_role("button", name="更换文件").click()
    page.locator("#file-upload").set_input_files(str(fixtures / "tab-demo.csv"))
    expect(page.locator(".dataset-name strong")).to_have_text("tab-demo.csv")
    expect(page.locator(".status-message")).to_contain_text("制表符")
    check("制表符分隔 CSV 自动识别并提示")

    assert not errors, errors
    print("PASS CSV 编码与分隔符端到端检查全部通过")
    browser.close()
