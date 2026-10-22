import { createHash } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiUrl = 'https://api.stackexchange.com/2.3/questions?fromdate=1704067200&todate=1706745599&order=desc&sort=creation&tagged=data-analysis&site=stackoverflow&pagesize=100&page=1';
const expectedRows = 61;
const expectedQuestionIdsSha256 = '457afc79b38d000e8f422da8c41ebd6ca8032b2964881d099d8c37f716b021d2';
const update = process.argv.includes('--update');
const dir = resolve('tests/fixtures/evaluation/platform');
const fixturePath = resolve(dir, 'stackoverflow-data-analysis-2024-01.csv');
const provenancePath = resolve(dir, 'provenance.json');
const snapshotPath = resolve(dir, 'stackoverflow-api-selected-snapshot.json');

if (!update) {
  try {
    await access(fixturePath);
    throw new Error('Refusing to overwrite the pinned Stack Overflow fixture. Re-run with --update after reviewing the source and expected values.');
  } catch (error) {
    if (error?.message?.startsWith('Refusing')) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

const response = await fetch(apiUrl, { headers: { 'User-Agent': 'ShujianAgent/0.1 (AI Web competition evaluation)' } });
if (!response.ok) throw new Error(`Stack Exchange API request failed: HTTP ${response.status}`);
const payload = await response.json();
const items = payload.items || [];
const questionIdsSha256 = createHash('sha256').update(items.map(item => item.question_id).join(','), 'utf8').digest('hex');
if (payload.has_more !== false || items.length !== expectedRows || questionIdsSha256 !== expectedQuestionIdsSha256) {
  throw new Error(`Unexpected historical question set: rows=${items.length}, has_more=${payload.has_more}, ids=${questionIdsSha256}`);
}

const records = items.map(item => ({
  question_id: String(item.question_id),
  event_date: new Date(item.creation_date * 1000).toISOString().slice(0, 10),
  title: item.title,
  tags: item.tags.join('|'),
  is_answered: String(Boolean(item.is_answered)),
  content_license: item.content_license || '',
  link: item.link,
}));
const selectedSnapshot = Buffer.from(JSON.stringify({ items: items.map(item => ({
  question_id: item.question_id,
  creation_date: item.creation_date,
  title: item.title,
  tags: item.tags,
  is_answered: item.is_answered,
  content_license: item.content_license || '',
  link: item.link,
})) }, null, 2) + '\n', 'utf8');
const sourceSnapshotSha256 = createHash('sha256').update(selectedSnapshot).digest('hex');
const headers = ['question_id', 'event_date', 'title', 'tags', 'is_answered', 'content_license', 'link'];
const csvCell = value => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const csv = [headers.join(','), ...records.map(row => headers.map(key => csvCell(row[key])).join(','))].join('\n') + '\n';
const fixtureSha256 = createHash('sha256').update(csv, 'utf8').digest('hex');
const metadata = {
  title: 'Stack Overflow questions tagged data-analysis, January 2024',
  source: 'Stack Exchange API v2.3, Stack Overflow questions endpoint',
  sourceUrl: apiUrl,
  site: 'stackoverflow',
  queryWindow: { from: '2024-01-01T00:00:00Z', to: '2024-01-31T23:59:59Z' },
  selection: 'All 61 records on the first and only API page for the fixed tag/date query (has_more=false); ordered question IDs are pinned by SHA-256 to prevent silent fixture drift.',
  orderedQuestionIdsSha256: questionIdsSha256,
  sourceSnapshotSha256,
  sourceSnapshotBytes: selectedSnapshot.byteLength,
  sourceSnapshotFile: 'stackoverflow-api-selected-snapshot.json',
  sourceSnapshotDescription: 'Deterministically selected API fields only; this is not the complete API response. Owner/profile fields are intentionally excluded.',
  retrievedOn: new Date().toISOString().slice(0, 10),
  rows: records.length,
  fixtureSha256,
  notes: [
    'Each row is a public question-creation event, not a user, account, or platform-wide usage record.',
    'Tags describe the question metadata; they do not measure population preference or market share.',
    'The fixture is suitable for testing event counting, date grouping, tag presence, source linkage, and scope warnings.',
    'The API reports each post content_license; Stack Overflow content is generally CC BY-SA according to its licensing help. Retain source attribution and links; review license and attribution requirements before redistribution.',
    'This evaluation snapshot is not product seed data; public release or commercial redistribution requires a separate license and attribution review.',
  ],
};
await mkdir(dir, { recursive: true });
await writeFile(fixturePath, csv, 'utf8');
await writeFile(provenancePath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
await writeFile(snapshotPath, selectedSnapshot);
console.log(JSON.stringify({ rows: records.length, fixtureSha256, sourceSnapshotSha256, output: dir }, null, 2));
