/* global AbortSignal, fetch */
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const requestInit = { headers: { 'content-type': 'application/json' }, method: 'POST', redirect: 'error' };
const timeout = 15_000;
const maxObservations = 40;
const observationDelay = 15_000;
const fixtures = [
  { mediaKind: 'ANIME', title: 'Cowboy Bebop', providers: ['anilist', 'kitsu-anime'] },
  { mediaKind: 'MANGA', title: 'One Piece', providers: ['mangaupdates', 'mangadex', 'kitsu-manga'] },
];

async function request(fetcher, path, body) {
  const response = await fetcher(`https://tobirink.com/v3/catalogue/discoveries/${path}`, { ...requestInit, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const payload = await response.json().catch(() => undefined);
  return { payload, status: response.status };
}

function stateOf(payload, key) {
  if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.key?.fingerprint !== key.fingerprint) {
    throw new Error('discovery-canary-invalid-lookup');
  }
  return payload[0].state;
}

function assertVerified(state, fixture) {
  if (state.state !== 'VERIFIED') throw new Error(`discovery-canary-terminal-${state.state}`);
  const candidate = state.profile?.candidate;
  if (!candidate || candidate.mediaKind !== fixture.mediaKind) throw new Error('discovery-canary-media-mismatch');
  if (!candidate.titles.some(title => title.toLowerCase() === fixture.title.toLowerCase())) throw new Error('discovery-canary-title-mismatch');
  if (!state.profile.references?.some(({ provider }) => fixture.providers.includes(provider))) {
    throw new Error('discovery-canary-provider-reference-missing');
  }
}

// Two new public fixture keys, exactly one admission each; never rearm history.
export async function runDiscoveryCanaries({ fetcher = fetch, wait = sleep, now = Date.now, nonce = randomUUID(), report = value => process.stdout.write(`${JSON.stringify(value)}\n`) } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    const startedAt = now();
    const key = {
      fingerprint: createHash('sha256').update(`release-canary:${nonce}:${fixture.mediaKind}`).digest('hex'),
      mediaKind: fixture.mediaKind, parserVersion: 'release-canary-v2', siteRulesVersion: 'canary-v1',
    };
    const lookupBody = { keys: [key], schemaVersion: 3 };
    const initial = await request(fetcher, 'lookup', lookupBody);
    if (initial.status !== 200 || stateOf(initial.payload, key)?.state !== 'MISS') throw new Error('discovery-canary-not-fresh');
    const query = { discoveryTitles: [fixture.title], mediaKind: fixture.mediaKind, sourceTitles: [fixture.title] };
    const submission = await request(fetcher, 'requests', { key, query, schemaVersion: 3 });
    if (submission.status !== 202) throw new Error(`discovery-canary-submit-http-${submission.status}`);
    if (submission.payload?.state !== 'PENDING') throw new Error('discovery-canary-admission-not-pending');
    report({ media: fixture.mediaKind, state: 'PENDING', elapsedMs: now() - startedAt });
    let verified = false;
    for (let observation = 1; observation <= maxObservations; observation += 1) {
      await wait(observationDelay);
      const response = await request(fetcher, 'lookup', lookupBody);
      if (response.status !== 200) throw new Error(`discovery-canary-lookup-http-${response.status}`);
      const state = stateOf(response.payload, key);
      if (state?.state === 'VERIFIED') {
        assertVerified(state, fixture);
        const result = { media: fixture.mediaKind, state: 'VERIFIED', observations: observation, elapsedMs: now() - startedAt };
        results.push(result);
        report(result);
        verified = true;
        break;
      }
      if (state?.state !== 'PENDING') throw new Error(`discovery-canary-terminal-${fixture.mediaKind}-${['UNAVAILABLE', 'NOT_FOUND', 'AMBIGUOUS', 'MISS'].includes(state?.state) ? state.state : 'INVALID'}`);
      report({ media: fixture.mediaKind, state: 'PENDING', observations: observation, elapsedMs: now() - startedAt });
    }
    if (!verified) throw new Error(`discovery-canary-observation-timeout-${fixture.mediaKind}`);
  }
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runDiscoveryCanaries().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
