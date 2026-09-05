import {
  reviewCandidateLimit,
  reviewCandidateReferenceResponseSchema,
  reviewCandidateTitleResponseSchema,
} from '@tobirink/application';
import type { ReviewCandidatePort, ReviewCandidateQuery, ReviewCandidateWorkRecord } from '@tobirink/application';
import { createWork, workId } from '@tobirink/domain';
import type { ExternalReference, Work } from '@tobirink/domain';

export const reviewCandidateResponseByteLimit = 64 * 1024;
export type ReviewCandidateFetch = (input: string, init: RequestInit) => Promise<Response>;

const publicIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const providerPattern = /^[a-z0-9-]{1,32}$/u;

function apiOrigin(value: string): string {
  const parsed = new URL(value);
  const hasExtraParts = parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '';
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || hasExtraParts) {
    throw new TypeError('Review candidate API must be an HTTPS origin.');
  }
  return parsed.origin;
}

function parseWork(value: ReviewCandidateWorkRecord, reference?: ExternalReference): Work {
  return createWork({
    externalReferences: reference ? [reference] : [],
    id: workId(value.id),
    mediaKind: value.mediaKind,
    preferredTitle: value.preferredTitle,
  });
}

async function readJson(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('Review candidate response must be JSON.');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > reviewCandidateResponseByteLimit) {
    throw new RangeError('Review candidate response exceeds its byte limit.');
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > reviewCandidateResponseByteLimit) {
    throw new RangeError('Review candidate response exceeds its byte limit.');
  }
  return body;
}

function parseCandidateValues(body: string, kind: ReviewCandidateQuery['kind']): ReviewCandidateWorkRecord[] {
  try {
    return kind === 'reference'
      ? [reviewCandidateReferenceResponseSchema.parse(JSON.parse(body)).work]
      : reviewCandidateTitleResponseSchema.parse(JSON.parse(body)).items;
  } catch {
    throw new Error('Invalid Review candidate response.');
  }
}

function requestUrl(origin: string, query: ReviewCandidateQuery): URL {
  const path = query.kind === 'reference' ? '/v1/catalogue/resolve' : '/v1/catalogue/search';
  const url = new URL(path, origin);
  if (query.kind === 'reference') {
    if (!providerPattern.test(query.reference.provider) || !publicIdPattern.test(query.reference.externalId)) {
      throw new TypeError('Invalid public Review candidate reference.');
    }
    url.searchParams.set('provider', query.reference.provider);
    url.searchParams.set('externalId', query.reference.externalId);
  } else {
    const title = query.title.trim();
    const hasControlCharacter = [...title].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
    });
    if (title.length === 0 || title.length > 200 || hasControlCharacter) {
      throw new TypeError('Invalid Review candidate title.');
    }
    url.searchParams.set('title', title);
    url.searchParams.set('limit', String(query.limit));
  }
  return url;
}

export class HttpReviewCandidateAdapter implements ReviewCandidatePort {
  private readonly origin: string;

  constructor(origin: string, private readonly fetcher: ReviewCandidateFetch) {
    this.origin = apiOrigin(origin);
  }

  async findCandidates(query: ReviewCandidateQuery): Promise<readonly Work[]> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > reviewCandidateLimit) {
      throw new RangeError('Review candidate limit must be between 1 and 6.');
    }
    const response = await this.fetcher(requestUrl(this.origin, query).toString(), {
      cache: 'default',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    if (query.kind === 'reference' && response.status === 404) return Object.freeze([]);
    if (!response.ok) throw new Error(`Review candidate request failed with status ${response.status}.`);

    const body = await readJson(response);
    const values = parseCandidateValues(body, query.kind);
    if (values.length > query.limit) throw new RangeError('Review candidate result exceeds its limit.');
    const reference = query.kind === 'reference' ? query.reference : undefined;
    return Object.freeze(values.map((value) => parseWork(value, reference)));
  }
}
