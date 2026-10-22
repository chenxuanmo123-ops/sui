import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

export default function RequestProgress({ active, label }: { active: boolean; label: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const start = Date.now();
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active, label]);
  if (!active) return null;
  return <div className="request-progress" role="status" aria-live="polite"><LoaderCircle size={16} className="spin" /><div><strong>{label} · 已等待 {seconds} 秒</strong><small>{seconds >= 20 ? '服务商仍未返回完整结果。推理模型可能较慢；你可以取消，文件不会丢失。' : '请求进行中，收到完整响应后会显示结果。最长等待约三分钟，可随时取消。'}</small></div></div>;
}
