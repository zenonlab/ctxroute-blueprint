import { z } from 'zod';

const consentIdSchema = z.string().regex(/^consent_[0-9a-f-]{36}$/);
const secretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const canonicalWorkIdSchema = z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/).max(128);
const providerSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/);
const externalWorkIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);

export const createCollectiveConsentSchema = z.strictObject({
  consent: z.literal(true),
});

export const collectiveAssociationSchema = z.strictObject({
  canonicalWorkId: canonicalWorkIdSchema,
  consentId: consentIdSchema,
  decidedAt: z.iso.datetime({ offset: true }),
  externalWorkId: externalWorkIdSchema,
  nonce: z.uuid(),
  provider: providerSchema,
});

export const collectiveConsentCredentialsSchema = z.strictObject({
  consentId: consentIdSchema,
  revokeToken: secretSchema,
  writeToken: secretSchema,
});

export const collectiveConsentIdSchema = consentIdSchema;
export const collectiveSecretSchema = secretSchema;

export type CollectiveAssociationPayload = z.infer<typeof collectiveAssociationSchema>;
export type CollectiveConsentCredentials = z.infer<typeof collectiveConsentCredentialsSchema>;
