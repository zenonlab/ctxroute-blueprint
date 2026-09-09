import { resolve } from 'node:path';
import { z } from 'zod';

const revisionSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u);
const publicIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,127}$/u);
const entrySchema = z.strictObject({
  availability: z.enum(['confirmed', 'estimated', 'official']),
  label: z.string().min(1).max(160),
  occursAt: z.iso.datetime(),
  releaseId: publicIdSchema,
  workId: publicIdSchema,
});
const snapshotSchema = z.strictObject({
  entries: z.array(entrySchema).max(200),
  generatedAt: z.iso.datetime(),
  revision: revisionSchema,
}).superRefine((snapshot, context) => {
  if (new Set(snapshot.entries.map(entry => entry.releaseId)).size !== snapshot.entries.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate public release identity', path: ['entries'] });
  }
});
const pointerSchema = z.strictObject({ revision: revisionSchema });

export const RELEASE_ACTION_KINDS = Object.freeze(['r2-release-snapshot', 'r2-release-pointer']);

export function isReleaseArtifactAction(action) {
  return action.kind === 'r2-publish' || RELEASE_ACTION_KINDS.includes(action.kind);
}

export function resolveReleaseAction(name, releaseBucket, releaseDirectory) {
  if (!releaseBucket) throw new Error(`unsupported-operation:${name}`);
  const match = /^(r2-release-snapshot|r2-release-pointer):(.+)$/u.exec(name);
  if (!match) throw new Error(`unsupported-operation:${name}`);
  const revision = revisionSchema.parse(match[2]);
  const snapshot = match[1] === 'r2-release-snapshot';
  const key = snapshot ? `releases/snapshots/${revision}.json` : 'releases/current.json';
  const filename = snapshot ? `${revision}.json` : `current-${revision}.json`;
  return {
    bucket: releaseBucket.name,
    key,
    kind: match[1],
    revision,
    source: resolve(releaseDirectory, filename),
    target: `r2:${releaseBucket.name}/${key}`,
  };
}

export function validateReleasePair(actions) {
  const selected = actions.filter(action => RELEASE_ACTION_KINDS.includes(action.kind));
  if (selected.length === 0) return;
  if (selected.length !== 2 || RELEASE_ACTION_KINDS.some(kind => selected.filter(action => action.kind === kind).length !== 1)) {
    throw new Error('release-publication-requires-snapshot-and-pointer');
  }
  if (new Set(selected.map(action => action.revision)).size !== 1) throw new Error('release-publication-revision-mismatch');
}

export function releaseRevisionFromActions(actions) {
  const snapshot = actions.find(action => action.kind === 'r2-release-snapshot');
  const match = snapshot && /^r2:[^/]+\/releases\/snapshots\/([A-Za-z0-9._-]{1,64})\.json$/u.exec(snapshot.target);
  return match?.[1];
}

export function validateReleaseJson(action, content) {
  if (!RELEASE_ACTION_KINDS.includes(action.kind)) return;
  let value;
  try { value = JSON.parse(content.toString('utf8')); } catch { throw new Error('invalid-release-json'); }
  const parsed = action.kind === 'r2-release-snapshot' ? snapshotSchema.parse(value) : pointerSchema.parse(value);
  if (parsed.revision !== action.revision) throw new Error('release-publication-revision-mismatch');
}

export function releaseMutationArguments(action) {
  if (!RELEASE_ACTION_KINDS.includes(action.kind)) return undefined;
  const cacheControl = action.kind === 'r2-release-snapshot' ? 'public, max-age=31536000, immutable' : 'no-cache';
  return ['r2', 'object', 'put', `${action.bucket}/${action.key}`, '--file', action.source, '--content-type', 'application/json', '--cache-control', cacheControl, '--remote', '--force'];
}
