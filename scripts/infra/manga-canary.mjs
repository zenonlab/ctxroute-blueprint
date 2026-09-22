/* global AbortSignal, fetch */

const key = {
  fingerprint: 'c'.repeat(64),
  mediaKind: 'MANGA',
  parserVersion: 'recovery-canary-20260921',
  siteRulesVersion: 'canary-v1',
};
const query = {
  discoveryTitles: ['One Piece'],
  mediaKind: 'MANGA',
  sourceTitles: ['One Piece'],
};
const lookupBody = JSON.stringify({ keys: [key], schemaVersion: 3 });
const submissionBody = JSON.stringify({ key, query, schemaVersion: 3 });
const requestInit = { headers: { 'content-type': 'application/json' }, method: 'POST', redirect: 'error' };
const timeout = 15_000;
const maxObservations = 40;
const observationDelay = 15_000;

async function submit() {
  const response = await fetch('https://tobirink.com/v3/catalogue/discoveries/requests', { ...requestInit, body: submissionBody, signal: AbortSignal.timeout(timeout) });
  const payload = await response.json().catch(() => undefined);
  return { payload, status: response.status };
}

async function lookup() {
  const response = await fetch('https://tobirink.com/v3/catalogue/discoveries/lookup', { ...requestInit, body: lookupBody, signal: AbortSignal.timeout(timeout) });
  const payload = await response.json().catch(() => undefined);
  return { payload, status: response.status };
}

function stateOf(payload) {
  if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.key?.fingerprint !== key.fingerprint) {
    throw new Error('manga-canary-invalid-lookup');
  }
  return payload[0].state;
}

function assertVerified(state) {
  if (state.state !== 'VERIFIED') throw new Error(`manga-canary-terminal-${state.state}`);
  const candidate = state.profile?.candidate;
  if (!candidate || !['MANGA', 'MANHWA', 'MANHUA'].includes(candidate.mediaKind)) throw new Error('manga-canary-media-mismatch');
  if (!candidate.titles.some((title) => title.toLowerCase() === 'one piece')) throw new Error('manga-canary-title-mismatch');
  if (!state.profile.references?.some(({ provider }) => ['mangaupdates', 'mangadex', 'kitsu-manga'].includes(provider))) {
    throw new Error('manga-canary-provider-reference-missing');
  }
}

const submission = await submit();
if (submission.status !== 202) throw new Error(`manga-canary-submit-http-${submission.status}`);
const admitted = submission.payload?.state;
if (!admitted || !['PENDING', 'VERIFIED'].includes(admitted)) throw new Error('manga-canary-submit-invalid-state');

for (let observation = 1; observation <= maxObservations; observation += 1) {
  const observation = await lookup();
  if (observation.status !== 200) throw new Error(`manga-canary-lookup-http-${observation.status}`);
  const state = stateOf(observation.payload);
  if (state.state === 'VERIFIED') {
    assertVerified(state);
    process.exit(0);
  }
  if (state.state === 'UNAVAILABLE' || state.state === 'NOT_FOUND' || state.state === 'AMBIGUOUS') {
    throw new Error(`manga-canary-terminal-${state.state}`);
  }
  await new Promise((resolve) => { setTimeout(resolve, observationDelay); });
}

throw new Error('manga-canary-observation-timeout');
