# Inside Airbnb — 阿姆斯特丹 2026-09-16 快照

这份目录是一份**真实公开数据**的独立分析样例，用来验证数鉴 Agent 在真实大文件上的导入、数字规范化、字段画像和分组统计，不是产品内置数据，也不是模拟结果。

## 数据来源与许可

| 项目 | 内容 |
| --- | --- |
| 数据集 | Inside Airbnb — Amsterdam, Netherlands |
| 快照日期 | 2026-09-16 |
| 发布方 | Inside Airbnb（<https://insideairbnb.com/get-the-data/>） |
| 许可 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 原始文件 | `listings.csv.gz`，解压后 `listings.csv`，10,612 行 × 90 列 |
| 下载地址 | <https://data.insideairbnb.com/the-netherlands/north-holland/amsterdam/2026-09-16/data/listings.csv.gz> |
| 下载日期 | 2026-10-23 |
| 压缩包 SHA-256 | `6ea5cc10880db73c1a4988561a204766c8471a643d797ab041e183e5de053b11` |
| 解压后 SHA-256 | `d6eabb54c664de6d10ee5709e71e2cb194f093d1d9777518f654bf3e45444ffe` |

使用时请保留上述署名与许可说明。数据由 Inside Airbnb 抓取，数鉴 Agent 项目与 Airbnb、Inside Airbnb 均无隶属关系。

## 目录内容

| 路径 | 说明 | 是否入库 |
| --- | --- | --- |
| `listings.csv.gz` | 官方原始压缩包，保持字节不变 | 否（体积大，可按下方命令重新下载） |
| `data/listings.csv` | 解压后的原始 CSV，分析输入 | 否（26 MB，且含房东姓名等字段） |
| `分析报告.md` | 分析过程、结论、局限与复现说明 | 是 |
| `metrics.json` | 报告中全部指标的机器可读版本 | 是 |
| `charts/*.png` | 由 `scripts/real-data-analysis/airbnb_amsterdam.py` 生成 | 是 |
| `screenshots/*.png` | 真实浏览器导入 26 MB CSV 后的界面截图 | 是 |

仓库不提交原始 CSV：它体积较大，并包含 `host_name`、`host_id` 等发布方已公开但不必在代码仓库中再分发一次的个人相关字段。按下面的步骤可在本地完整复现。

## 重新下载与校验

在仓库根目录执行：

```sh
mkdir -p demo-data/airbnb-amsterdam-2026-09-16/data
curl -L -o demo-data/airbnb-amsterdam-2026-09-16/listings.csv.gz \
  https://data.insideairbnb.com/the-netherlands/north-holland/amsterdam/2026-09-16/data/listings.csv.gz
gzip -dc demo-data/airbnb-amsterdam-2026-09-16/listings.csv.gz \
  > demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv
sha256sum demo-data/airbnb-amsterdam-2026-09-16/listings.csv.gz \
  demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv
```

两个哈希应分别与上表一致；不一致说明文件已被更新或下载不完整，不要继续沿用本目录的结论。

## 重新生成报告与图表

```sh
python -I scripts/real-data-analysis/airbnb_amsterdam.py
```

脚本会重新读取 `data/listings.csv`，交叉校验价格字段，写出 `metrics.json`、`charts/` 和 `分析报告.md`。脚本不访问网络。

## 在真实界面中复验

先启动开发服务器（`npm run dev`），再执行：

```sh
python tests/numeric-cleaning-browser.py
python scripts/real-data-analysis/ui-check.py
```

- `numeric-cleaning-browser.py` 用 `tests/fixtures/messy-amounts.csv` 验证货币符号、会计负数、百分号、全角字符与无法识别值的处理路径。
- `ui-check.py` 导入这份 26 MB CSV，验证 6,039 个价格单元格规范化、字段画像和 22 个街区分组，并生成 `screenshots/`。

## 口径提醒

- `price` 是抓取时针对具体入住日期生成的**报价**，不是全年成交价，也不是房源标价。
- 列中的 `$` 只是符号；`price_quote_raw.currency` 为 **EUR**，报告按欧元展示，不做汇率换算。
- 4,573 条房源没有报价，且缺失与可租天数强相关，因此报告不把有报价样本外推为“阿姆斯特丹整体均价”。
- 本目录只做一个时间快照的描述性分析，不包含趋势、因果或实际收入结论。
