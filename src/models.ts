import { useEffect, useState } from 'react';
import { aiRequest } from './ai';
import type { Provider } from './ai';
export type ModelProfile = Provider & { source: 'browser' | 'server'; baseURL?: string; apiKey?: string; jsonMode?: boolean; revision?: number; editable?: boolean; keyConfigured?: boolean };
export type ModelRequest = { providerId: string } | { provider: { id: string; name: string; baseURL: string; apiKey: string; model: string; jsonMode: boolean } };
type Status = { providers: Omit<ModelProfile, 'source'>[]; defaultProviderId?: string; canManage?: boolean };
const storageKey = 'shujian.model-profiles.v1';
const selectionKey = 'shujian.selected-model.v1';
function remembered(): ModelProfile[] {
  try { const data = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return (Array.isArray(data) ? data : []).slice(0, 8).filter(p => p && /^user_[a-zA-Z0-9_-]+$/.test(p.id) && typeof p.name === 'string' && typeof p.model === 'string' && typeof p.baseURL === 'string').map(p => ({ id: p.id, name: p.name.slice(0, 80), model: p.model.slice(0, 200), baseURL: p.baseURL.slice(0, 2048), jsonMode: p.jsonMode !== false, source: 'browser' as const }));
  } catch { return []; }
}
function initialSelection() { try { return localStorage.getItem(selectionKey) || remembered()[0]?.id || ''; } catch { return ''; } }
export function modelRequest(p: ModelProfile): ModelRequest {
  if (p.source === 'server' && !p.editable) return { providerId: p.id };
  if (p.source === 'server' && !p.apiKey) return { providerId: p.id };
  return { provider: { id: p.id, name: p.name, baseURL: p.baseURL || '', apiKey: p.apiKey || '', model: p.model, jsonMode: p.jsonMode !== false } };
}
export function useModelProfiles() {
  const [personal, setPersonal] = useState<ModelProfile[]>(remembered);
  const [server, setServer] = useState<ModelProfile[]>([]);
  const [selectedId, setSelectedId] = useState(initialSelection);
  const [defaultId, setDefaultId] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [status, setStatus] = useState('正在检查分析服务…');
  function apply(data: Status) {
    const profiles: ModelProfile[] = data.providers.map(p => ({ ...p, source: 'server' }));
    setServer(profiles); setDefaultId(data.defaultProviderId || profiles[0]?.id || ''); setCanManage(data.canManage === true);
    setPersonal(old => old.filter(p => !profiles.some(s => s.id === p.id)));
    setSelectedId(id => profiles.some(p => p.id === id) || remembered().some(p => p.id === id) ? id : data.defaultProviderId || profiles[0]?.id || '');
    setStatus('分析服务已就绪');
  }
  useEffect(() => {
    const c = new AbortController();
    fetch('/api/ai/status', { signal: c.signal }).then(async res => { if (!res.ok) throw new Error(); return res.json(); }).then(apply).catch(() => { if (!c.signal.aborted) setStatus('分析服务未连接，请使用 npm run dev 启动'); });
    return () => c.abort();
  }, []);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(personal.map(({ id, name, model, baseURL, jsonMode }) => ({ id, name, model, baseURL, jsonMode })))); } catch { /* Memory configuration still works. */ } }, [personal]);
  useEffect(() => { try { localStorage.setItem(selectionKey, selectedId); } catch { /* Optional preference. */ } }, [selectedId]);
  const profiles = [...server, ...personal.filter(p => !server.some(s => s.id === p.id))];
  const selected = profiles.find(p => p.id === selectedId);
  async function save(p: ModelProfile, makeDefault = false) {
    if (canManage) {
      const data = await aiRequest<Status>('connections', { action: 'save', profile: { id: p.id, name: p.name, baseURL: p.baseURL, apiKey: p.apiKey || '', model: p.model, jsonMode: p.jsonMode !== false }, makeDefault }, new AbortController().signal);
      apply(data);
    } else setPersonal(old => old.some(x => x.id === p.id) ? old.map(x => x.id === p.id ? { ...p, revision: (x.revision || 0) + 1 } : x) : [...old, { ...p, revision: 1 }].slice(0, 8));
    setSelectedId(p.id);
  }
  async function remove(id: string) {
    if (server.some(p => p.id === id)) apply(await aiRequest<Status>('connections', { action: 'delete', id }, new AbortController().signal));
    setPersonal(old => old.filter(p => p.id !== id));
    setSelectedId(current => current === id ? profiles.find(p => p.id !== id)?.id || '' : current);
  }
  async function setDefault(id: string) { apply(await aiRequest<Status>('connections', { action: 'default', id }, new AbortController().signal)); }
  return { profiles, selectedId, setSelectedId, selected, defaultId, defaultProfile: profiles.find(p => p.id === defaultId), canManage, setDefault, save, remove, status, ready: !!selected && (selected.source === 'server' || !!selected.apiKey?.trim()) };
}
