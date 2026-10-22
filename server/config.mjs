import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { providersFromEnv } from './ai.mjs';
export function loadProviders() {
  const envPath = resolve('.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  return providersFromEnv();
}
