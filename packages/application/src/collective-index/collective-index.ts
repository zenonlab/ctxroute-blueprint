export type CollectiveContributionResult = 'accepted' | 'duplicate' | 'quota-exceeded' | 'revoked' | 'unauthorized';

export interface CollectiveConsentRecord {
  consentId: string;
  createdAt: string;
  revokeTokenHash: string;
  writeTokenHash: string;
}

export interface CollectiveAssociationRecord {
  canonicalWorkId: string;
  consentId: string;
  decidedAt: string;
  externalWorkId: string;
  nonce: string;
  provider: string;
  receivedAt: string;
  writeTokenHash: string;
}

export interface CollectiveIndexPort {
  createConsent(record: CollectiveConsentRecord): Promise<void>;
  recordAssociation(record: CollectiveAssociationRecord, dailyQuota: number): Promise<CollectiveContributionResult>;
  revokeConsent(consentId: string, revokeTokenHash: string, revokedAt: string): Promise<boolean>;
}

export interface CollectiveCredentialPort {
  hash(secret: string): Promise<string>;
  issueConsentId(): string;
  issueSecret(): string;
}

export interface CollectiveClockPort {
  now(): string;
}

export interface CollectiveIndexDependencies {
  clock: CollectiveClockPort;
  credentials: CollectiveCredentialPort;
  index: CollectiveIndexPort;
}

export async function createCollectiveConsent(dependencies: CollectiveIndexDependencies): Promise<{
  consentId: string;
  revokeToken: string;
  writeToken: string;
}> {
  const consentId = dependencies.credentials.issueConsentId();
  const revokeToken = dependencies.credentials.issueSecret();
  const writeToken = dependencies.credentials.issueSecret();
  const [revokeTokenHash, writeTokenHash] = await Promise.all([
    dependencies.credentials.hash(revokeToken),
    dependencies.credentials.hash(writeToken),
  ]);
  await dependencies.index.createConsent({
    consentId,
    createdAt: dependencies.clock.now(),
    revokeTokenHash,
    writeTokenHash,
  });
  return { consentId, revokeToken, writeToken };
}

export async function contributeCollectiveAssociation(
  dependencies: CollectiveIndexDependencies,
  input: Omit<CollectiveAssociationRecord, 'receivedAt' | 'writeTokenHash'> & { writeToken: string },
  dailyQuota: number,
): Promise<CollectiveContributionResult> {
  if (!Number.isSafeInteger(dailyQuota) || dailyQuota < 1) throw new Error('invalid-collective-quota');
  const writeTokenHash = await dependencies.credentials.hash(input.writeToken);
  return dependencies.index.recordAssociation({
    canonicalWorkId: input.canonicalWorkId,
    consentId: input.consentId,
    decidedAt: input.decidedAt,
    externalWorkId: input.externalWorkId,
    nonce: input.nonce,
    provider: input.provider,
    receivedAt: dependencies.clock.now(),
    writeTokenHash,
  }, dailyQuota);
}

export async function revokeCollectiveConsent(
  dependencies: CollectiveIndexDependencies,
  consentId: string,
  revokeToken: string,
): Promise<boolean> {
  const revokeTokenHash = await dependencies.credentials.hash(revokeToken);
  return dependencies.index.revokeConsent(consentId, revokeTokenHash, dependencies.clock.now());
}
