import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, FileSpreadsheet, FileText, LoaderCircle, ScanLine, X } from 'lucide-react';
import { datasetFromImport, openPDF, prepareTable, suggestHeaderIndex, readPDFPage, readWorkbook } from './importers';
import type { ImportDocument, ImportTable, OpenPDF } from './importers';
import { aiRequest } from './ai';
import { modelRequest } from './models';
import type { ModelProfile } from './models';
import type { Dataset } from './data';
type Props = { file: File; models: ModelProfile[]; selected?: ModelProfile; onSelect: (id: string) => void; onConfigure: () => void; onClose: () => void; onImport: (dataset: Dataset) => void };
export default function ImportDialog({ file, models, selected, onSelect, onConfigure, onClose, onImport }: Props) {
  const ref = useRef<HTMLDialogElement>(null), pdf = useRef<OpenPDF | null>(null), version = useRef(0), operation = useRef<AbortController | null>(null);
  const [doc, setDoc] = useState<ImportDocument | null>(null), [tableIndex, setTableIndex] = useState(0), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [busy, setBusy] = useState('正在读取文件结构'), [error, setError] = useState(''), [header, setHeader] = useState(0), [last, setLast] = useState(0), [confirmed, setConfirmed] = useState(false), [visionConsent, setVisionConsent] = useState(false);
  const table = doc?.tables[tableIndex];
  const preview = useMemo(() => {
    if (!table) return { parsed: null, error: '' };
    try { return { parsed: prepareTable(table, header, last), error: '' }; } catch (e) { return { parsed: null, error: (e as Error).message }; }
  }, [table, header, last]);
  function resetRange(next: ImportTable) { setHeader(suggestHeaderIndex(next)); setLast(Math.max(0, next.lines.length - 1)); setConfirmed(false); }
  useEffect(() => {
    ref.current?.showModal(); let disposed = false;
    void (async () => {
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error('文件超过 30 MB，请先拆分。');
        if (/\.pdf$/i.test(file.name)) {
          const opened = await openPDF(file);
          if (disposed) return opened.close();
          pdf.current = opened; setPages(opened.pdf.numPages);
          const t = await readPDFPage(opened, 1); if (disposed) return;
          setDoc({ name: opened.name, hash: opened.hash, format: 'PDF', pageCount: opened.pdf.numPages, tables: [t] }); resetRange(t);
        } else {
          const workbook = await readWorkbook(file); if (disposed) return;
          setDoc(workbook); resetRange(workbook.tables[0]);
        }
      } catch (e) { if (!disposed) setError((e as Error).message); }
      finally { if (!disposed) setBusy(''); }
    })();
    return () => { disposed = true; version.current++; operation.current?.abort(); pdf.current?.close(); pdf.current = null; };
  }, [file]);
  useEffect(() => {
    setVisionConsent(false);
    if (!operation.current) return;
    version.current++; operation.current.abort(); operation.current = null;
    setBusy(''); setConfirmed(false); setError('识别模型已更改，上一次请求已取消，请重新授权。');
  }, [selected?.id, selected?.revision]);
  async function changePage(next: number) {
    if (!pdf.current || busy) return;
    const current = ++version.current; operation.current?.abort(); setBusy('正在提取页面文字与原图'); setError(''); setConfirmed(false); setVisionConsent(false);
    try {
      const t = await readPDFPage(pdf.current, next); if (version.current !== current) return;
      setDoc(old => old ? { ...old, tables: [t] } : null); setPage(next); setTableIndex(0); resetRange(t);
    } catch (e) { if (version.current === current) setError((e as Error).message); }
    finally { if (version.current === current) setBusy(''); }
  }
  async function vision() {
    if (!table?.image || !selected || !visionConsent) return;
    const current = ++version.current, c = new AbortController(); operation.current = c;
    setBusy('正在通过图像模型转录当前页'); setError(''); setConfirmed(false);
    try {
      const response = await aiRequest<{ extraction: { columns: string[]; rows: string[][]; warnings: string[] }; model: string }>('extract-document', { ...modelRequest(selected), consent: true, page, image: table.image }, c.signal);
      if (version.current !== current) return;
      const t: ImportTable = { ...table, lines: [response.extraction.columns, ...response.extraction.rows].map((cells, i) => ({ cells, sourceRow: i + 1 })), method: `视觉转录 · ${response.model}`, warnings: ['视觉转录可能误读数字和表格结构；请逐项对照左侧原页，不代表已验证准确。', ...response.extraction.warnings] };
      setDoc(old => old ? { ...old, tables: [t] } : null); resetRange(t);
    } catch (e) { if (version.current === current && !c.signal.aborted) setError((e as Error).message); }
    finally { if (version.current === current) { setBusy(''); operation.current = null; } }
  }
  function editCell(row: number, col: number, value: string) {
    setDoc(old => old ? { ...old, tables: old.tables.map((t, i) => i !== tableIndex ? t : { ...t, method: t.method.includes('人工修订') ? t.method : t.method + ' + 人工修订', lines: t.lines.map((l, j) => j !== row ? l : { ...l, cells: l.cells.map((c, k) => k === col ? value : c) }) }) } : null); setConfirmed(false);
  }
  async function commit() {
    if (!doc || !table || !confirmed || !preview.parsed) return;
    const current = ++version.current; setBusy('正在建立数据快照与来源索引'); setError('');
    try { const ds = await datasetFromImport(doc, table, header, last); if (version.current === current) onImport(ds); }
    catch (e) { if (version.current === current) setError((e as Error).message); }
    finally { if (version.current === current) setBusy(''); }
  }
  const isPDF = doc?.format === 'PDF' || /\.pdf$/i.test(file.name);
  const linesToShow = table ? Array.from(new Set([header, ...Array.from({ length: Math.min(table.lines.length, 50) }, (_, i) => i)])).sort((a, b) => a - b) : [];
  return <dialog ref={ref} className="import-dialog" aria-labelledby="import-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="import-header"><div className="import-heading-icon">{isPDF ? <FileText size={22} /> : <FileSpreadsheet size={22} />}</div><div><h2 id="import-title">导入预览与核对</h2><p title={file.name}>{file.name} · {(file.size / 1024).toFixed(1)} KB</p></div><button className="icon-button" aria-label="关闭导入预览" onClick={onClose}><X size={20} /></button></header>
    <div className="import-stepper"><span><Check size={14} />读取文件</span><ArrowRight size={14} /><strong>核对表格结构</strong><ArrowRight size={14} /><span>进入分析</span></div>
    <div className="import-body">
      {error && <div className="import-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
      {busy && <div className="import-progress" role="status"><LoaderCircle className="spin" size={18} />{busy}…</div>}
      {doc && table && <>
        <div className="import-controls">
          {isPDF ? <label>PDF 页面<select id="import-page" value={page} disabled={!!busy} onChange={e => void changePage(Number(e.target.value))}>{Array.from({ length: pages }, (_, i) => <option key={i} value={i + 1}>第 {i + 1} 页 / 共 {pages} 页</option>)}</select></label> : <label>工作表<select id="import-sheet" value={tableIndex} disabled={!!busy} onChange={e => { const i = Number(e.target.value); setTableIndex(i); resetRange(doc.tables[i]); setError(''); }}>{doc.tables.map((t, i) => <option key={i} value={i}>{t.name} · {t.lines.length} 行</option>)}</select></label>}
          <label>表头所在行<input id="import-header-row" type="number" min={1} max={table.lines.length || 1} value={header + 1} disabled={!!busy} onChange={e => { setHeader(Math.max(0, Number(e.target.value) - 1)); setConfirmed(false); }} /></label>
          <label>数据截止行<input id="import-last-row" type="number" min={header + 2} max={table.lines.length || 1} value={last + 1} disabled={!!busy} onChange={e => { setLast(Math.max(0, Number(e.target.value) - 1)); setConfirmed(false); }} /></label>
          <div className="import-method"><span>读取方式</span><strong>{table.method}</strong></div>
        </div>
        <div className={'import-preview-grid' + (isPDF ? ' has-document' : '')}>
          {isPDF && table.image && <section className="document-page"><h3>原始页面 <span>请对照核对</span></h3><img src={table.image} alt={`上传 PDF 的第 ${page} 页原始内容`} /></section>}
          <section className="import-table-area"><div className="import-table-title"><h3>提取内容</h3><span>{table.lines.length} 行 · 预览前 50 行</span></div>
            {table.lines.length ? <div className="import-table-scroll"><table><thead><tr><th>原行</th><th>内容（点击可修订）</th></tr></thead><tbody>{linesToShow.map(i => <tr key={i} className={i === header ? 'chosen-header' : i < header || i > last ? 'excluded-row' : ''}><th><button title="用作表头" onClick={() => { setHeader(i); setConfirmed(false); }}>{table.lines[i].sourceRow}{i === header && <small>表头</small>}</button></th><td><div className="import-cell-row">{table.lines[i].cells.map((c, k) => <input key={k} value={c} aria-label={`第${i + 1}行第${k + 1}列`} disabled={!!busy} onChange={e => editCell(i, k, e.target.value)} />)}</div></td></tr>)}</tbody></table></div> : <div className="no-text"><ScanLine size={32} /><h3>这页没有可提取的文字层</h3><p>可能是扫描件或图片。可使用下方视觉模型识别，再对照原页确认。</p></div>}
            {preview.error ? <p className="import-validation" role="status">{preview.error}</p> : <p className="import-valid"><Check size={14} />待导入 {preview.parsed?.rows.length.toLocaleString()} 条记录、{preview.parsed?.headers.length} 个字段</p>}
          </section>
        </div>
        {isPDF && <section className="vision-panel"><div><ScanLine size={19} /><h3>视觉模型识别当前页</h3><span>用于扫描件、复杂表格或文字分列不佳</span></div><div className="vision-controls"><label className="sr-only" htmlFor="vision-model">视觉识别模型</label><select id="vision-model" value={selected?.id || ''} onChange={e => onSelect(e.target.value)} disabled={!!busy}><option value="" disabled>选择支持图片输入的模型</option>{models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.model}</option>)}</select><button className="secondary" onClick={onConfigure}>配置模型</button><button className="primary" onClick={() => void vision()} disabled={!!busy || !selected || !visionConsent || !table.image}><ScanLine size={16} />识别当前页</button></div><label className="ai-check"><input type="checkbox" checked={visionConsent} disabled={!!busy} onChange={e => setVisionConsent(e.target.checked)} />授权将当前页原图发送给所选模型（可能产生接口费用）</label><p>需要接口支持图像输入。识别结果只作为候选，不自动进入计算；失败会保留文字提取内容。</p></section>}
        <details className="import-warnings" open><summary><AlertTriangle size={15} />需要检查的导入事项（{table.warnings.length}）</summary><ul>{table.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
      </>}
    </div>
    <footer className="import-footer"><label className="ai-check"><input id="confirm-import" type="checkbox" disabled={!!busy || !preview.parsed} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对表头、范围、列对齐与数值；导入选定表格</label><div><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={!!busy || !confirmed || !preview.parsed} onClick={() => void commit()}><ArrowRight size={16} />确认导入并分析</button></div></footer>
  </dialog>;
}
