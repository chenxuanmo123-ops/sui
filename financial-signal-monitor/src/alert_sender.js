/**
 * 告警推送模块 - 多级告警分发
 * 推送渠道: 控制台输出 → 日志文件 → WorkBuddy通知 → 微信推送(待集成)
 */

const fs = require('fs-extra');
const path = require('path');

const WORKSPACE_ROOT = 'c:\\Users\\asus\\WorkBuddy\\20260429203017\\financial-signal-monitor';
const OUTPUTS_DIR = path.join(WORKSPACE_ROOT, 'outputs');

/**
 * 格式化告警消息（Markdown格式）
 * @param {object} signalData - 触发的信号数据
 * @returns {string} 格式化后的消息
 */
function formatAlertMessage(signalData) {
  const { stock, signals } = signalData;
  
  let message = `# 🔔 金融信号告警\n\n`;
  message += `**股票**: ${stock.name} (${stock.code})\n`;
  message += `**市场**: ${stock.market}\n`;
  message += `**检测时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;
  message += `## 触发信号 (${signals.length}个)\n\n`;
  
  for (const signal of signals) {
    const severityIcon = signal.severity === 'high' ? '🔴' : signal.severity === 'medium' ? '🟡' : '🟢';
    
    message += `### ${severityIcon} ${signal.signalName}\n`;
    message += `- **严重程度**: ${signal.severity === 'high' ? '高' : signal.severity === 'medium' ? '中' : '低'}\n`;
    message += `- **触发时间**: ${new Date(signal.triggerTime).toLocaleString('zh-CN')}\n`;
    message += `- **简述**: ${signal.message}\n\n`;
    
    // 详细数据
    if (signal.data) {
      message += `**详细数据**:\n`;
      for (const [key, value] of Object.entries(signal.data)) {
        message += `  - ${key}: ${value}\n`;
      }
      message += `\n`;
    }
  }
  
  message += `\n---\n*由 Financial Signal Monitor 自动生成*\n`;
  
  return message;
}

/**
 * 发送告警（多级推送）
 * @param {object} signalData - 触发的信号数据
 * @param {object} options - 推送选项
 */
function sendAlert(signalData, options = {}) {
  const {
    toConsole = true,
    toLogFile = true,
    toWorkBuddy = false,  // 待实现
    toWechat = false       // 待实现
  } = options;
  
  const message = formatAlertMessage(signalData);
  const results = {
    console: false,
    logFile: false,
    workbuddy: false,
    wechat: false
  };
  
  // 1. 控制台输出
  if (toConsole) {
    try {
      console.log('\n' + '='.repeat(60));
      console.log(message);
      console.log('='.repeat(60) + '\n');
      results.console = true;
    } catch (err) {
      console.error('[告警推送] 控制台输出失败:', err.message);
    }
  }
  
  // 2. 保存到日志文件
  if (toLogFile) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `alert_${signalData.stock.code}_${timestamp}.md`;
      const filePath = path.join(OUTPUTS_DIR, filename);
      
      fs.ensureDirSync(OUTPUTS_DIR);
      fs.writeFileSync(filePath, message, 'utf8');
      
      console.log(`[告警推送] 告警已保存: ${filePath}`);
      results.logFile = true;
    } catch (err) {
      console.error('[告警推送] 保存日志文件失败:', err.message);
    }
  }
  
  // 3. WorkBuddy 通知 (待实现)
  if (toWorkBuddy) {
    console.log('[告警推送] WorkBuddy通知: 待集成');
    // TODO: 调用 WorkBuddy API 发送通知
    results.workbuddy = false;
  }
  
  // 4. 微信推送 (待实现)
  if (toWechat) {
    console.log('[告警推送] 微信推送: 待集成');
    // TODO: 调用微信推送API
    results.wechat = false;
  }
  
  return results;
}

/**
 * 批量发送告警
 * @param {array} allTriggeredSignals - runDetection() 的返回结果
 * @param {object} options - 推送选项
 * @returns {object} 推送结果统计
 */
function sendBatchAlerts(allTriggeredSignals, options = {}) {
  if (!allTriggeredSignals || allTriggeredSignals.length === 0) {
    console.log('\n[告警推送] 无触发信号，无需推送');
    return { total: 0, sent: 0, failed: 0 };
  }
  
  console.log(`\n[告警推送] ===== 开始推送告警 =====`);
  console.log(`[告警推送] 共 ${allTriggeredSignals.length} 只股票触发信号`);
  
  let sentCount = 0;
  let failedCount = 0;
  
  for (const signalData of allTriggeredSignals) {
    try {
      const results = sendAlert(signalData, options);
      if (results.console || results.logFile) {
        sentCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      console.error(`[告警推送] 推送失败 (${signalData.stock.name}):`, err.message);
      failedCount++;
    }
  }
  
  console.log(`[告警推送] ===== 推送完成 =====`);
  console.log(`[告警推送] 成功: ${sentCount}, 失败: ${failedCount}`);
  
  return {
    total: allTriggeredSignals.length,
    sent: sentCount,
    failed: failedCount
  };
}

/**
 * 生成HTML格式告警报告（用于可视化展示）
 * @param {array} allTriggeredSignals - 触发的信号列表
 * @returns {string} HTML内容
 */
function generateHTMLReport(allTriggeredSignals) {
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>金融信号监控报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; background: #f5f5f5; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; margin-bottom: 30px; }
    .header h1 { margin: 0 0 10px 0; }
    .header p { margin: 0; opacity: 0.9; }
    .summary { display: flex; gap: 20px; margin-bottom: 30px; }
    .summary-card { flex: 1; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .summary-card h3 { margin: 0 0 10px 0; color: #666; font-size: 14px; }
    .summary-card .number { font-size: 32px; font-weight: bold; color: #333; }
    .signal-card { background: white; padding: 20px; margin-bottom: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .signal-card.high { border-left: 4px solid #f44336; }
    .signal-card.medium { border-left: 4px solid #ff9800; }
    .signal-card.low { border-left: 4px solid #4caf50; }
    .signal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .signal-name { font-size: 18px; font-weight: bold; }
    .severity-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; }
    .severity-badge.high { background: #ffebee; color: #c62828; }
    .severity-badge.medium { background: #fff3e0; color: #e65100; }
    .severity-badge.low { background: #e8f5e9; color: #2e7d32; }
    .signal-message { font-size: 16px; margin-bottom: 10px; }
    .signal-data { background: #f5f5f5; padding: 10px; border-radius: 4px; font-size: 13px; }
    .signal-data dt { font-weight: bold; margin-top: 5px; }
    .signal-data dd { margin-left: 20px; margin-bottom: 5px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔔 金融信号监控报告</h1>
    <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
  </div>
  
  <div class="summary">
    <div class="summary-card">
      <h3>监控股票</h3>
      <div class="number">3</div>
    </div>
    <div class="summary-card">
      <h3>触发信号</h3>
      <div class="number" style="color: #f44336;">${allTriggeredSignals.reduce((sum, s) => sum + s.signals.length, 0)}</div>
    </div>
    <div class="summary-card">
      <h3>涉及股票</h3>
      <div class="number" style="color: #ff9800;">${allTriggeredSignals.length}</div>
    </div>
  </div>
  
  <h2>信号详情</h2>
`;
  
  for (const signalData of allTriggeredSignals) {
    for (const signal of signalData.signals) {
      html += `
  <div class="signal-card ${signal.severity}">
    <div class="signal-header">
      <div>
        <div class="signal-name">${signal.signalName} - ${signalData.stock.name} (${signalData.stock.code})</div>
      </div>
      <span class="severity-badge ${signal.severity}">${signal.severity === 'high' ? '高' : signal.severity === 'medium' ? '中' : '低'}</span>
    </div>
    <div class="signal-message">${signal.message}</div>
    <div class="signal-data">
`;
      
      for (const [key, value] of Object.entries(signal.data)) {
        html += `      <dt>${key}</dt><dd>${value}</dd>\n`;
      }
      
      html += `    </div>
  </div>
`;
    }
  }
  
  html += `</body></html>`;
  
  return html;
}

/**
 * 保存HTML报告
 * @param {array} allTriggeredSignals - 触发的信号列表
 */
function saveHTMLReport(allTriggeredSignals) {
  try {
    const html = generateHTMLReport(allTriggeredSignals);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `report_${timestamp}.html`;
    const filePath = path.join(OUTPUTS_DIR, filename);
    
    fs.ensureDirSync(OUTPUTS_DIR);
    fs.writeFileSync(filePath, html, 'utf8');
    
    console.log(`[告警推送] HTML报告已生成: ${filePath}`);
    return filePath;
  } catch (err) {
    console.error('[告警推送] 生成HTML报告失败:', err.message);
    return null;
  }
}

module.exports = {
  formatAlertMessage,
  sendAlert,
  sendBatchAlerts,
  generateHTMLReport,
  saveHTMLReport
};
