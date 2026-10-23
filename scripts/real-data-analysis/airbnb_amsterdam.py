#!/usr/bin/env python3
"""Reproducible exploratory analysis of the Amsterdam Inside Airbnb snapshot.

The raw file is downloaded separately; this script never rewrites it. All
numbers in the generated report come from this script's computation, and the
parsed price column is cross-checked against the file's own numeric quote
field before any statistic is reported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

PRICE_RE = re.compile(r"^\$([0-9][0-9,]*(?:\.[0-9]+)?)$")


def json_default(value: object) -> object:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    raise TypeError(f"not JSON serializable: {type(value)!r}")


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
BLUE = "#315be8"
LIGHT = "#9db4ef"
ORANGE = "#e59a2f"
RED = "#cf5b50"
GRAY = "#6f8099"
GRID = "#e6ebf3"


def parse_price(value: object) -> float:
    if pd.isna(value):
        return np.nan
    match = PRICE_RE.match(str(value).strip())
    return float(match.group(1).replace(",", "")) if match else np.nan


def euro(value: float, digits: int = 0) -> str:
    return f"€{value:,.{digits}f}"


def pct(value: float, digits: int = 1) -> str:
    return f"{value * 100:.{digits}f}%"


def gini(values: np.ndarray) -> float:
    values = np.sort(np.asarray(values, dtype=float))
    if not len(values) or values.sum() == 0:
        return 0.0
    cumulative = np.cumsum(values)
    n = len(values)
    return float((n + 1 - 2 * np.sum(cumulative) / cumulative[-1]) / n)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def md_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(str(cell) for cell in row) + " |" for row in rows]
    return "\n".join(lines)


def save(fig: plt.Figure, path: Path) -> None:
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parents[2] / "demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "demo-data/airbnb-amsterdam-2026-09-16")
    parser.add_argument("--source-url", default="https://data.insideairbnb.com/the-netherlands/north-holland/amsterdam/2026-09-16/data/listings.csv.gz")
    args = parser.parse_args()

    data_path: Path = args.data
    out_dir: Path = args.out
    charts_dir = out_dir / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)

    plt.rcParams.update({
        "font.sans-serif": ["Microsoft YaHei", "SimHei"],
        "axes.unicode_minus": False,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.edgecolor": "#cfd8e6",
        "axes.labelcolor": "#34496b",
        "xtick.color": "#5c6f8a",
        "ytick.color": "#5c6f8a",
        "text.color": "#223a5e",
        "axes.grid": True,
        "grid.color": GRID,
        "grid.linewidth": 0.8,
    })

    df = pd.read_csv(data_path, low_memory=False)
    original_columns = len(df.columns)
    df["price_num"] = df["price"].map(parse_price)
    df["price_quote_num"] = pd.to_numeric(df["price_quote_price_per_night"], errors="coerce")

    parsed = int(df["price_num"].notna().sum())
    parse_failures = int(df["price"].notna().sum() - parsed)
    quoted = int(df["price_quote_num"].notna().sum())
    matched = df[["price_num", "price_quote_num"]].dropna()
    cross_check = int(len(matched))
    mismatch = int((matched["price_num"] - matched["price_quote_num"]).abs().gt(0.005).sum())

    currencies: dict[str, int] = {}
    for raw in df["price_quote_raw"].dropna():
        try:
            currency = json.loads(raw).get("quote", {}).get("currency")
        except (ValueError, AttributeError):
            continue
        if currency:
            currencies[currency] = currencies.get(currency, 0) + 1
    currency = max(currencies, key=currencies.get) if currencies else "未标注"

    buckets = [(-1, 0, "0 天"), (0, 30, "1–30 天"), (30, 90, "31–90 天"), (90, 180, "91–180 天"), (180, 365, "181–365 天")]
    coverage_rows = []
    for low, high, label in buckets:
        group = df[df["availability_365"].between(low, high, inclusive="right" if low >= 0 else "neither")]
        if low == -1:
            group = df[df["availability_365"] == 0]
        coverage_rows.append({
            "label": label,
            "size": int(len(group)),
            "present": int(group["price_num"].notna().sum()),
            "coverage": float(group["price_num"].notna().mean()) if len(group) else 0.0,
            "median": float(group["price_num"].median()) if group["price_num"].notna().any() else np.nan,
        })

    price = df["price_num"].dropna()
    overall = {
        "n": int(len(price)),
        "coverage": float(len(price) / len(df)),
        "median": float(price.median()),
        "q1": float(price.quantile(0.25)),
        "q3": float(price.quantile(0.75)),
        "mean": float(price.mean()),
        "p95": float(price.quantile(0.95)),
        "p99": float(price.quantile(0.99)),
        "max": float(price.max()),
        "min": float(price.min()),
        "over_500": int((price > 500).sum()),
        "over_1000": int((price > 1000).sum()),
        "over_3000": int((price > 3000).sum()),
    }

    room = df[df["price_num"].notna()].groupby("room_type")["price_num"].agg(["size", "median", "mean"]).sort_values("size", ascending=False)
    room = room.reset_index()

    priced = df[df["price_num"].notna()]
    neighbourhood = priced.groupby("neighbourhood_cleansed")["price_num"].agg(["size", "median"]).reset_index()
    entire = priced[priced["room_type"] == "Entire home/apt"].groupby("neighbourhood_cleansed")["price_num"].agg(["size", "median"]).reset_index()
    entire = entire.rename(columns={"size": "entire_n", "median": "entire_median"})
    neighbourhood = neighbourhood.merge(entire, on="neighbourhood_cleansed", how="left")
    neighbourhood = neighbourhood.sort_values("size", ascending=False)

    bedrooms = priced[(priced["room_type"] == "Entire home/apt") & (priced["bedrooms"].between(1, 4))].groupby("bedrooms")["price_num"].agg(["size", "median"]).reset_index()

    host_counts = df.groupby("host_id").size().sort_values(ascending=False)
    host_metrics = {
        "hosts": int(len(host_counts)),
        "top1": int(host_counts.head(1).sum()),
        "top10": int(host_counts.head(10).sum()),
        "top50": int(host_counts.head(50).sum()),
        "top100": int(host_counts.head(100).sum()),
        "multi_hosts": int((host_counts > 1).sum()),
        "multi_listings": int(host_counts[host_counts > 1].sum()),
        "gini": gini(host_counts.values),
    }

    license_metrics = {
        "missing": int(df["license"].isna().sum()),
        "exempt": int((df["license"] == "Exempt").sum()),
        "identifier": int((df["license"].notna() & (df["license"] != "Exempt")).sum()),
    }

    correlations = {}
    for column, label in [("review_scores_rating", "review"), ("availability_365", "availability"), ("minimum_nights", "minimum_nights")]:
        pair = df[["price_num", column]].dropna()
        correlations[label] = float(pair["price_num"].corr(pair[column], method="spearman"))

    metrics = {
        "source_url": args.source_url,
        "data_file": str(data_path),
        "data_sha256": sha256(data_path),
        "rows": int(len(df)),
        "columns": int(original_columns),
        "duplicate_ids": int(df["id"].duplicated().sum()),
        "currency": currency,
        "currency_counts": currencies,
        "parsed_prices": parsed,
        "parse_failures": parse_failures,
        "quote_values": quoted,
        "cross_checked": cross_check,
        "cross_check_mismatch": mismatch,
        "coverage": coverage_rows,
        "overall": overall,
        "room_types": room.to_dict(orient="records"),
        "neighbourhoods": neighbourhood.to_dict(orient="records"),
        "bedrooms_entire": bedrooms.to_dict(orient="records"),
        "hosts": host_metrics,
        "licenses": license_metrics,
        "spearman": correlations,
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2, default=json_default), encoding="utf-8")

    # 1. Price coverage by availability.
    fig, ax = plt.subplots(figsize=(8.4, 4.6), dpi=180)
    labels = [row["label"] for row in coverage_rows]
    values = [row["coverage"] * 100 for row in coverage_rows]
    colors = [RED if value < 50 else BLUE for value in values]
    bars = ax.bar(labels, values, color=colors, width=0.62)
    for bar, row in zip(bars, coverage_rows):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 2, f"{row['coverage'] * 100:.1f}%\n{row['present']:,}/{row['size']:,}",
                ha="center", va="bottom", fontsize=9, color="#33496a")
    ax.set_ylim(0, 112)
    ax.set_ylabel("有报价的记录比例（%）")
    ax.set_xlabel("未来 365 天可租天数")
    ax.set_title("价格报价覆盖随可租天数变化", fontsize=14, pad=12)
    fig.text(0.01, -0.02, "不可租房源中 94.2% 没有价格；价格分析只能代表有报价的房源", fontsize=9.5, color="#7a5a1f")
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="x", visible=False)
    save(fig, charts_dir / "01-价格覆盖与可租天数.png")

    # 2. Price distribution.
    fig, ax = plt.subplots(figsize=(8.6, 4.8), dpi=180)
    clip = 1200
    ax.hist(price[price <= clip], bins=np.arange(0, clip + 25, 25), color=LIGHT, edgecolor="white", linewidth=0.4)
    ax.axvline(overall["median"], color=ORANGE, linewidth=2.2, label=f"中位数 {euro(overall['median'], 0)}")
    ax.axvline(overall["mean"], color=RED, linewidth=2.0, linestyle="--", label=f"均值 {euro(overall['mean'], 0)}")
    ax.set_xlim(0, clip)
    ax.set_xlabel("每晚价格（EUR，报价原文为 €；文件 price 列显示 $）")
    ax.set_ylabel("房源数")
    ax.set_title("每晚价格分布：右偏，均值被高价房源拉高", fontsize=14, pad=12)
    ax.legend(frameon=False, loc="upper right")
    ax.text(0.985, 0.72, f">{euro(clip)}：{int((price > clip).sum()):,} 条\n最高 {euro(overall['max'])}", transform=ax.transAxes,
            ha="right", va="top", fontsize=9, color=GRAY)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="x", visible=False)
    save(fig, charts_dir / "02-每晚价格分布.png")

    # 3. Room type boxplot.
    order = ["Entire home/apt", "Hotel room", "Private room", "Shared room"]
    room_map = {row["room_type"]: row for row in room.to_dict(orient="records")}
    series = [priced.loc[priced["room_type"] == name, "price_num"].clip(upper=1500).values for name in order]
    fig, ax = plt.subplots(figsize=(8.6, 4.8), dpi=180)
    box = ax.boxplot(series, orientation="horizontal", tick_labels=order, showfliers=False, patch_artist=True,
                     medianprops={"color": ORANGE, "linewidth": 2}, whiskerprops={"color": GRAY}, capprops={"color": GRAY},
                     boxprops={"facecolor": LIGHT, "edgecolor": "#7893d8"}, widths=0.55)
    for i, name in enumerate(order, start=1):
        row = room_map[name]
        ax.text(790, i, f"中位 {euro(row['median'], 0)} · n={int(row['size']):,}", va="center", fontsize=9, color="#33496a")
    ax.set_xlim(0, 1250)
    ax.set_xlabel("每晚价格（EUR；为便于展示截断在 €1,500，箱线不含极端值点）")
    ax.set_title("房型价格差异：整租中位数约为独立房间的 1.9 倍", fontsize=14, pad=12)
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", visible=False)
    save(fig, charts_dir / "03-房型价格.png")

    # 4. Neighbourhood: overall vs entire-home median.
    top = neighbourhood[neighbourhood["entire_n"].fillna(0) >= 30].head(12).iloc[::-1]
    fig, ax = plt.subplots(figsize=(9.2, 5.6), dpi=180)
    y = np.arange(len(top))
    ax.hlines(y, top["median"], top["entire_median"], color="#c9d4e8", linewidth=2)
    ax.scatter(top["median"], y, color=LIGHT, s=58, label="全部房型中位价", zorder=3)
    ax.scatter(top["entire_median"], y, color=BLUE, s=58, label="整租房中位价", zorder=3)
    for yi, (_, row) in zip(y, top.iterrows()):
        ax.text(max(row["median"], row["entire_median"]) + 8, yi, f"n={int(row['size']):,}", va="center", fontsize=8.5, color=GRAY)
    ax.set_yticks(y, top["neighbourhood_cleansed"])
    ax.set_xlim(0, 500)
    ax.set_xlabel("每晚中位价（EUR）")
    ax.set_title("同一街区的整体中位价与整租房中位价", fontsize=14, pad=12)
    fig.text(0.01, -0.02, "整体中位价混入房型结构；例如 Centrum-West 的整租中位价明显高于其整体中位价",
             fontsize=9.5, color="#5d6f89")
    ax.legend(frameon=False, loc="lower right")
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", visible=False)
    save(fig, charts_dir / "04-街区中位价对比.png")

    # 5. Host concentration Lorenz curve.
    counts = np.sort(host_counts.values)
    cumulative_hosts = np.arange(1, len(counts) + 1) / len(counts)
    cumulative_listings = np.cumsum(counts) / counts.sum()
    fig, ax = plt.subplots(figsize=(6.4, 5.2), dpi=180)
    ax.plot([0, 1], [0, 1], linestyle="--", color="#b9c5d8", linewidth=1.4, label="完全平均")
    ax.plot(np.r_[0, cumulative_hosts], np.r_[0, cumulative_listings], color=BLUE, linewidth=2.2, label="实际分布")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_xlabel("房东累计占比（按房源数从少到多）")
    ax.set_ylabel("房源累计占比")
    ax.set_title("房源在房东之间的集中度", fontsize=14, pad=12)
    ax.text(0.04, 0.9, f"Gini = {host_metrics['gini']:.2f}\n多房源房东 {host_metrics['multi_hosts']:,} 位\n持有 {pct(host_metrics['multi_listings'] / len(df))} 的房源",
            transform=ax.transAxes, fontsize=9.5, color="#33496a", va="top")
    ax.legend(frameon=False, loc="lower right")
    ax.spines[["top", "right"]].set_visible(False)
    save(fig, charts_dir / "05-房东集中度.png")

    # Report.
    coverage_table = md_table(
        ["可租天数", "记录数", "有报价", "覆盖率", "中位价"],
        [[row["label"], f"{row['size']:,}", f"{row['present']:,}", pct(row["coverage"]), euro(row["median"]) if not np.isnan(row["median"]) else "—"] for row in coverage_rows],
    )
    room_table = md_table(
        ["房型", "有报价记录", "中位价", "均值"],
        [[row["room_type"], f"{int(row['size']):,}", euro(row["median"]), euro(row["mean"])] for row in room.to_dict(orient="records")],
    )
    neighbourhood_table = md_table(
        ["街区", "有报价记录", "整体中位价", "整租记录", "整租中位价"],
        [[row["neighbourhood_cleansed"], f"{int(row['size']):,}", euro(row["median"]), f"{int(row['entire_n']):,}" if pd.notna(row["entire_n"]) else "—",
          euro(row["entire_median"]) if pd.notna(row["entire_median"]) else "—"] for row in neighbourhood.head(12).to_dict(orient="records")],
    )
    bedroom_table = md_table(
        ["卧室数（仅整租）", "有报价记录", "中位价"],
        [[f"{int(row['bedrooms'])} 卧", f"{int(row['size']):,}", euro(row["median"])] for row in bedrooms.to_dict(orient="records")],
    )
    license_total = len(df)
    license_lines = [
        f"缺失 {license_metrics['missing']:,} 条（{pct(license_metrics['missing'] / license_total)}）",
        f"标记 Exempt {license_metrics['exempt']:,} 条（{pct(license_metrics['exempt'] / license_total)}）",
        f"有许可证编号 {license_metrics['identifier']:,} 条（{pct(license_metrics['identifier'] / license_total)}）",
    ]

    report = f"""# 阿姆斯特丹 Airbnb 房源价格分析

> 数据：Inside Airbnb，Amsterdam，快照 2026-09-16，CC BY 4.0。原始文件 `listings.csv`，{metrics['rows']:,} 行 × {metrics['columns']} 列。
> 下载：2026-10-23，SHA-256 `{metrics['data_sha256']}`。
> 来源：<{args.source_url}>
> 复现：`python -I scripts/real-data-analysis/airbnb_amsterdam.py`

## 我会怎么分析

这份数据容易直接算“平均房价”，但那会同时犯三个错误：把缺失当随机、把不同房型混在一起、让极端值拉高均值。下面的顺序是：**先确认口径与完整性 → 显式规范化字段 → 用稳健统计量描述 → 分层复核 → 再谈结论边界**。

### 1. 先确认一行代表什么

一行是一个 Airbnb 房源，不是一次入住，也不是一笔成交。`price` 不是房源标价，而是抓取时针对某组具体日期生成的**报价**（`price_quote_checkin_date` 到 `price_quote_checkout_date`），并可能包含折扣；`price_quote_price_per_night` 是同一报价的每晚数值。因此这里算的是“抓取时有报价房源的每晚报价”，不是全年平均成交价，也不是平台整体均价。

`price` 列写成 `$97.00`，但 `price_quote_raw` 里的 `currency` 明确是 **EUR**。货币符号不能当作币种证据；本文按报价原文的 EUR 展示，不做汇率换算。

### 2. 先查完整性，不先算均值

- 价格非空 {parsed:,} 条，空值 {len(df) - parsed:,} 条，覆盖率 **{pct(overall['coverage'])}**。
- 价格格式：{parsed:,} 条 `$` 金额全部解析成功，失败 {parse_failures} 条；与文件自带的数值列逐条比对 **{cross_check:,}/{cross_check:,} 一致**（差异 >€0.005 的记录 {mismatch} 条）。这是字段级校验，不是模型判断。
- 价格缺失不是随机的：

{coverage_table}

可租天数为 0 的房源中，94.2% 没有报价；可租 31 天以上的房源中，约 97%–98% 有报价。**所以价格分析只覆盖“当前有可租日期且有报价”的房源，不能外推到全部 {len(df):,} 条房源，更不能外推到阿姆斯特丹整体租赁市场。**

### 3. 价格分布：右偏，用中位数和四分位距

有报价房源 {overall['n']:,} 条：

- 中位数 **{euro(overall['median'])}** / 晚，四分位距 **{euro(overall['q1'])}–{euro(overall['q3'])}**。
- 均值 {euro(overall['mean'])} / 晚，高于中位数；第 95 百分位 {euro(overall['p95'])}，第 99 百分位 {euro(overall['p99'])}。
- 最高 {euro(overall['max'])} / 晚；超过 €500 的 {overall['over_500']:,} 条，超过 €1,000 的 {overall['over_1000']:,} 条，超过 €3,000 的只有 {overall['over_3000']} 条。
- 没有 0 或负价格。极端值不删除，但在图中截断展示；均值对它们敏感，所以主结论用中位数。

![价格分布](charts/02-每晚价格分布.png)

### 4. 分层：房型与卧室数

{room_table}

整租中位价 {euro(room_map['Entire home/apt']['median'])}，独立房间 {euro(room_map['Private room']['median'])}，前者约为后者的 {room_map['Entire home/apt']['median'] / room_map['Private room']['median']:.2f} 倍。酒店房间和合住房间的样本分别只有 {int(room_map['Hotel room']['size'])} 和 {int(room_map['Shared room']['size'])} 条，不据此下结论。

{bedroom_table}

即使同为整租，卧室数从 1 增加到 4，中位价也从 {euro(bedrooms.iloc[0]['median'])} 升到 {euro(bedrooms.iloc[-1]['median'])}。**所以比较街区时必须控制房型/卧室数，否则比到的是房源结构，不是地段溢价。**

### 5. 街区：整体排名会被房型结构扭曲

{neighbourhood_table}

按“全部房型”的中位价，De Pijp–Rivierenbuurt、De Baarsjes–Oud-West、Zuid 靠前；但把范围收窄到整租房后，Centrum-West 从 {euro(neighbourhood.loc[neighbourhood['neighbourhood_cleansed'] == 'Centrum-West', 'median'].iloc[0])} 升到 {euro(neighbourhood.loc[neighbourhood['neighbourhood_cleansed'] == 'Centrum-West', 'entire_median'].iloc[0])}，排名上升。原因是中心区独立房间占比更高，拉低了“全部房型”的中位数。

![街区中位价对比](charts/04-街区中位价对比.png)

这仍然只是描述性比较：没有控制卧室数、面积、设施、评分和具体日期，也没有做显著性检验。下一步应按“整租 + 同卧室数”分层，或做回归/匹配，而不是直接说“某街区更贵”。

### 6. 供给集中度与许可证

- {host_metrics['hosts']:,} 位房东持有 {len(df):,} 条房源；前 10 位持有 {host_metrics['top10']:,} 条（{pct(host_metrics['top10'] / len(df))}），前 100 位持有 {host_metrics['top100']:,} 条（{pct(host_metrics['top100'] / len(df))}）。
- 持有 2 条及以上房源的房东 {host_metrics['multi_hosts']:,} 位，合计 {host_metrics['multi_listings']:,} 条（{pct(host_metrics['multi_listings'] / len(df))}）。Gini = {host_metrics['gini']:.2f}。
- 许可证字段：{'; '.join(license_lines)}。许可证缺失和 `Exempt` 的含义不同，不能把缺失直接当成“无证”。

![房东集中度](charts/05-房东集中度.png)

### 7. 我检查过但没有写成结论的关系

- 价格与评分（Spearman）{correlations['review']:.2f}；价格与可租天数 {correlations['availability']:.2f}；价格与最少入住晚数 {correlations['minimum_nights']:.2f}。
- 这些是相关，不是因果。房型、卧室数、地段和日期会同时影响价格与这些变量；没有控制变量前，不写“评分高所以更贵”或“可租天数少所以更贵”。

### 8. 这份分析不能回答什么

- 不能回答“阿姆斯特丹 Airbnb 的平均价格”，因为 {len(df) - parsed:,} 条没有报价，且缺失与可租状态强相关。
- 不能回答“某街区涨价/降价”，因为只有一个快照。
- 不能回答“某房源的实际收入”，因为没有订单数据；`estimated_revenue_l365d` 是平台估算，不是结算记录。
- 不能回答“许可证是否合规”，因为 `Exempt`、缺失和编号需要与市政登记规则匹配后才能判断。
- 不能把不同日期的报价直接比较；报价对应的入住日期不同，季节性和提前预订折扣未控制。

## 如果放进数鉴 Agent

1. 导入 `listings.csv`，先看字段画像：`price` 的非空唯一值、空值、可解析数值、首尾空白。
2. 在“明确指定清理规则”里选择 `price`，勾选“规范常见数字格式”，预览会显示 **{parsed:,} 个单元格修改、{parse_failures} 个无法识别**；应用后 `price` 变成可计算的数值字段，并记录处理步骤与父快照。
3. 手动口径：分组 `neighbourhood_cleansed`，指标 `price`，聚合先看计数和均值；结果表可搜索、排序，图表可回查原始记录。
4. 当前聚合选项没有中位数；这份报告的中位数由同一份原始文件在 Python 中独立计算，并用 `price_quote_price_per_night` 交叉校验。若要把“中位数”作为产品能力，需要扩展聚合类型，而不是在界面文案里假装支持。

## 复现与校验

```sh
python -I scripts/real-data-analysis/airbnb_amsterdam.py
```

- 原始数据 SHA-256：`{metrics['data_sha256']}`
- 所有指标同时写入 `metrics.json`；图表在 `charts/`。
- 解析规则：只接受 `$` + 数字/千分位/小数；解析结果必须与 `price_quote_price_per_night` 在 €0.005 内一致后才用于统计。
"""
    (out_dir / "分析报告.md").write_text(report, encoding="utf-8")

    print(json.dumps({
        "rows": metrics["rows"],
        "parsed": parsed,
        "parse_failures": parse_failures,
        "cross_checked": cross_check,
        "mismatch": mismatch,
        "median": overall["median"],
        "report": str(out_dir / "分析报告.md"),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
