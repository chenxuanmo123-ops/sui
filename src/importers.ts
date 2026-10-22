import type { Dataset, ImportOrigin, Row } from './data';

export type CellLine = { cells: string[]; positions?: number[]; sourceRow: number };
export type ImportTable = { name: string; lines: CellLine[]; warnings: string[]; page?: number; image?: string; method: string };
export type ImportDocument = { name: string; hash: string; format: 'XLSX' | 'XLS' | 'PDF'; tables: ImportTable[]; pageCount?: number; close?: () => void };

export async function fileHash(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function readWorkbook(file: File): Promise<ImportDocument> {
  const bytes = await file.arrayBuffer(), hash = await fileHash(bytes);
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: true, cellNF: true, dense: false, sheetRows: 100002 });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 50) throw new Error('工作簿需要 1—50 个工作表，请拆分后导入。');
  let totalCells = 0;
  const tables = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name], ref = sheet['!ref'];
    if (!ref) return { name, lines: [], warnings: ['空工作表'], method: 'Excel 单元格读取' };
    const range = XLSX.utils.decode_range(ref);
    const original = sheet['!fullref'] ? XLSX.utils.decode_range(sheet['!fullref']) : range;
    totalCells += (range.e.r + 1) * (range.e.c + 1);
    if (totalCells > 2000000) throw new Error('工作簿有效区域超过 200 万个单元格，请缩小范围后导入。');
    if (range.e.c > 199 || original.e.r > 100000) throw new Error('工作表超过 100,000 行或 200 列，请先拆分。');
    const warnings: string[] = [];
    if (sheet['!merges']?.length) warnings.push(`有 ${sheet['!merges'].length} 处合并单元格；只读取左上角值，不自动填充，请选择真正的表头和数据范围。`);
    if (sheet['!rows']?.some(r => r?.hidden)) warnings.push('包含隐藏行，导入仍包含选定范围中的隐藏行。');
    if (workbook.Workbook?.Sheets?.find(s => s.name === name)?.Hidden) warnings.push('这是隐藏工作表；不会自动忽略其中数据。');
    let formulas = 0, noCache = 0, errors = 0, percentages = 0;
    const lines: CellLine[] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const cells: string[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell?.f) { formulas++; if (cell.v === undefined) noCache++; }
        if (cell?.t === 'e') errors++;
        if (cell?.z?.includes('%')) percentages++;
        let value = '';
        if (cell?.v !== undefined && cell?.v !== null) {
          if (cell.t === 'e') value = cell.w || XLSX.utils.format_cell(cell) || `#ERROR(${cell.v})`;
          else if (cell.t === 'd' && cell.v instanceof Date) {
            const d = cell.v; value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (d.getHours() || d.getMinutes() || d.getSeconds()) value += `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
          } else if (cell.t === 'n') value = /(^|[^0])0{2,}/.test(cell.z || '') && !/[.#%]/.test(cell.z || '') ? (cell.w || String(cell.v)) : String(cell.v);
          else value = String(cell.v);
        }
        cells.push(value);
      }
      lines.push({ cells, sourceRow: r + 1 });
    }
    if (formulas) warnings.push(`${formulas} 个公式单元格采用文件保存的缓存值，本应用不重新计算公式。`);
    if (noCache) warnings.push(`${noCache} 个公式没有缓存值，将保持为空；请在 Excel 中重算并保存后再导入。`);
    if (percentages) warnings.push(`${percentages} 个百分比格式单元格保留底层比例值（例如 15% 为 0.15）；不自动放大或改单位，分析前请确认口径。`);
    if (errors) warnings.push(`${errors} 个 Excel 错误值将保留为文本，不能作为数值参与汇总。`);
    warnings.push('图片、图形和批注不作为表格数据；宏与外部链接不会执行。');
    return { name, lines, warnings, method: 'Excel 单元格读取' };
  });
  return { name: file.name, hash, format: file.name.toLowerCase().endsWith('.xls') ? 'XLS' : 'XLSX', tables };
}

let pdfModule: Promise<typeof import('pdfjs-dist')> | undefined;
async function getPDFModule() {
  if (!pdfModule) pdfModule = (async () => {
    const pdf = await import('pdfjs-dist');
    const { default: workerURL } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdf.GlobalWorkerOptions.workerSrc = workerURL;
    return pdf;
  })();
  return pdfModule;
}
export async function openPDF(file: File) {
  const buffer = await file.arrayBuffer(), hash = await fileHash(buffer), pdfjs = await getPDFModule();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  let pdf;
  try { pdf = await task.promise; } catch (error) { await task.destroy(); throw error; }
  if (pdf.numPages > 100) { await task.destroy(); throw new Error('当前支持最多 100 页 PDF，请拆分后导入。'); }
  return { name: file.name, hash, pdf, close: () => { void task.destroy(); } };
}
export type OpenPDF = Awaited<ReturnType<typeof openPDF>>;
export async function readPDFPage(document: OpenPDF, pageNumber: number): Promise<ImportTable> {
  const page = await document.pdf.getPage(pageNumber), content = await page.getTextContent();
  const items = content.items.filter((i): i is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in i && !!i.str.trim());
  const grouped: { y: number; items: typeof items }[] = [];
  for (const item of items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const y = item.transform[5];
    let line = grouped.find(l => Math.abs(l.y - y) <= Math.max(2, Math.abs(item.height) * 0.25));
    if (!line) { line = { y, items: [] }; grouped.push(line); }
    line.items.push(item);
  }
  const lines = grouped.map((line, i) => {
    const cells: string[] = [], positions: number[] = [];
    let lastEnd = -Infinity;
    for (const item of line.items.sort((a, b) => a.transform[4] - b.transform[4])) {
      const x = item.transform[4];
      if (cells.length && x - lastEnd <= Math.max(6, Math.abs(item.height) * 0.6)) cells[cells.length - 1] += ' ' + item.str.trim();
      else { cells.push(item.str.trim()); positions.push(x); }
      lastEnd = Math.max(lastEnd, x + item.width);
    }
    return { cells, positions, sourceRow: i + 1 };
  });
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(1.7, 1800 / base.width, 2400 / base.height) });
  const canvas = documentGlobal().createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const image = canvas.toDataURL('image/jpeg', 0.85); canvas.width = canvas.height = 1;
  return { name: `第 ${pageNumber} 页`, lines, page: pageNumber, image, warnings: ['PDF 没有可靠的电子表格结构，文字位置只生成表格候选。请核对列对齐、表头、单位和页脚；当前每次导入选中页的一张表。'], method: lines.length ? 'PDF 文字位置提取' : '无文字层，需视觉识别' };
}
function documentGlobal() { return window.document; }

// A structural suggestion only; importing still requires the user's confirmation.
// Reject title/metadata rows whose width cannot contain the following records.
export function suggestHeaderIndex(table: ImportTable): number {
  for (let index = 0; index < Math.min(50, table.lines.length - 1); index++) {
    try {
      prepareTable(table, index, Math.min(table.lines.length - 1, index + 20));
      return index;
    } catch { /* Try the next candidate without changing original cells. */ }
  }
  return Math.max(0, table.lines.findIndex(line => line.cells.filter(cell => cell.trim()).length >= 2));
}

export function prepareTable(table: ImportTable, headerIndex: number, lastIndex: number) {
  if (!Number.isInteger(headerIndex) || !Number.isInteger(lastIndex) || headerIndex < 0 || lastIndex >= table.lines.length || lastIndex <= headerIndex) throw new Error('请选择有效的表头与数据截止行，表头后至少保留一行数据。');
  const headerLine = table.lines[headerIndex];
  if (!headerLine) throw new Error('请选择有效表头行。');
  const headers = headerLine.cells.map(c => c.trim());
  // Drop trailing empty worksheet columns only; interior empties remain errors.
  while (headers.length && !headers.at(-1)) headers.pop();
  if (headers.length < 2 || headers.length > 200) throw new Error('表头需要 2—200 个字段。PDF 无法分列时，请使用视觉识别或调整表头。');
  if (headers.some(h => !h)) throw new Error('表头包含空字段，请修改表头行或补全列名。');
  if (new Set(headers).size !== headers.length) throw new Error('表头存在重复字段，请在预览中重命名。');
  const selected = table.lines.slice(headerIndex + 1, lastIndex + 1);
  const rows: Row[] = [], locations: string[] = [];
  for (const line of selected) {
    let cells = line.cells;
    if (!cells.some(c => c.trim())) continue;
    if (line.positions && headerLine.positions) {
      cells = headers.map(() => '');
      line.cells.forEach((v, i) => {
        const x = line.positions![i];
        let column = 0;
        for (let k = 1; k < headers.length; k++) if (x >= headerLine.positions![k] - 5) column = k;
        cells[column] += (cells[column] ? ' ' : '') + v;
      });
    }
    if (cells.slice(headers.length).some(c => c.trim())) throw new Error(`原第 ${line.sourceRow} 行有超出表头的数据，请调整表头或数据范围。`);
    rows.push(Object.fromEntries(headers.map((h, i) => [h, cells[i] === '' || cells[i] === undefined ? null : cells[i]])));
    locations.push(table.page ? `PDF 第 ${table.page} 页 · 提取行 ${line.sourceRow}` : `${table.name} · 第 ${line.sourceRow} 行`);
  }
  if (!rows.length) throw new Error('选定范围没有数据记录，请调整表头或末行。');
  if (rows.length > 100000) throw new Error('数据记录超过 100,000 行。');
  return { headers, rows, locations };
}
export async function datasetFromImport(document: ImportDocument, table: ImportTable, header: number, last: number): Promise<Dataset> {
  const { headers, rows, locations } = prepareTable(table, header, last);
  // Snapshot includes the extraction/mapping, so two tables in one file cannot share an analysis hash.
  const snapshot = JSON.stringify({ fileHash: document.hash, table: table.name, method: table.method, header, last, headers, rows });
  const hash = await fileHash(new TextEncoder().encode(snapshot).buffer);
  const origin: ImportOrigin = { format: document.format, fileHash: document.hash, sheet: table.page ? undefined : table.name, page: table.page, headerRow: table.lines[header].sourceRow, method: table.method, warnings: table.warnings, locations, reviewed: true, pageImage: table.image };
  return { title: `${document.name} · ${table.name}`, sourceUrl: '', headers, rows, fingerprint: hash, loadedAt: new Date().toISOString(), isPublic: false, origin };
}
