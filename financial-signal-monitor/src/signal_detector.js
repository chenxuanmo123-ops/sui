/**
 * 信号检测模块 - 多维度信号识别与推理
 * 支持: 价格异动、成交量放大、资金流向、技术指标(MACD金叉等)
 */

const fs = require('fs-extra');
const path = require('path');

const WORKSPACE_ROOT = 'c:\\Users\\asus\\WorkBuddy\\20260429203017\\financial-signal-monitor';
const SIGNALS_PATH = path.join(WORKSPACE_ROOT, 'config', 'signals.json');

/**
 * 读取信号配置
 */
function getSignalConfigs() {
  try {
    const data = fs.readJsonSync(SIGNALS_PATH);
    return data.signals.filter(s => s.enabled);
  } catch (err) {
    console.error('[信号检测] 读取信号配置失败:', err.message);
    return [];
  }
}

/**
 * 解析 westock kline 输出，提取结构化数据
 * @param {string} klineOutput - westock kline 命令输出
 * @returns {array} 结构化K线数据
 */
function parseKlineOutput(klineOutput) {
  try {
    // westock-data 输出格式: 日期 开盘 收盘 最高 最低 成交量 成交额
    const lines = klineOutput.trim().split('\n');
    const klines = [];
    
    for (const line of lines) {
      if (!line.trim() || line.startsWith('---')) continue;
      
      // 尝试解析CSV格式或表格格式
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 6) {
        klines.push({
          date: parts[0],
          open: parseFloat(parts[1]),
          close: parseFloat(parts[2]),
          high: parseFloat(parts[3]),
          low: parseFloat(parts[4]),
          volume: parseFloat(parts[5]),
          amount: parseFloat(parts[6]) || 0
        });
      }
    }
    
    return klines;
  } catch (err) {
    console.error('[信号检测] 解析K线数据失败:', err.message);
    return [];
  }
}

/**
 * 信号1: 价格异动检测
 * @param {object} stockData - 股票完整数据
 * @param {object} signalConfig - 信号配置
 * @returns {object|null} 触发的信号详情
 */
function detectPriceSurge(stockData, signalConfig) {
  const threshold = signalConfig.params.threshold_percent || 5.0;
  
  try {
    if (!stockData.data.westork?.kline) {
      return null;
    }
    
    const klines = parseKlineOutput(stockData.data.westork.kline);
    if (klines.length < 2) {
      return null;
    }
    
    const today = klines[klines.length - 1];
    const yesterday = klines[klines.length - 2];
    
    const changePercent = ((today.close - yesterday.close) / yesterday.close) * 100;
    
    if (Math.abs(changePercent) >= threshold) {
      return {
        signalId: 'price_surge',
        signalName: '价格异动',
        stock: stockData.stock,
        triggerTime: new Date().toISOString(),
        data: {
          todayClose: today.close,
          yesterdayClose: yesterday.close,
          changePercent: changePercent.toFixed(2),
          threshold: threshold,
          direction: changePercent > 0 ? '上涨' : '下跌'
        },
        severity: Math.abs(changePercent) >= 8 ? 'high' : 'medium',
        message: `${stockData.stock.name}(${stockData.stock.code}) ${changePercent > 0 ? '↑' : '↓'}${Math.abs(changePercent).toFixed(2)}%，超过阈值${threshold}%`
      };
    }
    
    return null;
  } catch (err) {
    console.error('[信号检测] 价格异动检测失败:', err.message);
    return null;
  }
}

/**
 * 信号2: 成交量放大检测
 * @param {object} stockData - 股票完整数据
 * @param {object} signalConfig - 信号配置
 * @returns {object|null} 触发的信号详情
 */
function detectVolumeSpike(stockData, signalConfig) {
  const multiple = signalConfig.params.multiple || 2.0;
  const lookbackDays = signalConfig.params.lookback_days || 5;
  
  try {
    if (!stockData.data.westork?.kline) {
      return null;
    }
    
    const klines = parseKlineOutput(stockData.data.westork.kline);
    if (klines.length < lookbackDays + 1) {
      return null;
    }
    
    const today = klines[klines.length - 1];
    const recentKlines = klines.slice(-lookbackDays - 1, -1);
    const avgVolume = recentKlines.reduce((sum, k) => sum + k.volume, 0) / recentKlines.length;
    
    const volumeRatio = today.volume / avgVolume;
    
    if (volumeRatio >= multiple) {
      return {
        signalId: 'volume_spike',
        signalName: '成交量放大',
        stock: stockData.stock,
        triggerTime: new Date().toISOString(),
        data: {
          todayVolume: today.volume,
          avgVolume: avgVolume.toFixed(0),
          volumeRatio: volumeRatio.toFixed(2),
          threshold: multiple
        },
        severity: volumeRatio >= 3 ? 'high' : 'medium',
        message: `${stockData.stock.name}(${stockData.stock.code}) 成交量 ${volumeRatio.toFixed(2)}x 放大 (均量:${avgVolume.toFixed(0)})`
      };
    }
    
    return null;
  } catch (err) {
    console.error('[信号检测] 成交量放大检测失败:', err.message);
    return null;
  }
}

/**
 * 信号3: 主力资金流入检测 (仅A股)
 * @param {object} stockData - 股票完整数据
 * @param {object} signalConfig - 信号配置
 * @returns {object|null} 触发的信号详情
 */
function detectFundInflow(stockData, signalConfig) {
  const minInflow = signalConfig.params.min_inflow_cny || 100000000;
  
  try {
    // 仅支持A股
    if (!stockData.stock.code.startsWith('sh') && !stockData.stock.code.startsWith('sz')) {
      return null;
    }
    
    if (!stockData.data.westork?.fundFlow) {
      return null;
    }
    
    // 解析资金流向数据 (简化处理，实际需解析 westock 输出)
    const fundOutput = stockData.data.westork.fundFlow;
    
    // TODO: 实际解析逻辑需要根据 westock-data 输出格式完善
    // 这里先做框架
    
    return null;  // 暂未实现完整解析
  } catch (err) {
    console.error('[信号检测] 资金流入检测失败:', err.message);
    return null;
  }
}

/**
 * 信号4: MACD金叉检测
 * @param {object} stockData - 股票完整数据
 * @param {object} signalConfig - 信号配置
 * @returns {object|null} 触发的信号详情
 */
function detectMACDCross(stockData, signalConfig) {
  try {
    if (!stockData.data.westork?.kline) {
      return null;
    }
    
    const klines = parseKlineOutput(stockData.data.westork.kline);
    if (klines.length < 26 + 9) {  // MACD需要至少35个数据点
      return null;
    }
    
    // 计算MACD (简化版)
    const closes = klines.map(k => k.close);
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const dif = ema12.map((val, idx) => val - ema26[idx]);
    const dea = calculateEMA(dif, 9);
    
    const todayDif = dif[dif.length - 1];
    const todayDea = dea[dea.length - 1];
    const yesterdayDif = dif[dif.length - 2];
    const yesterdayDea = dea[dea.length - 2];
    
    // 金叉: DIF上穿DEA (昨日DIF<DEA, 今日DIF>DEA)
    const isGoldenCross = (yesterdayDif < yesterdayDea) && (todayDif > todayDea);
    const isDeadCross = (yesterdayDif > yesterdayDea) && (todayDif < todayDea);
    
    if (isGoldenCross) {
      return {
        signalId: 'macd_golden_cross',
        signalName: 'MACD金叉',
        stock: stockData.stock,
        triggerTime: new Date().toISOString(),
        data: {
          dif: todayDif.toFixed(4),
          dea: todayDea.toFixed(4),
          macd: ((todayDif - todayDea) * 2).toFixed(4),
          crossType: 'golden'
        },
        severity: 'high',
        message: `${stockData.stock.name}(${stockData.stock.code}) MACD金叉 📈 DIF:${todayDif.toFixed(3)} DEA:${todayDea.toFixed(3)}`
      };
    }
    
    return null;
  } catch (err) {
    console.error('[信号检测] MACD金叉检测失败:', err.message);
    return null;
  }
}

/**
 * 计算EMA (指数移动平均)
 */
function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  const ema = [];
  
  // 第一个EMA值用SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  ema[period - 1] = sum / period;
  
  // 后续EMA值
  for (let i = period; i < prices.length; i++) {
    ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  
  return ema;
}

/**
 * 对单只股票运行所有启用的信号检测
 * @param {object} stockData - 股票完整数据
 * @returns {array} 触发的信号列表
 */
function detectSignals(stockData) {
  const signalConfigs = getSignalConfigs();
  const triggeredSignals = [];
  
  console.log(`[信号检测] 开始检测 ${stockData.stock.name}...`);
  
  for (const config of signalConfigs) {
    let result = null;
    
    switch (config.id) {
      case 'price_surge':
        result = detectPriceSurge(stockData, config);
        break;
      case 'volume_spike':
        result = detectVolumeSpike(stockData, config);
        break;
      case 'fund_inflow':
        result = detectFundInflow(stockData, config);
        break;
      case 'macd_golden_cross':
        result = detectMACDCross(stockData, config);
        break;
      default:
        console.warn(`[信号检测] 未知信号类型: ${config.id}`);
    }
    
    if (result) {
      triggeredSignals.push(result);
      console.log(`  ✓ 触发信号: ${result.signalName} - ${result.message}`);
    }
  }
  
  if (triggeredSignals.length === 0) {
    console.log(`  - 无触发信号`);
  }
  
  return triggeredSignals;
}

/**
 * 对所有采集的数据进行信号检测
 * @param {array} collectedData - collectAllData() 的返回结果
 * @returns {array} 所有触发的信号
 */
function runDetection(collectedData) {
  console.log(`\n[信号检测] ===== 开始信号检测 =====`);
  console.log(`[信号检测] 共 ${collectedData.length} 只股票待检测`);
  
  const allTriggeredSignals = [];
  
  for (const stockData of collectedData) {
    const signals = detectSignals(stockData);
    if (signals.length > 0) {
      allTriggeredSignals.push({
        stock: stockData.stock,
        signals: signals,
        detectTime: new Date().toISOString()
      });
    }
  }
  
  // 保存检测结果
  const resultPath = path.join(WORKSPACE_ROOT, 'logs', `signals_${formatDate()}.json`);
  fs.ensureDirSync(path.dirname(resultPath));
  fs.writeJsonSync(resultPath, {
    detectTime: new Date().toISOString(),
    totalStocks: collectedData.length,
    triggeredStocks: allTriggeredSignals.length,
    details: allTriggeredSignals
  }, { spaces: 2 });
  
  console.log(`[信号检测] ===== 检测完成 =====`);
  console.log(`[信号检测] 触发信号股票: ${allTriggeredSignals.length} / ${collectedData.length}`);
  console.log(`[信号检测] 结果已保存: ${resultPath}\n`);
  
  return allTriggeredSignals;
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = {
  getSignalConfigs,
  detectSignals,
  runDetection,
  detectPriceSurge,
  detectVolumeSpike,
  detectMACDCross
};
