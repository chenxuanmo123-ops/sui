import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only harmless, owned fixture files are used. Never read real credentials.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5180';
const name = `static-boundary-${randomUUID()}.txt`;
const marker = `NOT_A_SECRET_${randomUUID()}`;
const paths = ['.local', 'artifacts'].map(dir => ({ dir, file: resolve(dir, name) }));
let assertions = 0;
try {
  for (const { dir, file } of paths) {
    await mkdir(dir, { recursive: true });
    await writeFile(file, marker, { flag: 'wx' });
    const slashPath = file.replaceAll('\\', '/');
    const routes = [`/${dir}/${name}`, `/@fs/${slashPath}`, `/${dir}/${name}?raw`, `/@fs/${slashPath}?raw`];
    for (const route of routes) {
      const response = await fetch(base + encodeURI(route));
      const body = await response.text();
      if (response.status !== 403 && response.status !== 404) throw new Error(`Expected denied file route: ${route}, got ${response.status}`);
      if (body.includes(marker)) throw new Error(`Fixture contents leaked at ${route}`);
      assertions++;
    }
  }
  console.log(`PASS ${assertions} private-file routes denied at ${base} (owned harmless fixtures only)`);
} finally {
  for (const { file } of paths) await rm(file, { force: true });
}
