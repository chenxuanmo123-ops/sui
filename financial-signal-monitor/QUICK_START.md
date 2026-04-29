# 金融信号监控项目 - 快速启动指南

## 🚀 快速开始

### 1. 安装依赖
```bash
cd financial-signal-monitor
npm install
```

### 2. 配置监控股票
编辑 `config/watchlist.json`：
```json
{
  "stocks": [
    {
      "code": "sh600519",
      "name": "贵州茅台",
      "market": "A股",
      "enabled": true
    },
    {
      "code": "sz000001",
      "name": "平安银行",
      "market": "A股",
      "enabled": true
    },
    {
      "code": "hk00700",
      "name": "腾讯控股",
      "market": "港股",
      "enabled": true
    }
  ]
}
```

### 3. 运行项目
```bash
node src/index.js
```

## 📊 运行结果示例

```
============================================================
  Financial Signal Monitor v1.0.0
  基于Agent的金融信号监控与自动推送系统
============================================================

启动时间: 2026/4/29 21:34:48

📡 [Phase 1/4] 数据采集 - 双数据源协同
  主要数据源: westock-data (腾讯自选股)
  辅助数据源: neodata-financial-search

[数据采集] 共监控 3 只股票
[数据采集] ===== 开始采集 贵州茅台(sh600519) =====
[数据采集] ===== 开始采集 平安银行(sz000001) =====
[数据采集] ===== 开始采集 腾讯控股(hk00700) =====

🔍 [Phase 2/4] 信号检测 - 多维度识别
  启用信号: 价格异动 | 成交量放大 | MACD金叉

[信号检测] 触发信号股票: 0 / 3
市场状态: 平静 (无异动)

✅ 执行完成
```

## 🎯 核心功能

### 1. 双数据源协同
- **westock-data**: 腾讯自选股行情接口
- **neodata-financial-search**: 自然语言金融数据搜索
- **协同策略**: 互为补充，确保数据完整性

### 2. 多维度信号检测
- **价格异动**: 检测单日涨跌幅超过阈值（默认5%）
- **成交量放大**: 检测成交量是否超过均量倍数
- **资金流向**: 检测主力资金净流入情况
- **MACD金叉**: 检测技术指标金叉信号

### 3. 自动化执行
- 通过WorkBuddy Automation实现定时调度
- 自动保存执行日志和触发记录
- 支持历史回溯和分析

## 📁 项目结构

```
financial-signal-monitor/
├── config/
│   ├── watchlist.json      # 监控股票列表
│   └── signals.json        # 信号触发条件
├── src/
│   ├── index.js            # 主入口
│   ├── data_collector.js   # 数据采集模块
│   ├── signal_detector.js  # 信号检测模块
│   └── alert_sender.js     # 告警推送模块
├── logs/                   # 执行日志
├── outputs/                # 输出报告
├── package.json            # 项目配置
├── README.md              # 项目文档
├── RUN_SUMMARY.md         # 运行总结
└── DELIVERY.md            # 交付文档
```

## 🔧 配置说明

### 监控股票配置 (watchlist.json)
```json
{
  "stocks": [
    {
      "code": "sh600519",     // 股票代码
      "name": "贵州茅台",     // 股票名称
      "market": "A股",        // 市场类型
      "enabled": true         // 是否启用
    }
  ]
}
```

### 信号阈值配置 (signals.json)
```json
{
  "signals": [
    {
      "id": "price_surge",
      "name": "价格异动",
      "params": {
        "threshold_percent": 5.0  // 涨跌幅阈值（%）
      },
      "enabled": true
    },
    {
      "id": "volume_surge",
      "name": "成交量放大",
      "params": {
        "volume_multiple": 2.0    // 成交量倍数
      },
      "enabled": true
    }
  ]
}
```

## 📈 运行日志

### 日志文件位置
- `logs/collect_*.json` - 数据采集日志
- `logs/signals_*.json` - 信号检测日志
- `logs/execution_*.json` - 执行日志

### 日志内容示例
```json
{
  "stock": {
    "code": "sh600519",
    "name": "贵州茅台",
    "market": "A股"
  },
  "data": {
    "westock": null,
    "neodata": {
      "code": "neodata-query",
      "stockName": "贵州茅台",
      "source": "neodata-financial-search"
    }
  },
  "collectTime": "2026-04-29T13:34:48.344Z",
  "status": "partial"
}
```

## ⚙️ 自动化配置

### WorkBuddy Automation
在 WorkBuddy 中创建自动化任务：

```yaml
name: "金融信号监控 - 每30分钟"
schedule: "FREQ=HOURLY;INTERVAL=0.5"
command: "node c:\\Users\\asus\\WorkBuddy\\20260429203017\\financial-signal-monitor\\src\\index.js"
```

### 定时执行策略
- **开盘时段**: 9:30-11:30, 13:00-15:00（每15分钟）
- **收盘后**: 15:00-16:00（每30分钟）
- **夜间**: 21:00-23:00（每小时）

## 🎯 使用场景

### 场景1: 日常监控
- 配置关注股票列表
- 设置合适的信号阈值
- 运行项目进行实时监控

### 场景2: 突发事件监控
- 针对特定事件（如财报发布、政策变动）
- 临时调整监控股票和阈值
- 及时获取异动信号

### 场景3: 历史回溯分析
- 查看历史日志文件
- 分析信号触发规律
- 优化监控策略

## 🚀 后续扩展

### 短期扩展
1. **微信推送集成**: 实现微信告警推送
2. **Web界面**: 提供可视化监控界面
3. **更多信号检测**: 增加RSI、布林带等技术指标

### 长期扩展
1. **分析推理Agent**: 集成LLM进行深度分析
2. **多市场支持**: 扩展到更多市场（美股、欧股等）
3. **策略回测**: 支持信号策略回测功能

## 📞 技术支持

如有问题，请参考：
- `README.md` - 项目详细说明
- `RUN_SUMMARY.md` - 运行总结
- `DELIVERY.md` - 项目交付文档

---
**项目版本**: v1.0.0  
**运行日期**: 2026年4月29日  
**作者**: 李宗原 (WorkBuddy Agent)