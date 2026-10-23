"""Download reproducible SQL bundles from the real UI and rerun them with Python."""
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / ".tools/python"))
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding="utf-8")
url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5175")
data = root / "demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv"
out = root / "artifacts/reproducible-bundle"
out.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=180000)


def check(text):
    print("PASS " + text, flush=True)


def extract(zip_path, target):
    target.mkdir(parents=True, exist_ok=True)
    base = target.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            dest = (target / name).resolve()
            if base != dest.parent and base not in dest.parents:
                raise SystemExit("FAIL ZIP 包含越界路径：" + name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(archive.read(name))


def rerun(target):
    result = subprocess.run(
        [sys.executable, "-I", "-X", "utf8=1", "run_analysis.py"],
        cwd=target,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
    )
    output = (result.stdout + result.stderr).strip()
    assert result.returncode == 0, "runner 退出码 %d：%s" % (result.returncode, output)
    assert output.startswith("PASS"), "runner 未通过：" + output
    return output


def verify(zip_path, label):
    target = out / label
    shutil.rmtree(target, ignore_errors=True)
    extract(zip_path, target)
    names = sorted(p.name for p in target.iterdir())
    assert names == ["README.md", "analysis.sql", "data.csv", "expected.json", "run_analysis.py", "schema.sql"], names
    expected = json.loads((target / "expected.json").read_text(encoding="utf-8"))
    output = rerun(target)
    print("  " + output, flush=True)
    check("「%s」复现包在独立 Python + SQLite 中复算一致" % label)
    return expected


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel="msedge")
    page = browser.new_page(viewport={"width": 1440, "height": 1200}, accept_downloads=True)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    page.locator("#file-upload").set_input_files(str(data))
    expect(page.locator(".dataset-name strong")).to_have_text("listings.csv")

    # Clean price so the bundle carries the same numeric snapshot the UI analysed.
    page.get_by_role("button", name="数据处理", exact=True).click()
    page.get_by_label("处理字段", exact=True).select_option("price")
    page.locator("label.core-check").filter(has_text="规范常见数字格式").locator("input").check()
    page.get_by_role("button", name="预览处理影响", exact=True).click()
    expect(page.locator(".cleaning-preview")).to_contain_text("6039 个单元格")
    page.locator("label.core-check").filter(has_text="我已核对处理影响与数据粒度").locator("input").check()
    page.get_by_role("button", name="应用处理", exact=True).click()
    expect(page.locator(".status-message")).to_contain_text("处理已应用")

    # Workspace bundle: manual median by room type.
    page.get_by_role("button", name="分析工作台", exact=True).click()
    page.locator(".manual-start").click()
    if not page.locator(".manual-mapping").evaluate("el=>el.open"):
        page.locator(".manual-mapping > summary").click()
    page.locator("#group-field").select_option("room_type")
    page.locator("#metric-field").select_option("price")
    page.locator("#aggregate-method").select_option("median")
    page.get_by_role("button", name="按确认口径分析", exact=True).click()
    expect(page.locator(".finding")).to_contain_text("有效来源")
    page.get_by_role("button", name="证据与报告", exact=True).click()
    workspace_button = page.get_by_role("button", name="导出可复现 SQL 包", exact=True)
    expect(workspace_button).to_be_enabled()
    with page.expect_download() as info:
        workspace_button.click()
    workspace_zip = out / "workspace.zip"
    info.value.save_as(str(workspace_zip))
    workspace = verify(workspace_zip, "workspace")
    values = dict(workspace["result"]["rows"])
    assert values == {"Entire home/apt": 332, "Hotel room": 190, "Private room": 176.1, "Shared room": 63.5}, values
    check("工作台复现包结果与真实中位数一致（4 组）")

    # Exploration bundle: same median through the explore page.
    page.get_by_role("button", name="探索分析", exact=True).click()
    expect(page.get_by_role("heading", name="探索分析与可视化")).to_be_visible()
    page.get_by_label("探索分组字段").select_option("room_type")
    page.get_by_label("探索指标字段").select_option("price")
    page.get_by_label("探索统计方式").select_option("median")
    page.get_by_label("探索时间分桶").select_option("none")
    page.get_by_label("探索排序").select_option("label")
    page.get_by_role("button", name="执行探索分析", exact=True).click()
    explore_button = page.get_by_role("button", name="导出可复现 SQL 包", exact=True)
    expect(explore_button).to_be_enabled()
    with page.expect_download() as info:
        explore_button.click()
    explore_zip = out / "explore.zip"
    info.value.save_as(str(explore_zip))
    explore = verify(explore_zip, "explore")
    values = dict(row[:2] for row in explore["result"]["rows"])
    assert values == {"Entire home/apt": 332, "Hotel room": 190, "Private room": 176.1, "Shared room": 63.5}, values
    assert all(len(ids) > 0 for ids in explore["result"]["rowIds"])
    check("探索复现包结果与来源记录一致（4 组）")

    assert not errors, "页面脚本错误：" + "; ".join(errors)
    browser.close()

print("PASS 可复现 SQL 包端到端检查全部通过", flush=True)
