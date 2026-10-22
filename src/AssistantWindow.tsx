import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BrainCircuit, Maximize2, Minimize2, Minus } from 'lucide-react';
type Props = { docked?: boolean; open: boolean; onClose: () => void; children: ReactNode };
export default function AssistantWindow({ docked = false, open, onClose, children }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const resize = () => setPosition(null);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (open) { returnFocus.current = document.activeElement as HTMLElement; ref.current?.focus(); }
    else if (returnFocus.current?.isConnected) returnFocus.current.focus();
  }, [open]);
  return <div ref={ref} id="ai-assistant-window" className={'assistant-window' + (expanded ? ' expanded' : '') + (docked ? ' is-docked' : '')} hidden={!open} role="dialog" aria-modal="false" aria-labelledby="assistant-window-title" tabIndex={-1} style={!docked && !expanded && position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined} onKeyDown={e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.stopPropagation(); onClose(); } }}>
    <header className="assistant-window-bar" onPointerDown={e => {
      if (docked || expanded || window.innerWidth < 761 || (e.target as HTMLElement).closest('button')) return;
      const rect = ref.current!.getBoundingClientRect(); drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top }; e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      if (!drag.current || !ref.current) return;
      const rect = ref.current.getBoundingClientRect(), d = drag.current;
      setPosition({ left: Math.max(8, Math.min(window.innerWidth - rect.width - 8, d.left + e.clientX - d.x)), top: Math.max(8, Math.min(window.innerHeight - rect.height - 8, d.top + e.clientY - d.y)) });
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div><BrainCircuit size={18} /><strong id="assistant-window-title">数鉴 AI 助手</strong><span>分析与核验</span></div><div className="assistant-window-actions"><button className="icon-button" title={expanded ? '还原窗口' : '放大窗口'} aria-label={expanded ? '还原助手窗口' : '展开助手窗口'} onClick={() => { setExpanded(!expanded); setPosition(null); }}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><button className="icon-button" title="收起助手，保留当前分析" aria-label="收起 AI 助手" onClick={onClose}><Minus size={19} /></button></div>
    </header><div className="assistant-window-content">{children}</div>
  </div>;
}
