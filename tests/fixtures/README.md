# 真实公开数据测试子集

此目录是工程测试输入，不会自动载入产品，也不是虚构业务演示。

owid-China-2015-2022.csv 来源为 Our World in Data energy-data；筛选中国2015—2022年的五列。2026-10-15从固定上游CSV再次逐项核对8行40个单元格，完全一致。固定commit、完整来源URL、筛选条件、fixture SHA-256见 [owid-provenance.json](owid-provenance.json)。源项目许可与原始提供方归属请查阅 [OWID原仓库说明](https://github.com/owid/energy-data/tree/e7897aed55b514b8d16e0a3d8f1518789ac3de31)。

核心单测直接读本文件；Excel、PDF、扫描PDF验收只在artifacts中保真转换格式。边界测试的错误文本与极端数字明确标为契约测试，不能称真实业务样本或模型准确率测评。
