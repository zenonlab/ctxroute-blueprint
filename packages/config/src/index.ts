import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';

/** Invariants de sécurité et de protocole: ils ne sont jamais modifiables depuis Admin. */
export const SECURITY_LIMITS = Object.freeze({
  adminPageSizeMax: 100,
  adminActionItemsMax: 500,
  providerResponseBytesMax: 2 * 1024 * 1024,
  coverBytesMax: 512_000,
  redirectMax: 3,
  passwordMinLength: 15,
  extensionImportItemsMax: 250,
});

export const CONNECTOR_VERSIONS = Object.freeze({
  favoriteResolution: 'favorite-resolution-v11',
  anilistMetadata: 'anilist-v28',
  anilistCover: 'anilist-cover-v4',
  mangaUpdatesMetadata: 'mangaupdates-v27',
  mangaUpdatesCover: 'mangaupdates-cover-v6',
  mangaDexBridge: 'mangadex-resolution-v2',
});

export const operationalSettingSchemas = {
  'retention.metadataAttemptsDays': z.number().int().min(7).max(365),
  'retention.securityEventsDays': z.number().int().min(30).max(730),
  'cadence.availabilityMinutes': z.number().int().min(5).max(1440),
  'cadence.inventoryReconcileHours': z.number().int().min(1).max(168),
  'timeouts.providerMs': z.number().int().min(1000).max(30_000),
  'backoff.providerBaseSeconds': z.number().int().min(10).max(3600),
  'backoff.providerMaxSeconds': z.number().int().min(60).max(86_400),
  'coverage.staleHours': z.number().int().min(1).max(720),
  'admin.actionBatchSize': z.number().int().min(1).max(SECURITY_LIMITS.adminActionItemsMax),
  'metadata.noMatchRetryHours': z.number().int().min(24).max(2160),
  'metadata.maxAttempts': z.number().int().min(1).max(10),
  'extension.syncMinutes': z.number().int().min(5).max(1440),
} as const;
export type OperationalSettingKey = keyof typeof operationalSettingSchemas;
export type OperationalSettings = { [K in OperationalSettingKey]: z.infer<(typeof operationalSettingSchemas)[K]> };
export const OPERATIONAL_DEFAULTS: OperationalSettings = Object.freeze({
  'retention.metadataAttemptsDays': 90,
  'retention.securityEventsDays': 180,
  'cadence.availabilityMinutes': 30,
  'cadence.inventoryReconcileHours': 24,
  'timeouts.providerMs': 8_000,
  'backoff.providerBaseSeconds': 60,
  'backoff.providerMaxSeconds': 21_600,
  'coverage.staleHours': 72,
  'admin.actionBatchSize': 500,
  'metadata.noMatchRetryHours': 720,
  'metadata.maxAttempts': 3,
  'extension.syncMinutes': 15,
});
export const operationalSettingsPatchSchema = z.object(Object.fromEntries(Object.entries(operationalSettingSchemas).map(([key,value])=>[key,value.optional()])) as { [K in OperationalSettingKey]: (typeof operationalSettingSchemas)[K] extends z.ZodTypeAny ? z.ZodOptional<(typeof operationalSettingSchemas)[K]> : never }).strict().refine(value=>Object.keys(value).length>0,'At least one setting is required');
export const isTestEnvironment = (env: NodeJS.ProcessEnv = process.env) => env.NODE_ENV === 'test';

/** Return only an explicitly isolated integration-test database URL. */
export function isolatedTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error('TEST_DATABASE_URL is required for integration tests');
  let database: string;
  try { database = decodeURIComponent(new URL(value).pathname.replace(/^\//u, '')); }
  catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!/(?:^|_)test$/u.test(database)) throw new Error('TEST_DATABASE_URL must target a database ending in _test');
  if (env.DATABASE_URL && env.DATABASE_URL === value) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL');
  return value;
}

export function runtimeEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV !== 'test';
  const required = (name: string, testValue?: string) => {
    const file=env[`${name}_FILE`];
    const value=env[name]??(file?readSecret(file):undefined)??(!production?testValue:undefined);
    if(!value)throw new Error(`${name} is required`);
    return value;
  };
  const databaseUrl = env.NODE_ENV === 'test' && env.TEST_DATABASE_URL
    ? env.TEST_DATABASE_URL
    : required('DATABASE_URL','postgres://favlib_test:favlib_test@127.0.0.1:5432/favlib_test');
  return {
    nodeEnv: env.NODE_ENV ?? 'production',
    databaseUrl,
    baseUrl: required('FAVLIB_BASE_URL','https://favlib.home.arpa'),
    classificationKey: required('CATALOG_FINGERPRINT_KEY','favlib-test-classification-key'),
    port: z.coerce.number().int().min(1).max(65535).parse(env.PORT??3001),
    backupDestination: env.BACKUP_DESTINATION,
    backupKeyFile: env.BACKUP_KEY_FILE,
    restoreDatabaseUrl: env.RESTORE_DATABASE_URL,
    targetEmail: env.TARGET_EMAIL,
    workerConcurrency: Math.min(24, Math.max(1, Number.parseInt(env.FAVLIB_WORKER_CONCURRENCY ?? '16', 10) || 16)),
  };
}

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

export function buildVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.FAVLIB_BUILD_VERSION ?? env.FAVLIB_BUILD_SHA ?? 'development';
}

/** Configuration des outils d'audit manuels, sans accès réseau implicite. */
export function manualAuditEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl=env.DATABASE_URL??(env.DATABASE_URL_FILE?readSecret(env.DATABASE_URL_FILE):undefined);
  if(!databaseUrl)throw new Error('DATABASE_URL_OR_FILE_REQUIRED');
  const auditLimit=z.coerce.number().int().min(0).parse(env.AUDIT_LIMIT??0);
  return {databaseUrl,auditLimit,auditOutput:env.AUDIT_OUTPUT};
}
