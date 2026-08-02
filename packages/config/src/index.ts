import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  FAVLIB_BASE_URL: z.string().url().refine(v => v.startsWith('https://'), 'HTTPS is required'),
  DATABASE_URL_FILE: z.string().startsWith('/'), SESSION_SECRET_FILE: z.string().startsWith('/'),
  BACKUP_KEY_FILE: z.string().startsWith('/'), BACKUP_DESTINATION: z.string().startsWith('/'),
  FAVLIB_DATA_DIR: z.string().startsWith('/'), TZ: z.string().default('Europe/Paris'),
  LOG_LEVEL: z.enum(['error','warn','info','debug']).default('info')
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Configuration invalide: ${parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; ')}`);
  if (parsed.data.FAVLIB_BASE_URL !== 'https://favlib.home.arpa') throw new Error('FAVLIB_BASE_URL must be the documented local origin');
  for (const key of ['DATABASE_URL_FILE','SESSION_SECRET_FILE','BACKUP_KEY_FILE'] as const) if (!existsSync(parsed.data[key])) throw new Error(`${key} file is missing`);
  return parsed.data;
}
export function readSecret(path: string): string { const value = readFileSync(path, 'utf8').trim(); if (!value || value.includes('\n')) throw new Error('Empty or malformed secret file'); return value; }
