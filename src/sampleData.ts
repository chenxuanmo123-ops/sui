// Bundled copy of one real public dataset, used only as an instant demo.
//
// The file is a byte-for-byte copy of the UCI Bike Sharing `day.csv` already
// cited under docs/real-demo/. It ships with the app so a first-time visitor
// can try the workflow without finding a file or reaching GitHub raw, which is
// often blocked. Loading still verifies the pinned SHA-256 below and computes
// everything locally; the copy never becomes an argument for a result.
export const SAMPLE_DATA_PATH = 'demo/uci-bike-sharing-day.csv'
export const SAMPLE_DATA_SHA256 = 'a6bcf826782d3c0fbfdcbeead17cd0884185a0dafe8ff10cd48a874ee7ba18be'
export const SAMPLE_TITLE = 'UCI Bike Sharing · day.csv'
export const SAMPLE_SOURCE_URL = 'https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset'
export const SAMPLE_DESCRIPTION = '731 天、16 字段，2011-01-01–2012-12-31（UCI 公开数据，随应用附带副本）'
