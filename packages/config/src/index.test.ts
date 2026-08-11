import { describe,expect,it } from 'vitest';
import { CONNECTOR_VERSIONS,OPERATIONAL_DEFAULTS,operationalSettingsPatchSchema,runtimeEnvironment } from './index.js';

describe('central configuration',()=>{
  it('advances only the anime connector for explicit season evidence',()=>{expect(CONNECTOR_VERSIONS.anilistMetadata).toBe('anilist-v32');expect(CONNECTOR_VERSIONS.mangaUpdatesMetadata).toBe('mangaupdates-v30')});
  it('accepts every default and rejects every unsafe lower bound',()=>{expect(operationalSettingsPatchSchema.safeParse(OPERATIONAL_DEFAULTS).success).toBe(true);const invalid:Record<string,number>={'retention.metadataAttemptsDays':6,'retention.securityEventsDays':29,'cadence.availabilityMinutes':4,'cadence.inventoryReconcileHours':0,'timeouts.providerMs':999,'backoff.providerBaseSeconds':9,'backoff.providerMaxSeconds':59,'coverage.staleHours':0,'admin.actionBatchSize':0,'metadata.noMatchRetryHours':23,'metadata.maxAttempts':0,'extension.syncMinutes':4};for(const [key,value] of Object.entries(invalid))expect(operationalSettingsPatchSchema.safeParse({[key]:value}).success,key).toBe(false);expect(operationalSettingsPatchSchema.safeParse({'admin.actionBatchSize':501}).success).toBe(false);expect(OPERATIONAL_DEFAULTS['backoff.providerBaseSeconds']).toBeLessThan(OPERATIONAL_DEFAULTS['backoff.providerMaxSeconds'])});
  it('has no production secret or database fallback',()=>{expect(()=>runtimeEnvironment({NODE_ENV:'production'})).toThrow('DATABASE_URL is required');expect(runtimeEnvironment({NODE_ENV:'test'}).classificationKey).toContain('test')});
});
