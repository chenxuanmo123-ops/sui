/**
 * 数据采集模块 - 双数据源协同
 * 数据源1: westock-data-skillhub (腾讯自选股行情接口)
 * 数据源2: neodata-financial-search (自然语言金融数据搜索)
 */

const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const WORKSPACE_ROOT = 'c:\\Users\\asus\\WorkBuddy\\20260429203017\\financial-signal-monitor';
const WATCHLIST_PATH = path.join(WORKSPACE_ROOT, 'config', 'watchlist.json');

/**
 * 读取监控列表
 */
function getWatchlist() {
  try {
    const data = fs.readJsonSync(WATCHLIST_PATH);
    return data.stocks.filter(s => s.enabled);
  } catch (err) {
    console.error('[数据采集] 读取监控列表失败:', err.message);
    return [];
  }
}

/**
 * 通过 westock-data 获取股票行情数据
 * @param {string} code - 股票代码 (如 sh600519)
 * @returns {object|null} 结构化行情数据
 */
function fetchWestockData(code) {
  try {
    console.log(`[数据采集] 正在从 westock-data 获取 ${code} 行情...`);
    
    // 获取日K线数据（最近10天）
    const klineCmd = `npx --yes westock-data-skillhub@latest kline ${code} day 10`;
    const klineOutput = execSync(klineCmd, { encoding: 'utf8', timeout: 30000 });
    
    // 获取资金流向（A股）
    let fundOutput = '';
    if (code.startsWith('sh') || code.startsWith('sz')) {
      const fundCmd = `npx --yes westock-data-skillhub@latest asfund ${code}`;
      fundOutput = execSync(fundCmd, { encoding: 'utf8', timeout: 30000 });
    }
    
    // 获取公司简况
    const profileCmd = `npx --yes westock-data-skillhub@latest profile ${code}`;
    const profileOutput = execSync(profileCmd, { encoding: 'utf8', timeout: 30000 });
    
    return {
      code,
      source: 'westock-data',
      kline: klineOutput,
      fundFlow: fundOutput,
      profile: profileOutput,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error(`[数据采集] westock-data 获取 ${code} 失败:`, err.message);
    return null;
  }
}

/**
 * 通过 neodata-financial-search 获取补充数据
 * @param {string} stockName - 股票名称
 * @returns {object|null} 补充数据
 */
function fetchNeoData(stockName) {
  try {
    console.log(`[数据采集] 正在从 neodata-financial-search 获取 ${stockName} 数据...`);
    
    // 这里需要通过 WorkBuddy 的 skill 调用机制
    // 由于是在 Node.js 环境中，我们记录调用意图，实际由 Agent 执行
    return {
      code: 'neodata-query',
      stockName,
      source: 'neodata-financial-search',
      query: `${stockName} 最新行情 资金流向 技术指标`,
      note: '此数据源需要通过 WorkBuddy Agent 调用 neodata-financial-search skill'
    };
  } catch (err) {
    console.error(`[数据采集] neodata 获取 ${stockName} 失败:`, err.message);
    return null;
  }
}

/**
 * 采集单只股票的完整数据（双数据源）
 * @param {object} stock - 股票配置对象 {code, name, market}
 * @returns {object} 完整数据结构
 */
function collectStockData(stock) {
  console.log(`\n[数据采集] ===== 开始采集 ${stock.name}(${stock.code}) =====`);
  
  // 数据源1: westock-data (主要数据源)
  const westockData = fetchWestockData(stock.code);
  
  // 数据源2: neodata-financial-search (补充数据源)
  const neoData = fetchNeoData(stock.name);
  
  const result = {
    stock: {
      code: stock.code,
      name: stock.name,
      market: stock.market
    },
    data: {
      westock: westockData,
      neodata: neoData
    },
    collectTime: new Date().toISOString(),
    status: westockData ? 'success' : 'partial'
  };
  
  console.log(`[数据采集] ===== ${stock.name} 采集完成 [${result.status}] =====\n`);
  return result;
}

/**
 * 采集所有监控股票的完整数据
 * @returns {array} 所有股票的采集结果
 */
function collectAllData() {
  const watchlist = getWatchlist();
  console.log(`[数据采集] 共监控 ${watchlist.length} 只股票`);
  
  const results = watchlist.map(stock => collectStockData(stock));
  
  // 保存原始数据到日志
  const logPath = path.join(WORKSPACE_ROOT, 'logs', `collect_${formatDate()}.json`);
  fs.ensureDirSync(path.dirname(logPath));
  fs.writeJsonSync(logPath, results, { spaces: 2 });
  console.log(`[数据采集] 原始数据已保存: ${logPath}`);
  
  return results;
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = {
  getWatchlist,
  fetchWestockData,
  fetchNeoData,
  collectStockData,
  collectAllData
};
