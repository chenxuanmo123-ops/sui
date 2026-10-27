# 真实数据索引

本目录只收录有公开出处的真实数据，用于演示、复验和讲解。所有数字由数鉴在浏览器内对原文件真实计算，不含虚构业务数据、预置结论或模拟输出。

产品不会自动载入这些文件；演示时由用户手动上传。原始 CSV 与压缩包大多不提交仓库（体积、个人字段或再分发成本），下载命令和哈希见下。

## 1. 演示数据

| 编号 | 文件路径 | 规模 | 来源 | 许可 | SHA-256（本地已核对） |
| --- | --- | --- | --- | --- | --- |
| D1 | `tests/fixtures/owid-China-2015-2022.csv` | 375 B；8 行 × 5 列 | [OWID energy-data](https://github.com/owid/energy-data) 固定提交 `e7897aed`，筛选中国 2015–2022 | 见上游 README 与原提供方署名 | `6b0942ac…27e` |
| D2 | `tests/fixtures/uci-online-shoppers.csv` | 1.0 MB；12,330 行 × 18 列 | [UCI 468](https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset) | CC BY 4.0 | `b3055ee3…0d9` |
| D3 | `demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv` | 26 MB；10,612 行 × 90 列 | [Inside Airbnb 2026-09-16](https://insideairbnb.com/get-the-data/) | CC BY 4.0 | `d6eabb54…ffe` |
| D4 | `demo-data/bike-sharing-daily-labeled.csv` | 87 KB；731 行 × 21 列 | [UCI 275](https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset) Bike Sharing（日粒度），末尾追加 5 列 1:1 中文标签；UTF-8 **带 BOM** | CC BY 4.0 | `001cc081…fb0e` |

完整哈希与核验日期：

- D1 `6b0942ac9ab28308c2c7d65cd7044e5cc4c46efc438200d8857e254076c4e27e`，2026-10-15 逐单元格核对，详见 [owid-provenance.json](../tests/fixtures/owid-provenance.json)。
- D2 `b3055ee355f59134d851d32641183cb4a8b45def7124d2f50442a042f358e0d9`，2026-10-19 获取，详见 [uci-online-shoppers-source.md](../tests/fixtures/uci-online-shoppers-source.md)。
- D3 解压后 `d6eabb54c664de6d10ee5709e71e2cb194f093d1d9777518f654bf3e45444ffe`；压缩包 `6ea5cc10880db73c1a4988561a204766c8471a643d797ab041e183e5de053b11`，详见 [Airbnb 快照说明](airbnb-amsterdam-2026-09-16/README.md)。
- D4 `001cc081661765abb604bcaa06acf3e81f6d8aa748cfead9c19535031c67fb0e`（UTF-8 BOM 版本；去掉 BOM 后内容哈希为 `f8b30317bd72e57ef94692f2b7a2cd7ea943ec713fb7c81d67d5403eaa9ab18c`），2026-10-26 由官方压缩包解出；原始 `day.csv` `a6bcf826782d3c0fbfdcbeead17cd0884185a0dafe8ff10cd48a874ee7ba18be`，`hour.csv` `e03de4ee4ef4dc376ac6e04bf829673c6269e8eba5c60fa121640fa2f829504f`，压缩包 `b70182d0d0508e9abbb79306ce5c0cec34869000f8220175ac83d11dbe845401`。追加列只做官方字段的 1:1 标签映射，未改动任何原值；BOM 只影响 Excel 对 UTF-8 的识别，不改变单元格内容。

## 2. 各数据的演示角度

### D1：OWID 中国电力（8 年）

适合讲口径和统计边界，不适合外推。

- 按年求和/均值：8 个年度点，来源记录 8 条。
- 折线趋势：平均每年 +182.17 TWh，R² 0.988（描述性拟合，不是预测）。
- 散点：`renewables_electricity` × `solar_electricity`，Pearson r=0.9963，8 对有效值。
- 讲解重点：只有 8 年、单独一个国家；r 高不等于因果，也不能代表全球。

字段单位：`*_electricity` 为年度发电量 TWh，不是装机容量。原始说明见 [reference-energy-note.txt](../tests/fixtures/reference-energy-note.txt)（本项目编写的演示说明，不是外部资料）。

### D2：UCI 在线购物访问（12,330 行）

适合讲质量诊断、大样本相关和分类字段口径。

- 质量诊断：IQR 异常候选 961 条、整行后续重复候选 125 条；候选不等于错误，系统不自动删改。
- 散点：`PageValues` × `ProductRelated_Duration`，展示上限 20 时图中只画 20 条，但 r 仍按全部 12,330 对有效值计算。
- 转化率：`Revenue` 为 TRUE/FALSE；比例必须明确分子、分母取值集合，并排除未知值。
- 讲解重点：`Revenue` 是购买结果不是营收；`Month` 无年份；`TrafficType` 是编码，不翻译成广告来源。

### D3：Inside Airbnb 阿姆斯特丹（26 MB）

适合讲大文件导入、数值规范化、分组统计与缺失偏差。

- 导入 26 MB CSV，价格字段含 `$` 与千分位，规范化 6,039 个价格单元格。
- 按 `neighbourhood_cleansed` 分组，22 个街区，比较报价中位数与 P25/P75。
- 讲解重点：`price` 是抓取时针对具体日期的报价，不是成交价或全年均价；4,573 条无报价，缺失与可租天数相关，不能把有报价样本外推为全城均价；不做汇率换算。

下载与复验：

```sh
mkdir -p demo-data/airbnb-amsterdam-2026-09-16/data
curl -L -o demo-data/airbnb-amsterdam-2026-09-16/listings.csv.gz \
  https://data.insideairbnb.com/the-netherlands/north-holland/amsterdam/2026-09-16/data/listings.csv.gz
gzip -dc demo-data/airbnb-amsterdam-2026-09-16/listings.csv.gz \
  > demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv
sha256sum demo-data/airbnb-amsterdam-2026-09-16/listings.csv.gz \
  demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv
```

哈希不一致时不要继续使用本目录结论。

### D4：UCI 共享单车日租赁（731 天，2011–2012，华盛顿特区）

适合第一次体验：文件小、字段干净、问题直观，又能覆盖时间、分组、比例与相关。

- 规模：731 天，2011-01-01 至 2012-12-31，日期无重复；总租赁 3,292,679 次。
- 口径：`cnt` 是**租赁次数**，等于 `casual` 620,017 + `registered` 2,672,662，不是人数或车辆数。
- 分组：按 `season_name` 日均 春 2,604.13 / 夏 4,992.33 / 秋 5,644.30 / 冬 4,728.16 次。
- 对比：工作日日均 4,584.82 次（500 天），非工作日 4,330.17 次（231 天），日粒度差距不大；小时数据才有通勤双峰。
- 年度：2011 日均 3,405.76 次，2012 日均 5,599.93 次；系统扩张与站点增加同时发生，不能归因于单一措施。
- 讲解重点：`temp`、`atemp`、`hum`、`windspeed` 是官方归一化值（分别除以 41/50/100/67），不是摄氏度或百分比原值；`weathersit` 缺 4 级样本；分组差异是观察，不是因果。

文件：`demo-data/day.csv`、`demo-data/hour.csv` 是从 UCI 官方压缩包直接解出的原始文件（hour 17,379 行），字段说明见 `demo-data/Readme.txt`；`demo-data/bike-sharing-daily-labeled.csv` 只在官方 `day.csv` 末尾追加 5 个 1:1 中文标签列，并保存为 **UTF-8 with BOM**，以便中文 Windows 的 Excel 直接打开时不乱码。若不需要中文标签，请直接使用官方 `day.csv`。刷新官方文件：

```sh
mkdir -p demo-data/_download
curl -L -o demo-data/_download/bike.zip https://archive.ics.uci.edu/static/public/275/bike+sharing+dataset.zip
unzip -o demo-data/_download/bike.zip -d demo-data
```

## 3. 工程测试文件（不是演示样本）

| 文件 | 用途 |
| --- | --- |
| `tests/fixtures/messy-amounts.csv` | 货币符号、会计负数、百分号、全角字符等解析契约测试 |
| `tests/fixtures/country-region.csv` | SQL 控制台会话级 JOIN 的测试表 |
| `tests/fixtures/evaluation/` | 计划校验与证据绑定的评测输入 |
| `tests/fixtures/reference-note.pdf` / `reference-energy-note.txt` | 本地检索与引用编号的演示材料，由本项目编写，不是外部资料 |

这些文件只用于自动化测试或功能演示，不能当作业务样本，也不能据此宣称模型准确率。

## 4. 演示前自检

```sh
sha256sum tests/fixtures/owid-China-2015-2022.csv \
  tests/fixtures/uci-online-shoppers.csv \
  demo-data/airbnb-amsterdam-2026-09-16/data/listings.csv \
  demo-data/bike-sharing-daily-labeled.csv
```

四条输出应与第 1 节一致。演示脚本、评分点对应和答辩口径见 [演示与讲解手册](../docs/演示与讲解手册.md)；来源登记与报告引用规则见 [数据出处与引用说明](../docs/数据出处与引用说明.md)。
