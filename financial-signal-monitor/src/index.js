/**
 * Financial Signal Monitor - 主入口
 * 核心流程: 数据采集 → 信号检测 → 告警推送 → 报告生成
 */

const dataCollector = require('./data_collector');
const signalDetector = require('./signal_detector');
const alertSender = require('./alert_sender');
const fs = require('fs-extra');
const path = require('path');

const WORKSPACE_ROOT = 'c:\\Users\\asus\\WorkBuddy\\20260429203017\\financial-signal-monitor';

/**
 * 主执行函数 - 完整的监控链路
 */
async function main() {
  console.log('='.repeat(60));
  console.log('  Financial Signal Monitor v1.0.0');
  console.log('  基于Agent的金融信号监控与自动推送系统');
  console.log('='.repeat(60));
  console.log(`\n启动时间: ${new Date().toLocaleString('zh-CN')}\n`);
  
  try {
    // ========== Phase 1: 数据采集 ==========
    console.log('📡 [Phase 1/4] 数据采集 - 双数据源协同');
    console.log('  主要数据源: westock-data (腾讯自选股)');
    console.log('  辅助数据源: neodata-financial-search\n');
    
    const collectedData = dataCollector.collectAllData();
    
    if (!collectedData || collectedData.length === 0) {
      console.error('\n❌ 数据采集失败: 无可用数据');
      process.exit(1);
    }
    
    console.log(`✅ Phase 1 完成: 采集了 ${collectedData.length} 只股票的数据\n`);
    
    // ========== Phase 2: 信号检测 ==========
    console.log('🔍 [Phase 2/4] 信号检测 - 多维度识别');
    console.log('  启用信号: 价格异动 | 成交量放大 | MACD金叉\n');
    
    const triggeredSignals = signalDetector.runDetection(collectedData);
    
    console.log(`✅ Phase 2 完成: 触发信号的股票 ${triggeredSignals.length} 只\n`);
    
    // ========== Phase 3: 告警推送 ==========
    console.log('📢 [Phase 3/4] 告警推送 - 多级分发');
    
    if (triggeredSignals.length > 0) {
      const pushResults = alertSender.sendBatchAlerts(triggeredSignals, {
        toConsole: true,
        toLogFile: true,
        toWorkBuddy: false,  // 待集成
        toWechat: false       // 待集成
      });
      
      console.log(`✅ Phase 3 完成: 推送成功 ${pushResults.sent} 条\n`);
    } else {
      console.log('  无触发信号，跳过推送\n');
      console.log('✅ Phase 3 完成: 无需推送\n');
    }
    
    // ========== Phase 4: 报告生成 ==========
    console.log('📊 [Phase 4/4] 报告生成 - HTML可视化');
    
    if (triggeredSignals.length > 0) {
      const reportPath = alertSender.saveHTMLReport(triggeredSignals);
      if (reportPath) {
        console.log(`✅ Phase 4 完成: 报告已生成 ${reportPath}\n`);
      } else {
        console.log(`⚠️  Phase 4 完成: 报告生成失败\n`);
      }
    } else {
      console.log('  无触发信号，跳过报告生成\n');
      console.log('✅ Phase 4 完成: 无需生成报告\n');
    }
    
    // ========== 执行摘要 ==========
    printSummary(collectedData, triggeredSignals);
    
    // 保存执行日志
    saveExecutionLog(collectedData, triggeredSignals);
    
  } catch (err) {
    console.error('\n❌ 执行失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

/**
 * 打印执行摘要
 */
function printSummary(collectedData, triggeredSignals) {
  console.log('='.repeat(60));
  console.log('  📋 执行摘要');
  console.log('='.repeat(60));
  
  console.log(`\n  • 监控股票数: ${collectedData.length}`);
  console.log(`  • 数据采集: ✅ 成功`);
  console.log(`  • 触发信号股票: ${triggeredSignals.length}`);
  
  if (triggeredSignals.length > 0) {
    const totalSignals = triggeredSignals.reduce((sum, s) => sum + s.signals.length, 0);
    console.log(`  • 触发信号总数: ${totalSignals}`);
    
    const highSeverity = triggeredSignals.reduce((sum, s) => 
      sum + s.signals.filter(sig => sig.severity === 'high').length, 0);
    console.log(`  • 高严重度信号: ${highSeverity}`);
  } else {
    console.log(`  • 触发信号总数: 0`);
    console.log(`  • 市场状态: 平静 (无异动)`);
  }
  
  console.log(`\n  • 完成时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log(`  • 状态: ✅ 成功\n`);
}

/**
 * 保存执行日志
 */
function saveExecutionLog(collectedData, triggeredSignals) {
  try {
    const log = {
      executionTime: new Date().toISOString(),
      summary: {
        totalStocks: collectedData.length,
        triggeredStocks: triggeredSignals.length,
        totalSignals: triggeredSignals.reduce((sum, s) => sum + s.signals.length, 0)
      },
      collectedData: collectedData.map(d => ({
        stock: d.stock,
        status: d.status
      })),
      triggeredSignals: triggeredSignals.map(s => ({
        stock: s.stock,
        signalNames: s.signals.map(sig => sig.signalName),
        severity: s.signals.map(sig => sig.severity)
      }))
    };
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(WORKSPACE_ROOT, 'logs', `execution_${timestamp}.json`);
    
    fs.ensureDirSync(path.dirname(logPath));
    fs.writeJsonSync(logPath, log, { spaces: 2 });
    
    console.log(`📝 执行日志已保存: ${logPath}`);
  } catch (err) {
    console.error('保存执行日志失败:', err.message);
  }
}

// 如果是直接执行（非模块引用），则运行主函数
if (require.main === module) {
  main();
}

module.exports = {
  main,
  printSummary,
  saveExecutionLog
};
