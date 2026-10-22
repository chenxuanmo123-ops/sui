import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cik = '0000320193';
const accession = '0000320193-23-000106';
const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
const update = process.argv.includes('--update');
const dir = resolve('tests/fixtures/evaluation/financial');
const fixturePath = resolve(dir, 'apple-sec-company-facts-fy2021-2023.csv');
const provenancePath = resolve(dir, 'provenance.json');
const responsePath = resolve(dir, 'apple-sec-company-facts-response.json');
const tags = [
  ['RevenueFromContractWithCustomerExcludingAssessedTax', 'revenue', 'flow'],
  ['NetIncomeLoss', 'net_income', 'flow'],
  ['OperatingIncomeLoss', 'operating_income', 'flow'],
  ['Assets', 'assets', 'stock'],
  ['CashAndCashEquivalentsAtCarryingValue', 'cash_and_cash_equivalents', 'stock'],
];
const expectedPeriods = {
  revenue: ['FY2021', 'FY2022', 'FY2023'],
  net_income: ['FY2021', 'FY2022', 'FY2023'],
  operating_income: ['FY2021', 'FY2022', 'FY2023'],
  assets: ['FY2022', 'FY2023'],
  cash_and_cash_equivalents: ['FY2022', 'FY2023'],
};

if (!update) {
  try {
    await access(fixturePath);
    throw new Error('Refusing to overwrite the pinned SEC fixture. Re-run with --update after reviewing the source and expected values.');
  } catch (error) {
    if (error?.message?.startsWith('Refusing')) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

const response = await fetch(url, { headers: { 'User-Agent': 'ShujianAgent/0.1 (AI Web competition evaluation)' } });
if (!response.ok) throw new Error(`SEC Company Facts request failed: HTTP ${response.status}`);
const rawResponse = Buffer.from(await response.arrayBuffer());
const sourceResponseSha256 = createHash('sha256').update(rawResponse).digest('hex');
const company = JSON.parse(rawResponse.toString('utf8'));
if (company.cik !== Number(cik) || company.entityName !== 'Apple Inc.') throw new Error('SEC response entity did not match expected CIK');

const records = [];
for (const [tag, metric, factType] of tags) {
  const fact = company.facts?.['us-gaap']?.[tag];
  if (!fact) throw new Error(`Expected us-gaap fact missing: ${tag}`);
  for (const [unit, entries] of Object.entries(fact.units || {})) {
    for (const item of entries) {
      if (item.accn !== accession || item.form !== '10-K' || unit !== 'USD' || ![2021, 2022, 2023].includes(item.fy)) continue;
      records.push({
        entity: company.entityName,
        cik,
        metric,
        fact_type: factType,
        tag,
        filing_fy: String(item.fy),
        filing_period: item.fp || '',
        period_label: ({ '2021-09-25': 'FY2021', '2022-09-24': 'FY2022', '2023-09-30': 'FY2023' })[item.end] || '',
        start: item.start || '',
        end: item.end,
        value: String(item.val),
        unit,
        form: item.form,
        filed: item.filed,
        accession,
        frame: item.frame || '',
      });
    }
  }
}
records.sort((a, b) => a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
const actualPeriods = Object.fromEntries(tags.map(([, metric]) => [metric, records.filter(row => row.metric === metric).map(row => row.period_label)]));
for (const [metric, periods] of Object.entries(expectedPeriods)) {
  const actual = actualPeriods[metric];
  if (actual.length !== periods.length || actual.some((period, index) => period !== periods[index])) {
    throw new Error(`SEC extraction mismatch for ${metric}: expected ${periods.join(', ')}, got ${actual.join(', ')}`);
  }
}
if (records.length !== 13 || records.some(r => !r.end || !r.period_label || !Number.isFinite(Number(r.value)))) {
  throw new Error(`SEC extraction looks incomplete (${records.length} records)`);
}
const headers = ["entity","cik","metric","fact_type","tag","filing_fy","filing_period","period_label","start","end","value","unit","form","filed","accession","frame"];
const csvCell = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const csv = [headers.join(','), ...records.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n') + '\n';
const hash = createHash('sha256').update(csv, 'utf8').digest('hex');
const metadata = {
  title: 'Apple Inc. SEC Company Facts, FY2021-FY2023 facts from FY2023 10-K',
  source: 'U.S. Securities and Exchange Commission, Company Facts API',
  sourceUrl: url,
  cik,
  accession,
  accessionUrl: `https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/`,
  retrievedAt: new Date().toISOString(),
  selection: 'Only us-gaap facts whose filing accession is 0000320193-23-000106, form 10-K, fiscal year 2021-2023, and one of the listed tags.',
  sourceResponseSha256,
  sourceResponseBytes: rawResponse.byteLength,
  sourceResponseFile: 'apple-sec-company-facts-response.json',
  metricTypes: { flow: 'Duration fact; the selected period is retained in start/end.', stock: 'Instant fact; end is the as-of date and start is empty.' },
  tags: Object.fromEntries(tags.map(([tag, metric, factType]) => [metric, { tag, factType }])),
  rows: records.length,
  fixtureSha256: hash,
  notes: [
    'Source values are copied without scaling or currency conversion.',
    'A company-facts response can contain the same economic period in multiple filings; this fixture selects one filing accession to avoid silently mixing contexts.',
    'The API filing fiscal-year fields are retained separately from the reported period label; Apple fiscal years do not equal calendar years.',
    'Stock facts such as assets and cash are point-in-time values and must not be summed across years.',
    'This fixture tests financial-data grain and computation, not investment advice or accounting interpretation.',
  ],
};
await mkdir(dir, { recursive: true });
await writeFile(fixturePath, csv, 'utf8');
await writeFile(provenancePath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
await writeFile(responsePath, rawResponse);
console.log(JSON.stringify({ rows: records.length, fixtureSha256: hash, sourceResponseSha256, output: dir }, null, 2));
