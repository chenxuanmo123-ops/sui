import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Local deployment credentials; never returned through the browser API.
export function createProfileStore(file = resolve(process.env.SHUJIAN_CONFIG_PATH || '.local/model-connections.json')) {
  let queue = Promise.resolve();
  async function read() {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(data.profiles) || data.profiles.length > 8 || data.profiles.some(p => !p || typeof p.id !== 'string' || typeof p.apiKey !== 'string' || typeof p.baseURL !== 'string' || typeof p.model !== 'string')) throw new Error('invalid');
      return { profiles: data.profiles, defaultId: typeof data.defaultId === 'string' ? data.defaultId : '' };
    } catch (e) { if (e.code === 'ENOENT') return { profiles: [], defaultId: '' }; throw new Error('本机模型配置无法读取，请检查 .local/model-connections.json，原文件未改动。'); }
  }
  return {
    read: async () => { await queue; return read(); },
    update: transform => {
      const task = queue.then(async () => {
        const next = transform(await read());
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        const temp = file + '.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
        await rename(temp, file);
        return next;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}
