import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { Pool } from "pg";
import { z } from "zod";
import { createHash, randomUUID, randomInt } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  newOpaqueSecret,
  digest,
  validatePassword,
  safeEqual,
} from "@favlib/auth";
import { classify, normalizeText, type CatalogMedia } from "@favlib/catalog";
import {
  FAVORITE_PROGRESS_PARSER_VERSION,
  parseFavorite,
  progressionFromFavorite,
  providerIdFromUrl,
  sameSiteUrl,
  sourceIdentityFromUrl,
  suspiciousPageMetadata,
  selectBestLocalizedTitle,
  contentTaxonomyExclusion,
  mangaUpdatesMediaType,
  type FavoriteParseArtifact,
} from "@favlib/metadata";
import { position, acceptObservation } from "@favlib/progression";
import { previewDeclarative, validateDeclarative } from "@favlib/sources";
import { safeRequest } from "@favlib/safe-http";
import {
  EXTENSION_PROTOCOL,
  MINIMUM_EXTENSION_PROTOCOL,
  pairingChallengeContract,
  importBatchContract,
  registerRequestContract,
  adminInvitationCreateContract,
  adminUserPatchContract,
  extensionPageMetadataContract,
  extensionPreferencesPatchContract,
  extensionProposalResultContract,
  extensionReleaseContract,
  contentPreferencePatchContract,
  languagePreferencePatchContract,
  repairMissingPositionsRequestContract,
  sourceReportContract,
  sourceCheckContract,
  reviewReportContract,
  userReportContract,
  adminReportDecisionContract,
  catalogCardSummaryContract,
} from "@favlib/contracts";
import {
  CONNECTOR_VERSIONS,
  OPERATIONAL_DEFAULTS,
  operationalSettingSchemas,
  operationalSettingsPatchSchema,
  runtimeEnvironment,
  SECURITY_LIMITS,
  type OperationalSettingKey,
  buildVersion,
} from "@favlib/config";
import {
  BOOTSTRAP_SCHEMA_VERSION,
  inspectRuntimeSchema,
} from "./runtime-schema.js";
import {
  activeProviderSql,
  contentAllowedSql,
  libraryFilterKeys,
  libraryFilterSql,
  libraryFilterValues,
  libraryCardProjectionSql,
  libraryProjectionSql,
  libraryQuerySchema,
  retainSelected,
  type LibraryFilterKey,
} from "./library-query.js";
import { openApiDocument } from "@favlib/contracts/openapi";
import { recoverProviderRequestOwner } from "@favlib/database/provider-queue";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { chapterDisplay } from "@favlib/progression";
import { checkSourceUrl } from './source-check.js';
import { manifestMetadata } from './site-metadata.js';
import { detectLanguage } from '@favlib/metadata';
import { importIdentityFromArtifact } from './import-identity.js';
import { faviconCacheIsFresh, pageIconRequests } from './favicon.js';
async function sendPublicCatalogCover(
  mediaId: string,
  userId: string,
  headers: Record<string, unknown>,
  reply: any,
) {
  const cover = await pool.query(
    `SELECT c.mime_type,COALESCE(a.data,c.data) AS data,c.status,c.provider,c.attribution
     FROM media_cover c LEFT JOIN catalog_image_asset a ON a.sha256=c.asset_sha256
     WHERE c.media_id IN (SELECT $1::text UNION SELECT im.target_media_id FROM media_identity_merge im WHERE im.source_media_id=$1) AND ${contentAllowedSql('c.media_id','$2')}
     ORDER BY CASE WHEN c.media_id=$1 THEN 0 ELSE 1 END LIMIT 1`,
    [mediaId,userId],
  );
  if (
    !cover.rowCount ||
    cover.rows[0].status !== "ACTIVE" ||
    !cover.rows[0].data
  )
    return err(
      reply,
      404,
      "COVER_NOT_AVAILABLE",
      "Aucune couverture locale optimisée n’est disponible.",
    );
  const data = Buffer.from(cover.rows[0].data, "base64"),
    etag = `"${createHash("sha256").update(data).digest("base64url")}"`;
  if (headers["if-none-match"] === etag) return reply.code(304).send();
  reply
    .type(cover.rows[0].mime_type)
    .header("Cache-Control", "private, max-age=2592000, immutable")
    .header("ETag", etag)
    .header("Content-Length", String(data.length))
    .header("X-FavLib-Cover-Provider", cover.rows[0].provider);
  if (cover.rows[0].attribution)
    reply.header("X-FavLib-Cover-Attribution", cover.rows[0].attribution);
  return data;
}
const runtime = runtimeEnvironment();
async function addManualReviewCandidate(
  reviewId: string,
  provider: "anilist" | "mangaupdates",
  providerId: string,
) {
  const cached = await pool.query(
    `SELECT id,canonical_title,categories,genres FROM provider_profile WHERE provider=$1 AND provider_id=$2 ORDER BY last_seen_at DESC LIMIT 1`,
    [provider, providerId],
  );
  if (cached.rowCount) {
    const candidate = await pool.query(
      `INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id,hit_title) VALUES($1,$2,$3,$4) ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id,hit_title=excluded.hit_title RETURNING id`,
      [reviewId, cached.rows[0].id, providerId, cached.rows[0].canonical_title],
    );
    await attachManualProfileToCluster(reviewId, cached.rows[0].id, providerId);
    return candidate.rows[0].id;
  }
  return null;
}
async function attachManualProfileToCluster(
  reviewId: string,
  profileId: string,
  providerId: string,
) {
  await pool.query(
    `INSERT INTO review_cluster_candidate(cluster_id,profile_id)
    SELECT cluster_id,$2 FROM favorite_review WHERE id=$1 AND cluster_id IS NOT NULL
    ON CONFLICT DO NOTHING`,
    [reviewId, profileId],
  );
  await pool.query(
    `INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id)
    SELECT pending.id,$2,$3 FROM favorite_review source JOIN favorite_review pending ON pending.cluster_id=source.cluster_id
    WHERE source.id=$1 AND pending.status='PENDING'
    ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id`,
    [reviewId, profileId, providerId],
  );
}
const pool = new Pool({ connectionString: runtime.databaseUrl });
if (runtime.nodeEnv !== "test")
  await recoverProviderRequestOwner(pool, "api", "API_RESTART");
if (runtime.nodeEnv !== "test") {
  const schema = await inspectRuntimeSchema(pool);
  if (!schema.ok)
    throw new Error(
      `Schéma FavLib insuffisant (${BOOTSTRAP_SCHEMA_VERSION}), tables absentes: ${schema.missing.join(", ")}`,
    );
}
async function operationalValue<K extends OperationalSettingKey>(
  key: K,
): Promise<number> {
  const result = await pool.query(
    "SELECT value FROM operational_setting WHERE key=$1",
    [key],
  );
  if (!result.rowCount) return OPERATIONAL_DEFAULTS[key];
  const parsed = operationalSettingSchemas[key].safeParse(result.rows[0].value);
  return parsed.success ? parsed.data : OPERATIONAL_DEFAULTS[key];
}
async function rateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowMinutes: number,
) {
  const result = await pool.query(
    `INSERT INTO security_rate_limit(bucket,subject_hash,attempt_count) VALUES($1,$2,1) ON CONFLICT(bucket,subject_hash) DO UPDATE SET attempt_count=CASE WHEN security_rate_limit.window_started_at<now()-make_interval(mins=>$4) THEN 1 ELSE security_rate_limit.attempt_count+1 END,window_started_at=CASE WHEN security_rate_limit.window_started_at<now()-make_interval(mins=>$4) THEN now() ELSE security_rate_limit.window_started_at END,blocked_until=CASE WHEN security_rate_limit.window_started_at<now()-make_interval(mins=>$4) THEN NULL WHEN security_rate_limit.attempt_count+1>$3 THEN now()+make_interval(secs=>LEAST(3600,power(2,LEAST(10,security_rate_limit.attempt_count+1-$3))::int*60)) ELSE security_rate_limit.blocked_until END,updated_at=now() RETURNING blocked_until`,
    [bucket, digest(subject), limit, windowMinutes],
  );
  return Boolean(
    result.rows[0]?.blocked_until &&
      new Date(result.rows[0].blocked_until) > new Date(),
  );
}
function requireWebOrigin(req: any, reply: any) {
  if (req.headers.origin !== origin)
    return err(reply, 403, "ORIGIN_MISMATCH", "Origine Web refusée.");
  return true;
}
async function enqueueMetadata(
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  userId: string,
  mediaId: string,
  title: string,
  url: string,
) {
  // Metadata enrichment is optional and must never be the ingestion gate.
  // In particular, source-resolve:v2 used to move links while trying to find
  // a provider identity. Keep this boundary inert until an explicit provider
  // identity exists; the raw bookmark remains the source of truth.
  void db; void userId; void mediaId; void title; void url;
  return;
}
const app = Fastify({
  logger: {
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.password",
      "*.token",
      "*.invitationToken",
      "*.deviceToken",
      "*.activation_token",
      "*.activationToken",
    ],
  },
  bodyLimit: SECURITY_LIMITS.providerResponseBytesMax,
}).withTypeProvider<ZodTypeProvider>();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
await app.register(cookie);
const runtimeRouteOperations = new Map<string, Set<string>>();
app.addHook("onRoute", (route) => {
  const path = route.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  const current = runtimeRouteOperations.get(path) ?? new Set<string>();
  for (const method of methods)
    if (method !== "HEAD") current.add(method.toLowerCase());
  runtimeRouteOperations.set(path, current);
});
function runtimeOpenApi() {
  const paths: any = { ...(openApiDocument as any).paths };
  for (const [path, methods] of runtimeRouteOperations) {
    paths[path] ??= {};
    for (const method of methods)
      paths[path][method] ??= {
        responses: { default: { description: "Structured FavLib response" } },
      };
  }
  return { ...openApiDocument, paths };
}
const origin = runtime.baseUrl;
const pairingUrl = (id: string) =>
  `${origin}/settings?pairing=${encodeURIComponent(id)}#extension`;
app.addHook("onRequest", async (req, reply) => {
  const id =
    typeof req.headers["x-request-id"] === "string" &&
    /^[A-Za-z0-9._-]{1,80}$/.test(req.headers["x-request-id"])
      ? req.headers["x-request-id"]
      : `req_${randomUUID()}`;
  reply.header("X-Request-Id", id);
  (req as any).requestId = id;
});
app.addHook("onSend",async(req,reply,payload)=>{
  if(req.method==='GET'&&req.url.startsWith('/api/v1/')&&!req.url.startsWith('/api/v1/public/')&&req.url!=='/api/v1/health'){
    reply.header('Cache-Control','private, max-age=30').header('Vary','Cookie');
  }
  return payload;
});
function err(
  reply: any,
  status: number,
  code: string,
  message = "La requête est invalide.",
  fields: any[] = [],
) {
  return reply
    .code(status)
    .send({
      error: {
        code,
        message,
        requestId: (reply as any).request?.requestId ?? "unknown",
        fields,
      },
    });
}
async function auth(req: any, reply: any) {
  if (
    req.url.startsWith("/api/v1/public/") ||
    (req.url.startsWith("/api/v1/calendar/feeds/") && req.method === "GET") ||
    req.url === "/api/v1/auth/register" ||
    req.url === "/api/v1/auth/password-reset"
  ) {
    req.user = { id: null, role: "member" };
    return;
  }
  const raw = req.cookies["__Host-favlib_session"];
  if (!raw)
    return err(reply, 401, "UNAUTHENTICATED", "Authentification requise.");
  const r = await pool.query(
    "SELECT u.id,u.email,u.role,s.id session_id,s.csrf_hash FROM user_session s JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND u.active AND s.revoked_at IS NULL AND s.expires_at>now() AND s.absolute_expires_at>now()",
    [digest(raw)],
  );
  if (!r.rowCount)
    return err(reply, 401, "UNAUTHENTICATED", "Authentification requise.");
  req.user = r.rows[0];
}
function csrf(req: any, reply: any) {
  if (
    req.url === "/api/v1/auth/register" ||
    req.url === "/api/v1/auth/password-reset" ||
    req.url.startsWith("/api/v1/public/")
  )
    return true;
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) return true;
  if (req.headers.origin !== origin)
    return err(reply, 403, "ORIGIN_MISMATCH", "Origine refusée.");
  const token = req.headers["x-csrf-token"];
  if (
    typeof token !== "string" ||
    !req.user ||
    !safeEqual(digest(token), req.user.csrf_hash)
  )
    return err(reply, 403, "CSRF_FAILED", "Protection CSRF refusée.");
  return true;
}
app.addHook("preHandler", async (req: any, reply: any) => {
  const path = req.url.split("?")[0];
  const match = path.match(
    /^\/api\/v1\/(?:catalog\/media|extension\/favorites)\/([^/]+)\/(?:cover|banner)$/,
  );
  if (!match || !req.user?.id) return;
  const mediaId = decodeURIComponent(match[1]);
  const allowed = await pool.query(
    `SELECT 1 FROM bookmark_media_link l WHERE l.user_id=$1 AND l.media_id=$2 AND l.status IN ('matched','accepted','review') LIMIT 1`,
    [req.user.id, mediaId],
  );
  if (!allowed.rowCount)
    return err(
      reply,
      404,
      "MEDIA_NOT_IN_LIBRARY",
      "Cette œuvre n’est pas résolue dans la bibliothèque.",
    );
});
app.get("/api/v1/health", async () => ({
  status: "ok",
  currentProtocol: 1,
  minimumSupportedProtocol: 1,
  buildVersion: buildVersion(),
  schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
}));
app.get("/api/v1/catalog/favicon", async (req: any, reply: any) => {
  const parsed = z.object({domain:z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/)}).safeParse(req.query);
  if (!parsed.success) return err(reply,400,"VALIDATION_FAILED");
  const domain=parsed.data.domain;
  const cached=await pool.query('SELECT mime_type AS "mimeType",data,fetched_at AS "fetchedAt",error FROM domain_favicon_cache WHERE domain=$1',[domain]);
  const row=cached.rows[0];
  if(row && faviconCacheIsFresh(row)){
    if(row.data)return reply.type(row.mimeType??'image/png').header('Cache-Control','public, max-age=86400').send(row.data);
    return err(reply,404,'FAVICON_NOT_FOUND');
  }
  const candidates:Array<{url:string;referer?:string}>=[];
  try {
    const page=await safeRequest(`https://${domain}/`,{requireHttps:true,maxRedirects:3,timeoutMs:5000,maxBytes:1024*1024,mimeTypes:['text/html','application/xhtml+xml'],headers:{accept:'text/html,application/xhtml+xml','user-agent':'FavLib favicon discovery/1.0'}});
    if(page.status>=200&&page.status<300){
      candidates.push(...pageIconRequests(page.body.toString('utf8'),page.url));
    }
  } catch {}
  candidates.push({url:`https://a.favicon.im/${encodeURIComponent(domain)}?larger=true&throw-error-on-404=true`},{url:`https://${domain}/favicon.ico`});
  for(const candidate of candidates){
    try{
      const response=await safeRequest(candidate.url,{requireHttps:true,maxRedirects:3,timeoutMs:5000,maxBytes:512*1024,mimeTypes:['image/png','image/jpeg','image/gif','image/webp','image/x-icon','image/vnd.microsoft.icon','image/svg+xml'],headers:{accept:'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8','user-agent':'FavLib favicon discovery/1.0',...(candidate.referer?{referer:candidate.referer}:{})}});
      if(response.status>=200&&response.status<300&&response.body.length){const contentType=Array.isArray(response.headers['content-type'])?response.headers['content-type'][0]:response.headers['content-type'];const mime=contentType?.split(';',1)[0]??'image/png';await pool.query('INSERT INTO domain_favicon_cache(domain,mime_type,data,fetched_at,error) VALUES($1,$2,$3,now(),NULL) ON CONFLICT(domain) DO UPDATE SET mime_type=excluded.mime_type,data=excluded.data,fetched_at=excluded.fetched_at,error=NULL',[domain,mime,response.body]);return reply.type(mime).header('Cache-Control','public, max-age=86400').send(response.body)}
    }catch{}
  }
  await pool.query("INSERT INTO domain_favicon_cache(domain,mime_type,data,fetched_at,error) VALUES($1,NULL,NULL,now(),'FAVICON_NOT_FOUND') ON CONFLICT(domain) DO UPDATE SET mime_type=NULL,data=NULL,fetched_at=excluded.fetched_at,error=excluded.error",[domain]);
  return err(reply,404,"FAVICON_NOT_FOUND");
});
app.get("/api/v1/catalog/site-metadata", async (req: any, reply: any) => {
  const parsed=z.object({domain:z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/)}).safeParse(req.query);
  if(!parsed.success)return err(reply,400,"VALIDATION_FAILED");
  const domain=parsed.data.domain;
  const cached=await pool.query('SELECT domain,language,detection_method AS "detectionMethod",manifest_url AS "manifestUrl",raw_url AS "rawUrl",detected_at AS "detectedAt" FROM site_metadata_cache WHERE domain=$1',[domain]);
  if(cached.rowCount)return cached.rows[0];
  for(const path of ['/manifest.json','/site.webmanifest']){
    try{
      const manifestUrl=`https://${domain}${path}`;
      const response=await safeRequest(manifestUrl,{requireHttps:true,maxRedirects:3,timeoutMs:5000,maxBytes:128*1024,mimeTypes:[]});
      if(response.status<200||response.status>=300)continue;
      const value=JSON.parse(response.body.toString('utf8')) as unknown;
      const metadata=manifestMetadata(value,response.url); const detected=detectLanguage(response.url,metadata.language); const result={...metadata,language:detected.language,detectionMethod:detected.method,rawUrl:response.url,detectedAt:detected.detectedAt};
      await pool.query('INSERT INTO site_metadata_cache(domain,language,detection_method,manifest_url,raw_url,detected_at,error) VALUES($1,$2,$3,$4,$5,$6,NULL) ON CONFLICT(domain) DO UPDATE SET language=excluded.language,detection_method=excluded.detection_method,manifest_url=excluded.manifest_url,raw_url=excluded.raw_url,detected_at=excluded.detected_at,error=NULL',[domain,result.language,result.detectionMethod,result.manifestUrl,result.rawUrl,result.detectedAt]);
      return result;
    }catch{}
  }
  await pool.query("INSERT INTO site_metadata_cache(domain,language,detection_method,manifest_url,raw_url,detected_at,error) VALUES($1,NULL,'undetected',NULL,$2,now(),'SITE_MANIFEST_NOT_FOUND') ON CONFLICT(domain) DO UPDATE SET error=excluded.error,detected_at=excluded.detected_at",[domain,`https://${domain}`]);
  return err(reply,404,"SITE_MANIFEST_NOT_FOUND");
});
app.get("/api/v1/openapi.json", async () => runtimeOpenApi());
app.get(
  "/api/v1/public/extension-releases/:browser",
  async (req: any, reply: any) => {
    const parsed = z.enum(["chrome", "firefox"]).safeParse(req.params.browser);
    if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
    const release = await pool.query(
      'SELECT browser,version,protocol,checksum_sha256 AS "checksumSha256",artifact_url AS "artifactUrl",update_manifest_url AS "updateManifestUrl",installation_mode AS "installationMode",published_at AS "publishedAt" FROM extension_release WHERE browser=$1',
      [parsed.data],
    );
    if (!release.rowCount)
      return err(
        reply,
        404,
        "EXTENSION_RELEASE_NOT_PUBLISHED",
        "Aucune version vérifiée n’est publiée.",
      );
    return release.rows[0];
  },
);
app.get("/api/v1/releases", async () => {
  const r = await pool.query(
    `SELECT DISTINCT ON (a.media_id) a.media_id AS "mediaId",favlib_display_title(m.id,NULL)->>'title' AS title,favlib_display_title(m.id,NULL) AS "titleSelection",m.type,a.release_key AS "releaseKey",a.status,a.announced_at AS "announcedAt" FROM release_announcement a JOIN media m ON m.id=a.media_id ORDER BY a.media_id,a.announced_at DESC,a.id DESC`,
  );
  return {
    items: r.rows
      .sort(
        (a: any, b: any) =>
          Date.parse(b.announcedAt) - Date.parse(a.announcedAt),
      )
      .slice(0, 30)
      .map((row: any) => ({
        ...row,
        coverUrl: row.title
          ? `/api/v1/catalog/media/${encodeURIComponent(row.mediaId)}/cover`
          : null,
      })),
  };
});
app.post("/api/v1/progression/observations", async (req: any, reply: any) => {
  const p = z
    .object({
      mediaId: z.string().min(1).max(300),
      source: z.string().min(1).max(200),
      position: z.string().min(1).max(100),
      kind: z
        .enum(["season", "volume", "chapter", "episode", "special"])
        .default("episode"),
      confidence: z.enum(["high", "medium", "low"]),
      consented: z.boolean(),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const next = position(p.data.position, p.data.kind);
  const current = await pool.query(
    'SELECT position_kind AS "kind",position_number AS "number",position_raw AS "raw" FROM favorite_progress WHERE user_id=$1 AND media_id=$2 AND position_kind=$3',
    [req.user.id, p.data.mediaId, p.data.kind],
  );
  const currentPosition = current.rowCount
    ? {
        kind: current.rows[0].kind,
        number:
          current.rows[0].number === null
            ? undefined
            : Number(current.rows[0].number),
        raw: current.rows[0].raw,
      }
    : null;
  const observation = {
    mediaId: p.data.mediaId,
    source: p.data.source,
    position: next,
    confidence: p.data.confidence,
    consented: p.data.consented,
    observedAt: new Date().toISOString(),
  };
  if (!acceptObservation(currentPosition, observation))
    return err(
      reply,
      409,
      "PROGRESSION_REJECTED",
      "Observation non consentie, incertaine ou régressive.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saved = await client.query(
      "INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,confidence,consented,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,media_id,source,position_kind,position_raw,observed_at) DO UPDATE SET confidence=excluded.confidence RETURNING id",
      [
        req.user.id,
        p.data.mediaId,
        p.data.source,
        next.kind,
        next.number ?? null,
        next.raw,
        p.data.confidence,
        p.data.consented,
        observation.observedAt,
      ],
    );
    await client.query(
      "INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,media_id,position_kind) DO UPDATE SET position_number=excluded.position_number,position_raw=excluded.position_raw,observation_id=excluded.observation_id,updated_at=now()",
      [
        req.user.id,
        p.data.mediaId,
        next.kind,
        next.number ?? null,
        next.raw,
        saved.rows[0].id,
      ],
    );
    await client.query("COMMIT");
    return reply
      .code(201)
      .send({ ok: true, mediaId: p.data.mediaId, position: next.raw });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.get("/api/v1/progression", async (req: any) => {
  const r = await pool.query(
    'SELECT media_id AS "mediaId",position_kind AS "kind",position_number AS "number",position_raw AS "raw",updated_at AS "updatedAt" FROM favorite_progress WHERE user_id=$1 ORDER BY updated_at DESC',
    [req.user.id],
  );
  return { items: r.rows };
});
app.get("/api/v1/notifications", async (req: any) => {
  const r = await pool.query(
    `SELECT n.id,n.kind,n.payload,n.created_at AS "createdAt",n.read_at AS "readAt",
  favlib_display_title(m.id,$1::uuid)->>'title' AS title,
  favlib_display_title(m.id,$1::uuid) AS "titleSelection"
  FROM personal_notification n
  LEFT JOIN media m ON m.id=COALESCE(n.payload#>>'{release,mediaId}',split_part(n.release_key,'|',1))
  WHERE n.user_id=$1 AND (m.id IS NULL OR favlib_content_allowed(m.id,$1::uuid))
    AND (n.kind<>'FAVORITE_REVIEW_REQUIRED' OR EXISTS(
      SELECT 1 FROM favorite_review review JOIN bookmark_media_link link
        ON link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id
      WHERE review.user_id=$1 AND review.status='PENDING' AND link.media_id IS NOT NULL AND favlib_content_allowed(link.media_id,$1::uuid)))
  ORDER BY n.created_at DESC LIMIT 100`,
    [req.user.id],
  );
  return { items: r.rows };
});
app.get("/api/v1/reviews", async (req: any) => {
  const r = await pool.query(
    `WITH owned AS (SELECT r.*,COALESCE(r.cluster_id::text,r.id::text) AS logical_key FROM favorite_review r WHERE r.user_id=$1 AND EXISTS(SELECT 1 FROM bookmark_media_link active_link WHERE active_link.user_id=r.user_id AND active_link.installation_id=r.installation_id AND active_link.bookmark_id=r.bookmark_id AND active_link.status IN ('matched','accepted','review')) AND NOT EXISTS(SELECT 1 FROM favorite_review queued JOIN bookmark_media_link queued_link ON queued_link.user_id=queued.user_id AND queued_link.installation_id=queued.installation_id AND queued_link.bookmark_id=queued.bookmark_id AND queued_link.status IN ('matched','accepted','review') WHERE queued.user_id=r.user_id AND COALESCE(queued.cluster_id::text,queued.id::text)=COALESCE(r.cluster_id::text,r.id::text) AND queued.status='PENDING' AND queued.decision->>'kind'='manual-queued')),representative AS (SELECT DISTINCT ON(logical_key) * FROM owned ORDER BY logical_key,(status='PENDING') DESC,created_at DESC,id DESC),counts AS (SELECT logical_key,count(*) FILTER(WHERE status='PENDING')::int AS pending_rows,count(*)::int AS favorite_count FROM owned GROUP BY logical_key),candidates AS (SELECT o.logical_key,count(DISTINCT c.provider_id)::int AS candidate_count FROM owned o LEFT JOIN favorite_review_candidate c ON c.review_id=o.id GROUP BY o.logical_key) SELECT r.id,r.cluster_id AS "clusterId",r.favorite_title AS "favoriteTitle",r.favorite_url AS "favoriteUrl",r.provider,r.status,r.reason,r.created_at AS "createdAt",r.resolved_at AS "resolvedAt",c.favorite_count AS "favoriteCount",LEAST(ca.candidate_count,5) AS "candidateCount" FROM representative r JOIN counts c USING(logical_key) JOIN candidates ca USING(logical_key) ORDER BY (c.pending_rows>0) DESC,CASE WHEN c.pending_rows>0 THEN LEAST(ca.candidate_count,5) ELSE 0 END DESC,r.created_at DESC`,
    [req.user.id],
  );
  const visible=await pool.query(`SELECT DISTINCT review.id FROM favorite_review review JOIN bookmark_media_link link
    ON link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id
    WHERE review.user_id=$1 AND link.media_id IS NOT NULL AND favlib_content_allowed(link.media_id,$1::uuid)`,[req.user.id]);
  const visibleIds=new Set(visible.rows.map((row:any)=>row.id));
  const items=r.rows.filter((row:any)=>visibleIds.has(row.id));
  return {
    items,
    pendingCount: items.filter((row: any) => row.status === "PENDING").length,
  };
});
app.get("/api/v1/reviews/:id", async (req: any, reply: any) => {
  const review = await pool.query(
    `SELECT r.id,r.cluster_id AS "clusterId",r.installation_id AS "installationId",r.bookmark_id AS "bookmarkId",r.favorite_title AS "favoriteTitle",r.favorite_url AS "favoriteUrl",i.payload->>'title' AS "rawFavoriteTitle",COALESCE(i.parse_artifact#>>'{identity,title}',NULLIF(i.parse_artifact->>'displayTitle',''),r.favorite_title) AS "sourceTitle",i.parse_artifact->'progression' AS progression,r.provider,r.status,r.reason,r.review_mode AS mode,r.selected_candidate_id AS "selectedCandidateId",r.decision,r.created_at AS "createdAt",r.resolved_at AS "resolvedAt",cl.state AS "collectiveState",cl.epoch,(SELECT count(*)::int FROM favorite_review x WHERE x.user_id=r.user_id AND COALESCE(x.cluster_id::text,x.id::text)=COALESCE(r.cluster_id::text,r.id::text)) AS "favoriteCount" FROM favorite_review r LEFT JOIN review_title_cluster cl ON cl.id=r.cluster_id LEFT JOIN bookmark_import_item i ON i.user_id=r.user_id AND i.installation_id=r.installation_id AND i.bookmark_id=r.bookmark_id WHERE r.id=$1::uuid AND r.user_id=$2::uuid`,
    [req.params.id, req.user.id],
  );
  if (!review.rowCount) return err(reply, 404, "REVIEW_NOT_FOUND");
  const reviewVisibility=await pool.query(`SELECT 1 FROM bookmark_media_link link WHERE link.user_id=$1 AND link.installation_id=$2 AND link.bookmark_id=$3
    AND link.media_id IS NOT NULL AND favlib_content_allowed(link.media_id,$1::uuid) LIMIT 1`,[req.user.id,review.rows[0].installationId,review.rows[0].bookmarkId]);
  if(!reviewVisibility.rowCount)return err(reply,404,"REVIEW_NOT_FOUND");
  const contentPreference=await pool.query('SELECT COALESCE((SELECT allow_adult FROM user_catalog_preference WHERE user_id=$1),false) AS "allowAdult"',[req.user.id]);
  const allowAdult=Boolean(contentPreference.rows[0]?.allowAdult);
  const chosen = review.rows[0].status !== "PENDING";
  const candidates = await pool.query(
    `SELECT DISTINCT ON(c.provider_id) c.id,c.provider_id AS "providerId",COALESCE(p.canonical_title,c.provider_id) AS "displayTitle",p.canonical_title AS "canonicalTitle",c.hit_title AS "hitTitle",c.hit_title AS "matchedAlias",p.associated_titles AS "associatedTitles",p.type,COALESCE(NULLIF(p.payload->>'format',''),p.type) AS format,p.year,p.start_date AS "startDate",p.status,p.authors,p.categories,p.genres,CASE WHEN p.cover_status='ACTIVE' AND p.cover_asset_sha256 IS NOT NULL THEN '/api/v1/reviews/'||$1::text||'/candidates/'||c.id::text||'/cover' ELSE p.image END AS image,p.url,c.media_id AS "mediaId",p.payload_hash AS "profileHash",CASE WHEN $3::boolean AND p.id IS NOT NULL THEN (SELECT count(*)::int FROM review_cluster_endorsement e JOIN favorite_review rr ON rr.cluster_id=e.cluster_id WHERE rr.id=$2 AND e.profile_id=p.id) END AS endorsements,CASE WHEN $3::boolean AND p.id IS NOT NULL THEN (SELECT count(*)::int FROM review_cluster_vote v JOIN favorite_review rr ON rr.cluster_id=v.cluster_id WHERE rr.id=$2 AND v.profile_id=p.id) END AS "reliableVotes" FROM favorite_review target JOIN favorite_review sibling ON sibling.user_id=target.user_id AND COALESCE(sibling.cluster_id::text,sibling.id::text)=COALESCE(target.cluster_id::text,target.id::text) JOIN favorite_review_candidate c ON c.review_id=sibling.id JOIN provider_profile p ON p.id=c.profile_id WHERE target.id=$2::uuid AND target.user_id=$4::uuid ORDER BY c.provider_id,endorsements DESC NULLS LAST,(p.cover_status='ACTIVE') DESC LIMIT 5`,
    [req.params.id, req.params.id, chosen, req.user.id],
  );
  const favoriteTitle = review.rows[0].sourceTitle ?? review.rows[0].favoriteTitle;
  const chain = review.rows[0].provider === "anilist-chain";
  return {
    ...review.rows[0],
    allowedActions:
      review.rows[0].status === "PENDING"
        ? chain
          ? ["choose", "no-match"]
          : ["choose", "no-match", "manual"]
        : chain
          ? []
          : ["report"],
    candidates: candidates.rows.filter((candidate:any)=>allowAdult||!contentTaxonomyExclusion(candidate)).map((candidate:any) => ({...candidate,displayTitle:selectBestLocalizedTitle([favoriteTitle],[candidate.canonicalTitle,candidate.hitTitle,...(candidate.associatedTitles??[])].filter(Boolean).map((text:string)=>({text})))?.text??candidate.displayTitle})),
    google: chain
      ? undefined
      : {
          anilist: `https://www.google.com/search?q=${encodeURIComponent(favoriteTitle + " site:anilist.co/anime/")}`,
          mangaupdates: `https://www.google.com/search?q=${encodeURIComponent(favoriteTitle + " site:mangaupdates.com/series/")}`,
        },
  };
});
app.get(
  "/api/v1/reviews/:id/candidates/:candidateId/cover",
  async (req: any, reply: any) => {
    const contentPreference=await pool.query('SELECT COALESCE((SELECT allow_adult FROM user_catalog_preference WHERE user_id=$1),false) AS "allowAdult"',[req.user.id]);
    const cover = await pool.query(
      `SELECT a.mime_type,a.data,p.categories,p.genres FROM favorite_review r JOIN favorite_review owner ON owner.user_id=r.user_id AND COALESCE(owner.cluster_id::text,owner.id::text)=COALESCE(r.cluster_id::text,r.id::text) JOIN favorite_review_candidate c ON c.review_id=owner.id AND c.id=$2 JOIN provider_profile p ON p.id=c.profile_id AND p.cover_status='ACTIVE' JOIN catalog_image_asset a ON a.sha256=p.cover_asset_sha256 WHERE r.id=$1 AND r.user_id=$3`,
      [req.params.id, req.params.candidateId, req.user.id],
    );
    if (!cover.rowCount || !cover.rows[0].data || (!contentPreference.rows[0]?.allowAdult && contentTaxonomyExclusion(cover.rows[0])))
      return err(
        reply,
        404,
        "COVER_NOT_AVAILABLE",
        "Aucune couverture locale du candidat n’est disponible.",
      );
    const data = Buffer.from(cover.rows[0].data, "base64");
    return reply
      .type(cover.rows[0].mime_type)
      .header("Cache-Control", "private, max-age=2592000, immutable")
      .send(data);
  },
);
async function refreshReviewQueue(userId: string) {
  const pending = await pool.query(
    "SELECT count(DISTINCT COALESCE(r.cluster_id::text,r.id::text))::int AS count FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id WHERE r.user_id=$1 AND r.status='PENDING' AND l.status IN ('matched','accepted','review') AND l.media_id IS NOT NULL AND favlib_content_allowed(l.media_id,$1::uuid)",
    [userId],
  );
  const count = Number(pending.rows[0]?.count ?? 0);
  if (!count) {
    await pool.query(
      "DELETE FROM personal_notification WHERE user_id=$1 AND kind='FAVORITE_REVIEW_REQUIRED' AND release_key='favorite-review-queue'",
      [userId],
    );
    return;
  }
  await pool.query(
    "INSERT INTO personal_notification(user_id,release_key,kind,payload) VALUES($1,'favorite-review-queue','FAVORITE_REVIEW_REQUIRED',jsonb_build_object('title','Correspondances à résoudre','message',$2::text,'count',$3::int,'url','/review')) ON CONFLICT(user_id,release_key,kind) DO UPDATE SET payload=excluded.payload,read_at=NULL",
    [
      userId,
      `Il reste ${count} favori${count > 1 ? "s" : ""} à vérifier.`,
      count,
    ],
  );
}
async function resolveReview(
  reviewId: string,
  userId: string,
  candidateId: string,
  decision: Record<string, unknown>,
  reply: any,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(
      `SELECT r.*,c.id AS candidate_id,c.provider_id,c.profile_id,p.canonical_title,p.type,p.year,p.url,p.payload,p.payload_hash,p.categories,p.genres,COALESCE(c.media_id,e.media_id) AS media_id FROM favorite_review r JOIN favorite_review candidate_owner ON candidate_owner.user_id=r.user_id AND COALESCE(candidate_owner.cluster_id::text,candidate_owner.id::text)=COALESCE(r.cluster_id::text,r.id::text) JOIN favorite_review_candidate c ON c.review_id=candidate_owner.id AND c.id=$3 LEFT JOIN provider_profile p ON p.id=c.profile_id LEFT JOIN media_external_id e ON e.provider=r.provider AND e.external_id=c.provider_id WHERE r.id=$1 AND r.user_id=$2 AND r.status='PENDING' FOR UPDATE OF r`,
      [reviewId, userId, candidateId],
    );
    if (!row.rowCount) {
      await client.query("ROLLBACK");
      return err(reply, 404, "REVIEW_CANDIDATE_NOT_FOUND");
    }
    const x = row.rows[0];
    const contentPreference=await client.query('SELECT COALESCE((SELECT allow_adult FROM user_catalog_preference WHERE user_id=$1),false) AS "allowAdult"',[userId]);
    if (!contentPreference.rows[0]?.allowAdult && contentTaxonomyExclusion(x)) {
      await client.query("ROLLBACK");
      return err(reply,409,"CONTENT_EXCLUDED","Cette œuvre appartient à une catégorie ou un genre bloqué.");
    }
    if (x.provider === "anilist-chain") {
      const seed = await client.query(
        `SELECT l.media_id FROM bookmark_media_link l
         JOIN bookmark_import_item i USING(user_id,installation_id,bookmark_id)
         WHERE l.user_id=$1 AND l.installation_id=$2 AND l.bookmark_id=$3
           AND l.status IN ('matched','accepted') AND i.event<>'removed'
         FOR UPDATE OF l`,
        [userId, x.installation_id, x.bookmark_id],
      );
      if (!seed.rowCount || !x.media_id) {
        await client.query("ROLLBACK");
        return err(reply, 404, "REVIEW_CANDIDATE_NOT_FOUND");
      }
      await client.query(
        `INSERT INTO user_anime_work_choice(user_id,seed_media_id,selected_media_id,review_id,provenance)
         VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(user_id,seed_media_id) DO NOTHING`,
        [userId, seed.rows[0].media_id, x.media_id, reviewId, JSON.stringify({ reason: "ANIME_CHAIN_AMBIGUOUS", candidateId })],
      );
      const resolved = await client.query(
        `UPDATE favorite_review SET status='RESOLVED',selected_candidate_id=$2,decision=$3::jsonb,resolved_at=now()
         WHERE id=$1 AND user_id=$4 AND status='PENDING' AND decision IS NULL RETURNING id`,
        [reviewId, candidateId, JSON.stringify({ ...decision, kind: "anime-chain-choice", selectedMediaId: x.media_id }), userId],
      );
      if (!resolved.rowCount) {
        await client.query("ROLLBACK");
        return err(reply, 409, "REVIEW_ALREADY_DECIDED");
      }
      await client.query("COMMIT");
      await refreshReviewQueue(userId);
      return { ok: true, reviewId, mediaId: seed.rows[0].media_id, status: "RESOLVED", profileStored: false, coverQueued: false, resolvedSiblingCount: 0 };
    }
    const mediaType = x.provider === "anilist" ? "ANIME" : mangaUpdatesMediaType(x.type) ?? "MANGA";
    let mediaId = x.media_id;
    if (!mediaId) {
      mediaId = `${x.provider}:${x.provider_id}`;
      await client.query(
        "INSERT INTO media(id,type,season_year) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET type=excluded.type,season_year=COALESCE(excluded.season_year,media.season_year),updated_at=now()",
        [mediaId, mediaType, x.year],
      );
      await client.query(
        "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [
          mediaId,
          x.provider,
          x.provider_id,
          { source: "favorite-review", reviewId },
        ],
      );
      await client.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,lower(regexp_replace($2,'[^[:alnum:]]+',' ','g')),NULL,'official','canonical',$3,1,$4) ON CONFLICT DO NOTHING",
        [
          mediaId,
          x.canonical_title,
          x.provider,
          { provider: x.provider, externalId: x.provider_id },
        ],
      );
      await client.query(
        "INSERT INTO media_metadata(media_id,provider,external_id,source_url,status,resolved_at,updated_at) VALUES($1,$2,$3,$4,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET status='ACTIVE',external_id=excluded.external_id,source_url=excluded.source_url,updated_at=now()",
        [mediaId, x.provider, x.provider_id, x.url],
      );
    }
    if(x.provider==='mangaupdates')await client.query("UPDATE media SET type=$2,updated_at=now() WHERE id=$1 AND type IN ('MANGA','MANHWA','MANHUA')",[mediaId,mediaType]);
    await client.query(
      "INSERT INTO provider_payload(media_id,provider,connector_version,collected_at,payload_hash,payload,provenance,validity_status,is_current) VALUES($1,$2,'favorite-review-v1',now(),COALESCE($3,encode(digest($4::jsonb::text,'sha256'),'hex')),$4::jsonb,$5::jsonb,'VALID',true) ON CONFLICT(media_id,provider,connector_version,payload_hash) DO UPDATE SET is_current=true",
      [
        mediaId,
        x.provider,
        x.payload_hash,
        JSON.stringify(x.payload),
        JSON.stringify({
          source: "favorite-review",
          reviewId,
          providerId: x.provider_id,
        }),
      ],
    );
    await client.query(
      "UPDATE favorite_review_candidate SET media_id=$1 WHERE id=$2",
      [mediaId, candidateId],
    );
    await client.query(
      `INSERT INTO media_cover(media_id,source_url,provider,provider_external_id,provenance,mime_type,data,asset_sha256,content_sha256,width,height,byte_size,status,fetched_at,error) SELECT $1,p.cover_source_url,$2,$3,jsonb_build_object('source','favorite-review','reviewId',$4::text,'profileId',p.id::text),'image/webp',NULL,p.cover_asset_sha256,p.cover_asset_sha256,p.cover_width,p.cover_height,p.cover_byte_size,'ACTIVE',now(),NULL FROM provider_profile p WHERE p.id=$5 AND p.cover_status='ACTIVE' AND p.cover_asset_sha256 IS NOT NULL ON CONFLICT(media_id) DO UPDATE SET source_url=excluded.source_url,provider=excluded.provider,provider_external_id=excluded.provider_external_id,provenance=excluded.provenance,mime_type=excluded.mime_type,data=NULL,asset_sha256=excluded.asset_sha256,content_sha256=excluded.content_sha256,width=excluded.width,height=excluded.height,byte_size=excluded.byte_size,status='ACTIVE',fetched_at=now(),error=NULL WHERE media_cover.status IN ('FAILED','STALE','FALLBACK')`,
      [mediaId, x.provider, x.provider_id, reviewId, x.profile_id],
    );
    await client.query(
      "UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=evidence||$2::jsonb WHERE user_id=$3 AND installation_id=$4 AND bookmark_id=$5",
      [
        mediaId,
        JSON.stringify({
          resolution: "user-review",
          provider: x.provider,
          providerId: x.provider_id,
        }),
        userId,
        x.installation_id,
        x.bookmark_id,
      ],
    );
    await client.query(
      "UPDATE favorite_review SET status='RESOLVED',selected_candidate_id=$2,decision=$3,resolved_at=now() WHERE id=$1 AND user_id=$4",
      [
        reviewId,
        candidateId,
        JSON.stringify({ ...decision, profileHash: x.payload_hash }),
        userId,
      ],
    );
    // A deliberate candidate choice becomes the user's current parsed-title
    // answer. Historical reviews stay intact; reimports consult this lock.
    await client.query(`INSERT INTO user_title_resolution_lock(user_id,cluster_key,provider,outcome,profile_id,media_id,source_review_id)
      SELECT r.user_id,cl.cluster_key,r.provider,'MATCH',c.profile_id,$2,r.id
      FROM favorite_review r JOIN review_title_cluster cl ON cl.id=r.cluster_id
      JOIN favorite_review_candidate c ON c.id=$3
      WHERE r.id=$1 AND r.user_id=$4
      ON CONFLICT(user_id,cluster_key) DO UPDATE SET outcome='MATCH',profile_id=excluded.profile_id,media_id=excluded.media_id,source_review_id=excluded.source_review_id,updated_at=now()`,[reviewId,mediaId,candidateId,userId]);
    const siblings = await client.query(
      `WITH sibling AS (SELECT pending.id,pending.installation_id,pending.bookmark_id FROM favorite_review source JOIN favorite_review pending ON pending.user_id=source.user_id AND COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(source.cluster_id::text,source.id::text) AND pending.id<>source.id AND pending.status='PENDING' AND pending.decision IS NULL WHERE source.id=$1 AND source.user_id=$2),linked AS (UPDATE bookmark_media_link l SET media_id=$4,status='matched',evidence=l.evidence||$5::jsonb FROM sibling s WHERE l.user_id=$2 AND l.installation_id=s.installation_id AND l.bookmark_id=s.bookmark_id RETURNING s.id) UPDATE favorite_review r SET status='RESOLVED',selected_candidate_id=$3,decision=jsonb_build_object('kind','same-user-cluster','sourceReviewId',$1::text,'provider',$6::text,'providerId',$7::text,'profileHash',$8::text),resolved_at=now() FROM sibling s WHERE r.id=s.id RETURNING r.id`,
      [
        reviewId,
        userId,
        candidateId,
        mediaId,
        JSON.stringify({
          resolution: "same-user-cluster",
          provider: x.provider,
          providerId: x.provider_id,
        }),
        x.provider,
        x.provider_id,
        x.payload_hash ?? "",
      ],
    );
    await client.query(
      "SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3)",
      [
        x.provider === "anilist"
          ? "anilist-enrichment"
          : "mangaupdates-enrichment",
        JSON.stringify({
          mediaId,
          forceRefresh: true,
          repairAvailability: true,
        }),
        `review-profile:${x.provider}:${x.provider_id}:${x.payload_hash ?? "legacy"}`,
      ],
    );
    await client.query("COMMIT");
    await refreshReviewQueue(userId);
    return {
      ok: true,
      reviewId,
      mediaId,
      status: "RESOLVED",
      profileStored: true,
      coverQueued: true,
      resolvedSiblingCount: siblings.rowCount ?? 0,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function recordCollectiveEndorsement(reviewId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT r.cluster_id,c.profile_id,cl.epoch FROM favorite_review r JOIN favorite_review_candidate c ON c.id=r.selected_candidate_id JOIN review_title_cluster cl ON cl.id=r.cluster_id WHERE r.id=$1 AND r.user_id=$2 AND r.status='RESOLVED' AND EXISTS(SELECT 1 FROM bookmark_media_link l WHERE l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id AND l.status IN ('matched','accepted')) FOR UPDATE OF cl`,
      [reviewId, userId],
    );
    if (!locked.rowCount) {
      await client.query("ROLLBACK");
      return;
    }
    const x = locked.rows[0];
    await client.query(
      `INSERT INTO review_cluster_endorsement(cluster_id,epoch,user_id,profile_id,review_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [x.cluster_id, x.epoch, userId, x.profile_id, reviewId],
    );
    await client.query(
      `UPDATE review_cluster_candidate SET locked_at=now() WHERE cluster_id=$1 AND profile_id=$2 AND locked_at IS NULL AND (SELECT count(DISTINCT user_id) FROM review_cluster_endorsement WHERE cluster_id=$1 AND profile_id=$2)>=2`,
      [x.cluster_id, x.profile_id],
    );
    await client.query("SELECT favlib_promote_collective_endorsements($1)", [
      x.cluster_id,
    ]);
    const tally = await client.query(
      `SELECT profile_id,count(DISTINCT user_id)::int AS votes FROM review_cluster_vote WHERE cluster_id=$1 AND epoch=$2 GROUP BY profile_id HAVING count(DISTINCT user_id)>=2 ORDER BY votes DESC,profile_id`,
      [x.cluster_id, x.epoch],
    );
    if (tally.rows.length >= 2)
      await client.query(
        `UPDATE review_title_cluster SET state='HOMONYM_REQUIRED',consensus_profile_id=NULL,updated_at=now() WHERE id=$1`,
        [x.cluster_id],
      );
    else if (tally.rows.length)
      await client.query(
        `UPDATE review_title_cluster SET state='CONFIRMED',consensus_profile_id=$2,updated_at=now() WHERE id=$1`,
        [x.cluster_id, tally.rows[0].profile_id],
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
app.post("/api/v1/reviews/:id/resolve", async (req: any, reply: any) => {
  const p = z.object({ candidateId: z.string().uuid() }).safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const result = await resolveReview(
    req.params.id,
    req.user.id,
    p.data.candidateId,
    { kind: "candidate" },
    reply,
  );
  if ((result as any)?.ok)
    await recordCollectiveEndorsement(req.params.id, req.user.id);
  return result;
});
app.post("/api/v1/reviews/:id/no-match", async (req: any, reply: any) => {
  const r = await pool.query(
    `UPDATE favorite_review pending SET status='NO_MATCH',decision=$3::jsonb,resolved_at=now() FROM favorite_review source WHERE source.id=$1 AND source.user_id=$2 AND pending.user_id=source.user_id AND COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(source.cluster_id::text,source.id::text) AND pending.status='PENDING' AND pending.decision IS NULL RETURNING pending.id`,
    [req.params.id, req.user.id, JSON.stringify({ kind: "no-match" })],
  );
  if (!r.rowCount) return err(reply, 404, "REVIEW_NOT_FOUND");
  await pool.query(`INSERT INTO user_title_resolution_lock(user_id,cluster_key,provider,outcome,profile_id,media_id,source_review_id)
    SELECT source.user_id,cluster.cluster_key,source.provider,'NO_MATCH',NULL,NULL,source.id
    FROM favorite_review source JOIN review_title_cluster cluster ON cluster.id=source.cluster_id
    WHERE source.id=$1 AND source.user_id=$2
    ON CONFLICT(user_id,cluster_key) DO UPDATE SET outcome='NO_MATCH',profile_id=NULL,media_id=NULL,source_review_id=excluded.source_review_id,updated_at=now()`,[req.params.id,req.user.id]);
  await refreshReviewQueue(req.user.id);
  return { ok: true, status: "NO_MATCH" };
});
app.post("/api/v1/reviews/:id/manual", async (req: any, reply: any) => {
  const p = z
    .object({
      provider: z.enum(["anilist", "mangaupdates"]),
      id: z.string().trim().min(1).max(80).optional(),
      url: z.string().url().optional(),
    })
    .strict()
    .refine((v) => Boolean(v.id || v.url))
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const owned = await pool.query(
    "SELECT provider FROM favorite_review WHERE id=$1 AND user_id=$2 AND status='PENDING' AND decision IS NULL",
    [req.params.id, req.user.id],
  );
  if (!owned.rowCount) return err(reply, 404, "REVIEW_NOT_FOUND");
  if (owned.rows[0].provider !== p.data.provider)
    return err(reply, 422, "PROVIDER_MISMATCH");
  const id = p.data.url
    ? providerIdFromUrl(p.data.provider, p.data.url)
    : p.data.id;
  if (!id)
    return err(
      reply,
      422,
      p.data.url ? "PROVIDER_URL_INVALID" : "PROVIDER_ID_INVALID",
    );
  const validId =
    p.data.provider === "anilist"
      ? /^\d{1,12}$/u.test(id)
      : /^[A-Za-z0-9]{1,80}$/u.test(id);
  if (!validId) return err(reply, 422, "PROVIDER_ID_INVALID");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const manualDecision = JSON.stringify({ kind: "manual-queued", provider: p.data.provider, id, submittedAt: new Date().toISOString() });
    const persisted = await client.query(
      `WITH source AS (
        UPDATE favorite_review SET decision=$3::jsonb,reason='MANUAL_QUEUED'
        WHERE id=$1 AND user_id=$2 AND status='PENDING' AND decision IS NULL
        RETURNING id,user_id,cluster_id
      ), siblings AS (
        UPDATE favorite_review pending SET
          decision=$3::jsonb||jsonb_build_object('sourceReviewId',$1::text),reason='MANUAL_QUEUED'
        FROM source
        WHERE pending.user_id=source.user_id
          AND COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(source.cluster_id::text,source.id::text)
          AND pending.status='PENDING' AND pending.decision IS NULL
        RETURNING pending.id
      ) SELECT id FROM source`,
      [req.params.id, req.user.id, manualDecision],
    );
    if (!persisted.rowCount) { await client.query("ROLLBACK"); return err(reply, 409, "REVIEW_ALREADY_QUEUED"); }
    await client.query(
      "SELECT graphile_worker.add_job('manual-review-provider',$1,job_key := $2,max_attempts := 3,priority := -100,job_key_mode := 'preserve_run_at')",
      [JSON.stringify({ reviewId: req.params.id, userId: req.user.id, provider: p.data.provider, providerId: id }), `manual-review:${req.params.id}:${p.data.provider}:${id}`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await refreshReviewQueue(req.user.id);
  return reply
    .code(202)
    .send({
      ok: true,
      status: "QUEUED",
      reviewId: req.params.id,
      provider: p.data.provider,
      providerId: id,
    });
});
app.post("/api/v1/reviews/:id/report", async (req: any, reply: any) => {
  const p = reviewReportContract.safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const row=await pool.query(`SELECT l.media_id FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id WHERE r.id=$1 AND r.user_id=$2 AND r.status='RESOLVED' AND l.status IN ('matched','accepted') LIMIT 1`,[req.params.id,req.user.id]);
  if(!row.rowCount)return err(reply,403,'ACTIVE_FAVORITE_REQUIRED');
  const identity=(await reportingForMedia([row.rows[0].media_id],req.user.id)).get(row.rows[0].media_id)?.identity;
  if(!identity)return err(reply,409,'REPORT_SUBJECT_STALE');
  const submitted=await submitAdjudicatedReport(req.user.id,{family:'IDENTITY',mediaId:row.rows[0].media_id,subjectKey:identity.subjectKey,evidenceRevision:identity.evidenceRevision,reason:p.data.reason,details:p.data.details},req.requestId);
  if(submitted.error!==undefined)return err(reply,409,submitted.error);
  return reply.code(201).send({ok:true,caseId:submitted.caseId,status:'PENDING',suspended:false});
});
app.post("/api/v1/revalidations/:id/skip", async (req: any, reply: any) => {
  const row = await pool.query(
    `UPDATE review_revalidation SET status='SKIPPED',resolved_at=now() WHERE id=$1 AND user_id=$2 AND status='PENDING' RETURNING id`,
    [req.params.id, req.user.id],
  );
  if (!row.rowCount) return err(reply, 404, "REVALIDATION_NOT_FOUND");
  return { ok: true, status: "SKIPPED" };
});
app.get("/api/v1/revalidations", async (req: any) => {
  const rows = await pool.query(
    `SELECT rv.id,rv.cluster_id AS "clusterId",rv.epoch,rv.status,rv.selected_profile_id AS "selectedProfileId",rv.created_at AS "createdAt",cl.state AS "collectiveState",cl.parsed_title AS title FROM review_revalidation rv JOIN review_title_cluster cl ON cl.id=rv.cluster_id WHERE rv.user_id=$1 ORDER BY (rv.status='PENDING') DESC,rv.created_at DESC`,
    [req.user.id],
  );
  return { items: rows.rows };
});
app.post("/api/v1/revalidations/:id/choose", async (req: any, reply: any) => {
  const p = z
    .object({ profileId: z.string().uuid() })
    .strict()
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(
      `UPDATE review_revalidation rv SET status='CHOSEN',selected_profile_id=$3,resolved_at=now() WHERE rv.id=$1 AND rv.user_id=$2 AND rv.status='PENDING' AND EXISTS(SELECT 1 FROM review_cluster_candidate cc WHERE cc.cluster_id=rv.cluster_id AND cc.profile_id=$3) RETURNING id,cluster_id,epoch`,
      [req.params.id, req.user.id, p.data.profileId],
    );
    if (!row.rowCount) {
      await client.query("ROLLBACK");
      return err(reply, 404, "REVALIDATION_NOT_FOUND");
    }
    const x = row.rows[0];
    await client.query(
      `INSERT INTO review_cluster_endorsement(cluster_id,epoch,user_id,profile_id,revalidation_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [x.cluster_id, x.epoch, req.user.id, p.data.profileId, x.id],
    );
    await client.query("SELECT favlib_promote_collective_endorsements($1)", [
      x.cluster_id,
    ]);
    await client.query("COMMIT");
    return { ok: true, status: "CHOSEN" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post(
  "/api/v1/admin/review-clusters/:id/choose",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const parsed = z
      .object({ profileId: z.string().uuid() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cluster = await client.query(
        `SELECT id,state,consensus_profile_id FROM review_title_cluster WHERE id=$1 FOR UPDATE`,
        [req.params.id],
      );
      if (!cluster.rowCount) {
        await client.query("ROLLBACK");
        return err(reply, 404, "REVIEW_CLUSTER_NOT_FOUND");
      }
      const candidate = await client.query(
        `SELECT 1 FROM review_cluster_candidate WHERE cluster_id=$1 AND profile_id=$2`,
        [req.params.id, parsed.data.profileId],
      );
      if (!candidate.rowCount) {
        await client.query("ROLLBACK");
        return err(reply, 404, "REVIEW_CLUSTER_CANDIDATE_NOT_FOUND");
      }
      await client.query(
        `UPDATE review_cluster_candidate SET locked_at=COALESCE(locked_at,now()) WHERE cluster_id=$1 AND profile_id=$2`,
        [req.params.id, parsed.data.profileId],
      );
      const ambiguity = await client.query(
        `SELECT count(*)::int AS qualified FROM review_cluster_candidate WHERE cluster_id=$1 AND locked_at IS NOT NULL`,
        [req.params.id],
      );
      const qualified = Number(ambiguity.rows[0]?.qualified ?? 0);
      const resultingState = qualified >= 2 ? "HOMONYM_REQUIRED" : "CONFIRMED";
      const decision = await client.query(
        `INSERT INTO review_cluster_admin_decision(cluster_id,actor_user_id,action,selected_profile_id,previous_state,previous_consensus_profile_id,resulting_state,resulting_consensus_profile_id,request_id) VALUES($1,$2,'CHOOSE',$3,$4,$5,$6,$3,$7) RETURNING id`,
        [
          req.params.id,
          req.user.id,
          parsed.data.profileId,
          cluster.rows[0].state,
          cluster.rows[0].consensus_profile_id,
          resultingState,
          req.requestId,
        ],
      );
      await client.query(
        `UPDATE review_title_cluster SET state=$2,consensus_profile_id=$3,current_admin_decision_id=$4,updated_at=now() WHERE id=$1`,
        [
          req.params.id,
          resultingState,
          parsed.data.profileId,
          decision.rows[0].id,
        ],
      );
      await client.query(
        `INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'review_cluster_choose','review_title_cluster',$2,$3::jsonb,$4)`,
        [
          req.user.id,
          req.params.id,
          JSON.stringify({
            decisionId: decision.rows[0].id,
            profileId: parsed.data.profileId,
            resultingState,
          }),
          req.requestId,
        ],
      );
      await client.query("COMMIT");
      return {
        ok: true,
        decisionId: decision.rows[0].id,
        state: resultingState,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);
app.get(
  "/api/v1/admin/review-clusters/:id/history",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const rows = await pool.query(
      `SELECT id,action,selected_profile_id AS "selectedProfileId",previous_state AS "previousState",resulting_state AS "resultingState",reverted_decision_id AS "revertedDecisionId",created_at AS "createdAt" FROM review_cluster_admin_decision WHERE cluster_id=$1 ORDER BY created_at DESC,id DESC`,
      [req.params.id],
    );
    return { items: rows.rows };
  },
);
app.post(
  "/api/v1/admin/review-clusters/:id/revert",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT cl.id,cl.state,cl.consensus_profile_id,d.id AS decision_id,d.previous_state,d.previous_consensus_profile_id FROM review_title_cluster cl JOIN review_cluster_admin_decision d ON d.id=cl.current_admin_decision_id AND d.action='CHOOSE' WHERE cl.id=$1 FOR UPDATE OF cl`,
        [req.params.id],
      );
      if (!current.rowCount) {
        await client.query("ROLLBACK");
        return err(reply, 409, "ADMIN_REVIEW_DECISION_NOT_REVERSIBLE");
      }
      const x = current.rows[0];
      const tally = await client.query(
        `SELECT profile_id,count(DISTINCT user_id)::int AS votes FROM review_cluster_vote WHERE cluster_id=$1 AND epoch=(SELECT epoch FROM review_title_cluster WHERE id=$1) GROUP BY profile_id HAVING count(DISTINCT user_id)>=2 ORDER BY votes DESC,profile_id`,
        [req.params.id],
      );
      const resultingState =
        tally.rows.length >= 2
          ? "HOMONYM_REQUIRED"
          : tally.rows.length === 1
            ? "CONFIRMED"
            : "PROVISIONAL";
      const resultingProfile =
        tally.rows.length === 1 ? tally.rows[0].profile_id : null;
      const history = await client.query(
        `INSERT INTO review_cluster_admin_decision(cluster_id,actor_user_id,action,previous_state,previous_consensus_profile_id,resulting_state,resulting_consensus_profile_id,reverted_decision_id,request_id) VALUES($1,$2,'REVERT',$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          req.params.id,
          req.user.id,
          x.state,
          x.consensus_profile_id,
          resultingState,
          resultingProfile,
          x.decision_id,
          req.requestId,
        ],
      );
      await client.query(
        `UPDATE review_title_cluster SET state=$2,consensus_profile_id=$3,current_admin_decision_id=NULL,updated_at=now() WHERE id=$1`,
        [req.params.id, resultingState, resultingProfile],
      );
      await client.query(
        `INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'review_cluster_revert','review_title_cluster',$2,$3::jsonb,$4)`,
        [
          req.user.id,
          req.params.id,
          JSON.stringify({
            decisionId: history.rows[0].id,
            revertedDecisionId: x.decision_id,
          }),
          req.requestId,
        ],
      );
      await client.query("COMMIT");
      return {
        ok: true,
        decisionId: history.rows[0].id,
        state: resultingState,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);
type CalendarFilters = {
  followed?: boolean;
  favorites?: boolean;
  mediaTypes?: string[];
  genres?: string[];
  metadataCategories?: string[];
  from?: string;
  to?: string;
  direction?: "asc" | "desc";
};
const calendarFilters = z
  .object({
    followed: z.boolean().optional(),
    favorites: z.boolean().optional(),
    mediaTypes: z
      .array(z.enum(["ANIME", "MANGA", "MANHWA", "MANHUA"]))
      .max(4)
      .optional(),
    genres: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    metadataCategories: z
      .array(z.string().trim().min(1).max(100))
      .max(50)
      .optional(),
  })
  .default({});
function calendarLocal(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
async function calendarRows(
  userId: string,
  filters: CalendarFilters,
  timeZone = "UTC",
  limit = 10000,
  offset = 0,
) {
  const types = filters.mediaTypes?.length ? filters.mediaTypes : null;
  const genres = filters.genres?.length
    ? filters.genres.map((value) => value.toLocaleLowerCase())
    : null;
  const metadataCategories = filters.metadataCategories?.length
    ? filters.metadataCategories.map((value) => value.toLocaleLowerCase())
    : null;
  const favoritesOnly = filters.favorites ?? filters.followed ?? false;
  const now = Date.now();
  const from = filters.from ?? new Date(now - 30 * 86_400_000).toISOString();
  const to = filters.to ?? new Date(now + 370 * 86_400_000).toISOString();
  const direction = filters.direction ?? "asc";
  const result = await pool.query(
    `WITH favorite_media AS (SELECT DISTINCT media_id FROM bookmark_media_link WHERE user_id=$1::uuid AND status IN ('matched','accepted','review') AND media_id IS NOT NULL), latest_mu AS (
    SELECT DISTINCT ON (o.media_id,o.provider_release_key) o.*
    FROM mangaupdates_release_observation o
    WHERE o.release_date IS NOT NULL
    ORDER BY o.media_id,o.provider_release_key,o.observed_at DESC,o.id DESC
  ), events AS (
    SELECT 'release'::text AS category,m.type AS event_type,o.media_id,o.provider_release_key AS release_key,o.release_date AS starts_at,'DATE'::text AS time_precision,o.observed_at,'mangaupdates'::text AS provider,'ANNOUNCED'::text AS status,o.chapter,o.volume,o.groups,o.languages
    FROM latest_mu o JOIN media m ON m.id=o.media_id
    WHERE m.type IN ('MANGA','MANHWA','MANHUA')
    UNION ALL
    SELECT 'airing'::text,m.type,a.media_id,'episode:'||a.episode::text,a.airing_at_utc,a.precision,a.last_verified_at,a.provider,a.schedule_status,NULL,a.episode::text,NULL,NULL
    FROM media_airing a JOIN media m ON m.id=a.media_id
    WHERE m.type='ANIME' AND a.schedule_status='SCHEDULED'
  ) SELECT e.category,e.event_type AS "type",e.media_id AS "mediaId",e.release_key AS "releaseKey",e.provider,e.status,e.starts_at AS "startsAt",e.time_precision AS "timePrecision",e.observed_at AS "observedAt",e.chapter,e.volume,e.groups,e.languages,
    COALESCE(favlib_display_title(e.media_id,$1::uuid)->>'title',e.media_id) AS title,
    favlib_display_title(e.media_id,$1::uuid) AS "titleSelection",
    (SELECT favlib_clean_display_title(t.text) FROM media_title t WHERE t.media_id=e.media_id AND t.kind='personal' AND t.provenance->>'userId'=$1::text AND favlib_clean_display_title(t.text) IS NOT NULL ORDER BY t.id DESC LIMIT 1) AS "personalTitle",
    CASE WHEN c.media_id IS NOT NULL AND (c.data IS NOT NULL OR c.asset_sha256 IS NOT NULL) THEN '/api/v1/catalog/public-media/'||replace(e.media_id,'/','%2F')||'/cover' END AS "coverUrl",
    (SELECT COALESCE(jsonb_agg(DISTINCT genre_value ORDER BY genre_value), '[]'::jsonb) FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements_text(a.value) genre_value WHERE a.media_id=e.media_id AND a.field='genres' AND jsonb_typeof(a.value)='array') AS genres,
    (SELECT COALESCE(jsonb_agg(DISTINCT category_value ORDER BY category_value), '[]'::jsonb) FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements_text(a.value) category_value WHERE a.media_id=e.media_id AND a.field='categories' AND jsonb_typeof(a.value)='array') AS categories,
    (SELECT CASE WHEN jsonb_typeof(a.value)='number' THEN (a.value #>> '{}')::int WHEN jsonb_typeof(a.value)='string' AND (a.value #>> '{}') ~ '^[0-9]+$' THEN (a.value #>> '{}')::int END FROM metadata_assertion a WHERE a.media_id=e.media_id AND a.field IN ('episodes','episodeCount') ORDER BY a.asserted_at DESC LIMIT 1) AS "episodeTotal",count(*) OVER()::int AS "total"
  FROM events e LEFT JOIN media_cover c ON c.media_id=e.media_id AND c.status='ACTIVE'
  WHERE ${contentAllowedSql('e.media_id')}
    AND ($2::text[] IS NULL OR e.event_type=ANY($2))
    AND ($3::text[] IS NULL OR EXISTS(SELECT 1 FROM metadata_assertion ga CROSS JOIN LATERAL jsonb_array_elements_text(ga.value) genre_value WHERE ga.media_id=e.media_id AND ga.field='genres' AND lower(genre_value)=ANY($3)))
    AND ($10::text[] IS NULL OR EXISTS(SELECT 1 FROM metadata_assertion ca CROSS JOIN LATERAL jsonb_array_elements_text(ca.value) category_value WHERE ca.media_id=e.media_id AND ca.field='categories' AND lower(category_value)=ANY($10)))
    AND ($7::boolean=false OR e.media_id IN (SELECT media_id FROM favorite_media))
    AND e.starts_at >= $4::timestamptz AND e.starts_at < $5::timestamptz
  ORDER BY CASE WHEN $6='asc' THEN e.starts_at END ASC,CASE WHEN $6='desc' THEN e.starts_at END DESC,e.media_id,e.release_key LIMIT $8 OFFSET $9`,
    [
      userId,
      types,
      genres,
      from,
      to,
      direction,
      favoritesOnly,
      limit,
      offset,
      metadataCategories,
    ],
  );
  return result.rows.map((row: any) => ({
    ...row,
    chapterDisplay: chapterDisplay(row.chapter),
    localStart: calendarLocal(new Date(row.startsAt).toISOString(), timeZone),
    startsAtUtc: new Date(row.startsAt).toISOString(),
  }));
}
function icsEscape(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}
function icsDate(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
function calendarEventLabel(row: any) {
  return (
    [
      row.volume && `Volume ${row.volume}`,
      row.chapterDisplay ?? chapterDisplay(row.chapter),
    ]
      .filter(Boolean)
      .join(" · ") || "Nouvelle release"
  );
}
function calendarIcs(rows: any[], timeZone: string) {
  const now = icsDate(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FavLib//Calendar//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:" + icsEscape(timeZone),
  ];
  for (const row of rows) {
    const uid = `${row.category}-${row.mediaId}-${row.releaseKey}@favlib`;
    const end = new Date(
      new Date(row.startsAt).getTime() + 60 * 60 * 1000,
    ).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(row.startsAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(`${calendarEventLabel(row)} · ${row.personalTitle ?? row.title}`)}`,
      `DESCRIPTION:${icsEscape(`${row.title}${row.personalTitle ? ` · Favori : ${row.personalTitle}` : ""} · ${row.provider}`)}`,
      "CATEGORIES:MANGA RELEASE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
app.get("/api/v1/calendar/latest", async (req: any) => {
  const pref = await pool.query(
    "SELECT timezone FROM user_catalog_preference WHERE user_id=$1::uuid",
    [req.user.id],
  );
  const timeZone = pref.rows[0]?.timezone ?? "UTC";
  const now = Date.now();
  const items = await calendarRows(
    req.user.id,
    {
      from: new Date(now - 10 * 365 * 86_400_000).toISOString(),
      to: new Date(now + 7 * 86_400_000).toISOString(),
      direction: "desc",
      favorites: true,
    },
    timeZone,
  );
  return { items: items.slice(0, 6), timeZone };
});
app.get("/api/v1/calendar", async (req: any, reply: any) => {
  const range = z
    .object({
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
    })
    .refine(
      (value) =>
        !value.from || !value.to || new Date(value.from) < new Date(value.to),
    );
  const parsed = calendarFilters.safeParse({
    followed:
      req.query?.followed === undefined
        ? undefined
        : req.query.followed !== "false",
    favorites:
      req.query?.favorites === undefined
        ? true
        : req.query.favorites !== "false",
    genres:
      typeof req.query?.genre === "string"
        ? req.query.genre.split(",")
        : undefined,
    metadataCategories:
      typeof req.query?.metadataCategory === "string"
        ? req.query.metadataCategory.split(",")
        : undefined,
    mediaTypes:
      typeof req.query?.type === "string"
        ? req.query.type.split(",")
        : undefined,
  });
  const parsedRange = range.safeParse({
    from: req.query?.from,
    to: req.query?.to,
  });
  const cursor = Number.parseInt(String(req.query?.cursor ?? "0"), 10);
  if (
    !parsed.success ||
    !parsedRange.success ||
    !Number.isInteger(cursor) ||
    cursor < 0
  )
    return err(
      reply,
      400,
      "VALIDATION_FAILED",
      "Filtres calendrier invalides.",
    );
  const pref = await pool.query(
    "SELECT timezone FROM user_catalog_preference WHERE user_id=$1::uuid",
    [req.user.id],
  );
  let timeZone = pref.rows[0]?.timezone ?? "UTC";
  if (typeof req.query?.timezone === "string") {
    try {
      new Intl.DateTimeFormat("en-US", {
        timeZone: req.query.timezone,
      }).format();
      timeZone = req.query.timezone;
    } catch {}
  }
  const filters = { ...parsed.data, ...parsedRange.data };
  const items = await calendarRows(req.user.id, filters, timeZone, 200, cursor);
  const total = Number(items[0]?.total ?? 0);
  const facetRows =
    cursor === 0
      ? await calendarRows(
          req.user.id,
          { ...filters, genres: undefined, metadataCategories: undefined },
          timeZone,
          10000,
          0,
        )
      : [];
  const facet = (key: "genres" | "categories") =>
    Object.entries(
      facetRows
        .flatMap((item: any) => item[key] ?? [])
        .reduce(
          (counts: Record<string, number>, value: string) => (
            (counts[value] = (counts[value] ?? 0) + 1),
            counts
          ),
          {},
        ),
    )
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  return {
    items: items.map(({ total: _total, ...item }: any) => item),
    total,
    nextCursor:
      cursor + items.length < total ? String(cursor + items.length) : null,
    timeZone,
    filters,
    facets: { genres: facet("genres"), categories: facet("categories") },
  };
});
app.get("/api/v1/calendar/feeds", async (req: any) => {
  const rows = await pool.query(
    'SELECT id,label,filters,created_at AS "createdAt",last_used_at AS "lastUsedAt",revoked_at AS "revokedAt" FROM calendar_feed WHERE user_id=$1::uuid ORDER BY created_at DESC',
    [req.user.id],
  );
  return {
    items: rows.rows.map((row: any) => ({
      ...row,
      url: null,
      tokenAvailable: false,
    })),
  };
});
app.post("/api/v1/calendar/feeds", async (req: any, reply: any) => {
  const parsed = z
    .object({
      label: z.string().trim().min(1).max(80).default("FavLib"),
      filters: calendarFilters.default({}),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success)
    return err(reply, 400, "VALIDATION_FAILED", "Filtres de flux invalides.");
  const token = newOpaqueSecret(36);
  const row = await pool.query(
    'INSERT INTO calendar_feed(user_id,token_hash,label,filters) VALUES($1,$2,$3,$4) RETURNING id,label,filters,created_at AS "createdAt"',
    [
      req.user.id,
      digest(token),
      parsed.data.label,
      JSON.stringify(parsed.data.filters),
    ],
  );
  return reply
    .code(201)
    .send({
      ...row.rows[0],
      url: `${origin}/api/v1/calendar/feeds/${row.rows[0].id}?token=${encodeURIComponent(token)}`,
      token,
    });
});
app.post(
  "/api/v1/calendar/feeds/:id/regenerate",
  async (req: any, reply: any) => {
    const token = newOpaqueSecret(36);
    const row = await pool.query(
      'UPDATE calendar_feed SET token_hash=$1,revoked_at=NULL WHERE id=$2 AND user_id=$3 RETURNING id,label,filters,created_at AS "createdAt"',
      [digest(token), req.params.id, req.user.id],
    );
    if (!row.rowCount) return err(reply, 404, "CALENDAR_FEED_NOT_FOUND");
    return {
      ...row.rows[0],
      url: `${origin}/api/v1/calendar/feeds/${row.rows[0].id}?token=${encodeURIComponent(token)}`,
      token,
    };
  },
);
app.delete("/api/v1/calendar/feeds/:id", async (req: any, reply: any) => {
  const row = await pool.query(
    "UPDATE calendar_feed SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!row.rowCount) return err(reply, 404, "CALENDAR_FEED_NOT_FOUND");
  return { ok: true };
});
app.get("/api/v1/calendar/feeds/:id", async (req: any, reply: any) => {
  const token = typeof req.query?.token === "string" ? req.query.token : "";
  const row = await pool.query(
    "SELECT * FROM calendar_feed WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL",
    [req.params.id, digest(token)],
  );
  if (!row.rowCount)
    return err(
      reply,
      404,
      "CALENDAR_FEED_NOT_FOUND",
      "Flux inexistant, révoqué ou jeton invalide.",
    );
  const pref = await pool.query(
    "SELECT timezone FROM user_catalog_preference WHERE user_id=$1",
    [row.rows[0].user_id],
  );
  const timeZone = pref.rows[0]?.timezone ?? "UTC";
  const rows = await calendarRows(
    row.rows[0].user_id,
    row.rows[0].filters ?? {},
    timeZone,
  );
  await pool.query("UPDATE calendar_feed SET last_used_at=now() WHERE id=$1", [
    req.params.id,
  ]);
  return reply
    .header("Content-Type", "text/calendar; charset=utf-8")
    .header("Cache-Control", "private, no-store")
    .send(calendarIcs(rows, timeZone));
});
app.get("/api/v1/preferences/catalog-timezone", async (req: any) => {
  const r = await pool.query(
    'SELECT timezone,updated_at AS "updatedAt" FROM user_catalog_preference WHERE user_id=$1',
    [req.user.id],
  );
  return r.rows[0] ?? { timezone: "UTC", updatedAt: null };
});
app.patch(
  "/api/v1/preferences/catalog-timezone",
  async (req: any, reply: any) => {
    const parsed = z
      .object({ timezone: z.string().min(1).max(100) })
      .safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
    try {
      new Intl.DateTimeFormat("en-US", {
        timeZone: parsed.data.timezone,
      }).format();
    } catch {
      return err(
        reply,
        422,
        "TIMEZONE_INVALID",
        "Le fuseau doit être un identifiant IANA valide.",
      );
    }
    const r = await pool.query(
      'INSERT INTO user_catalog_preference(user_id,timezone,updated_at) VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone,updated_at=now() RETURNING timezone,updated_at AS "updatedAt"',
      [req.user.id, parsed.data.timezone],
    );
    return r.rows[0];
  },
);
app.get("/api/v1/preferences/content", async (req: any) => {
  const result=await pool.query('SELECT allow_adult AS "allowAdult",updated_at AS "updatedAt" FROM user_catalog_preference WHERE user_id=$1',[req.user.id]);
  return result.rows[0]??{allowAdult:false,updatedAt:null};
});
app.patch("/api/v1/preferences/content", async (req: any, reply: any) => {
  const parsed=contentPreferencePatchContract.safeParse(req.body);
  if(!parsed.success)return err(reply,400,"VALIDATION_FAILED","Préférence de contenu invalide.",parsed.error.issues);
  const result=await pool.query(`INSERT INTO user_catalog_preference(user_id,allow_adult,updated_at) VALUES($1,$2,now())
    ON CONFLICT(user_id) DO UPDATE SET allow_adult=excluded.allow_adult,updated_at=now()
    RETURNING allow_adult AS "allowAdult",updated_at AS "updatedAt"`,[req.user.id,parsed.data.allowAdult]);
  await pool.query('SELECT favlib_recalculate_user_content_visibility($1::uuid)',[req.user.id]);
  await refreshReviewQueue(req.user.id);
  return result.rows[0];
});
app.get("/api/v1/preferences/languages", async (req: any) => {
  const r=await pool.query('SELECT preferred_languages AS "preferredLanguages",updated_at AS "updatedAt" FROM user_catalog_preference WHERE user_id=$1',[req.user.id]);
  return r.rows[0]??{preferredLanguages:[],updatedAt:null};
});
app.patch("/api/v1/preferences/languages", async (req: any, reply: any) => {
  const parsed=languagePreferencePatchContract.safeParse(req.body);
  if(!parsed.success)return err(reply,400,"VALIDATION_FAILED","Préférences de langue invalides.",parsed.error.issues);
  const languages=[...new Set(parsed.data.preferredLanguages.map(value=>value.replace(/_/g,'-').toLowerCase()))];
  const r=await pool.query('INSERT INTO user_catalog_preference(user_id,preferred_languages,updated_at) VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET preferred_languages=excluded.preferred_languages,updated_at=now() RETURNING preferred_languages AS "preferredLanguages",updated_at AS "updatedAt"',[req.user.id,languages]);
  return r.rows[0];
});
app.post("/api/v1/notifications/:id/read", async (req: any, reply: any) => {
  const r = await pool.query(
    "UPDATE personal_notification SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!r.rowCount) return err(reply, 404, "NOTIFICATION_NOT_FOUND");
  return { ok: true };
});
app.post("/api/v1/admin/announcements", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const p = z
    .object({
      provider: z.string().min(1).max(100),
      announcements: z
        .array(
          z.object({
            mediaId: z.string().min(1).max(300),
            releaseKey: z.string().min(1).max(500),
            status: z.enum(["SCHEDULED", "ANNOUNCED"]),
            announcedAt: z.string().datetime(),
            provenance: z.record(z.string(), z.unknown()).default({}),
          }),
        )
        .min(1)
        .max(1000),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const policy = await pool.query(
    "SELECT status FROM catalog_provider_policy WHERE provider=$1",
    [p.data.provider],
  );
  if (!policy.rowCount || policy.rows[0].status !== "AUTHORIZED")
    return err(reply, 403, "PROVIDER_POLICY_NOT_AUTHORIZED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const announcement of p.data.announcements)
      await client.query(
        "INSERT INTO release_announcement(media_id,release_key,provider,status,announced_at,provenance) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,release_key) DO UPDATE SET media_id=excluded.media_id,status=excluded.status,announced_at=excluded.announced_at,provenance=excluded.provenance",
        [
          announcement.mediaId,
          announcement.releaseKey,
          p.data.provider,
          announcement.status,
          announcement.announcedAt,
          JSON.stringify(announcement.provenance),
        ],
      );
    await client.query("COMMIT");
    return reply
      .code(202)
      .send({ ok: true, accepted: p.data.announcements.length });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
async function catalogRows(userId:string,query: string, mediaId?: string) {
  const r = await pool.query(
    `SELECT m.id,m.type,m.season_year AS "seasonYear",m.country_of_origin AS "countryOfOrigin",m.format,(SELECT jsonb_object_agg(a.field,a.value) FROM metadata_assertion a WHERE a.media_id=m.id AND a.provider IN ('anilist','mangaupdates')) AS metadata,COALESCE((SELECT jsonb_build_object('provider',c.provider,'sourceUrl',c.source_url,'attribution',c.attribution,'fetchedAt',c.fetched_at) FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE'),(SELECT jsonb_build_object('provider',c.provider,'sourceUrl',c.source_url,'attribution',c.attribution,'fetchedAt',c.fetched_at,'provenance',jsonb_build_object('source','media-identity-merge','targetMediaId',im.target_media_id)) FROM media_identity_merge im JOIN media_cover c ON c.media_id=im.target_media_id AND c.status='ACTIVE' WHERE im.source_media_id=m.id LIMIT 1)) AS "coverProvenance",COALESCE(json_agg(jsonb_build_object('text',t.text,'language',t.language,'kind',t.kind,'connector',t.connector)) FILTER (WHERE t.id IS NOT NULL),'[]'::json) AS titles FROM media m LEFT JOIN media_title t ON t.media_id=m.id WHERE ${contentAllowedSql('m.id','$2')} AND ($1='' OR m.id=$1 OR t.normalized_text LIKE '%'||lower($1)||'%') GROUP BY m.id ORDER BY m.id LIMIT 50`,
    [mediaId ?? query,userId],
  );
  return r.rows as CatalogMedia[];
}
const relatedWorkClosureSql = (mediaIdsPlaceholder: string) => `WITH RECURSIVE requested(card_id,root_id) AS (
      SELECT input_media_id,COALESCE((SELECT root_media_id FROM anime_work_member WHERE media_id=input_media_id),input_media_id)
      FROM unnest(${mediaIdsPlaceholder}::text[]) input_media_id
    ),
    graph_edges(source_id,target_id,relation_type) AS (
      SELECT relation.media_id,relation.target_media_id,relation.kind FROM media_relation relation
      WHERE relation.kind<>'canonical_variant'
      UNION ALL
      SELECT relation.target_media_id,relation.media_id,
        CASE WHEN relation.kind='PREQUEL' THEN 'SEQUEL' WHEN relation.kind='SEQUEL' THEN 'PREQUEL' ELSE relation.kind END
      FROM media_relation relation
      WHERE relation.kind<>'canonical_variant'
      UNION ALL
      SELECT member.root_media_id,member.media_id,'SEQUENCE_MEMBER' FROM anime_work_member member
      UNION ALL
      SELECT member.media_id,member.root_media_id,'SEQUENCE_ROOT' FROM anime_work_member member
    ),
    sequence_scope AS (
      SELECT card_id,root_id,root_id AS media_id FROM requested
      UNION
      SELECT requested.card_id,requested.root_id,member.media_id FROM requested JOIN anime_work_member member ON member.root_media_id=requested.root_id
    ),
    relation_walk(card_id,root_id,media_id,relation_type,relation_depth) AS (
      SELECT scope.card_id,scope.root_id,scope.media_id,
        CASE WHEN scope.media_id=scope.card_id THEN 'CURRENT' ELSE 'SEQUENCE_MEMBER' END,
        0
      FROM sequence_scope scope
      UNION
      SELECT walk.card_id,walk.root_id,edge.target_id,edge.relation_type,walk.relation_depth+1
      FROM relation_walk walk JOIN graph_edges edge ON edge.source_id=walk.media_id
      WHERE walk.relation_depth<8
    )`;
async function libraryRelatedWorks(mediaIds: string[], userId: string, coverScopeByMediaId = new Map<string, string>()) {
  if (!mediaIds.length) return new Map<string, any[]>();
  const result = await pool.query(
    `${relatedWorkClosureSql("$1")},deduplicated AS (
      SELECT walk.card_id,walk.root_id,walk.media_id,min(member.member_order) AS sequence_order,min(walk.relation_depth) AS relation_depth,
        array_agg(DISTINCT walk.relation_type ORDER BY walk.relation_type) AS relation_types
      FROM relation_walk walk
      LEFT JOIN anime_work_member member ON member.root_media_id=walk.root_id AND member.media_id=walk.media_id
      GROUP BY walk.card_id,walk.root_id,walk.media_id
    ),ranked AS (
      SELECT deduplicated.*,row_number() OVER(PARTITION BY card_id ORDER BY sequence_order NULLS LAST,relation_depth,media_id) AS related_rank FROM deduplicated
    )
    SELECT ranked.card_id AS "libraryMediaId",ranked.media_id AS id,ranked.sequence_order AS "sequenceOrder",ranked.relation_depth AS "relationDepth",ranked.relation_types AS "relationTypes",
      favlib_display_title(ranked.media_id,$2::uuid)->>'title' AS title,media.type,media.format,media.season_year AS "seasonYear",
      (SELECT external_id FROM media_external_id WHERE media_id=ranked.media_id AND provider='anilist' ORDER BY created_at DESC LIMIT 1) AS "anilistId",
      CASE
        WHEN status_assertion.raw_status ~* '\\m(on[[:space:]]+)?hiatus\\M' THEN 'Hiatus'
        WHEN status_assertion.raw_status ~* '\\m(complete|completed|finished)\\M' THEN 'Completed'
        WHEN status_assertion.raw_status ~* '\\m(cancelled|canceled|discontinued|dropped)\\M' THEN 'Cancelled'
        WHEN status_assertion.raw_status ~* '\\m(not[_ -]?yet[_ -]?released|upcoming|planned|ongoing|releasing)\\M' THEN 'Ongoing'
        ELSE NULL
      END AS status,
      (SELECT jsonb_build_object('kind',progress.position_kind,'number',COALESCE(progress.global_position_number,progress.position_number::numeric),'raw',progress.position_raw,'season',progress.season,'localNumber',progress.local_position_number,'globalNumber',progress.global_position_number,'updatedAt',progress.updated_at)
        FROM favorite_progress progress WHERE progress.user_id=$2 AND progress.media_id=ranked.media_id
        ORDER BY COALESCE(progress.global_position_number,progress.position_number::numeric) DESC NULLS LAST,progress.updated_at DESC LIMIT 1) AS progress,
      (SELECT jsonb_build_object('kind',availability.available_position_kind,'number',COALESCE(availability.global_position_number,availability.available_position_number),'raw',availability.available_position_raw,'season',availability.season,'localNumber',availability.local_position_number,'globalNumber',availability.global_position_number,'provider',availability.provider,'provenance',availability.available_position_provenance,'verifiedAt',availability.last_checked_at)
        FROM provider_progress availability WHERE availability.media_id=ranked.media_id AND availability.status='ACTIVE' AND availability.available_position_kind IS NOT NULL
        ORDER BY COALESCE(availability.global_position_number,availability.available_position_number) DESC NULLS LAST,availability.updated_at DESC LIMIT 1) AS availability,
      EXISTS(SELECT 1 FROM media_cover cover WHERE cover.status='ACTIVE' AND (cover.data IS NOT NULL OR cover.asset_sha256 IS NOT NULL) AND cover.media_id IN
        (SELECT ranked.media_id UNION SELECT merge.target_media_id FROM media_identity_merge merge WHERE merge.source_media_id=ranked.media_id)) AS "coverAvailable"
    FROM ranked JOIN media ON media.id=ranked.media_id
    LEFT JOIN LATERAL (SELECT assertion.value #>> '{}' AS raw_status FROM metadata_assertion assertion WHERE assertion.media_id=ranked.media_id AND assertion.field='status' ORDER BY assertion.confidence DESC,assertion.asserted_at DESC LIMIT 1) status_assertion ON true
    WHERE ranked.related_rank<=50 AND ${contentAllowedSql('ranked.media_id','$2')}
    ORDER BY ranked.card_id,ranked.sequence_order NULLS LAST,ranked.relation_depth,ranked.media_id`,
    [mediaIds, userId],
  );
  const grouped = new Map<string, any[]>();
  for (const row of result.rows) {
    const values = grouped.get(row.libraryMediaId) ?? [];
    const {libraryMediaId:_,coverAvailable:__,...related}=row;
    const coverScope=coverScopeByMediaId.get(row.libraryMediaId)??row.libraryMediaId;
    values.push({...related,coverUrl:row.coverAvailable?`/api/v1/library/${encodeURIComponent(coverScope)}/related/${encodeURIComponent(row.id)}/cover`:null});
    grouped.set(row.libraryMediaId, values);
  }
  return grouped;
}
async function relatedLibraryMediaAllowed(rootMediaId:string,mediaId:string,userId:string){
  const allowed=await pool.query(
    `${relatedWorkClosureSql("$1")},deduplicated AS (
      SELECT walk.card_id,walk.media_id,min(walk.relation_depth) AS relation_depth,
        min(member.member_order) AS sequence_order
      FROM relation_walk walk
      LEFT JOIN anime_work_member member ON member.root_media_id=walk.root_id AND member.media_id=walk.media_id
      GROUP BY walk.card_id,walk.media_id
    ),ranked AS (
      SELECT deduplicated.*,row_number() OVER(PARTITION BY card_id ORDER BY sequence_order NULLS LAST,relation_depth,media_id) AS related_rank
      FROM deduplicated
    ),authorized_root AS (
      SELECT 1 FROM bookmark_media_link link
      WHERE link.user_id=$3 AND link.media_id=$4 AND link.status IN ('matched','accepted','review') LIMIT 1
    )
    SELECT 1 FROM ranked CROSS JOIN authorized_root
    WHERE ranked.card_id=$4 AND ranked.media_id=$2 AND ranked.related_rank<=50 AND ${contentAllowedSql('ranked.media_id','$3')} LIMIT 1`,
    [[rootMediaId],mediaId,userId,rootMediaId],
  );
  return Boolean(allowed.rowCount);
}
type ReportingProjection={identity:{subjectKey:string;evidenceRevision:string;state:'REPORTABLE'|'PENDING'|'FINAL';caseId:string|null}|null;sources:Array<{subjectKey:string;evidenceRevision:string;canonicalUrl:string;domain:string;declaredLanguage:string|null;accessMode:string;lastVerifiedAt:string|null;state:'REPORTABLE'|'PENDING'|'FINAL';caseId:string|null}>;reportableCount:number};
async function reportingForMedia(mediaIds:string[],userId:string){
  const result=new Map<string,ReportingProjection>();
  for(const mediaId of mediaIds)result.set(mediaId,{identity:null,sources:[],reportableCount:0});
  if(!mediaIds.length)return result;
  const identities=await pool.query(`SELECT m.id AS "mediaId",'identity:'||m.id AS "subjectKey",
    md5(m.updated_at::text||'|'||COALESCE(string_agg(e.provider||':'||e.external_id,'|' ORDER BY e.provider,e.external_id),'')) AS "evidenceRevision",
    c.id AS "caseId",c.status
    FROM media m LEFT JOIN media_external_id e ON e.media_id=m.id
    LEFT JOIN report_case c ON c.subject_key='identity:'||m.id AND c.evidence_revision=md5(m.updated_at::text||'|'||(SELECT COALESCE(string_agg(x.provider||':'||x.external_id,'|' ORDER BY x.provider,x.external_id),'') FROM media_external_id x WHERE x.media_id=m.id))
    WHERE m.id=ANY($1::text[]) AND EXISTS(SELECT 1 FROM bookmark_media_link link WHERE link.user_id=$2 AND link.media_id=m.id AND link.status IN ('matched','accepted')) GROUP BY m.id,c.id,c.status`,[mediaIds,userId]);
  for(const row of identities.rows){const projection=result.get(row.mediaId)!;projection.identity={subjectKey:row.subjectKey,evidenceRevision:row.evidenceRevision,state:row.status==='PENDING'?'PENDING':row.status?'FINAL':'REPORTABLE',caseId:row.caseId??null}}
  const sources=await pool.query(`WITH visible AS (
    SELECT DISTINCT ON(o.media_id,o.provenance->>'workUrl') o.media_id,o.user_id,o.checked_at,o.provenance,o.provenance->>'workUrl' AS work_url,
      lower(regexp_replace(o.provenance->>'workUrl','^https?://([^/:?#]+).*','\\1','i')) AS domain
    FROM release_origin o WHERE o.media_id=ANY($1::text[]) AND (o.user_id IS NULL OR o.user_id=$2)
      AND o.status='AVAILABLE' AND NULLIF(o.provenance->>'language','') IS NOT NULL
      AND o.provenance->>'languageDetection' NOT IN ('undetected','ambiguous') AND o.provenance->>'workUrl' ~ '^https?://'
      AND NOT EXISTS(SELECT 1 FROM source_association_decision d WHERE d.active AND d.verdict='BLOCK' AND d.media_id=o.media_id AND d.canonical_url=o.provenance->>'workUrl' AND (d.user_id IS NULL OR d.user_id=$2))
    ORDER BY o.media_id,o.provenance->>'workUrl',o.checked_at DESC
  ), subjects AS (SELECT *, 'source:'||media_id||':'||md5(work_url||CASE WHEN provenance->>'accessMode'='extension_private' THEN '|private:'||$2::text ELSE '|public' END) AS subject_key,
    md5(COALESCE(provenance->>'snapshotHash','')||'|'||COALESCE(provenance->>'language','')||'|'||COALESCE(provenance->>'accessMode',CASE WHEN user_id IS NULL THEN 'public' ELSE 'public' END)||'|'||checked_at::text) AS evidence_revision FROM visible)
  SELECT s.media_id AS "mediaId",s.subject_key AS "subjectKey",s.evidence_revision AS "evidenceRevision",s.work_url AS "canonicalUrl",s.domain,
    s.provenance->>'language' AS "declaredLanguage",COALESCE(s.provenance->>'accessMode','public') AS "accessMode",s.checked_at AS "lastVerifiedAt",c.id AS "caseId",c.status
  FROM subjects s LEFT JOIN report_case c ON c.subject_key=s.subject_key AND c.evidence_revision=s.evidence_revision ORDER BY s.media_id,s.domain`,[mediaIds,userId]);
  for(const row of sources.rows){const projection=result.get(row.mediaId)!;projection.sources.push({...row,state:row.status==='PENDING'?'PENDING':row.status?'FINAL':'REPORTABLE',caseId:row.caseId??null})}
  for(const projection of result.values())projection.reportableCount=(projection.identity?.state==='REPORTABLE'?1:0)+projection.sources.filter(source=>source.state==='REPORTABLE').length;
  return result;
}

async function submitAdjudicatedReport(userId:string,input:z.infer<typeof userReportContract>,requestId:string|undefined):Promise<{error:string;caseId?:never}|{caseId:string;error?:never}>{
  const reporting=(await reportingForMedia([input.mediaId],userId)).get(input.mediaId);
  const subject=input.family==='IDENTITY'?reporting?.identity:reporting?.sources.find(source=>source.subjectKey===input.subjectKey&&source.canonicalUrl===input.canonicalUrl);
  if(!subject||subject.subjectKey!==input.subjectKey||subject.evidenceRevision!==input.evidenceRevision)return {error:'REPORT_SUBJECT_STALE' as const};
  if(subject.state==='FINAL')return {error:'REPORT_SUBJECT_FINAL' as const};
  const sanitizedEvidence=input.family==='IDENTITY'
    ?(await pool.query(`SELECT jsonb_build_object('mediaType',m.type,'seasonYear',m.season_year,'format',m.format,'providerProfiles',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',e.provider,'externalId',e.external_id)) FROM media_external_id e WHERE e.media_id=m.id),'[]'::jsonb),'parserProvenance',COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('parserId',i.parser_id,'parserVersion',i.parser_version,'parserFingerprint',i.parser_fingerprint,'seasonProvenance',i.parse_artifact#>'{identity,seasonProvenance}')) FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id WHERE l.media_id=m.id),'[]'::jsonb)) AS evidence FROM media m WHERE m.id=$1`,[input.mediaId])).rows[0]?.evidence??{}
    :(await pool.query(`SELECT jsonb_build_object('sourceUrl',$2::text,'language',o.provenance->>'language','languageEvidence',o.provenance->'languageEvidence','accessMode',COALESCE(o.provenance->>'accessMode','public'),'snapshotHash',o.provenance->>'snapshotHash','connector',o.connector,'connectorVersion',COALESCE(o.provenance->>'connectorVersion','unknown'),'checkedAt',o.checked_at,'status',o.status) AS evidence FROM release_origin o WHERE o.media_id=$1 AND o.provenance->>'workUrl'=$2 AND (o.user_id IS NULL OR o.user_id=$3) ORDER BY o.checked_at DESC LIMIT 1`,[input.mediaId,input.canonicalUrl,userId])).rows[0]?.evidence??{};
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const reportCase=await client.query(`INSERT INTO report_case(family,subject_key,evidence_revision,media_id,sanitized_evidence) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(subject_key,evidence_revision) DO UPDATE SET updated_at=report_case.updated_at RETURNING id,status`,[input.family,input.subjectKey,input.evidenceRevision,input.mediaId,sanitizedEvidence]);
    if(reportCase.rows[0].status!=='PENDING'){await client.query('ROLLBACK');return {error:'REPORT_SUBJECT_FINAL' as const}}
    const submission=await client.query('INSERT INTO report_submission(case_id,user_id,reason,details) VALUES($1,$2,$3,$4) ON CONFLICT(case_id,user_id) DO NOTHING RETURNING id',[reportCase.rows[0].id,userId,input.reason,input.details??null]);
    if(!submission.rowCount){await client.query('ROLLBACK');return {error:'REPORT_ALREADY_PENDING' as const}}
    await client.query(`UPDATE report_case SET report_count=report_count+1,reason_counts=jsonb_set(reason_counts,ARRAY[$2::text],to_jsonb(COALESCE((reason_counts->>$2)::int,0)+1),true),updated_at=now() WHERE id=$1`,[reportCase.rows[0].id,input.reason]);
    await client.query('COMMIT');return {caseId:reportCase.rows[0].id};
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

async function libraryCardPage(userId:string,query:unknown){
  const parsed=libraryQuerySchema.safeParse(query??{});
  if(!parsed.success)return {error:parsed.error} as const;
  const {limit,offset,sort,direction}=parsed.data;
  const orderBy={inventory:'"id"',title:'lower("title")',type:'"type"',year:'"seasonYear"',release:'"latestReleaseDate"',favorites:'"favoriteCount"'}[sort];
  const result=await pool.query(
    `WITH ${libraryCardProjectionSql},filtered AS (SELECT * FROM projected WHERE ${libraryFilterSql()})
     SELECT "id","title","type","format",status,progress,availability,"favoriteCount","classificationStatus","coverUrl",count(*) OVER()::int AS "totalCount"
     FROM filtered ORDER BY ${orderBy} ${direction.toUpperCase()} NULLS LAST,"id" LIMIT $18 OFFSET $19`,
    [...libraryFilterValues(userId,parsed.data),limit,offset],
  );
  const total=result.rows[0]?.totalCount??0;
  const items=result.rows.map(({totalCount:_,...row}:any)=>catalogCardSummaryContract.parse(row));
  const nextOffset=offset+items.length;
  return {data:{items,total,nextOffset,hasMore:nextOffset<total}} as const;
}

app.get('/api/v1/library/cards',async(req:any,reply:any)=>{
  const page=await libraryCardPage(req.user.id,req.query);
  if('error' in page)return err(reply,400,'VALIDATION_FAILED','Paramètres de filtre invalides.',page.error!.issues);
  return page.data;
});

app.get('/api/v1/home',async(req:any,reply:any)=>{
  const [myListPage,continuePage,pref]=await Promise.all([
    libraryCardPage(req.user.id,{limit:6,offset:0}),
    libraryCardPage(req.user.id,{limit:30,offset:0,sort:'inventory',direction:'asc'}),
    pool.query('SELECT timezone FROM user_catalog_preference WHERE user_id=$1::uuid',[req.user.id]),
  ]);
  if('error' in myListPage||'error' in continuePage)return err(reply,500,'HOME_PROJECTION_FAILED');
  const timeZone=pref.rows[0]?.timezone??'UTC',now=Date.now();
  const latest=await calendarRows(req.user.id,{from:new Date(now-10*365*86_400_000).toISOString(),to:new Date(now+7*86_400_000).toISOString(),direction:'desc',favorites:true},timeZone);
  return {myList:myListPage.data.items,continue:continuePage.data.items.filter(item=>Boolean(item.progress)).slice(0,6),latestReleases:latest.slice(0,6)};
});

app.get('/api/v1/header-summary',async(req:any)=>{
  const pending=await pool.query(`SELECT count(DISTINCT COALESCE(review.cluster_id::text,review.id::text))::int AS count
    FROM favorite_review review JOIN bookmark_media_link link ON link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id
    WHERE review.user_id=$1 AND review.status='PENDING' AND link.status IN ('matched','accepted','review') AND link.media_id IS NOT NULL
      AND favlib_content_allowed(link.media_id,$1::uuid)
      -- A manual lookup is already in flight for the entire parsed-title
      -- group. Do not advertise its undecided siblings as actionable cards.
      AND NOT EXISTS(SELECT 1 FROM favorite_review queued
        WHERE queued.user_id=review.user_id
          AND COALESCE(queued.cluster_id::text,queued.id::text)=COALESCE(review.cluster_id::text,review.id::text)
          AND queued.status='PENDING' AND queued.decision->>'kind'='manual-queued')`,[req.user.id]);
  return {role:req.user.role,pendingReviewCount:Number(pending.rows[0]?.count??0)};
});

app.get("/api/v1/library", async (req: any, reply: any) => {
  const parsed = libraryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success)
    return err(
      reply,
      400,
      "VALIDATION_FAILED",
      "Paramètres de filtre invalides.",
      parsed.error.issues,
    );
  const { limit, offset, sort, direction } = parsed.data;
  const orderBy = {
    inventory: '"id"',
    title: 'lower("title")',
    type: '"type"',
    year: '"seasonYear"',
    release: '"latestReleaseDate"',
    favorites: '"favoriteCount"',
  }[sort];
  const r = await pool.query(
    `WITH ${libraryProjectionSql},filtered AS (SELECT * FROM projected WHERE ${libraryFilterSql()}) SELECT *,count(*) OVER()::int AS "totalCount" FROM filtered ORDER BY ${orderBy} ${direction.toUpperCase()} NULLS LAST,"id" LIMIT $18 OFFSET $19`,
    [...libraryFilterValues(req.user.id, parsed.data), limit, offset],
  );
  const total = r.rows[0]?.totalCount ?? 0;
  const rows = r.rows.map(({ totalCount: _, ...row }: any) => row);
  const relatedByMedia = await libraryRelatedWorks(rows.map((row: any) => row.id), req.user.id);
  const reportingByMedia=await reportingForMedia(rows.map((row:any)=>row.id),req.user.id);
  const items = rows.map((row: any) => ({
    ...row,
    coverUrl: row.coverProvenance
      ? `/api/v1/catalog/media/${encodeURIComponent(row.id)}/cover?v=${encodeURIComponent(row.coverProvenance.fetchedAt)}`
      : null,
    relatedWorks: relatedByMedia.get(row.id) ?? [],
    reporting:reportingByMedia.get(row.id),
  }));
  const nextOffset = offset + items.length;
  return { items, total, nextOffset, hasMore: nextOffset < total };
});
app.get("/api/v1/library/inventory", async (req: any, reply: any) => {
  const parsed=z.object({limit:z.coerce.number().int().min(1).max(100).default(30),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).safeParse(req.query??{});
  if(!parsed.success)return err(reply,400,"VALIDATION_FAILED","Paramètres d’inventaire invalides.",parsed.error.issues);
  const {limit,offset}=parsed.data;
  const result=await pool.query(`SELECT i.installation_id AS "installationId",i.bookmark_id AS "bookmarkId",
      i.payload->>'title' AS "rawTitle",i.payload->>'url' AS "rawUrl",
      COALESCE(i.parse_artifact#>>'{identity,title}',NULLIF(i.parse_artifact->>'displayTitle','')) AS "parsedTitle",i.classification_status AS "classificationStatus",
      l.status AS "linkStatus",l.media_id AS "mediaId",
      i.parse_artifact->'provenance' AS provenance
    FROM bookmark_import_item i
    LEFT JOIN LATERAL(SELECT status,media_id FROM bookmark_media_link x
      WHERE x.user_id=i.user_id AND x.installation_id=i.installation_id AND x.bookmark_id=i.bookmark_id
      ORDER BY CASE x.status WHEN 'accepted' THEN 1 WHEN 'matched' THEN 2 WHEN 'review' THEN 3 ELSE 4 END LIMIT 1) l ON true
    WHERE i.user_id=$1 AND i.event<>'removed'
    ORDER BY i.created_at,i.installation_id,i.bookmark_id LIMIT $2 OFFSET $3`,[req.user.id,limit,offset]);
  const count=await pool.query("SELECT count(*)::int AS total FROM bookmark_import_item WHERE user_id=$1 AND event<>'removed'",[req.user.id]);
  const items=result.rows.map((row:any)=>{
    let domain='';try{domain=new URL(row.rawUrl).hostname.toLowerCase()}catch{}
    const language=typeof row.provenance?.language==='string'?row.provenance.language:null;
    return {...row,recommendations:domain?[{canonicalUrl:row.rawUrl,domain,language,status:'AVAILABLE',checkedAt:null,provenance:{source:'bookmark-import',rawUrl:row.rawUrl,installationId:row.installationId,bookmarkId:row.bookmarkId}}]:[]};
  });
  const total=Number(count.rows[0]?.total??0),nextOffset=offset+items.length;
  return {items,total,nextOffset,hasMore:nextOffset<total};
});
app.get("/api/v1/library/facets", async (req: any, reply: any) => {
  const parsed = libraryQuerySchema
    .omit({ limit: true, offset: true, sort: true, direction: true })
    .safeParse(req.query ?? {});
  if (!parsed.success)
    return err(
      reply,
      400,
      "VALIDATION_FAILED",
      "Paramètres de facette invalides.",
      parsed.error.issues,
    );
  const query = {
    limit: 30,
    offset: 0,
    sort: "inventory" as const,
    direction: "asc" as const,
    ...parsed.data,
  };
  const values = libraryFilterValues(req.user.id, query);
  const specs: Record<
    LibraryFilterKey,
    { expression: string; condition: string; order: string }
  > = {
    type: {
      expression: '"type"',
      condition: `"type" IN ('ANIME','MANGA','MANHUA','MANHWA')`,
      order: "value",
    },
    theme: { expression: "theme", condition: `theme<>''`, order: "value" },
    genre: { expression: "genre", condition: `genre<>''`, order: "value" },
    category: {
      expression: "category",
      condition: `category<>''`,
      order: "value",
    },
    status: {
      expression: "status",
      condition: `status IN ('Ongoing','Hiatus','Completed','Cancelled')`,
      order: "value",
    },
    year: {
      expression: '"seasonYear"',
      condition: `"seasonYear" IS NOT NULL`,
      order: "value DESC",
    },
  };
  const results = await Promise.all(
    libraryFilterKeys.map(async (key) => {
      const spec = specs[key];
      const source =
        key === "theme"
          ? `filtered CROSS JOIN LATERAL jsonb_array_elements_text(themes) theme`
          : key === "genre"
            ? `filtered CROSS JOIN LATERAL jsonb_array_elements_text(genres) genre`
            : key === "category"
              ? `filtered CROSS JOIN LATERAL jsonb_array_elements_text(categories) category`
              : "filtered";
      const result = await pool.query(
        `WITH ${libraryCardProjectionSql},filtered AS (SELECT * FROM projected WHERE ${libraryFilterSql(key)}) SELECT ${spec.expression} AS value,count(DISTINCT "id")::int AS count FROM ${source} WHERE ${spec.condition} GROUP BY ${spec.expression} ORDER BY ${spec.order}`,
        values,
      );
      return [key, result.rows] as const;
    }),
  );
  const byKey = Object.fromEntries(results) as Record<
    LibraryFilterKey,
    Array<{ value: string | number; count: number }>
  >;
  return {
    types: retainSelected(byKey.type, query.type),
    themes: retainSelected(byKey.theme, query.theme),
    genres: retainSelected(byKey.genre, query.genre),
    categories: retainSelected(byKey.category, query.category),
    statuses: retainSelected(byKey.status, query.status),
    years: retainSelected(byKey.year, query.year),
  };
});
app.get("/api/v1/library/:mediaId", async (req: any, reply: any) => {
  const item = await richCatalogRow(
    req.user.id,
    req.params.mediaId,
    req.headers["x-timezone"],
  );
  if (!item) return err(reply, 404, "MEDIA_NOT_IN_LIBRARY");
  const relatedByMedia=await libraryRelatedWorks([req.params.mediaId],req.user.id);
  return {...item,relatedWorks:relatedByMedia.get(req.params.mediaId)??[]};
});
app.get("/api/v1/library/:rootMediaId/related/:mediaId", async (req:any,reply:any)=>{
  const rootMediaId=String(req.params.rootMediaId),mediaId=String(req.params.mediaId);
  const item=await richCatalogRow(req.user.id,mediaId,req.headers["x-timezone"],rootMediaId);
  if(!item)return err(reply,404,"RELATED_MEDIA_NOT_IN_LIBRARY_GRAPH");
  const relatedByMedia=await libraryRelatedWorks([mediaId],req.user.id,new Map([[mediaId,rootMediaId]]));
  return {...item,rootMediaId,relatedWorks:relatedByMedia.get(mediaId)??[]};
});
app.post('/api/v1/reports',async(req:any,reply:any)=>{
  const parsed=userReportContract.safeParse(req.body);
  if(!parsed.success)return err(reply,400,'VALIDATION_FAILED','Signalement invalide.',parsed.error.issues);
  const owned=await pool.query("SELECT 1 FROM bookmark_media_link WHERE user_id=$1 AND media_id=$2 AND status IN ('matched','accepted','review') AND favlib_content_allowed(media_id,$1::uuid) LIMIT 1",[req.user.id,parsed.data.mediaId]);
  if(!owned.rowCount)return err(reply,404,'MEDIA_NOT_IN_LIBRARY');
  const submitted=await submitAdjudicatedReport(req.user.id,parsed.data,req.requestId);
  if(submitted.error!==undefined)return err(reply,409,submitted.error);
  return reply.code(201).send({ok:true,caseId:submitted.caseId,status:'PENDING'});
});
app.post("/api/v1/library/:mediaId/source-reports", async (req: any, reply: any) => {
  const parsed=sourceReportContract.safeParse({...req.body,mediaId:req.params.mediaId});
  if(!parsed.success)return err(reply,400,"VALIDATION_FAILED","Signalement invalide.",parsed.error.issues);
  const owned=await pool.query("SELECT 1 FROM bookmark_media_link WHERE user_id=$1 AND media_id=$2 AND status IN ('matched','accepted','review') AND favlib_content_allowed(media_id,$1::uuid) LIMIT 1",[req.user.id,req.params.mediaId]);
  if(!owned.rowCount)return err(reply,404,"MEDIA_NOT_IN_LIBRARY");
  const origin=await pool.query("SELECT 1 FROM release_origin WHERE media_id=$1 AND (canonical_url=$2 OR provenance->>'workUrl'=$2) AND (user_id IS NULL OR user_id=$3) LIMIT 1",[req.params.mediaId,parsed.data.canonicalUrl,req.user.id]);
  if(!origin.rowCount)return err(reply,404,"SOURCE_NOT_FOUND");
  await pool.query("INSERT INTO source_report(user_id,media_id,canonical_url,reason,details) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,media_id,canonical_url) DO UPDATE SET reason=excluded.reason,details=excluded.details,created_at=now()",[req.user.id,req.params.mediaId,parsed.data.canonicalUrl,parsed.data.reason,parsed.data.details??null]);
  if(parsed.data.reason==='DEAD_LINK')return reply.code(202).send({ok:true,mediaId:req.params.mediaId,canonicalUrl:parsed.data.canonicalUrl,classification:'AUTOMATED_HEALTH_FEEDBACK'});
  const reporting=(await reportingForMedia([req.params.mediaId],req.user.id)).get(req.params.mediaId);
  const source=reporting?.sources.find(subject=>subject.canonicalUrl===parsed.data.canonicalUrl);
  if(!source)return err(reply,409,'REPORT_SUBJECT_STALE');
  const reason=parsed.data.reason==='OTHER'?'OTHER_SOURCE':parsed.data.reason;
  const submitted=await submitAdjudicatedReport(req.user.id,{family:'SOURCE',mediaId:req.params.mediaId,subjectKey:source.subjectKey,evidenceRevision:source.evidenceRevision,canonicalUrl:source.canonicalUrl,reason,details:parsed.data.details},req.requestId);
  if(submitted.error!==undefined)return err(reply,409,submitted.error);
  return reply.code(201).send({ok:true,caseId:submitted.caseId,status:'PENDING'});
});
app.post("/api/v1/library/:mediaId/source-check", async (req: any, reply: any) => {
  const parsed=sourceCheckContract.safeParse(req.body);
  if(!parsed.success)return err(reply,400,"VALIDATION_FAILED","Contrôle de source invalide.",parsed.error.issues);
  const mediaId=String(req.params.mediaId);
  const owned=await pool.query("SELECT 1 FROM bookmark_media_link WHERE user_id=$1 AND media_id=$2 AND status IN ('matched','accepted','review') AND favlib_content_allowed(media_id,$1::uuid) LIMIT 1",[req.user.id,mediaId]);
  if(!owned.rowCount)return err(reply,404,"MEDIA_NOT_IN_LIBRARY");
  const origin=await pool.query("SELECT 1 FROM release_origin WHERE media_id=$1 AND (canonical_url=$2 OR provenance->>'workUrl'=$2) AND (user_id IS NULL OR user_id=$3) LIMIT 1",[mediaId,parsed.data.canonicalUrl,req.user.id]);
  if(!origin.rowCount)return err(reply,404,"SOURCE_NOT_FOUND");
  const checked=await checkSourceUrl(parsed.data.canonicalUrl);
  const checkedAt=new Date().toISOString();
  await pool.query("UPDATE release_origin SET status=$1,checked_at=$2,provenance=provenance || $3::jsonb WHERE media_id=$4 AND (canonical_url=$5 OR provenance->>'workUrl'=$5) AND (user_id IS NULL OR user_id=$6)",[checked.status==='AVAILABLE'?'AVAILABLE':'ERROR',checkedAt,JSON.stringify({httpStatus:checked.httpStatus,finalUrl:checked.finalUrl,checkedAt,error:checked.error}),mediaId,parsed.data.canonicalUrl,req.user.id]);
  return {mediaId,canonicalUrl:parsed.data.canonicalUrl,...checked,checkedAt};
});
app.post(
  "/api/v1/library/repair-missing-positions",
  async (req: any, reply: any) => {
    const parsed = repairMissingPositionsRequestContract.safeParse(req.body);
    if (!parsed.success)
      return err(
        reply,
        400,
        "VALIDATION_FAILED",
        "Lot de réparation invalide.",
        parsed.error.issues,
      );
    const results = [] as Array<{
      mediaId: string;
      personal: string;
      availability: string;
    }>;
    for (const requested of parsed.data.items) {
      const wantsPersonal = requested.missing.includes("personal"),
        wantsAvailability = requested.missing.includes("availability");
      type RepairStatus =
        | "repaired"
        | "queued"
        | "unchanged"
        | "no_evidence"
        | "cooldown"
        | "unauthorized";
      let personal: RepairStatus = "unchanged",
        availability: RepairStatus = "unchanged";
      const owned = await pool.query(
        `SELECT m.type FROM media m WHERE m.id=$1 AND favlib_content_allowed(m.id,$2::uuid) AND EXISTS(SELECT 1 FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id WHERE l.user_id=$2 AND l.media_id=m.id AND l.status IN ('matched','accepted') AND i.event<>'removed')`,
        [requested.mediaId, req.user.id],
      );
      if (!owned.rowCount) {
        results.push({
          mediaId: requested.mediaId,
          personal: wantsPersonal ? "unauthorized" : "unchanged",
          availability: wantsAvailability ? "unauthorized" : "unchanged",
        });
        continue;
      }
      if (wantsPersonal) {
        const before = await pool.query(
          "SELECT max(position_number) AS value FROM favorite_progress WHERE user_id=$1 AND media_id=$2",
          [req.user.id, requested.mediaId],
        );
        const favorites = await pool.query(
          `SELECT i.installation_id,i.bookmark_id,i.fingerprint,i.payload->>'title' AS title,i.payload->>'url' AS url,i.progress_parser_version,i.progress_parser_fingerprint FROM bookmark_import_item i JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id WHERE i.user_id=$1 AND l.media_id=$2 AND l.status IN ('matched','accepted') AND i.event<>'removed'`,
          [req.user.id, requested.mediaId],
        );
        let evidence = false,
          examined = false;
        for (const favorite of favorites.rows) {
          if (
            favorite.progress_parser_version ===
              FAVORITE_PROGRESS_PARSER_VERSION &&
            favorite.progress_parser_fingerprint === favorite.fingerprint
          )
            continue;
          examined = true;
          const source = sourceIdentityFromUrl(favorite.url);
          const candidate = progressionFromFavorite({
            title: favorite.title ?? "",
            url: favorite.url,
            source,
          });
          if (candidate) {
            evidence = true;
            await pool.query(
              `INSERT INTO favorite_progress_candidate(user_id,installation_id,bookmark_id,position_kind,position_number,position_raw,raw_title,raw_url,parsed_slug,path_segments,evidence,season,local_position_number,global_position_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14) ON CONFLICT(user_id,installation_id,bookmark_id,position_kind) DO UPDATE SET position_number=excluded.position_number,position_raw=excluded.position_raw,raw_title=excluded.raw_title,raw_url=excluded.raw_url,parsed_slug=excluded.parsed_slug,path_segments=excluded.path_segments,evidence=excluded.evidence,season=excluded.season,local_position_number=excluded.local_position_number,global_position_number=excluded.global_position_number,last_observed_at=now(),applied_at=CASE WHEN excluded.position_number>favorite_progress_candidate.position_number THEN NULL ELSE favorite_progress_candidate.applied_at END`,
              [
                req.user.id,
                favorite.installation_id,
                favorite.bookmark_id,
                candidate.kind,
                candidate.number,
                candidate.raw,
                favorite.title ?? "",
                favorite.url,
                source?.slug ?? null,
                JSON.stringify(candidate.provenance.pathSegments),
                JSON.stringify(candidate.provenance),
                candidate.season ?? null,
                candidate.localNumber ?? null,
                candidate.globalNumber ?? null,
              ],
            );
            await pool.query(
              "UPDATE bookmark_media_link SET status=status WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND media_id=$4 AND status IN ('matched','accepted')",
              [
                req.user.id,
                favorite.installation_id,
                favorite.bookmark_id,
                requested.mediaId,
              ],
            );
          } else {
            await pool.query(
              "DELETE FROM favorite_progress_candidate WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",
              [req.user.id, favorite.installation_id, favorite.bookmark_id],
            );
          }
          await pool.query(
            "UPDATE bookmark_import_item SET progress_parser_version=$1,progress_parser_fingerprint=fingerprint,progress_parse_status=$2 WHERE user_id=$3 AND installation_id=$4 AND bookmark_id=$5",
            [
              FAVORITE_PROGRESS_PARSER_VERSION,
              candidate ? "evidence" : "no_evidence",
              req.user.id,
              favorite.installation_id,
              favorite.bookmark_id,
            ],
          );
        }
        const after = await pool.query(
          "SELECT max(position_number) AS value FROM favorite_progress WHERE user_id=$1 AND media_id=$2",
          [req.user.id, requested.mediaId],
        );
        personal =
          Number(after.rows[0]?.value) > Number(before.rows[0]?.value ?? -1)
            ? "repaired"
            : evidence
              ? "unchanged"
              : examined
                ? "no_evidence"
                : "no_evidence";
      }
      if (wantsAvailability) {
        const provider =
          owned.rows[0].type === "ANIME" ? "anilist" : "mangaupdates";
        const state = await pool.query(
          `SELECT e.external_id,pp.available_position_number,pp.last_checked_at,e.media_id AS "refreshMediaId" FROM media_external_id e LEFT JOIN provider_progress pp ON pp.media_id=e.media_id AND pp.provider=e.provider WHERE e.media_id=CASE WHEN $2='anilist' THEN COALESCE((SELECT media_id FROM anime_work_member WHERE root_media_id=$1 ORDER BY member_order DESC LIMIT 1),$1) ELSE $1 END AND e.provider=$2 ORDER BY e.created_at DESC LIMIT 1`,
          [requested.mediaId, provider],
        );
        if (!state.rowCount) availability = "unchanged";
        else if (
          state.rows[0].available_position_number !== null &&
          state.rows[0].available_position_number !== undefined
        )
          availability = "unchanged";
        else if (
          state.rows[0].last_checked_at &&
          Date.now() - new Date(state.rows[0].last_checked_at).getTime() <
            6 * 60 * 60 * 1000
        )
          availability = "cooldown";
        else {
          const task =
            provider === "anilist"
              ? "anilist-enrichment"
              : "mangaupdates-enrichment";
          const refreshMediaId =
            state.rows[0].refreshMediaId ?? requested.mediaId;
          await pool.query(
            "SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3,job_key_mode := 'preserve_run_at')",
            [
              task,
              JSON.stringify({
                mediaId: refreshMediaId,
                forceRefresh: true,
                repairAvailability: true,
              }),
              `repair-availability:${provider}:${refreshMediaId}`,
            ],
          );
          availability = "queued";
        }
      }
      results.push({ mediaId: requested.mediaId, personal, availability });
    }
    return { items: results };
  },
);
app.get("/api/v1/catalog/search", async (req: any) => {
  const q =
    typeof req.query?.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  return { items: await catalogRows(req.user.id,q) };
});
async function richCatalogRow(
  userId: string,
  mediaId: string,
  requestedTimezone?: string,
  authorizedRootMediaId?:string,
) {
  if(authorizedRootMediaId){
    if(!await relatedLibraryMediaAllowed(authorizedRootMediaId,mediaId,userId))return null;
  }else{
    const favorite = await pool.query(
      `SELECT 1 FROM bookmark_media_link l WHERE l.user_id=$1 AND l.media_id=$2 AND l.status IN ('matched','accepted','review') LIMIT 1`,
      [userId, mediaId],
    );
    if (!favorite.rowCount) return null;
  }
  const allowedContent = await pool.query(`SELECT 1 WHERE ${contentAllowedSql('$1','$2')}`,[mediaId,userId]);
  if (!allowedContent.rowCount) return null;
  const timezoneRow = await pool.query(
    "SELECT timezone FROM user_catalog_preference WHERE user_id=$1",
    [userId],
  );
  const fallback = (() => {
    try {
      const value = requestedTimezone ?? "UTC";
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return value;
    } catch {
      return "UTC";
    }
  })();
  const timezone = timezoneRow.rows[0]?.timezone ?? fallback;
  if (!timezoneRow.rowCount)
    await pool.query(
      "INSERT INTO user_catalog_preference(user_id,timezone) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
      [userId, timezone],
    );
  const [
    base,
    titles,
    ids,
    progress,
    airing,
    mu,
    releases,
    sync,
    animeSeasons,
    animeRelated,
  ] = await Promise.all([
    pool.query(
      `SELECT id,type,season_year AS "seasonYear",country_of_origin AS "countryOfOrigin",format,
        COALESCE(
          (SELECT jsonb_build_object('provider',c.provider,'sourceUrl',c.source_url,'attribution',c.attribution,'fetchedAt',c.fetched_at) FROM media_cover c WHERE c.media_id=$1 AND c.status='ACTIVE'),
          (SELECT jsonb_build_object('provider',c.provider,'sourceUrl',c.source_url,'attribution',c.attribution,'fetchedAt',c.fetched_at,'provenance',jsonb_build_object('source','media-identity-merge','targetMediaId',im.target_media_id)) FROM media_identity_merge im JOIN media_cover c ON c.media_id=im.target_media_id AND c.status='ACTIVE' WHERE im.source_media_id=$1 LIMIT 1)
        ) AS "coverProvenance" FROM media WHERE id=$1 AND ${contentAllowedSql('id','$2')}`,
      [mediaId,userId],
    ),
    pool.query(
      `SELECT text,language,script,kind AS "kind",title_type AS "titleType",personal_status AS "personalStatus",connector,confidence,provenance FROM media_title WHERE media_id=$1 ORDER BY CASE WHEN kind='personal' AND provenance->>'userId'=$2 THEN 0 ELSE 1 END,kind,text`,
      [mediaId, userId],
    ),
    pool.query(
      `SELECT provider,external_id AS "externalId",provenance FROM media_external_id WHERE media_id=$1 OR media_id IN (SELECT media_id FROM anime_work_member WHERE root_media_id=$1) ORDER BY provider,"externalId"`,
      [mediaId],
    ),
    pool.query(
      `SELECT provider,serialization_status AS "serializationStatus",latest_chapter AS "latestChapter",latest_volume AS "latestVolume",available_position_kind AS "availablePositionKind",COALESCE(global_position_number,available_position_number) AS "availablePositionNumber",available_position_raw AS "availablePositionRaw",season,local_position_number AS "localNumber",global_position_number AS "globalNumber",available_position_provenance AS "availablePositionProvenance",latest_release_at AS "latestReleaseAt",last_checked_at AS "lastCheckedAt",status,last_error AS "lastError",provenance FROM provider_progress WHERE media_id=$1 ORDER BY provider`,
      [mediaId],
    ),
    pool.query(
      `SELECT schedule.episode+COALESCE(w.cumulative_offset,0) AS episode,schedule.episode AS "localEpisode",w.member_order+1 AS season,airing_at_utc AS "airingAtUtc",airing_at_utc AT TIME ZONE $2 AS "airingAt",source_local_time AS "sourceLocalTime",source_timezone AS "sourceTimezone",precision,schedule_status AS "scheduleStatus",last_verified_at AS "lastVerifiedAt",provider,schedule.provenance||jsonb_build_object('seasonMediaId',schedule.media_id,'cumulativeOffset',w.cumulative_offset) AS provenance FROM media_airing schedule LEFT JOIN anime_work_member w ON w.media_id=schedule.media_id AND w.root_media_id=$1 WHERE schedule.media_id=$1 OR w.root_media_id=$1 ORDER BY airing_at_utc`,
      [mediaId, timezone],
    ),
    pool.query(
      `SELECT provider_release_key AS "releaseKey",series_id AS "seriesId",chapter,volume,release_date AS "releaseDate",groups,languages,raw_title AS "rawTitle",observed_at AS "observedAt",provenance FROM mangaupdates_release_observation WHERE media_id=$1 ORDER BY observed_at DESC LIMIT 100`,
      [mediaId],
    ),
    pool.query(
      `SELECT release_key AS "releaseKey",provider,status,announced_at AS "announcedAt",provenance FROM release_announcement WHERE media_id=$1 ORDER BY announced_at DESC LIMIT 100`,
      [mediaId],
    ),
    pool.query(
      `SELECT provider,connector_version AS "connectorVersion",last_payload_hash AS "lastPayloadHash",last_collected_at AS "lastCollectedAt",last_success_at AS "lastSuccessAt",status,error,attempt_count AS "attemptCount" FROM provider_sync_state WHERE media_id=$1 ORDER BY provider`,
      [mediaId],
    ),
    pool.query(
      `SELECT w.media_id AS id,w.member_order AS "order",w.episode_total AS "episodeTotal",w.cumulative_offset AS "cumulativeOffset",w.status,
      favlib_display_title(w.media_id,$2::uuid)->>'title' AS title,m.format,m.season_year AS "seasonYear",w.anilist_id AS "anilistId",
      EXISTS(SELECT 1 FROM provider_payload payload WHERE payload.media_id=w.media_id AND payload.provider='anilist' AND payload.is_current AND payload.validity_status='VALID') AS enriched
      FROM anime_work_member w JOIN media m ON m.id=w.media_id
      WHERE w.root_media_id=$1 AND ${contentAllowedSql('w.media_id','$2')} ORDER BY w.member_order LIMIT 50`,
      [mediaId, userId],
    ),
    pool.query(
      `WITH sequence_media AS (SELECT $1::text AS id UNION SELECT media_id FROM anime_work_member WHERE root_media_id=$1)
      SELECT DISTINCT ON (related.id) related.id,favlib_display_title(related.id,$2::uuid)->>'title' AS title,related.format,related.season_year AS "seasonYear",
      relation.kind AS "relationType",external.external_id AS "anilistId",
      EXISTS(SELECT 1 FROM provider_payload payload WHERE payload.media_id=related.id AND payload.provider='anilist' AND payload.is_current AND payload.validity_status='VALID') AS enriched
      FROM sequence_media member JOIN media_relation relation ON relation.media_id=member.id OR relation.target_media_id=member.id
      JOIN media related ON related.id=CASE WHEN relation.media_id=member.id THEN relation.target_media_id ELSE relation.media_id END
      LEFT JOIN media_external_id external ON external.media_id=related.id AND external.provider='anilist'
      WHERE NOT EXISTS(SELECT 1 FROM anime_work_member sequence WHERE sequence.root_media_id=$1 AND sequence.media_id=related.id)
        AND relation.kind<>'canonical_variant' AND ${contentAllowedSql('related.id','$2')}
      ORDER BY related.id,relation.kind LIMIT 50`,
      [mediaId, userId],
    ),
  ]);
  if (!base.rowCount) return null;
  const payloads = await pool.query(
    `SELECT provider,connector_version AS "connectorVersion",collected_at AS "collectedAt",payload_hash AS "payloadHash",validity_status AS "validityStatus",error,provenance FROM provider_payload WHERE media_id=$1 ORDER BY collected_at DESC`,
    [mediaId],
  );
  const titleSelection = (
    await pool.query("SELECT favlib_display_title($1,$2) AS selection", [
      mediaId,
      userId,
    ])
  ).rows[0]?.selection;
  const [favorites, sources, providerPages,modalProjection] = await Promise.all([
    pool.query(`SELECT i.bookmark_id AS "bookmarkId",i.payload->>'url' AS url,i.payload->>'title' AS title,COALESCE(i.parse_artifact#>>'{identity,title}',NULLIF(i.parse_artifact->>'displayTitle','')) AS "parsedTitle",i.parse_artifact->'progression' AS progression,COALESCE(d.name,'Profil') AS device,i.parser_id AS "parserId",i.parser_version AS "parserVersion",i.parse_artifact->'provenance' AS provenance FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id LEFT JOIN extension_device d ON d.user_id=i.user_id AND d.installation_id=i.installation_id WHERE l.user_id=$1 AND l.media_id=$2 AND l.status IN ('matched','accepted','review') AND i.event<>'removed' ORDER BY i.created_at DESC`,[userId,mediaId]),
    pool.query(`SELECT DISTINCT ON (lower(regexp_replace(o.provenance->>'workUrl','^https?://([^/:?#]+).*','\\1','i'))) o.media_id AS "mediaId",o.connector,o.provenance->>'workUrl' AS "canonicalUrl",o.provenance->>'workUrl' AS "workUrl",'AVAILABLE' AS status,o.checked_at AS "checkedAt",NULL::text AS title,NULL::text AS chapter,lower(regexp_replace(o.provenance->>'workUrl','^https?://([^/:?#]+).*','\\1','i')) AS domain,o.provenance->>'language' AS language,o.provenance FROM release_origin o WHERE o.media_id=$1 AND (o.user_id IS NULL OR o.user_id=$2) AND o.status='AVAILABLE' AND NULLIF(o.provenance->>'language','') IS NOT NULL AND o.provenance->>'languageDetection' NOT IN ('undetected','ambiguous') AND o.provenance->>'workUrl' ~ '^https?://' AND NOT EXISTS(SELECT 1 FROM source_association_decision d WHERE d.active AND d.verdict='BLOCK' AND d.media_id=o.media_id AND d.canonical_url=o.provenance->>'workUrl' AND (d.user_id IS NULL OR d.user_id=$2)) ORDER BY lower(regexp_replace(o.provenance->>'workUrl','^https?://([^/:?#]+).*','\\1','i')),o.checked_at DESC`,[mediaId,userId]),
    pool.query(`SELECT provider,source_url AS "sourceUrl",status FROM media_metadata WHERE media_id=$1 AND provider IN ('anilist','mangaupdates','mangadex') AND status='ACTIVE' ORDER BY provider`,[mediaId]),
    pool.query(`SELECT
      (SELECT jsonb_build_object('provider',mm.provider,'status',mm.status,'latestChapter',mm.latest_chapter,'sourceUrl',mm.source_url,'metadata',COALESCE((SELECT jsonb_object_agg(a.field,a.value) FROM metadata_assertion a WHERE a.media_id=$1 AND a.provider=mm.provider),'{}'::jsonb)) FROM media_metadata mm WHERE mm.media_id=$1 AND mm.status='ACTIVE' LIMIT 1) AS metadata,
      COALESCE((SELECT jsonb_agg(DISTINCT a.value_text) FROM (SELECT jsonb_array_elements_text(value) AS value_text FROM metadata_assertion WHERE media_id=$1 AND field='themes' AND jsonb_typeof(value)='array') a),'[]'::jsonb) AS themes,
      COALESCE((SELECT jsonb_agg(DISTINCT a.value_text) FROM (SELECT jsonb_array_elements_text(value) AS value_text FROM metadata_assertion WHERE media_id=$1 AND field='genres' AND jsonb_typeof(value)='array') a),'[]'::jsonb) AS genres,
      COALESCE((SELECT jsonb_agg(DISTINCT a.value_text) FROM (SELECT jsonb_array_elements_text(value) AS value_text FROM metadata_assertion WHERE media_id=$1 AND field='categories' AND jsonb_typeof(value)='array') a),'[]'::jsonb) AS categories,
      (SELECT value #>> '{}' FROM metadata_assertion WHERE media_id=$1 AND field='language' ORDER BY confidence DESC,asserted_at DESC LIMIT 1) AS language,
      (SELECT max(value #>> '{}') FROM metadata_assertion WHERE media_id=$1 AND field='latestReleaseDate') AS "latestReleaseDate",
      (SELECT jsonb_build_object('kind',fp.position_kind,'number',COALESCE(fp.global_position_number,fp.position_number::numeric),'raw',fp.position_raw,'season',fp.season,'seasonMediaId',observation.provenance->>'seasonMediaId','localNumber',fp.local_position_number,'globalNumber',fp.global_position_number,'provenance',observation.provenance,'updatedAt',fp.updated_at) FROM favorite_progress fp LEFT JOIN progression_observation observation ON observation.id=fp.observation_id WHERE fp.user_id=$2 AND fp.media_id=$1 ORDER BY fp.updated_at DESC LIMIT 1) AS progress,
      (SELECT jsonb_build_object('kind',pp.available_position_kind,'number',COALESCE(pp.global_position_number,pp.available_position_number),'raw',pp.available_position_raw,'season',pp.season,'localNumber',pp.local_position_number,'globalNumber',pp.global_position_number,'provider',pp.provider,'provenance',pp.available_position_provenance,'verifiedAt',pp.last_checked_at) FROM provider_progress pp WHERE pp.media_id=$1 AND pp.status='ACTIVE' AND pp.available_position_kind IS NOT NULL ORDER BY pp.updated_at DESC LIMIT 1) AS availability,
      (SELECT count(*)::int FROM bookmark_media_link link WHERE link.user_id=$2 AND link.media_id=$1 AND link.status IN ('matched','accepted','review')) AS "favoriteCount"`,[mediaId,userId]),
  ]);
  const modal=modalProjection.rows[0]??{};
  const reporting=(await reportingForMedia([mediaId],userId)).get(mediaId);
  return {
    ...base.rows[0],
    ...modal,
    title:titleSelection?.title??null,
    coverUrl: base.rows[0].coverProvenance
      ? authorizedRootMediaId
        ? `/api/v1/library/${encodeURIComponent(authorizedRootMediaId)}/related/${encodeURIComponent(mediaId)}/cover`
        : `/api/v1/catalog/media/${encodeURIComponent(mediaId)}/cover?v=${encodeURIComponent(base.rows[0].coverProvenance.fetchedAt)}`
      : null,
    displayedTitle: titleSelection?.title ?? null,
    titleSelection,
    timezone,
    titles: titles.rows,
    externalIds: ids.rows,
    providerProgress: progress.rows,
    airing: airing.rows,
    mangaUpdates: mu.rows,
    releases: releases.rows,
    animeSeasons: animeSeasons.rows,
    animeRelated: animeRelated.rows,
    provenance: { payloads: payloads.rows, sync: sync.rows },
    freshness: sync.rows.map((row: any) => ({
      provider: row.provider,
      lastCollectedAt: row.lastCollectedAt,
      status: row.status,
      error: row.error,
    })),
    favorites: favorites.rows,
    sources: sources.rows,
    providerPages: providerPages.rows,
    reporting,
  };
}
app.get("/api/v1/catalog/media/:mediaId", async (req: any, reply: any) => {
  const item = await richCatalogRow(
    req.user.id,
    req.params.mediaId,
    req.headers["x-timezone"],
  );
  if (!item) return err(reply, 404, "MEDIA_NOT_FOUND");
  return item;
});
app.get(
  "/api/v1/catalog/public-media/:mediaId/cover",
  async (req: any, reply: any) =>
    sendPublicCatalogCover(req.params.mediaId, req.user.id, req.headers, reply),
);
app.get(
  "/api/v1/library/:mediaId/related/:relatedMediaId/cover",
  async (req: any, reply: any) => {
    if (!await relatedLibraryMediaAllowed(req.params.mediaId,req.params.relatedMediaId,req.user.id))
      return err(
        reply,
        404,
        "RELATED_MEDIA_NOT_IN_LIBRARY_GRAPH",
        "Cette œuvre reliée n’est pas accessible depuis la bibliothèque.",
      );
    return sendPublicCatalogCover(
      req.params.relatedMediaId,
      req.user.id,
      req.headers,
      reply,
    );
  },
);
app.get(
  "/api/v1/catalog/media/:mediaId/cover",
  async (req: any, reply: any) => {
    const cover = await pool.query(
      `SELECT c.mime_type,COALESCE(a.data,c.data) AS data,c.status,c.provider,c.attribution FROM media_cover c LEFT JOIN catalog_image_asset a ON a.sha256=c.asset_sha256 WHERE c.media_id IN (SELECT $1::text UNION SELECT im.target_media_id FROM media_identity_merge im WHERE im.source_media_id=$1) AND ${contentAllowedSql('c.media_id','$2')} AND EXISTS (SELECT 1 FROM bookmark_media_link l WHERE l.media_id=$1 AND l.user_id=$2 AND l.status IN ('matched','accepted','review'))`,
      [req.params.mediaId, req.user.id],
    );
    if (
      !cover.rowCount ||
      cover.rows[0].status !== "ACTIVE" ||
      !cover.rows[0].data
    )
      return err(
        reply,
        404,
        "COVER_NOT_AVAILABLE",
        "Aucune couverture locale optimisée n’est disponible.",
      );
    const data = Buffer.from(cover.rows[0].data, "base64"),
      etag = `"${createHash("sha256").update(data).digest("base64url")}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    reply
      .type(cover.rows[0].mime_type)
      .header("Cache-Control", "private, max-age=2592000, immutable")
      .header("ETag", etag)
      .header("Content-Length", String(data.length))
      .header("X-FavLib-Cover-Provider", cover.rows[0].provider);
    if (cover.rows[0].attribution)
      reply.header("X-FavLib-Cover-Attribution", cover.rows[0].attribution);
    return data;
  },
);
app.get(
  "/api/v1/catalog/media/:mediaId/banner",
  async (req: any, reply: any) => {
    const banner = await pool.query(
      `SELECT b.mime_type,COALESCE(a.data,b.data) AS data,b.status,b.provider,b.attribution FROM media_banner b JOIN bookmark_media_link l ON l.media_id=b.media_id AND l.user_id=$2 AND l.status IN ('matched','accepted','review') LEFT JOIN catalog_image_asset a ON a.sha256=b.asset_sha256 WHERE b.media_id=$1 AND favlib_content_allowed(b.media_id,$2::uuid)`,
      [req.params.mediaId, req.user.id],
    );
    if (
      !banner.rowCount ||
      banner.rows[0].status !== "ACTIVE" ||
      !banner.rows[0].data
    )
      return err(
        reply,
        404,
        "BANNER_NOT_AVAILABLE",
        "Aucune bannière locale optimisée n’est disponible.",
      );
    const data = Buffer.from(banner.rows[0].data, "base64"),
      etag = `"${createHash("sha256").update(data).digest("base64url")}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    reply
      .type(banner.rows[0].mime_type)
      .header("Cache-Control", "private, max-age=2592000, immutable")
      .header("ETag", etag)
      .header("Content-Length", String(data.length))
      .header("X-FavLib-Banner-Provider", banner.rows[0].provider);
    if (banner.rows[0].attribution)
      reply.header("X-FavLib-Banner-Attribution", banner.rows[0].attribution);
    return data;
  },
);
app.get("/api/v1/catalog/health", async () => {
  const r = await pool.query(
    "SELECT count(*)::int AS media, count(*) FILTER (WHERE status='AUTHORIZED')::int AS authorized_policies FROM media m CROSS JOIN catalog_provider_policy",
  );
  const providers = await pool.query(
    "SELECT provider,status,version FROM catalog_provider_policy WHERE provider IN ('anilist','mangaupdates','mangadex') ORDER BY provider",
  );
  const sync = await pool.query(
    "SELECT service,observed_at AS \"observedAt\" FROM service_heartbeat WHERE service IN ('mangaupdates','anilist') ORDER BY service",
  );
  return {
    status: "ok",
    mediaCount: r.rows[0]?.media ?? 0,
    authorizedPolicies: r.rows[0]?.authorized_policies ?? 0,
    metadataProviders: ["source-page", "anilist", "mangaupdates"],
    externalCalls: "worker-only",
    providers: providers.rows,
    sync: sync.rows,
  };
});
app.get("/api/v1/library/:mediaId/providers", async (req: any, reply: any) => {
  const media = await pool.query("SELECT id,type FROM media WHERE id=$1", [
    req.params.mediaId,
  ]);
  if (!media.rowCount) return err(reply, 404, "MEDIA_NOT_FOUND");
  const [progress, ids, announcements] = await Promise.all([
    pool.query(
      `SELECT provider,serialization_status AS "serializationStatus",latest_chapter AS "latestChapter",latest_volume AS "latestVolume",latest_release_at AS "latestReleaseAt",last_checked_at AS "lastCheckedAt",status,last_error AS "lastError",provenance FROM provider_progress WHERE media_id=$1 ORDER BY provider`,
      [req.params.mediaId],
    ),
    pool.query(
      `SELECT provider,external_id AS "externalId",provenance FROM media_external_id WHERE media_id=$1 ORDER BY provider`,
      [req.params.mediaId],
    ),
    pool.query(
      `SELECT release_key AS "releaseKey",provider,status,announced_at AS "announcedAt",provenance FROM release_announcement WHERE media_id=$1 ORDER BY announced_at DESC LIMIT 100`,
      [req.params.mediaId],
    ),
  ]);
  return {
    media: media.rows[0],
    providers: progress.rows,
    externalIds: ids.rows,
    announcements: announcements.rows,
  };
});
app.get("/api/v1/classification/review", async (req: any) => {
  const r = await pool.query(
    'SELECT id,classifier_version AS "classifierVersion",input_fingerprint AS fingerprint,status,matches,created_at AS "createdAt" FROM classification_run WHERE user_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 100',
    [req.user.id, "review"],
  );
  return { items: r.rows };
});
app.post("/api/v1/classification", async (req: any, reply: any) => {
  const p = z
    .object({
      title: z.string().min(1).max(500),
      url: z.string().url(),
      year: z.number().int().optional(),
      type: z
        .enum(["ANIME", "MANGA", "MANHWA", "MANHUA", "UNKNOWN"])
        .optional(),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const rows = await catalogRows(req.user.id,"");
  const result = classify(p.data, rows, runtime.classificationKey);
  const saved = await pool.query(
    "INSERT INTO classification_run(user_id,classifier_version,input_fingerprint,status,matches) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,input_fingerprint,classifier_version) DO UPDATE SET status=excluded.status,matches=excluded.matches RETURNING id",
    [
      req.user.id,
      result.classifierVersion,
      result.fingerprint,
      result.status,
      JSON.stringify(result.matches),
    ],
  );
  return reply.code(200).send({ candidateId: saved.rows[0].id, ...result });
});
app.post(
  "/api/v1/classification/:candidateId/resolve",
  async (req: any, reply: any) => {
    const p = z.object({ mediaId: z.string().min(1) }).safeParse(req.body);
    if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
    const r = await pool.query(
      "UPDATE classification_run SET status='matched',matches=jsonb_build_array(jsonb_build_object('mediaId',$1,'score',1,'reasons',jsonb_build_array(jsonb_build_object('code','USER_CONFIRMED')))) WHERE id=$2 AND user_id=$3 RETURNING id",
      [p.data.mediaId, req.params.candidateId, req.user.id],
    );
    if (!r.rowCount) return err(reply, 404, "CLASSIFICATION_NOT_FOUND");
    return { ok: true, candidateId: r.rows[0].id, mediaId: p.data.mediaId };
  },
);
app.get(
  "/api/v1/admin/metadata-provider-policies",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const r = await pool.query(
      `SELECT p.provider,p.status,p.version,p.license,p.attribution,p.purposes,p.fields,p.retention,p.purge_procedure AS "purgeProcedure",p.quota,p.terms_source AS "termsSource",p.terms_checked_at AS "termsCheckedAt",p.next_review_at AS "nextReviewAt",p.reviewed_by AS "reviewedBy",p.reviewed_at AS "reviewedAt",p.purge_after AS "purgeAfter",last.status AS "lastResult",last.error AS "lastError",last.created_at AS "lastAttemptAt",last.next_retry_at AS "backoffUntil" FROM catalog_provider_policy p LEFT JOIN LATERAL(SELECT status,error,created_at,next_retry_at FROM metadata_attempt WHERE provider=p.provider ORDER BY created_at DESC LIMIT 1) last ON true ORDER BY p.provider`,
    );
    return { items: r.rows };
  },
);
app.patch(
  "/api/v1/admin/metadata-provider-policies/:provider",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const p = z
      .object({
        status: z.enum(["AUTHORIZED", "REVIEW_REQUIRED", "DISABLED"]),
        version: z.string().min(1).max(80),
        license: z.string().max(200).nullable().optional(),
        attribution: z.string().max(500).nullable().optional(),
        purposes: z.array(z.string().min(1).max(200)).min(1),
        fields: z.array(z.string().min(1).max(200)).min(1),
        retention: z.string().min(1).max(500),
        purgeProcedure: z.string().min(1).max(1000),
        quota: z.string().min(1).max(500),
        termsSource: z.string().url().max(1000),
        termsCheckedAt: z.string().datetime(),
        nextReviewAt: z.string().datetime(),
      })
      .safeParse(req.body);
    if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
    const r = await pool.query(
      `INSERT INTO catalog_provider_policy(provider,status,version,license,attribution,purposes,fields,retention,purge_procedure,quota,terms_source,terms_checked_at,next_review_at,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,version=excluded.version,license=excluded.license,attribution=excluded.attribution,purposes=excluded.purposes,fields=excluded.fields,retention=excluded.retention,purge_procedure=excluded.purge_procedure,quota=excluded.quota,terms_source=excluded.terms_source,terms_checked_at=excluded.terms_checked_at,next_review_at=excluded.next_review_at,reviewed_by=excluded.reviewed_by,reviewed_at=now() RETURNING provider,status,version,license,attribution,purposes,fields,retention,purge_procedure AS "purgeProcedure",quota,terms_source AS "termsSource",terms_checked_at AS "termsCheckedAt",next_review_at AS "nextReviewAt",reviewed_by AS "reviewedBy"`,
      [
        req.params.provider,
        p.data.status,
        p.data.version,
        p.data.license ?? null,
        p.data.attribution ?? null,
        p.data.purposes,
        p.data.fields,
        p.data.retention,
        p.data.purgeProcedure,
        p.data.quota,
        p.data.termsSource,
        p.data.termsCheckedAt,
        p.data.nextReviewAt,
        req.user.id,
      ],
    );
    return r.rows[0];
  },
);
app.post("/api/v1/auth/login", async (req, reply) => {
  const p = z
    .object({ email: z.string().email(), password: z.string().max(128) })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const email = p.data.email.toLowerCase();
  const r = await pool.query(
    "SELECT * FROM app_user WHERE email=$1 AND active",
    [email],
  );
  if (
    !r.rowCount ||
    !(await verifyPassword(r.rows[0].password_hash, p.data.password))
  )
    return err(reply, 401, "INVALID_CREDENTIALS", "Identifiants invalides.");
  await pool.query(
    "DELETE FROM security_rate_limit WHERE (bucket='login:account' AND subject_hash=$1) OR (bucket='login:ip' AND subject_hash=$2)",
    [digest(email), digest(req.ip)],
  );
  const raw = newOpaqueSecret(),
    csrfToken = newOpaqueSecret(24),
    now = Date.now();
  await pool.query(
    "INSERT INTO user_session(user_id,token_hash,csrf_hash,expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5)",
    [
      r.rows[0].id,
      digest(raw),
      digest(csrfToken),
      new Date(now + 12 * 3600e3),
      new Date(now + 7 * 86400e3),
    ],
  );
  reply.setCookie("__Host-favlib_session", raw, {
    secure: true,
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 86400,
  });
  return {
    user: { id: r.rows[0].id, email: r.rows[0].email, role: r.rows[0].role },
    csrfToken,
  };
});
app.post("/api/v1/auth/register", async (req, reply) => {
  const p = registerRequestContract.safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  try {
    validatePassword(p.data.password);
  } catch {
    return err(
      reply,
      422,
      "PASSWORD_POLICY",
      "Le mot de passe doit contenir au moins 15 caractères.",
    );
  }
  try {
    const user = await pool.query(
      "INSERT INTO app_user(email,password_hash,role) VALUES($1,$2,'member') RETURNING id,email,role",
      [p.data.email.toLowerCase(), await hashPassword(p.data.password)],
    );
    return reply.code(201).send({ user: user.rows[0] });
  } catch (error) {
    if ((error as any)?.code === "23505")
      return err(
        reply,
        409,
        "EMAIL_ALREADY_REGISTERED",
        "Cette adresse est déjà enregistrée.",
      );
    throw error;
  }
});
app.post("/api/v1/auth/password-reset", async (req: any, reply: any) => {
  const parsed = z
    .object({
      token: z.string().min(32).max(160),
      password: z.string().max(128),
    })
    .safeParse(req.body);
  if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
  try {
    validatePassword(parsed.data.password);
  } catch {
    return err(
      reply,
      422,
      "PASSWORD_POLICY",
      "Le mot de passe doit contenir au moins 15 caractères.",
    );
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const token = await client.query(
      "SELECT id,user_id,consumed_at FROM password_reset_token WHERE token_hash=$1 AND expires_at>now() FOR UPDATE",
      [digest(parsed.data.token)],
    );
    if (!token.rowCount || token.rows[0].consumed_at) {
      await client.query("ROLLBACK");
      return err(
        reply,
        403,
        "PASSWORD_RESET_INVALID",
        "Jeton invalide, expiré ou déjà utilisé.",
      );
    }
    await client.query("UPDATE app_user SET password_hash=$1 WHERE id=$2", [
      await hashPassword(parsed.data.password),
      token.rows[0].user_id,
    ]);
    await client.query(
      "UPDATE password_reset_token SET consumed_at=now() WHERE id=$1",
      [token.rows[0].id],
    );
    await client.query(
      "UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [token.rows[0].user_id],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
async function deviceAuth(req: any, reply: any) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token)
    return err(
      reply,
      401,
      "DEVICE_UNAUTHENTICATED",
      "Jeton d’appareil requis.",
    );
  const r = await pool.query(
    "SELECT d.*,u.role FROM extension_device d JOIN app_user u ON u.id=d.user_id AND u.active WHERE d.token_hash=$1 AND d.revoked_at IS NULL",
    [digest(token)],
  );
  if (!r.rowCount)
    return err(reply, 401, "DEVICE_REVOKED", "Appareil révoqué ou inconnu.");
  if (r.rows[0].protocol < MINIMUM_EXTENSION_PROTOCOL)
    return err(
      reply,
      426,
      "PROTOCOL_UNSUPPORTED",
      "Mise à jour de l’extension requise.",
    );
  req.device = r.rows[0];
  req.user = { id: r.rows[0].user_id, role: r.rows[0].role };
}
app.addHook("preValidation", async (req: any, reply) => {
  if (req.method !== "POST") return;
  const webAuth = ["/api/v1/auth/login", "/api/v1/auth/register"];
  if (webAuth.includes(req.url) && requireWebOrigin(req, reply) !== true)
    return;
  if (req.url === "/api/v1/auth/login") {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.toLowerCase()
        : "invalid";
    if (
      (await rateLimit("login:account", email, 5, 15)) ||
      (await rateLimit("login:ip", req.ip, 30, 15))
    )
      return err(reply, 429, "RATE_LIMITED", "Trop de tentatives.");
  }
  if (
    req.url === "/api/v1/auth/register" ||
    req.url === "/api/v1/auth/password-reset"
  ) {
    if (await rateLimit(`auth:${req.url.split("/").at(-1)}:ip`, req.ip, 10, 15))
      return err(reply, 429, "RATE_LIMITED", "Trop de tentatives.");
  }
  if (req.url === "/api/v1/extension/pairing/challenges") {
    const installation =
      typeof req.body?.installationId === "string"
        ? req.body.installationId
        : "invalid";
    if (await rateLimit("pairing:create", installation, 10, 10))
      return err(reply, 429, "RATE_LIMITED", "Trop de créations d’appairage.");
  }
});
app.addHook("preHandler", async (req, reply) => {
  const request = req as any;
  if (
    req.url.startsWith("/api/v1/auth/login") ||
    req.url === "/api/v1/health" ||
    ((req.method === "POST" || req.method === "GET") &&
      /^\/api\/v1\/extension\/pairing\/challenges(?:\/[^/]+)?$/.test(req.url) &&
      !req.url.endsWith("/confirm"))
  )
    return;
  if (
    req.url.startsWith("/api/v1/extension/import-batches") ||
    req.url.startsWith("/api/v1/extension/reconcile") ||
    req.url.startsWith("/api/v1/extension/diagnostic") ||
    req.url.startsWith("/api/v1/extension/report") ||
    req.url.startsWith("/api/v1/extension/updates") ||
    req.url.startsWith("/api/v1/extension/config") ||
    req.url.startsWith("/api/v1/extension/control") ||
    req.url.startsWith("/api/v1/extension/preferences") ||
    req.url.startsWith("/api/v1/extension/update-proposals") ||
    req.url.startsWith("/api/v1/extension/progression") ||
    req.url.startsWith("/api/v1/extension/page-resolution") ||
    req.url.startsWith("/api/v1/extension/favorites") ||
    req.url.startsWith("/api/v1/extension/page-metadata")
  ) {
    await deviceAuth(request, reply);
    if (reply.sent) return;
    if (
      req.url.startsWith("/api/v1/extension/import-batches") &&
      typeof request.body?.installationId === "string" &&
      request.body.installationId !== request.device.installation_id
    )
      return err(reply, 403, "DEVICE_INSTALLATION_MISMATCH");
    return;
  }
  await auth(request, reply);
  if (reply.sent) return;
  if (
    req.url === "/api/v1/sites" &&
    req.method === "POST" &&
    typeof request.body?.deviceId === "string"
  ) {
    const owned = await pool.query(
      "SELECT 1 FROM extension_device WHERE id=$1 AND user_id=$2",
      [request.body.deviceId, request.user.id],
    );
    if (!owned.rowCount) return err(reply, 403, "DEVICE_NOT_OWNED");
  }
  if (csrf(request, reply) !== true) return;
});

app.post("/api/v1/extension/pairing/challenges", async (req, reply) => {
  const p = z
    .object({
      installationId: z.string().min(16).max(100),
      protocol: z.number().int(),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  if (p.data.protocol < MINIMUM_EXTENSION_PROTOCOL)
    return err(reply, 426, "PROTOCOL_UNSUPPORTED");
  const challengeId = randomUUID(),
    code = randomInt(0, 100000000).toString().padStart(8, "0"),
    salt = newOpaqueSecret(16);
  await pool.query(
    "INSERT INTO pairing_challenge(id,installation_id,code_hash,salt,protocol,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
    [
      challengeId,
      p.data.installationId,
      digest(`${salt}:${code}`),
      salt,
      p.data.protocol,
    ],
  );
  return reply
    .code(201)
    .send({
      challengeId,
      code,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pairingUrl: pairingUrl(challengeId),
      protocol: EXTENSION_PROTOCOL,
    });
});
app.get("/api/v1/extension/pairing/challenges/:id", async (req: any, reply) => {
  const r = await pool.query(
    "SELECT id,installation_id,protocol,expires_at,consumed_at,activation_token FROM pairing_challenge WHERE id=$1",
    [req.params.id],
  );
  if (!r.rowCount) return err(reply, 404, "CHALLENGE_NOT_FOUND");
  const row = r.rows[0];
  if (!row.consumed_at && new Date(row.expires_at).getTime() < Date.now())
    return { status: "expired", challengeId: row.id, protocol: row.protocol };
  if (!row.consumed_at)
    return {
      status: "pending",
      challengeId: row.id,
      protocol: row.protocol,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  if (!row.activation_token)
    return { status: "consumed", challengeId: row.id, protocol: row.protocol };
  const token = row.activation_token;
  await pool.query(
    "UPDATE pairing_challenge SET activation_token=NULL WHERE id=$1",
    [row.id],
  );
  return {
    status: "activated",
    challengeId: row.id,
    installationId: row.installation_id,
    deviceToken: token,
    protocol: row.protocol,
  };
});
app.post(
  "/api/v1/extension/pairing/challenges/:id/confirm",
  async (req: any, reply) => {
    const p = z
      .object({
        code: z.string().regex(/^\d{8}$/),
        name: z.string().max(100).default("FavLib extension"),
        browser: z.string().max(40).default("unknown"),
      })
      .safeParse(req.body);
    if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const challenge = await client.query(
        "SELECT * FROM pairing_challenge WHERE id=$1 FOR UPDATE",
        [req.params.id],
      );
      if (!challenge.rowCount) {
        await client.query("ROLLBACK");
        return err(
          reply,
          404,
          "CHALLENGE_NOT_FOUND",
          "Code d’appairage inconnu.",
        );
      }
      const row = challenge.rows[0];
      if (!safeEqual(digest(`${row.salt}:${p.data.code}`), row.code_hash)) {
        await client.query(
          "UPDATE pairing_challenge SET attempts=attempts+1 WHERE id=$1 AND consumed_at IS NULL",
          [row.id],
        );
        await client.query("COMMIT");
        if (Number(row.attempts) + 1 >= 5)
          return err(
            reply,
            429,
            "PAIRING_ATTEMPTS_EXCEEDED",
            "Trop de tentatives pour ce code.",
          );
        return err(
          reply,
          400,
          "PAIRING_CODE_INVALID",
          "Code d’appairage invalide.",
        );
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return err(
          reply,
          410,
          "PAIRING_EXPIRED",
          "Le code d’appairage a expiré.",
        );
      }
      if (Number(row.attempts) >= 5) {
        await client.query("ROLLBACK");
        return err(
          reply,
          429,
          "PAIRING_ATTEMPTS_EXCEEDED",
          "Trop de tentatives pour ce code.",
        );
      }
      const owned = await client.query(
        "SELECT id,revoked_at FROM extension_device WHERE installation_id=$1 AND user_id=$2",
        [row.installation_id, req.user.id],
      );
      if (row.consumed_at) {
        await client.query("ROLLBACK");
        if (owned.rowCount && !owned.rows[0].revoked_at)
          return { ok: true, idempotent: true };
        return err(
          reply,
          409,
          "PAIRING_CODE_REUSED",
          "Ce code d’appairage a déjà été utilisé.",
        );
      }
      const otherOwner = await client.query(
        "SELECT 1 FROM extension_device WHERE installation_id=$1 AND user_id<>$2 AND revoked_at IS NULL LIMIT 1",
        [row.installation_id, req.user.id],
      );
      if (otherOwner.rowCount) {
        await client.query("ROLLBACK");
        return err(
          reply,
          409,
          "PAIRING_DEVICE_OWNED",
          "Cette installation est déjà liée à un autre compte.",
        );
      }
      const token = newOpaqueSecret(32);
      const device = await client.query(
        "INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,installation_id) DO UPDATE SET token_hash=excluded.token_hash,name=excluded.name,browser=excluded.browser,protocol=excluded.protocol,revoked_at=NULL RETURNING id",
        [
          req.user.id,
          row.installation_id,
          digest(token),
          p.data.name,
          p.data.browser,
          EXTENSION_PROTOCOL,
        ],
      );
      await client.query(
        "UPDATE pairing_challenge SET consumed_at=now(),activation_token=$1 WHERE id=$2",
        [token, row.id],
      );
      await client.query(
        "INSERT INTO security_event(actor_user_id,event,target_id,result) VALUES($1,'extension_paired',$2,'success')",
        [req.user.id, device.rows[0].id],
      );
      await client.query("COMMIT");
      return { ok: true };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  },
);
app.get("/api/v1/extension/devices", async (req: any) => {
  const r = await pool.query(
    `SELECT d.id,d.installation_id,d.name,d.browser,d.last_sync_at,d.verified_sync_at,d.revoked_at,
  count(i.id) FILTER (WHERE i.event<>'removed')::int AS "inventoryTotal",
  count(i.id) FILTER (WHERE i.event<>'removed' AND i.classification_status='recognized')::int AS "recognizedCount",
  count(i.id) FILTER (WHERE i.event<>'removed' AND i.classification_status='review')::int AS "reviewCount",
  count(i.id) FILTER (WHERE i.event<>'removed' AND i.classification_status='excluded')::int AS "excludedCount"
  FROM extension_device d LEFT JOIN bookmark_import_item i ON i.user_id=d.user_id AND i.installation_id=d.installation_id
  WHERE d.user_id=$1 GROUP BY d.id ORDER BY d.created_at DESC`,
    [req.user.id],
  );
  return {
    items: await Promise.all(
      r.rows.map(async (row: any) => ({
        ...row,
        installationIdShort: String(row.installation_id).slice(-8),
        inventoryDigest: (
          await inventoryDiagnostic(req.user.id, row.installation_id)
        ).inventoryDigest,
      })),
    ),
  };
});
async function reconcileBookmarkEvent(
  client: any,
  userId: string,
  installationId: string,
  item: any,
) {
  if (item.event !== "removed") return;
  const link = await client.query(
    "UPDATE bookmark_media_link SET status='removed' WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND status IN ('matched','accepted','review') RETURNING media_id",
    [userId, installationId, item.id],
  );
  for (const row of link.rows) {
    const active = await client.query(
      "SELECT 1 FROM bookmark_media_link WHERE user_id=$1 AND media_id=$2 AND status IN ('matched','accepted') LIMIT 1",
      [userId, row.media_id],
    );
    if (!active.rowCount)
      await client.query(
        "UPDATE release_origin SET status='STALE' WHERE user_id=$1 AND media_id=$2 AND status='AVAILABLE'",
        [userId, row.media_id],
      );
  }
}
async function classifyImportItems(
  client: any,
  userId: string,
  installationId: string,
  items: Array<any & { parseArtifact?: FavoriteParseArtifact }>,
) {
  const linked: Array<{ mediaId: string; title: string; url: string }> = [];
  for (const item of items) {
    if (item.event === "removed") {
      await client.query(
        "UPDATE bookmark_import_item SET classification_status='excluded',classification_reason='REMOVED' WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",
        [userId, installationId, item.id],
      );
      continue;
    }
    const artifact = item.parseArtifact;
    const classification = importIdentityFromArtifact(artifact, item.url);
    const identity = classification.identity;
    if (!identity) {
      const reason = classification.reason;
      await client.query(
        "UPDATE bookmark_import_item SET classification_status=$1,classification_reason=$2 WHERE user_id=$3 AND installation_id=$4 AND bookmark_id=$5",
        [
          classification.status,
          reason,
          userId,
          installationId,
          item.id,
        ],
      );
      await client.query(
        "UPDATE bookmark_media_link l SET status=$1,evidence=$2 WHERE l.user_id=$3 AND l.installation_id=$4 AND l.bookmark_id=$5 AND l.classifier_version='source-v1' AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)",
        [
          classification.status === "excluded" ? "removed" : "review",
          {
            source: "shared-parse-artifact",
            reason,
            url: item.url,
            parser: artifact?.parser ?? null,
          },
          userId,
          installationId,
          item.id,
        ],
      );
      continue;
    }
    const mediaId = `source:${digest(identity.key).slice(0, 40)}`;
    const shared = await client.query(
      `SELECT m.id
      FROM media m
      JOIN media_title t ON t.media_id=m.id AND t.kind IN ('source','official','alias') AND t.normalized_text=$2
      WHERE m.type=$1 AND m.id<>$3
        AND (EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=m.id AND mm.status='ACTIVE' AND mm.provider IN ('anilist','mangaupdates'))
          OR EXISTS(SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.purpose='metadata' AND es.status='PENDING' AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END))
      GROUP BY m.id ORDER BY m.id LIMIT 2`,
      [identity.type, normalizeText(identity.title), mediaId],
    );
    if (shared.rows.length === 1) {
      const target = shared.rows[0].id;
      await client.query(
        "INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,$3,$4,'matched','source-v1',$5) ON CONFLICT(user_id,installation_id,bookmark_id,classifier_version) DO UPDATE SET media_id=excluded.media_id,status='matched',evidence=excluded.evidence WHERE NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=bookmark_media_link.user_id AND r.installation_id=bookmark_media_link.installation_id AND r.bookmark_id=bookmark_media_link.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)",
        [
          userId,
          installationId,
          item.id,
          target,
          {
            source: "shared-active-provider",
            parsedTitle: identity.title,
            sourceUrl: identity.canonicalUrl,
            parser: artifact?.parser,
          },
        ],
      );
      await client.query(
        "UPDATE bookmark_import_item SET classification_status='recognized',classification_reason='SHARED_ACTIVE_PROVIDER' WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",
        [userId, installationId, item.id],
      );
      continue;
    }
    await client.query(
      "INSERT INTO media(id,type,format) VALUES($1,$2,NULL) ON CONFLICT(id) DO NOTHING",
      [mediaId, identity.type ?? "UNKNOWN"],
    );
    await client.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,connector,provenance) VALUES($1,$2,$3,NULL,'source','source-url',$4) ON CONFLICT DO NOTHING",
        [
          mediaId,
          identity.title,
          normalizeText(identity.title),
          { sourceUrl: identity.canonicalUrl, rawUrl: artifact?.raw.url, rawTitle: artifact?.raw.title, rawSlug: identity.rawSlug, transformations: identity.transformations, parser: artifact?.parser },
        ],
      );
    await client.query(
      "INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,$3,$4,'matched','source-v1',$5) ON CONFLICT(user_id,installation_id,bookmark_id,classifier_version) DO UPDATE SET media_id=excluded.media_id,status='matched',evidence=excluded.evidence WHERE NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=bookmark_media_link.user_id AND r.installation_id=bookmark_media_link.installation_id AND r.bookmark_id=bookmark_media_link.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)",
      [
        userId,
        installationId,
        item.id,
        mediaId,
        {
          source: "source-url",
          strategy: identity.strategy,
          evidence: identity.evidence,
          url: item.url,
          parser: artifact?.parser,
          transformations: identity.transformations,
        },
      ],
    );
    await client.query(
      "UPDATE bookmark_import_item SET classification_status='recognized',classification_reason=$1 WHERE user_id=$2 AND installation_id=$3 AND bookmark_id=$4",
      [
        classification.reason,
        userId,
        installationId,
        item.id,
      ],
    );
    // `parsedTitle` remains accepted on the wire for old extensions, but raw
    // server-observed input is the sole authority for parsing and identity.
    linked.push({ mediaId, title: identity.title, url: identity.canonicalUrl });
  }
  return linked;
}
app.post("/api/v1/extension/devices/:id/revoke", async (req: any, reply) => {
  const r = await pool.query(
    "UPDATE extension_device SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!r.rowCount) return err(reply, 404, "DEVICE_NOT_FOUND");
  return { ok: true };
});
app.post(
  "/api/v1/extension/import-batches/:mode?",
  async (req: any, reply: any) => {
    const adminRoute = req.params.mode === "admin-reimport";
    if (adminRoute && req.user.role !== "admin")
      return err(
        reply,
        403,
        "ADMIN_REQUIRED",
        "La resynchronisation complète est réservée aux administrateurs.",
      );
    const p = importBatchContract.safeParse(req.body);
    if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
    if (p.data.protocol < MINIMUM_EXTENSION_PROTOCOL)
      return err(reply, 426, "PROTOCOL_UNSUPPORTED");
    const client = await pool.connect();
    let metadata: Array<{ mediaId: string; title: string; url: string }> = [];
    let nextCursor = p.data.cursor ?? randomUUID();
    try {
      await client.query("BEGIN");
      const batch = await client.query(
        "INSERT INTO bookmark_import_batch(device_id,batch_id,cursor,item_count) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,batch_id) DO NOTHING RETURNING id",
        [req.device.id, p.data.batchId, nextCursor, p.data.items.length],
      );
      if (batch.rowCount) {
        for (const item of p.data.items) {
          const source = item.event === "removed" ? null : sourceIdentityFromUrl(item.url);
          const parseArtifact = parseFavorite({ title: item.title, url: item.url, source });
          const progressCandidate = item.event === "removed" ? null : parseArtifact.progression;
          const progressFingerprint = digest(JSON.stringify({ parserVersion: FAVORITE_PROGRESS_PARSER_VERSION, raw: parseArtifact.raw }));
          const previous = await client.query(
            "SELECT i.fingerprint,i.event,i.parser_version AS \"parserVersion\",l.media_id AS \"mediaId\" FROM bookmark_import_item i LEFT JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id AND l.status IN ('matched','accepted','review') WHERE i.user_id=$1 AND i.installation_id=$2 AND i.bookmark_id=$3 FOR UPDATE OF i",
            [req.user.id, p.data.installationId, item.id],
          );
          // Always recompute evidence from raw input, including unchanged catch-up
          // imports. Client-provided parsed/provenance fields are only hints.
          if (item.event !== "removed") {
            const candidate = progressCandidate;
            if (candidate)
              await client.query(
                `INSERT INTO favorite_progress_candidate(user_id,installation_id,bookmark_id,position_kind,position_number,position_raw,raw_title,raw_url,parsed_slug,path_segments,evidence,season,local_position_number,global_position_number)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
            ON CONFLICT(user_id,installation_id,bookmark_id,position_kind) DO UPDATE SET
              position_number=excluded.position_number,
              position_raw=excluded.position_raw,
              raw_title=excluded.raw_title,raw_url=excluded.raw_url,parsed_slug=excluded.parsed_slug,path_segments=excluded.path_segments,
              evidence=excluded.evidence,season=excluded.season,local_position_number=excluded.local_position_number,global_position_number=excluded.global_position_number,last_observed_at=now(),applied_at=CASE WHEN excluded.position_number>favorite_progress_candidate.position_number THEN NULL ELSE favorite_progress_candidate.applied_at END`,
                [
                  req.user.id,
                  p.data.installationId,
                  item.id,
                  candidate.kind,
                  candidate.number,
                  candidate.raw,
                  item.title,
                  item.url,
                  source?.slug ?? null,
                  JSON.stringify(candidate.provenance.pathSegments),
                  JSON.stringify(candidate.provenance),
                  candidate.season ?? null,
                  candidate.localNumber ?? null,
                  candidate.globalNumber ?? null,
                ],
              );
            else
              await client.query(
                "DELETE FROM favorite_progress_candidate WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",
                [req.user.id, p.data.installationId, item.id],
              );
            // Re-fire the trigger for a pre-existing resolved link after a catch-up.
            if (candidate)
              await client.query(
                "UPDATE bookmark_media_link SET status=status WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND status IN ('matched','accepted')",
                [req.user.id, p.data.installationId, item.id],
              );
          } else {
            await client.query(
              "DELETE FROM favorite_progress_candidate WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",
              [req.user.id, p.data.installationId, item.id],
            );
          }
          // A catalogue reset preserves the import fingerprint but removes the
          // media identity. Re-run classification/enrichment in that case.
          if (
            previous.rows[0]?.fingerprint === item.fingerprint &&
            previous.rows[0]?.event === item.event &&
            previous.rows[0]?.mediaId &&
            previous.rows[0]?.parserVersion === parseArtifact.version
          )
            continue;
          await client.query(
            "INSERT INTO bookmark_import_item(batch_id,user_id,installation_id,bookmark_id,fingerprint,event,payload,parse_artifact,parser_id,parser_version,parser_fingerprint,parse_status,progress_parser_version,progress_parser_fingerprint,progress_parse_status,classification_status,classification_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,'review','PENDING') ON CONFLICT(user_id,installation_id,bookmark_id) DO UPDATE SET batch_id=excluded.batch_id,fingerprint=excluded.fingerprint,event=excluded.event,payload=excluded.payload,parse_artifact=excluded.parse_artifact,parser_id=excluded.parser_id,parser_version=excluded.parser_version,parser_fingerprint=excluded.parser_fingerprint,parse_status=excluded.parse_status,progress_parser_version=excluded.progress_parser_version,progress_parser_fingerprint=excluded.progress_parser_fingerprint,progress_parse_status=excluded.progress_parse_status,classification_status='review',classification_reason='PENDING',created_at=now()",
            [
              batch.rows[0].id,
              req.user.id,
              p.data.installationId,
              item.id,
              item.fingerprint,
              item.event,
              item,
              JSON.stringify(parseArtifact),
              parseArtifact.parser,
              parseArtifact.version,
              parseArtifact.fingerprint,
              parseArtifact.status,
              FAVORITE_PROGRESS_PARSER_VERSION,
              progressFingerprint,
              progressCandidate ? "evidence" : "no_evidence",
            ],
          );
          await reconcileBookmarkEvent(
            client,
            req.user.id,
            p.data.installationId,
            item,
          );
        }
        const changed = [];
        for (const item of p.data.items) {
          const current = await client.query(
            "SELECT classification_reason,parse_artifact AS \"parseArtifact\" FROM bookmark_import_item WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3",
            [req.user.id, p.data.installationId, item.id],
          );
          if (current.rows[0]?.classification_reason === "PENDING")
            changed.push({ ...item, parseArtifact: current.rows[0].parseArtifact });
        }
        metadata = await classifyImportItems(
          client,
          req.user.id,
          p.data.installationId,
          changed,
        );
        for (const item of metadata)
          await enqueueMetadata(
            client,
            req.user.id,
            item.mediaId,
            item.title,
            item.url,
          );
        await client.query(
          "INSERT INTO reconciliation_cursor(device_id,cursor) VALUES($1,$2) ON CONFLICT(device_id) DO UPDATE SET cursor=excluded.cursor,updated_at=now()",
          [req.device.id, nextCursor],
        );
      }
      await client.query(
        "UPDATE extension_device SET last_sync_at=now() WHERE id=$1",
        [req.device.id],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    if (adminRoute)
      await pool.query(
        "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'extension.inventory_reimport.batch','extension_device',$2,$3,$4)",
        [
          req.user.id,
          req.device.id,
          { accepted: p.data.items.length, batchId: p.data.batchId },
          req.requestId,
        ],
      );
    const receipt=await inventoryDiagnostic(req.user.id,req.device.installation_id);
    return { ok: true, accepted: p.data.items.length, cursor: nextCursor, receipt:{...receipt,serverSyncedAt:new Date().toISOString()} };
  },
);
async function inventoryDiagnostic(userId: string, installationId: string) {
  const rows = await pool.query(
    `SELECT bookmark_id AS id,fingerprint,classification_status AS status FROM bookmark_import_item WHERE user_id=$1 AND installation_id=$2 AND event<>'removed' ORDER BY bookmark_id`,
    [userId, installationId],
  );
  const ordered = [...rows.rows].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const inventoryDigest = createHash("sha256")
    .update(ordered.map((row) => `${row.id}\0${row.fingerprint}\n`).join(""))
    .digest("hex");
  const counts = { recognizedCount: 0, reviewCount: 0, excludedCount: 0 };
  for (const row of rows.rows) {
    if (row.status === "recognized") counts.recognizedCount++;
    else if (row.status === "excluded") counts.excludedCount++;
    else counts.reviewCount++;
  }
  return { inventoryTotal: rows.rowCount, inventoryDigest, ...counts };
}
app.get("/api/v1/extension/diagnostic", async (req: any) => {
  const inventory = await inventoryDiagnostic(
    req.user.id,
    req.device.installation_id,
  );
  const device = await pool.query(
    'SELECT last_sync_at AS "lastSyncAt",verified_sync_at AS "verifiedSyncAt" FROM extension_device WHERE id=$1',
    [req.device.id],
  );
  const unresolved = await pool.query(
    `SELECT i.bookmark_id AS "bookmarkId",i.payload->>'title' AS title,i.payload->>'url' AS url,l.media_id AS "mediaId",COALESCE(es.status,CASE WHEN i.classification_status='review' THEN 'REVIEW' END) AS status,COALESCE(es.error_code,i.classification_reason) AS reason,es.candidate_snapshot AS candidates FROM bookmark_import_item i LEFT JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=$2 AND l.bookmark_id=i.bookmark_id AND l.status IN ('matched','accepted','review') LEFT JOIN LATERAL(SELECT status,error_code,candidate_snapshot FROM media_enrichment_state WHERE media_id=l.media_id AND provider IN ('anilist','mangaupdates') AND purpose='metadata' ORDER BY updated_at DESC LIMIT 1) es ON true WHERE i.user_id=$1 AND i.installation_id=$2 AND i.event<>'removed' AND (i.classification_status='review' OR es.status IN ('NO_MATCH','FAILED','TERMINAL')) ORDER BY i.created_at DESC LIMIT 500`,
    [req.user.id, req.device.installation_id],
  );
  const resolution = await pool.query(
    `SELECT provider,purpose,status,COALESCE(resolution_code,error_code,'NONE') AS code,count(*)::int AS count FROM media_enrichment_state WHERE media_id IN (SELECT media_id FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND status IN ('matched','accepted','review')) GROUP BY provider,purpose,status,code ORDER BY provider,purpose,status,code`,
    [req.user.id, req.device.installation_id],
  );
  const covers = await pool.query(
    `SELECT COALESCE(provider,'NONE') AS provider,COALESCE(status,'NONE') AS status,COALESCE(error,'NONE') AS error,count(*)::int AS count FROM media_cover WHERE media_id IN (SELECT media_id FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND status IN ('matched','accepted','review')) GROUP BY provider,status,error`,
    [req.user.id, req.device.installation_id],
  );
  const identity = await pool.query(
    `SELECT m.type,COALESCE(me.provider,'NONE') AS provider,count(DISTINCT m.id)::int AS count FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.user_id=$1 AND l.installation_id=$2 AND l.status IN ('matched','accepted','review') LEFT JOIN media_metadata me ON me.media_id=m.id AND me.status='ACTIVE' GROUP BY m.type,me.provider ORDER BY m.type,me.provider`,
    [req.user.id, req.device.installation_id],
  );
  const noCover = await pool.query(
    `SELECT m.id AS "mediaId",m.type FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.user_id=$1 AND l.installation_id=$2 AND l.status IN ('matched','accepted','review') LEFT JOIN media_cover c ON c.media_id=m.id AND c.status='ACTIVE' WHERE c.media_id IS NULL ORDER BY m.id`,
    [req.user.id, req.device.installation_id],
  );
  const jobs = await pool
    .query(
      `SELECT status,count(*)::int AS count FROM graphile_worker.jobs WHERE task_identifier IN ('anilist-enrichment','mangaupdates-enrichment') GROUP BY status`,
      [],
    )
    .catch(() => ({ rows: [] }));
  return {
    protocol: EXTENSION_PROTOCOL,
    minimumProtocol: MINIMUM_EXTENSION_PROTOCOL,
    deviceId: req.device.id,
    installationIdShort: String(req.device.installation_id).slice(-8),
    revoked: false,
    ...device.rows[0],
    ...inventory,
    collection: {
      total: inventory.inventoryTotal,
      recognized: inventory.recognizedCount,
      review: inventory.reviewCount,
      excluded: inventory.excludedCount,
    },
    unresolvedItems: unresolved.rows,
    debug: {
      resolution: resolution.rows,
      covers: covers.rows,
      identity: identity.rows,
      animeResolved: identity.rows.filter(
        (x: any) => x.type === "ANIME" && x.provider === "anilist",
      ),
      readingResolved: identity.rows.filter(
        (x: any) =>
          ["MANGA", "MANHWA", "MANHUA"].includes(x.type) &&
          x.provider === "mangaupdates",
      ),
      anilistCovers: covers.rows.filter((x: any) => x.provider === "anilist"),
      withoutIdentity: identity.rows.filter((x: any) => x.provider === "NONE"),
      withoutCover: noCover.rows,
      jobs: jobs.rows,
    },
  };
});
app.get("/api/v1/extension/report", async (req: any) => {
  const rows = await pool.query(
    `SELECT i.bookmark_id AS "bookmarkId",i.classification_status AS status,i.payload->>'url' AS url,m.type,l.media_id AS "mediaId" FROM bookmark_import_item i LEFT JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id AND l.status IN ('matched','accepted') LEFT JOIN media m ON m.id=l.media_id WHERE i.user_id=$1 AND i.installation_id=$2 AND i.event<>'removed'`,
    [req.user.id, req.device.installation_id],
  );
  const byDomain: Record<string, number> = {},
    byType: Record<string, { favorites: number; works: Set<string> }> = {};
  for (const row of rows.rows) {
    let domain = "invalid";
    try {
      domain = new URL(row.url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {}
    byDomain[domain] = (byDomain[domain] ?? 0) + 1;
    const type = row.type ?? "UNRESOLVED";
    const group = (byType[type] ??= { favorites: 0, works: new Set<string>() });
    group.favorites++;
    if (row.mediaId) group.works.add(row.mediaId);
    byType[type] = group;
  }
  return {
    inventoryTotal: rows.rowCount,
    byDomain: Object.entries(byDomain)
      .sort((a, b) => b[1] - a[1])
      .map(([domain, favorites]) => ({ domain, favorites })),
    byType: Object.entries(byType).map(([type, value]) => ({
      type,
      favorites: value.favorites,
      works: value.works.size,
    })),
  };
});
app.post("/api/v1/extension/reconcile", async (req: any, reply: any) => {
  const parsed = z
    .object({
      inventoryTotal: z.number().int().nonnegative(),
      inventoryDigest: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .safeParse(req.body);
  if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
  const inventory = await inventoryDiagnostic(
    req.user.id,
    req.device.installation_id,
  );
  if (
    inventory.inventoryTotal !== parsed.data.inventoryTotal ||
    inventory.inventoryDigest !== parsed.data.inventoryDigest
  )
    return reply.code(409).send({ verified: false, ...inventory });
  const saved = await pool.query(
    'UPDATE extension_device SET verified_sync_at=now() WHERE id=$1 RETURNING verified_sync_at AS "verifiedSyncAt"',
    [req.device.id],
  );
  return {
    verified: true,
    verifiedSyncAt: saved.rows[0].verifiedSyncAt,
    ...inventory,
  };
});
app.get("/api/v1/sites", async (req: any) => {
  const r = await pool.query(
    'SELECT id,domain,source,device_id AS "deviceId",created_at AS "createdAt" FROM approved_site WHERE user_id=$1 ORDER BY domain',
    [req.user.id],
  );
  return { items: r.rows };
});
app.post("/api/v1/sites", async (req: any, reply) => {
  const p = z
    .object({
      domain: z.string().min(1).max(253),
      source: z.enum(["manual", "bookmark"]).default("manual"),
      deviceId: z.string().uuid().nullable().optional(),
    })
    .safeParse(req.body);
  if (
    !p.success ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      p.data?.domain ?? "",
    )
  )
    return err(reply, 400, "INVALID_APPROVED_DOMAIN", "Domaine invalide.");
  const domain = p.data.domain.toLowerCase().replace(/^www\./, "");
  const r = await pool.query(
    "INSERT INTO approved_site(user_id,device_id,domain,source) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,device_id,domain) DO UPDATE SET source=excluded.source RETURNING id,domain,source",
    [req.user.id, p.data.deviceId ?? null, domain, p.data.source],
  );
  return reply.code(201).send(r.rows[0]);
});
app.delete("/api/v1/sites/:id", async (req: any, reply) => {
  const r = await pool.query(
    "DELETE FROM approved_site WHERE id=$1 AND user_id=$2 RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!r.rowCount) return err(reply, 404, "SITE_NOT_FOUND");
  return { ok: true };
});
app.get("/api/v1/links/checks", async (req: any) => {
  const r = await pool.query(
    'SELECT url,status,checked_at AS "checkedAt",error,failures FROM url_check WHERE user_id=$1 ORDER BY checked_at DESC NULLS LAST',
    [req.user.id],
  );
  return { items: r.rows };
});
app.post("/api/v1/links/checks", async (req: any, reply) => {
  const p = z
    .object({
      url: z.string().url(),
      status: z.enum(["accessible", "needs_review", "offline", "unknown"]),
      error: z.string().max(500).nullable().optional(),
      failures: z.number().int().nonnegative().default(0),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const r = await pool.query(
    'INSERT INTO url_check(user_id,url,status,checked_at,error,failures) VALUES($1,$2,$3,now(),$4,$5) ON CONFLICT(user_id,url) DO UPDATE SET status=excluded.status,checked_at=now(),error=excluded.error,failures=excluded.failures RETURNING url,status,checked_at AS "checkedAt",error,failures',
    [
      req.user.id,
      p.data.url,
      p.data.status,
      p.data.error ?? null,
      p.data.failures,
    ],
  );
  return r.rows[0];
});
app.get("/api/v1/extension/updates", async (req: any) => {
  const r = await pool.query(
    'SELECT id,bookmark_id AS "bookmarkId",old_url AS "oldUrl",old_title AS "oldTitle",new_url AS "newUrl",new_title AS "newTitle",created_at AS "createdAt",undone_at AS "undoneAt" FROM favorite_update_log WHERE user_id=$1 AND (device_id=$2 OR device_id IS NULL) ORDER BY created_at DESC',
    [req.user.id, req.device?.id ?? null],
  );
  return { items: r.rows };
});
app.post("/api/v1/extension/updates", async (req: any, reply: any) => {
  const p = z
    .object({
      bookmarkId: z.string().min(1),
      oldUrl: z.string().url(),
      oldTitle: z.string().max(500),
      newUrl: z.string().url(),
      newTitle: z.string().max(500),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const r = await pool.query(
    'INSERT INTO favorite_update_log(user_id,device_id,bookmark_id,old_url,old_title,new_url,new_title) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,created_at AS "createdAt"',
    [
      req.user.id,
      req.device?.id ?? null,
      p.data.bookmarkId,
      p.data.oldUrl,
      p.data.oldTitle,
      p.data.newUrl,
      p.data.newTitle,
    ],
  );
  return reply.code(201).send(r.rows[0]);
});
app.post("/api/v1/extension/updates/:id/undo", async (req: any, reply: any) => {
  const r = await pool.query(
    'UPDATE favorite_update_log SET undone_at=now() WHERE id=$1 AND user_id=$2 AND undone_at IS NULL RETURNING id,bookmark_id AS "bookmarkId",old_url AS "oldUrl",old_title AS "oldTitle"',
    [req.params.id, req.user.id],
  );
  if (!r.rowCount) return err(reply, 404, "UPDATE_NOT_FOUND");
  return { ok: true, update: r.rows[0] };
});
app.get("/api/v1/extension/config", async (req: any) => {
  const browser = /firefox/i.test(req.device.browser)
    ? "firefox"
    : /chrome|chromium/i.test(req.device.browser)
      ? "chrome"
      : null;
  const [preference, release, sites] = await Promise.all([
    pool.query(
      'SELECT auto_update_favorites AS "autoUpdateFavorites",observe_navigation AS "observeNavigation",sync_minutes AS "syncMinutes",updated_at AS "updatedAt" FROM extension_preference WHERE user_id=$1',
      [req.user.id],
    ),
    browser
      ? pool.query("SELECT version FROM extension_release WHERE browser=$1", [
          browser,
        ])
      : Promise.resolve({ rows: [] }),
    pool.query(
      "SELECT id,domain,source FROM approved_site WHERE user_id=$1 AND (device_id IS NULL OR device_id=$2) ORDER BY domain",
      [req.user.id, req.device.id],
    ),
  ]);
  return {
    protocol: EXTENSION_PROTOCOL,
    minimumProtocol: MINIMUM_EXTENSION_PROTOCOL,
    preferences: preference.rows[0] ?? {
      autoUpdateFavorites: false,
      observeNavigation: false,
      syncMinutes: await operationalValue("extension.syncMinutes"),
      updatedAt: null,
    },
    availableVersion: release.rows[0]?.version ?? null,
    browser,
    role: req.user.role,
    sites: sites.rows,
  };
});
app.get('/api/v1/extension/control',async(req:any)=>{
  const browser=/firefox/i.test(req.device.browser)?'firefox':/chrome|chromium/i.test(req.device.browser)?'chrome':null;
  const [preference,release,sites,proposals,receipt]=await Promise.all([
    pool.query('SELECT auto_update_favorites AS "autoUpdateFavorites",observe_navigation AS "observeNavigation",sync_minutes AS "syncMinutes",updated_at AS "updatedAt" FROM extension_preference WHERE user_id=$1',[req.user.id]),
    browser?pool.query('SELECT version FROM extension_release WHERE browser=$1',[browser]):Promise.resolve({rows:[]}),
    pool.query("SELECT id,domain,source FROM approved_site WHERE user_id=$1 AND (device_id IS NULL OR device_id=$2) ORDER BY domain",[req.user.id,req.device.id]),
    pool.query(`SELECT id,bookmark_id AS "bookmarkId",expected_url AS "expectedUrl",expected_title AS "expectedTitle",new_url AS "newUrl",new_title AS "newTitle",domain,state,created_at AS "createdAt" FROM favorite_update_proposal WHERE user_id=$1 AND state='PENDING' AND (device_id=$2 OR device_id IS NULL) ORDER BY created_at,id`,[req.user.id,req.device.id]),
    inventoryDiagnostic(req.user.id,req.device.installation_id),
  ]);
  return {protocol:EXTENSION_PROTOCOL,minimumProtocol:MINIMUM_EXTENSION_PROTOCOL,preferences:preference.rows[0]??{autoUpdateFavorites:false,observeNavigation:false,syncMinutes:await operationalValue('extension.syncMinutes'),updatedAt:null},availableVersion:release.rows[0]?.version??null,browser,role:req.user.role,sites:sites.rows,proposals:proposals.rows,receipt};
});
app.patch("/api/v1/extension/preferences", async (req: any, reply: any) => {
  const parsed = extensionPreferencesPatchContract.safeParse(req.body);
  if (!parsed.success)
    return err(
      reply,
      422,
      "SETTING_OUT_OF_BOUNDS",
      "Préférence inconnue ou hors bornes.",
      parsed.error.issues,
    );
  const current = await pool.query(
    'SELECT auto_update_favorites AS "autoUpdateFavorites",observe_navigation AS "observeNavigation",sync_minutes AS "syncMinutes" FROM extension_preference WHERE user_id=$1',
    [req.user.id],
  );
  const next = {
    autoUpdateFavorites: false,
    observeNavigation: false,
    syncMinutes: await operationalValue("extension.syncMinutes"),
    ...(current.rows[0] ?? {}),
    ...parsed.data,
  };
  const saved = await pool.query(
    'INSERT INTO extension_preference(user_id,auto_update_favorites,observe_navigation,sync_minutes) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET auto_update_favorites=excluded.auto_update_favorites,observe_navigation=excluded.observe_navigation,sync_minutes=excluded.sync_minutes,updated_at=now() RETURNING auto_update_favorites AS "autoUpdateFavorites",observe_navigation AS "observeNavigation",sync_minutes AS "syncMinutes",updated_at AS "updatedAt"',
    [
      req.user.id,
      next.autoUpdateFavorites,
      next.observeNavigation,
      next.syncMinutes,
    ],
  );
  return saved.rows[0];
});
app.get("/api/v1/extension/update-proposals", async (req: any) => {
  const rows = await pool.query(
    `SELECT id,bookmark_id AS "bookmarkId",expected_url AS "expectedUrl",expected_title AS "expectedTitle",new_url AS "newUrl",new_title AS "newTitle",domain,state,created_at AS "createdAt" FROM favorite_update_proposal WHERE user_id=$1 AND state='PENDING' AND (device_id=$2 OR device_id IS NULL) ORDER BY created_at,id`,
    [req.user.id, req.device.id],
  );
  return { items: rows.rows };
});
app.post(
  "/api/v1/extension/update-proposals/:id/result",
  async (req: any, reply: any) => {
    const parsed = extensionProposalResultContract.safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const proposal = await client.query(
        "SELECT * FROM favorite_update_proposal WHERE id=$1 AND user_id=$2 AND state='PENDING' AND (device_id=$3 OR device_id IS NULL) FOR UPDATE",
        [req.params.id, req.user.id, req.device.id],
      );
      if (!proposal.rowCount) {
        await client.query("ROLLBACK");
        return err(reply, 404, "PROPOSAL_NOT_PENDING");
      }
      const row = proposal.rows[0];
      await client.query(
        "UPDATE favorite_update_proposal SET state=$1,result_code=$2,resolved_at=now() WHERE id=$3",
        [parsed.data.result, parsed.data.code ?? null, row.id],
      );
      if (parsed.data.result === "APPLIED")
        await client.query(
          "INSERT INTO favorite_update_log(user_id,device_id,bookmark_id,old_url,old_title,new_url,new_title) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
          [
            req.user.id,
            req.device.id,
            row.bookmark_id,
            row.expected_url,
            row.expected_title,
            row.new_url,
            row.new_title,
          ],
        );
      await client.query("COMMIT");
      return { ok: true, state: parsed.data.result };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);
app.post("/api/v1/auth/logout", async (req: any, reply) => {
  await pool.query("UPDATE user_session SET revoked_at=now() WHERE id=$1", [
    req.user.session_id,
  ]);
  reply.clearCookie("__Host-favlib_session", { path: "/" });
  return { ok: true };
});
app.get("/api/v1/auth/session", async (req: any) => ({
  user: { id: req.user.id, email: req.user.email, role: req.user.role },
}));
app.get("/api/v1/admin/users", async (req: any, reply) => {
  if (req.user.role !== "admin")
    return err(reply, 403, "FORBIDDEN", "Action interdite.");
  const parsed = z
    .object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(SECURITY_LIMITS.adminPageSizeMax)
        .default(50),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .safeParse(req.query ?? {});
  if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
  const r = await pool.query(
    `SELECT u.id,u.email,u.role,u.active,u.created_at AS "createdAt",max(d.last_sync_at) AS "lastSyncAt",count(DISTINCT d.id)::int AS devices,count(*) OVER()::int AS "totalCount" FROM app_user u LEFT JOIN extension_device d ON d.user_id=u.id GROUP BY u.id ORDER BY u.created_at,u.id LIMIT $1 OFFSET $2`,
    [parsed.data.limit, parsed.data.offset],
  );
  const total = r.rows[0]?.totalCount ?? 0;
  return {
    items: r.rows.map(({ totalCount: _, ...row }) => row),
    total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  };
});
app.patch("/api/v1/admin/users/:id", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const parsed = adminUserPatchContract.safeParse(req.body);
  if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(
      "SELECT id,role,active FROM app_user WHERE id=$1 FOR UPDATE",
      [req.params.id],
    );
    if (!target.rowCount) {
      await client.query("ROLLBACK");
      return err(reply, 404, "USER_NOT_FOUND");
    }
    const removesAdmin =
      (parsed.data.role === "member" || parsed.data.active === false) &&
      target.rows[0].role === "admin" &&
      target.rows[0].active;
    if (removesAdmin) {
      const admins = await client.query(
        "SELECT count(*)::int AS count FROM app_user WHERE role='admin' AND active",
      );
      if (admins.rows[0].count <= 1) {
        await client.query("ROLLBACK");
        return err(
          reply,
          409,
          "LAST_ADMIN_PROTECTED",
          "Le dernier administrateur actif est protégé.",
        );
      }
    }
    const updated = await client.query(
      'UPDATE app_user SET role=COALESCE($1,role),active=COALESCE($2,active) WHERE id=$3 RETURNING id,email,role,active,created_at AS "createdAt"',
      [parsed.data.role ?? null, parsed.data.active ?? null, req.params.id],
    );
    if (parsed.data.active === false)
      await client.query(
        "UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
        [req.params.id],
      );
    await client.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'user.update','user',$2,$3,$4)",
      [req.user.id, req.params.id, parsed.data, req.requestId],
    );
    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post(
  "/api/v1/admin/users/:id/revoke-sessions",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const result = await pool.query(
      "UPDATE user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [req.params.id],
    );
    await pool.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'sessions.revoke','user',$2,$3,$4)",
      [req.user.id, req.params.id, { revoked: result.rowCount }, req.requestId],
    );
    return { ok: true, revoked: result.rowCount };
  },
);
app.get("/api/v1/admin/invitations", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(
    `SELECT i.id,i.email,i.expires_at AS "expiresAt",i.consumed_at AS "consumedAt",i.revoked_at AS "revokedAt",i.created_by AS "createdBy" FROM invitation i ORDER BY i.expires_at DESC LIMIT $1`,
    [SECURITY_LIMITS.adminPageSizeMax],
  );
  return { items: result.rows };
});
app.post("/api/v1/admin/invitations", async (req: any, reply) => {
  if (req.user.role !== "admin")
    return err(reply, 403, "FORBIDDEN", "Action interdite.");
  const p = adminInvitationCreateContract.safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const raw = newOpaqueSecret(32);
  const created = await pool.query(
    "INSERT INTO invitation(token_hash,email,created_by,expires_at) VALUES($1,$2,$3,now()+($4::text||' hours')::interval) RETURNING id,email,expires_at AS \"expiresAt\"",
    [
      digest(raw),
      p.data.email.toLowerCase(),
      req.user.id,
      p.data.expiresInHours,
    ],
  );
  await pool.query(
    "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'invitation.create','invitation',$2,$3,$4)",
    [
      req.user.id,
      created.rows[0].id,
      {
        email: p.data.email.toLowerCase(),
        expiresInHours: p.data.expiresInHours,
      },
      req.requestId,
    ],
  );
  return reply.code(201).send({ ...created.rows[0], token: raw });
});
app.delete("/api/v1/admin/invitations/:id", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(
    "UPDATE invitation SET revoked_at=now(),revoked_by=$1 WHERE id=$2 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id",
    [req.user.id, req.params.id],
  );
  if (!result.rowCount) return err(reply, 404, "INVITATION_NOT_REVOCABLE");
  await pool.query(
    "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,request_id) VALUES($1,'invitation.revoke','invitation',$2,$3)",
    [req.user.id, req.params.id, req.requestId],
  );
  return { ok: true, revoked: true };
});
app.post("/api/v1/auth/password", async (req: any, reply) => {
  const p = z
    .object({ currentPassword: z.string(), newPassword: z.string() })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  try {
    validatePassword(p.data.newPassword);
  } catch {
    return err(reply, 422, "PASSWORD_POLICY", "Mot de passe trop court.");
  }
  const r = await pool.query("SELECT password_hash FROM app_user WHERE id=$1", [
    req.user.id,
  ]);
  if (!(await verifyPassword(r.rows[0].password_hash, p.data.currentPassword)))
    return err(reply, 401, "INVALID_CREDENTIALS", "Identifiants invalides.");
  await pool.query("UPDATE app_user SET password_hash=$1 WHERE id=$2", [
    await hashPassword(p.data.newPassword),
    req.user.id,
  ]);
  await pool.query(
    "UPDATE user_session SET revoked_at=now() WHERE user_id=$1",
    [req.user.id],
  );
  return { ok: true };
});
app.post("/api/v1/extension/progression", async (req: any, reply: any) => {
  const p = z
    .object({
      bookmarkId: z.string().min(1).max(200),
      url: z.string().url(),
      title: z.string().max(500),
      position: z.string().min(1).max(100),
      kind: z
        .enum(["season", "volume", "chapter", "episode", "special"])
        .default("episode"),
      confidence: z.enum(["high", "medium", "low"]),
      consented: z.boolean(),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const link = await pool.query(
    `SELECT media_id AS "mediaId" FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND status IN ('matched','accepted') AND ${contentAllowedSql('bookmark_media_link.media_id')} LIMIT 1`,
    [req.user.id, req.device.installation_id, p.data.bookmarkId],
  );
  if (!link.rowCount) return err(reply, 404, "FAVORITE_NOT_LINKED");
  const mediaId = link.rows[0].mediaId;
  const next = position(p.data.position, p.data.kind);
  const current = await pool.query(
    'SELECT position_kind AS "kind",position_number AS "number",position_raw AS "raw" FROM favorite_progress WHERE user_id=$1 AND media_id=$2 AND position_kind=$3',
    [req.user.id, mediaId, p.data.kind],
  );
  const currentPosition = current.rowCount
    ? {
        kind: current.rows[0].kind,
        number:
          current.rows[0].number === null
            ? undefined
            : Number(current.rows[0].number),
        raw: current.rows[0].raw,
      }
    : null;
  const observation = {
    mediaId,
    source: p.data.url,
    position: next,
    confidence: p.data.confidence,
    consented: p.data.consented,
    observedAt: new Date().toISOString(),
  };
  if (!acceptObservation(currentPosition, observation))
    return err(
      reply,
      409,
      "PROGRESSION_REJECTED",
      "Observation non consentie, incertaine ou régressive.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const saved = await client.query(
      "INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,confidence,consented,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,media_id,source,position_kind,position_raw,observed_at) DO UPDATE SET confidence=excluded.confidence RETURNING id",
      [
        req.user.id,
        mediaId,
        p.data.url,
        next.kind,
        next.number ?? null,
        next.raw,
        p.data.confidence,
        p.data.consented,
        observation.observedAt,
      ],
    );
    await client.query(
      "INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,media_id,position_kind) DO UPDATE SET position_number=excluded.position_number,position_raw=excluded.position_raw,observation_id=excluded.observation_id,updated_at=now()",
      [
        req.user.id,
        mediaId,
        next.kind,
        next.number ?? null,
        next.raw,
        saved.rows[0].id,
      ],
    );
    await client.query("COMMIT");
    return reply.code(201).send({ ok: true, mediaId, position: next.raw });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post("/api/v1/admin/sources/preview", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const p = z
    .object({
      definition: z.object({
        sourceId: z.string().min(1).max(100),
        version: z.string().min(1).max(80),
        domain: z.string().min(1).max(253),
        page: z.enum(["work", "release"]),
        titleSelector: z.string().max(100),
        sequenceSelector: z.string().max(100),
        linkSelector: z.string().max(100),
        sequencePattern: z.string().max(100).optional(),
      }),
      html: z.string().max(512 * 1024),
      baseUrl: z.string().url(),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const errors = validateDeclarative(p.data.definition);
  return {
    validation: errors,
    preview: previewDeclarative(p.data.definition, p.data.html, p.data.baseUrl),
  };
});
app.get("/api/v1/admin/sources", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const r = await pool.query(
    'SELECT s.id,s.domain,s.state,s.feature_flag AS "featureFlag",s.active_version AS "activeVersion",COALESCE(json_agg(v.definition ORDER BY v.created_at) FILTER (WHERE v.id IS NOT NULL),\'[]\'::json) AS versions FROM source_connector s LEFT JOIN source_connector_version v ON v.source_id=s.id GROUP BY s.id ORDER BY s.id',
  );
  return { items: r.rows };
});
app.post("/api/v1/admin/sources", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const p = z
    .object({
      definition: z.object({
        sourceId: z.string().min(1).max(100),
        version: z.string().min(1).max(80),
        domain: z.string().min(1).max(253),
        page: z.enum(["work", "release"]),
        titleSelector: z.string().max(100),
        sequenceSelector: z.string().max(100),
        linkSelector: z.string().max(100),
        sequencePattern: z.string().max(100).optional(),
      }),
      featureFlag: z.string().regex(/^source\.[a-z0-9._-]+$/),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const errors = validateDeclarative(p.data.definition);
  if (errors.length)
    return err(reply, 422, "SOURCE_DEFINITION_INVALID", errors.join(","));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO source_connector(id,domain,state,feature_flag) VALUES($1,$2,'REVIEW',$3) ON CONFLICT(id) DO UPDATE SET domain=excluded.domain,feature_flag=excluded.feature_flag",
      [
        p.data.definition.sourceId,
        p.data.definition.domain,
        p.data.featureFlag,
      ],
    );
    await client.query(
      "INSERT INTO source_connector_version(source_id,version,definition) VALUES($1,$2,$3) ON CONFLICT(source_id,version) DO NOTHING",
      [
        p.data.definition.sourceId,
        p.data.definition.version,
        JSON.stringify(p.data.definition),
      ],
    );
    await client.query("COMMIT");
    return reply
      .code(201)
      .send({
        ok: true,
        sourceId: p.data.definition.sourceId,
        version: p.data.definition.version,
        state: "REVIEW",
      });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post(
  "/api/v1/admin/sources/:sourceId/activate",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const p = z
      .object({ version: z.string().min(1).max(80) })
      .safeParse(req.body);
    if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
    const r = await pool.query(
      "UPDATE source_connector SET state='ACTIVE',active_version=$1 WHERE id=$2 AND EXISTS(SELECT 1 FROM source_connector_version WHERE source_id=$2 AND version=$1) RETURNING id,state,active_version AS \"activeVersion\"",
      [p.data.version, req.params.sourceId],
    );
    if (!r.rowCount) return err(reply, 404, "SOURCE_VERSION_NOT_FOUND");
    return r.rows[0];
  },
);
app.post(
  "/api/v1/admin/sources/:sourceId/rollback",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const current = await pool.query(
      'SELECT active_version AS "activeVersion" FROM source_connector WHERE id=$1',
      [req.params.sourceId],
    );
    if (!current.rowCount) return err(reply, 404, "SOURCE_NOT_FOUND");
    const previous = await pool.query(
      "SELECT version FROM source_connector_version WHERE source_id=$1 AND version<>$2 ORDER BY created_at DESC LIMIT 1",
      [req.params.sourceId, current.rows[0].activeVersion],
    );
    if (!previous.rowCount) return err(reply, 409, "SOURCE_ROLLBACK_EMPTY");
    const r = await pool.query(
      "UPDATE source_connector SET active_version=$1,state='ACTIVE' WHERE id=$2 RETURNING id,state,active_version AS \"activeVersion\"",
      [previous.rows[0].version, req.params.sourceId],
    );
    return r.rows[0];
  },
);
app.post("/api/v1/account-exports", async (req: any, reply: any) => {
  const key =
    typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"]
      : "";
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(key))
    return err(reply, 400, "IDEMPOTENCY_KEY_REQUIRED");
  const existing = await pool.query(
    "SELECT response_code,response_body FROM idempotency_key WHERE owner_id=$1 AND route=$2 AND key=$3",
    [req.user.id, "account-export", key],
  );
  if (existing.rowCount)
    return reply
      .code(existing.rows[0].response_code)
      .send(existing.rows[0].response_body);
  const [user, bookmarks, links, progress, preferences] = await Promise.all([
    pool.query(
      'SELECT id,email,role,created_at AS "createdAt" FROM app_user WHERE id=$1',
      [req.user.id],
    ),
    pool.query(
      'SELECT bookmark_id AS "bookmarkId",payload,event,created_at AS "createdAt" FROM bookmark_import_item WHERE user_id=$1 ORDER BY created_at',
      [req.user.id],
    ),
    pool.query(
      'SELECT installation_id AS "installationId",bookmark_id AS "bookmarkId",media_id AS "mediaId",status,evidence FROM bookmark_media_link WHERE user_id=$1',
      [req.user.id],
    ),
    pool.query(
      'SELECT media_id AS "mediaId",position_kind AS "kind",position_number AS "number",position_raw AS "raw",updated_at AS "updatedAt" FROM favorite_progress WHERE user_id=$1',
      [req.user.id],
    ),
    pool.query(
      'SELECT digest_enabled AS "digestEnabled",preferred_origin_alert AS "preferredOriginAlert",ntfy_topic AS "ntfyTopic" FROM notification_preference WHERE user_id=$1',
      [req.user.id],
    ),
  ]);
  const payload = {
    format: "favlib-account-export-v1",
    exportedAt: new Date().toISOString(),
    user: user.rows[0],
    bookmarks: bookmarks.rows,
    links: links.rows,
    progress: progress.rows,
    preferences: preferences.rows[0] ?? null,
  };
  const saved = await pool.query(
    'INSERT INTO account_export(user_id,status,payload) VALUES($1,\'READY\',$2) RETURNING id,created_at AS "createdAt",purge_after AS "purgeAfter"',
    [req.user.id, JSON.stringify(payload)],
  );
  const response = {
    exportId: saved.rows[0].id,
    status: "READY",
    createdAt: saved.rows[0].createdAt,
    purgeAfter: saved.rows[0].purgeAfter,
  };
  await pool.query(
    "INSERT INTO idempotency_key(owner_id,route,key,body_hash,response_code,response_body) VALUES($1,$2,$3,$4,$5,$6)",
    [
      req.user.id,
      "account-export",
      key,
      digest(JSON.stringify(req.body ?? {})),
      202,
      JSON.stringify(response),
    ],
  );
  return reply.code(202).send(response);
});
app.get("/api/v1/account-exports/:id", async (req: any, reply: any) => {
  const r = await pool.query(
    'SELECT id,status,payload,created_at AS "createdAt",purge_after AS "purgeAfter" FROM account_export WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id],
  );
  if (!r.rowCount) return err(reply, 404, "EXPORT_NOT_FOUND");
  return r.rows[0];
});
app.delete("/api/v1/account-exports/:id", async (req: any, reply: any) => {
  const r = await pool.query(
    "UPDATE account_export SET status='PURGED',payload='{}'::jsonb WHERE id=$1 AND user_id=$2 RETURNING id",
    [req.params.id, req.user.id],
  );
  if (!r.rowCount) return err(reply, 404, "EXPORT_NOT_FOUND");
  return { ok: true, purged: true };
});
app.get("/api/v1/notification-preferences", async (req: any) => {
  const r = await pool.query(
    'SELECT digest_enabled AS "digestEnabled",preferred_origin_alert AS "preferredOriginAlert",ntfy_topic AS "ntfyTopic" FROM notification_preference WHERE user_id=$1',
    [req.user.id],
  );
  return (
    r.rows[0] ?? {
      digestEnabled: false,
      preferredOriginAlert: false,
      ntfyTopic: null,
    }
  );
});
app.patch("/api/v1/notification-preferences", async (req: any, reply: any) => {
  const p = z
    .object({
      digestEnabled: z.boolean().optional(),
      preferredOriginAlert: z.boolean().optional(),
      ntfyTopic: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,64}$/)
        .nullable()
        .optional(),
    })
    .safeParse(req.body);
  if (!p.success) return err(reply, 400, "VALIDATION_FAILED");
  const current = await pool.query(
    'SELECT digest_enabled AS "digestEnabled",preferred_origin_alert AS "preferredOriginAlert",ntfy_topic AS "ntfyTopic" FROM notification_preference WHERE user_id=$1',
    [req.user.id],
  );
  const next = {
    ...{ digestEnabled: false, preferredOriginAlert: false, ntfyTopic: null },
    ...(current.rows[0] ?? {}),
    ...p.data,
  };
  const r = await pool.query(
    'INSERT INTO notification_preference(user_id,digest_enabled,preferred_origin_alert,ntfy_topic) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET digest_enabled=excluded.digest_enabled,preferred_origin_alert=excluded.preferred_origin_alert,ntfy_topic=excluded.ntfy_topic,updated_at=now() RETURNING digest_enabled AS "digestEnabled",preferred_origin_alert AS "preferredOriginAlert",ntfy_topic AS "ntfyTopic"',
    [
      req.user.id,
      next.digestEnabled,
      next.preferredOriginAlert,
      next.ntfyTopic,
    ],
  );
  return r.rows[0];
});
app.get("/api/v1/admin/settings", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const stored = await pool.query(
    'SELECT key,value,updated_by AS "updatedBy",updated_at AS "updatedAt" FROM operational_setting ORDER BY key',
  );
  const overrides = Object.fromEntries(
    stored.rows.map((row) => [row.key, row.value]),
  );
  return {
    values: { ...OPERATIONAL_DEFAULTS, ...overrides },
    defaults: OPERATIONAL_DEFAULTS,
    overrides: stored.rows,
  };
});
app.patch("/api/v1/admin/settings", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const parsed = operationalSettingsPatchSchema.safeParse(req.body);
  if (!parsed.success)
    return err(
      reply,
      422,
      "SETTING_OUT_OF_BOUNDS",
      "Réglage inconnu ou hors bornes.",
      parsed.error.issues,
    );
  const current = await pool.query("SELECT key,value FROM operational_setting");
  const merged = {
    ...OPERATIONAL_DEFAULTS,
    ...Object.fromEntries(current.rows.map((row) => [row.key, row.value])),
    ...parsed.data,
  };
  if (
    merged["backoff.providerBaseSeconds"] > merged["backoff.providerMaxSeconds"]
  )
    return err(
      reply,
      422,
      "SETTING_RELATION_INVALID",
      "Le backoff de base doit être inférieur au maximum.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of Object.entries(parsed.data))
      await client.query(
        "INSERT INTO operational_setting(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()",
        [key, JSON.stringify(value), req.user.id],
      );
    await client.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,summary,request_id) VALUES($1,'settings.update','operational_settings',$2,$3)",
      [req.user.id, parsed.data, req.requestId],
    );
    await client.query("COMMIT");
    return { values: merged, updated: Object.keys(parsed.data) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post(
  "/api/v1/admin/users/:id/password-reset",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const exists = await pool.query("SELECT id FROM app_user WHERE id=$1", [
      req.params.id,
    ]);
    if (!exists.rowCount) return err(reply, 404, "USER_NOT_FOUND");
    const raw = newOpaqueSecret(32);
    const created = await pool.query(
      "INSERT INTO password_reset_token(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING id,expires_at AS \"expiresAt\"",
      [req.params.id, digest(raw)],
    );
    await pool.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,request_id) VALUES($1,'password_reset.issue','user',$2,$3)",
      [req.user.id, req.params.id, req.requestId],
    );
    return reply
      .code(201)
      .send({
        resetId: created.rows[0].id,
        token: raw,
        expiresAt: created.rows[0].expiresAt,
      });
  },
);
app.get("/api/v1/admin/security/sessions", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(
    `SELECT s.id,s.user_id AS "userId",u.email,s.last_seen_at AS "lastSeenAt",s.expires_at AS "expiresAt",s.revoked_at AS "revokedAt" FROM user_session s JOIN app_user u ON u.id=s.user_id ORDER BY s.last_seen_at DESC LIMIT $1`,
    [SECURITY_LIMITS.adminPageSizeMax],
  );
  return { items: result.rows };
});
app.delete(
  "/api/v1/admin/security/sessions/:id",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const result = await pool.query(
      "UPDATE user_session SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id,user_id",
      [req.params.id],
    );
    if (!result.rowCount) return err(reply, 404, "SESSION_NOT_FOUND");
    await pool.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,request_id) VALUES($1,'session.revoke','session',$2,$3)",
      [req.user.id, req.params.id, req.requestId],
    );
    return { ok: true, revoked: true };
  },
);
app.get("/api/v1/admin/security/events", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const [security, audit] = await Promise.all([
    pool.query(
      'SELECT id,actor_user_id AS "actorUserId",event AS action,target_id AS "targetId",result,request_id AS "requestId",created_at AS "createdAt" FROM security_event ORDER BY created_at DESC LIMIT $1',
      [SECURITY_LIMITS.adminPageSizeMax],
    ),
    pool.query(
      'SELECT id,actor_user_id AS "actorUserId",action,target_type AS "targetType",target_id AS "targetId",summary,request_id AS "requestId",created_at AS "createdAt" FROM admin_audit_event ORDER BY created_at DESC LIMIT $1',
      [SECURITY_LIMITS.adminPageSizeMax],
    ),
  ]);
  return {
    items: [...security.rows, ...audit.rows]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, SECURITY_LIMITS.adminPageSizeMax),
    redacted: true,
  };
});
app.get("/api/v1/admin/backups", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(
    `SELECT id,status,CASE WHEN status='READY' AND checksum IS NOT NULL AND verified_at IS NOT NULL AND restore_tested_at IS NOT NULL THEN 'HEALTHY' ELSE 'NOT_VERIFIED' END AS health,manifest_name AS "manifestName",checksum,byte_size AS "byteSize",requested_at AS "requestedAt",completed_at AS "completedAt",verified_at AS "verifiedAt",restore_tested_at AS "restoreTestedAt",COALESCE(rpo_seconds::text,'NOT_VERIFIED') AS rpo,COALESCE(rto_seconds::text,'NOT_VERIFIED') AS rto,error_code AS "errorCode" FROM backup_run ORDER BY requested_at DESC LIMIT $1`,
    [SECURITY_LIMITS.adminPageSizeMax],
  );
  return { items: result.rows, destination: "SERVER_MANAGED" };
});
app.post("/api/v1/admin/backups", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      "INSERT INTO backup_run(status,requested_by) VALUES('REQUESTED',$1) RETURNING id,status,requested_at AS \"requestedAt\"",
      [req.user.id],
    );
    await client.query("SELECT graphile_worker.add_job('backup',$1)", [
      JSON.stringify({ backupId: created.rows[0].id, action: "create" }),
    ]);
    await client.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,request_id) VALUES($1,'backup.request','backup',$2,$3)",
      [req.user.id, created.rows[0].id, req.requestId],
    );
    await client.query("COMMIT");
    return reply
      .code(202)
      .send({ ...created.rows[0], verification: "NOT_VERIFIED" });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post("/api/v1/admin/backups/:id/verify", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const backup = await client.query(
      "SELECT id FROM backup_run WHERE id=$1 AND status='READY' FOR UPDATE",
      [req.params.id],
    );
    if (!backup.rowCount) {
      await client.query("ROLLBACK");
      return err(reply, 409, "BACKUP_NOT_READY");
    }
    await client.query("SELECT graphile_worker.add_job('backup',$1)", [
      JSON.stringify({ backupId: req.params.id, action: "verify" }),
    ]);
    await client.query("COMMIT");
    return reply.code(202).send({ ok: true, status: "VERIFY_REQUESTED" });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post(
  "/api/v1/admin/backups/:id/restore-test",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const backup = await client.query(
        "SELECT id FROM backup_run WHERE id=$1 AND status='READY' FOR UPDATE",
        [req.params.id],
      );
      if (!backup.rowCount) {
        await client.query("ROLLBACK");
        return err(reply, 409, "BACKUP_NOT_READY");
      }
      await client.query("SELECT graphile_worker.add_job('backup',$1)", [
        JSON.stringify({ backupId: req.params.id, action: "restore-test" }),
      ]);
      await client.query("COMMIT");
      return reply
        .code(202)
        .send({ ok: true, status: "RESTORE_TEST_REQUESTED" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);
app.post("/api/v1/admin/extension-releases", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const parsed = z
    .object({
      version: z.string(),
      protocol: z.number().int(),
      releases: z.array(extensionReleaseContract).length(2),
    })
    .superRefine((value, ctx) => {
      if (
        value.releases.some(
          (release) =>
            release.version !== value.version ||
            release.protocol !== value.protocol,
        )
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Release versions/protocols diverge",
        });
      if (new Set(value.releases.map((release) => release.browser)).size !== 2)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Both browsers are required",
        });
    })
    .safeParse(req.body);
  if (!parsed.success)
    return err(
      reply,
      422,
      "EXTENSION_RELEASE_DIVERGED",
      "Artefacts, version ou protocole divergents.",
      parsed.error.issues,
    );
  if (parsed.data.protocol !== EXTENSION_PROTOCOL)
    return err(reply, 422, "EXTENSION_PROTOCOL_DIVERGED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const release of parsed.data.releases)
      await client.query(
        "INSERT INTO extension_release(browser,version,protocol,checksum_sha256,artifact_url,update_manifest_url,installation_mode,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(browser) DO UPDATE SET version=excluded.version,protocol=excluded.protocol,checksum_sha256=excluded.checksum_sha256,artifact_url=excluded.artifact_url,update_manifest_url=excluded.update_manifest_url,installation_mode=excluded.installation_mode,published_at=excluded.published_at",
        [
          release.browser,
          release.version,
          release.protocol,
          release.checksumSha256,
          release.artifactUrl,
          release.updateManifestUrl,
          release.installationMode,
          release.publishedAt,
        ],
      );
    await client.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,summary,request_id) VALUES($1,'extension.release.publish','extension_release',$2,$3)",
      [
        req.user.id,
        {
          version: parsed.data.version,
          protocol: parsed.data.protocol,
          browsers: parsed.data.releases.map((item) => item.browser),
        },
        req.requestId,
      ],
    );
    await client.query("COMMIT");
    return reply.code(201).send({ ok: true, version: parsed.data.version });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.get("/api/v1/admin/domain-proposals", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(
    'SELECT id,domain,state,proposed_by AS "proposedBy",reviewed_by AS "reviewedBy",created_at AS "createdAt",reviewed_at AS "reviewedAt" FROM domain_proposal ORDER BY created_at DESC',
  );
  return { items: result.rows };
});
app.patch(
  "/api/v1/admin/domain-proposals/:id",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const parsed = z
      .object({ state: z.enum(["APPROVED", "REJECTED"]) })
      .safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
    const result = await pool.query(
      "UPDATE domain_proposal SET state=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3 AND state='PROPOSED' RETURNING id,domain,state",
      [parsed.data.state, req.user.id, req.params.id],
    );
    if (!result.rowCount) return err(reply, 404, "DOMAIN_PROPOSAL_NOT_FOUND");
    await pool.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'domain.review','domain_proposal',$2,$3,$4)",
      [req.user.id, req.params.id, parsed.data, req.requestId],
    );
    return result.rows[0];
  },
);
const adminWarningSelect=`SELECT c.id,c.family,c.subject_key AS "subjectKey",c.evidence_revision AS "evidenceRevision",c.status,c.reason_counts AS "reasonCounts",c.report_count AS "reportCount",c.media_id AS "mediaId",
  (SELECT t.text FROM media_title t WHERE t.media_id=c.media_id AND t.kind<>'personal' ORDER BY CASE t.kind WHEN 'official' THEN 0 ELSE 1 END,t.id LIMIT 1) AS title,
  CASE WHEN c.family='SOURCE' THEN c.sanitized_evidence->>'sourceUrl' END AS "sourceUrl",c.sanitized_evidence AS evidence,c.verdict,c.decision_scope AS scope,c.created_at AS "createdAt",c.decided_at AS "decidedAt",c.reverted_at AS "revertedAt" FROM report_case c`;
app.get('/api/v1/admin/warnings',async(req:any,reply:any)=>{
  if(req.user.role!=='admin')return err(reply,403,'FORBIDDEN');
  const rows=await pool.query(`${adminWarningSelect} ORDER BY (c.status='PENDING') DESC,c.created_at`);
  return {items:rows.rows,pendingCount:rows.rows.filter((row:any)=>row.status==='PENDING').length};
});
app.get('/api/v1/admin/warnings/:id',async(req:any,reply:any)=>{
  if(req.user.role!=='admin')return err(reply,403,'FORBIDDEN');
  const row=await pool.query(`${adminWarningSelect} WHERE c.id=$1`,[req.params.id]);if(!row.rowCount)return err(reply,404,'WARNING_NOT_FOUND');
  const alternatives=row.rows[0].family==='IDENTITY'?(await pool.query(`SELECT DISTINCT p.id,p.provider,p.provider_id AS "providerId",p.canonical_title AS "title",p.type,p.year,p.url FROM provider_profile p WHERE EXISTS(SELECT 1 FROM review_cluster_candidate candidate JOIN favorite_review review ON review.cluster_id=candidate.cluster_id JOIN bookmark_media_link link ON link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id WHERE candidate.profile_id=p.id AND link.media_id=$1) ORDER BY p.provider,p.canonical_title LIMIT 20`,[row.rows[0].mediaId])).rows:[];
  const history=(await pool.query(`SELECT action,before_state AS "beforeState",after_state AS "afterState",created_at AS "createdAt" FROM report_case_audit_event WHERE case_id=$1 ORDER BY created_at`,[req.params.id])).rows;
  return {...row.rows[0],alternatives,history};
});
app.get('/api/v1/admin/warnings/:id/preview',async(req:any,reply:any)=>{
  if(req.user.role!=='admin')return err(reply,403,'FORBIDDEN');
  const parsed=z.object({scope:z.enum(['SUBJECT','FAVORITE','CLUSTER','ASSOCIATION'])}).safeParse(req.query);if(!parsed.success)return err(reply,400,'VALIDATION_FAILED');
  const row=await pool.query('SELECT family,media_id AS "mediaId",evidence_revision AS "evidenceRevision" FROM report_case WHERE id=$1 AND status=\'PENDING\'',[req.params.id]);if(!row.rowCount)return err(reply,404,'WARNING_NOT_PENDING');
  let affected=1;
  if(parsed.data.scope==='CLUSTER'){const count=await pool.query(`SELECT count(DISTINCT link.id)::int AS count FROM favorite_review seed JOIN favorite_review review ON review.cluster_id=seed.cluster_id JOIN bookmark_media_link link ON link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id WHERE seed.id=(SELECT review.id FROM report_submission submission JOIN report_case c ON c.id=submission.case_id JOIN favorite_review review ON review.user_id=submission.user_id JOIN bookmark_media_link l ON l.user_id=review.user_id AND l.installation_id=review.installation_id AND l.bookmark_id=review.bookmark_id AND l.media_id=c.media_id WHERE c.id=$1 ORDER BY submission.created_at,review.created_at LIMIT 1) AND link.status IN ('matched','accepted')`,[req.params.id]);affected=Number(count.rows[0]?.count??0)}
  return {caseId:req.params.id,family:row.rows[0].family,scope:parsed.data.scope,affectedActiveFavorites:affected,evidenceRevision:row.rows[0].evidenceRevision};
});
app.post('/api/v1/admin/warnings/:id/decide',async(req:any,reply:any)=>{
  if(req.user.role!=='admin')return err(reply,403,'FORBIDDEN');
  const parsed=adminReportDecisionContract.safeParse(req.body);if(!parsed.success)return err(reply,400,'VALIDATION_FAILED','Décision invalide.',parsed.error.issues);
  const client=await pool.connect();try{await client.query('BEGIN');const found=await client.query('SELECT * FROM report_case WHERE id=$1 FOR UPDATE',[req.params.id]);if(!found.rowCount||found.rows[0].status!=='PENDING'){await client.query('ROLLBACK');return err(reply,409,'WARNING_NOT_PENDING')}const warning=found.rows[0];if(warning.evidence_revision!==parsed.data.expectedEvidenceRevision){await client.query('ROLLBACK');return err(reply,409,'EVIDENCE_REVISION_CHANGED')}
    if(warning.family==='SOURCE'){
      if(parsed.data.scope!=='ASSOCIATION'||!['KEEP','BLOCK'].includes(parsed.data.verdict)){await client.query('ROLLBACK');return err(reply,400,'SOURCE_DECISION_INVALID')}
      const privateScope=warning.sanitized_evidence?.accessMode==='extension_private';const owner=privateScope?(await client.query('SELECT user_id FROM report_submission WHERE case_id=$1 ORDER BY created_at LIMIT 1',[warning.id])).rows[0]?.user_id:null;
      await client.query(`INSERT INTO source_association_decision(case_id,media_id,canonical_url,user_id,verdict,evidence_revision) VALUES($1,$2,$3,$4,$5,$6)`,[warning.id,warning.media_id,warning.sanitized_evidence.sourceUrl,owner,parsed.data.verdict,warning.evidence_revision]);
    }else if(parsed.data.verdict==='CORRECT'){
      if(!['FAVORITE','CLUSTER'].includes(parsed.data.scope)){await client.query('ROLLBACK');return err(reply,400,'IDENTITY_SCOPE_INVALID')}
      let profile:any=null;if(parsed.data.providerProfileId)profile=(await client.query('SELECT * FROM provider_profile WHERE id=$1',[parsed.data.providerProfileId])).rows[0];
      const provider=profile?.provider??parsed.data.provider;const rawProviderId=profile?.provider_id??parsed.data.providerId??(provider&&parsed.data.providerUrl?providerIdFromUrl(provider,parsed.data.providerUrl):null);
      if(!provider||!rawProviderId){await client.query('ROLLBACK');return err(reply,400,'PROVIDER_PROFILE_REQUIRED')}
      const providerId=String(rawProviderId);let newMedia=(await client.query('SELECT media_id FROM media_external_id WHERE provider=$1 AND external_id=$2 ORDER BY id LIMIT 1',[provider,providerId])).rows[0]?.media_id;
      if(!newMedia){newMedia=`${provider}:${providerId}`;const current=await client.query('SELECT type FROM media WHERE id=$1',[warning.media_id]);await client.query('INSERT INTO media(id,type) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[newMedia,provider==='anilist'?'ANIME':current.rows[0]?.type??'MANGA']);await client.query('INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[newMedia,provider,providerId,{source:'admin-adjudication',caseId:warning.id,requestId:req.requestId}]);if(profile?.canonical_title)await client.query("INSERT INTO media_title(media_id,text,normalized_text,kind,title_type,connector,confidence,provenance) VALUES($1,$2,lower(regexp_replace($2,'[^[:alnum:]]+',' ','g')),'official','canonical',$3,1,$4) ON CONFLICT DO NOTHING",[newMedia,profile.canonical_title,provider,{source:'admin-adjudication',caseId:warning.id}]);await client.query("SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3,job_key_mode := 'replace')",[provider==='anilist'?'anilist-enrichment':'mangaupdates-enrichment',JSON.stringify({mediaId:newMedia,forceRefresh:true,providerId}),`admin-adjudication:${provider}:${providerId}`])}
      const representative=await client.query(`SELECT link.id,link.media_id,review.id AS review_id,review.cluster_id FROM report_submission submission JOIN report_case c ON c.id=submission.case_id JOIN bookmark_media_link link ON link.user_id=submission.user_id AND link.media_id=c.media_id AND link.status IN ('matched','accepted') LEFT JOIN favorite_review review ON review.user_id=link.user_id AND review.installation_id=link.installation_id AND review.bookmark_id=link.bookmark_id WHERE c.id=$1 ORDER BY submission.created_at,link.created_at LIMIT 1`,[warning.id]);if(!representative.rowCount){await client.query('ROLLBACK');return err(reply,409,'ACTIVE_FAVORITE_REQUIRED')}const target=representative.rows[0];if(parsed.data.scope==='CLUSTER'&&!target.cluster_id){await client.query('ROLLBACK');return err(reply,409,'CLUSTER_NOT_AVAILABLE')}
      await client.query("SELECT set_config('favlib.resolved_review_repair','on',true)");const updated=parsed.data.scope==='FAVORITE'?await client.query("UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=evidence||$2::jsonb WHERE id=$3 RETURNING id",[newMedia,JSON.stringify({adminOverrideCaseId:warning.id,previousMediaId:warning.media_id}),target.id]):await client.query(`UPDATE bookmark_media_link link SET media_id=$1,status='matched',evidence=evidence||$2::jsonb FROM favorite_review review WHERE review.cluster_id=$3 AND link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id AND link.status IN ('matched','accepted') RETURNING link.id`,[newMedia,JSON.stringify({adminOverrideCaseId:warning.id,previousMediaId:warning.media_id}),target.cluster_id]);
      await client.query(`INSERT INTO admin_identity_override(case_id,scope,bookmark_link_id,review_id,cluster_id,old_media_id,new_media_id,chosen_profile_id,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[warning.id,parsed.data.scope,target.id,target.review_id,target.cluster_id,warning.media_id,newMedia,profile?.id??null,{source:'admin-adjudication',affectedActiveFavorites:updated.rowCount,requestId:req.requestId}]);
    }else if(parsed.data.verdict!=='KEEP'){await client.query('ROLLBACK');return err(reply,400,'IDENTITY_DECISION_INVALID')}
    const before={status:warning.status,verdict:warning.verdict,scope:warning.decision_scope};const updated=await client.query(`UPDATE report_case SET status='FINAL',verdict=$2,decision_scope=$3,chosen_profile_id=$4,chosen_provider=$5,chosen_provider_id=$6,actor_user_id=$7,request_id=$8,decided_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,[warning.id,parsed.data.verdict,parsed.data.scope,parsed.data.providerProfileId??null,parsed.data.provider??null,parsed.data.providerId??null,req.user.id,req.requestId]);await client.query('INSERT INTO report_case_audit_event(case_id,actor_user_id,action,before_state,after_state,request_id) VALUES($1,$2,\'DECIDE\',$3,$4,$5)',[warning.id,req.user.id,before,{status:'FINAL',verdict:parsed.data.verdict,scope:parsed.data.scope},req.requestId]);await client.query("INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES($1,'warning.decide','report_case',$2,$3,$4)",[req.user.id,warning.id,{verdict:parsed.data.verdict,scope:parsed.data.scope,evidenceRevision:warning.evidence_revision},req.requestId]);await client.query('COMMIT');return {ok:true,id:updated.rows[0].id,status:'FINAL'}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
});
app.post('/api/v1/admin/warnings/:id/revert',async(req:any,reply:any)=>{
  if(req.user.role!=='admin')return err(reply,403,'FORBIDDEN');const parsed=z.object({confirm:z.literal(true)}).strict().safeParse(req.body);if(!parsed.success)return err(reply,400,'CONFIRMATION_REQUIRED');const client=await pool.connect();try{await client.query('BEGIN');const found=await client.query("SELECT * FROM report_case WHERE id=$1 AND status='FINAL' FOR UPDATE",[req.params.id]);if(!found.rowCount){await client.query('ROLLBACK');return err(reply,409,'WARNING_NOT_FINAL')}const warning=found.rows[0];if(warning.family==='SOURCE')await client.query('UPDATE source_association_decision SET active=false,reverted_at=now() WHERE case_id=$1 AND active',[warning.id]);else{const override=(await client.query('SELECT * FROM admin_identity_override WHERE case_id=$1 AND active FOR UPDATE',[warning.id])).rows[0];if(override){await client.query("SELECT set_config('favlib.resolved_review_repair','on',true)");if(override.scope==='FAVORITE')await client.query('UPDATE bookmark_media_link SET media_id=$1,evidence=evidence||$2::jsonb WHERE id=$3',[override.old_media_id,JSON.stringify({adminOverrideRevertedCaseId:warning.id}),override.bookmark_link_id]);else await client.query('UPDATE bookmark_media_link link SET media_id=$1,evidence=evidence||$2::jsonb FROM favorite_review review WHERE review.cluster_id=$3 AND link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id',[override.old_media_id,JSON.stringify({adminOverrideRevertedCaseId:warning.id}),override.cluster_id]);await client.query('UPDATE admin_identity_override SET active=false,reverted_at=now() WHERE id=$1',[override.id])}}
    await client.query("UPDATE report_case SET status='REVERTED',reverted_at=now(),updated_at=now() WHERE id=$1",[warning.id]);await client.query("INSERT INTO report_case_audit_event(case_id,actor_user_id,action,before_state,after_state,request_id) VALUES($1,$2,'REVERT',$3,$4,$5)",[warning.id,req.user.id,{status:'FINAL',verdict:warning.verdict},{status:'REVERTED'},req.requestId]);await client.query('COMMIT');return {ok:true,status:'REVERTED'}
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
});

app.get("/api/v1/admin/metrics", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const workerSchema = await pool.query(
    "SELECT to_regclass('graphile_worker.jobs') AS jobs",
  );
  const jobQuery = workerSchema.rows[0].jobs
    ? pool.query("SELECT count(*)::int AS count FROM graphile_worker.jobs")
    : Promise.resolve({ rows: [{ count: 0 }] });
  const [users, devices, jobs, stale, notifications,warnings] = await Promise.all([
    pool.query("SELECT count(*)::int AS count FROM app_user"),
    pool.query(
      "SELECT count(*)::int AS count FROM extension_device WHERE revoked_at IS NULL",
    ),
    jobQuery,
    pool.query(
      "SELECT count(*)::int AS count FROM source_snapshot WHERE status IN ('QUARANTINED','ERROR')",
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM personal_notification WHERE read_at IS NULL",
    ),
    pool.query("SELECT count(*)::int AS count FROM report_case WHERE status='PENDING'"),
  ]);
  return {
    users: users.rows[0].count,
    activeDevices: devices.rows[0].count,
    pendingJobs: jobs.rows[0].count,
    staleSnapshots: stale.rows[0].count,
    unreadNotifications: notifications.rows[0].count,
    pendingWarnings:warnings.rows[0].count,
  };
});
app.get("/api/v1/admin/diagnostics", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const workerSchema = await pool.query(
    "SELECT to_regclass('graphile_worker.jobs') AS jobs",
  );
  const jobQuery = workerSchema.rows[0].jobs
    ? pool.query(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE last_error IS NOT NULL)::int AS failed,count(*) FILTER(WHERE locked_at IS NOT NULL)::int AS running FROM graphile_worker.jobs",
      )
    : Promise.resolve({
        rows: [{ total: 0, failed: 0, running: 0, schemaMissing: true }],
      });
  const [
    database,
    heartbeat,
    policies,
    inventory,
    covers,
    jobs,
    duplicates,
    orphans,
    isolation,
    enrichment,
    circuits,
    coverQueue,
  ] = await Promise.all([
    pool.query("SELECT current_database() AS database,now() AS now"),
    pool.query(
      "SELECT observed_at AS \"observedAt\",observed_at>now()-interval '5 minutes' AS fresh,build_version AS \"buildVersion\",details FROM service_heartbeat WHERE service='worker'",
    ),
    pool.query(
      'SELECT p.provider,p.status,p.version,p.license,p.attribution,p.reviewed_at AS "reviewedAt",last.status AS "lastAttemptStatus",last.error AS "lastAttemptError",last.created_at AS "lastAttemptAt" FROM catalog_provider_policy p LEFT JOIN LATERAL (SELECT a.status,a.error,a.created_at FROM metadata_attempt a WHERE a.provider=p.provider ORDER BY a.created_at DESC LIMIT 1) last ON true WHERE p.provider IN (\'anilist\',\'mangaupdates\',\'mangadex\') ORDER BY p.provider',
    ),
    pool.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE fingerprint !~ '^[0-9a-f]{64}$')::int AS \"invalidFingerprints\",count(*) FILTER(WHERE classification_status NOT IN ('recognized','review','excluded'))::int AS \"invalidClassifications\",count(*) FILTER(WHERE classification_status='review')::int AS \"pendingClassification\" FROM bookmark_import_item WHERE event<>'removed'",
    ),
    pool.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='ACTIVE')::int AS \"active\",count(*) FILTER(WHERE status<>'ACTIVE')::int AS \"failedOrMissing\",count(*) FILTER(WHERE mime_type<>'image/webp' OR byte_size>512000 OR width IS NULL OR height IS NULL)::int AS \"compressionIssues\",count(*) FILTER(WHERE source_url IS NULL OR provider IN ('','legacy') OR (data IS NULL AND (asset_sha256 IS NULL OR NOT EXISTS(SELECT 1 FROM catalog_image_asset a WHERE a.sha256=media_cover.asset_sha256))) OR (data IS NOT NULL AND data !~ '^[A-Za-z0-9+/]*={0,2}$'))::int AS \"integrityIssues\",(SELECT count(*) FROM catalog_image_asset a WHERE NOT EXISTS(SELECT 1 FROM media_cover c WHERE c.asset_sha256=a.sha256) AND NOT EXISTS(SELECT 1 FROM media_banner b WHERE b.asset_sha256=a.sha256))::int AS \"orphanAssets\",COALESCE(sum(byte_size),0)::bigint AS \"localBytes\" FROM media_cover",
    ),
    jobQuery,
    pool.query(
      "SELECT count(*)::int AS count FROM (SELECT user_id,installation_id,fingerprint FROM bookmark_import_item WHERE event<>'removed' GROUP BY user_id,installation_id,fingerprint HAVING count(*)>1) d",
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM media m WHERE NOT EXISTS(SELECT 1 FROM bookmark_media_link l WHERE l.media_id=m.id AND l.status IN ('matched','accepted'))",
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM bookmark_media_link l WHERE NOT EXISTS(SELECT 1 FROM bookmark_import_item i WHERE i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id)",
    ),
    pool.query(
      "SELECT status,count(*)::int AS count FROM media_enrichment_state GROUP BY status ORDER BY status",
    ),
    pool.query(
      "SELECT count(*)::int AS open FROM provider_domain_circuit WHERE status='OPEN' AND blocked_until>now()",
    ),
    pool.query(`SELECT
      count(*) FILTER(WHERE c.status='ACTIVE')::int AS active,
      count(*) FILTER(WHERE c.media_id IS NULL)::int AS missing,
      count(*) FILTER(WHERE c.media_id IS NULL AND es.status='PENDING')::int AS pending,
      count(*) FILTER(WHERE c.media_id IS NULL AND es.status IN ('FAILED','NO_MATCH') AND es.next_attempt_at>now())::int AS retry,
      count(*) FILTER(WHERE c.media_id IS NULL AND es.status='TERMINAL')::int AS terminal,
      count(*) FILTER(WHERE c.media_id IS NULL AND mm.media_id IS NULL)::int AS "blockedByMissingIdentity"
      FROM media m
      JOIN (SELECT DISTINCT media_id FROM bookmark_media_link WHERE status IN ('matched','accepted','review')) l ON l.media_id=m.id
      LEFT JOIN media_cover c ON c.media_id=m.id AND c.status='ACTIVE'
      LEFT JOIN media_metadata mm ON mm.media_id=m.id AND mm.status='ACTIVE' AND mm.external_id IS NOT NULL
      LEFT JOIN LATERAL (SELECT status,next_attempt_at FROM media_enrichment_state s WHERE s.media_id=m.id AND s.purpose='cover' ORDER BY s.updated_at DESC LIMIT 1) es ON true
      WHERE m.type IN ('ANIME','MANGA','MANHWA','MANHUA')`),
  ]);
  const inv = inventory.rows[0],
    cover = covers.rows[0],
    queue = jobs.rows[0];
  const worker = heartbeat.rows[0];
  const checks = [
    {
      id: "api",
      label: "API FavLib",
      status: "ok",
      details: { requestId: req.requestId },
    },
    {
      id: "postgres",
      label: "PostgreSQL",
      status: "ok",
      details: database.rows[0],
    },
    {
      id: "worker",
      label: "Worker",
      status: worker?.fresh ? "ok" : "error",
      details: worker ?? { message: "Aucun heartbeat récent" },
    },
    {
      id: "providers",
      label: "Connectivité et politique fournisseurs",
      status:
        policies.rows.length === 3 &&
        policies.rows.every((row) => row.status === "AUTHORIZED")
          ? "ok"
          : "warning",
      details: {
        mode: "policy-only-no-network-probe",
        providers: policies.rows,
      },
    },
    {
      id: "inventory",
      label: "Inventaire, empreintes et classifications",
      status:
        inv.invalidFingerprints || inv.invalidClassifications
          ? "error"
          : inv.pendingClassification
            ? "warning"
            : "ok",
      details: inv,
    },
    {
      id: "covers",
      label: "Couvertures locales, intégrité et provenance",
      status: cover.integrityIssues
        ? "error"
        : cover.compressionIssues
          ? "warning"
          : "ok",
      details: { ...cover, queue: coverQueue.rows[0] },
    },
    {
      id: "jobs",
      label: "Tâches échouées",
      status: queue.schemaMissing ? "error" : queue.failed ? "error" : "ok",
      details: queue,
    },
    {
      id: "duplicates",
      label: "Doublons",
      status: duplicates.rows[0].count ? "warning" : "ok",
      details: duplicates.rows[0],
    },
    {
      id: "orphans",
      label: "Œuvres orphelines",
      status: orphans.rows[0].count ? "warning" : "ok",
      details: orphans.rows[0],
    },
    {
      id: "isolation",
      label: "Isolation utilisateur",
      status: isolation.rows[0].count ? "error" : "ok",
      details: isolation.rows[0],
    },
    {
      id: "enrichment",
      label: "États globaux d’enrichissement",
      status: enrichment.rows.some((row) => row.status === "TERMINAL")
        ? "warning"
        : "ok",
      details: { states: enrichment.rows },
    },
    {
      id: "circuits",
      label: "Circuit breakers domaines",
      status: circuits.rows[0].open ? "warning" : "ok",
      details: circuits.rows[0],
    },
  ];
  return {
    format: "favlib-admin-diagnostics-v1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    checks,
  };
});
app.get("/api/v1/admin/actions/preview", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const parsed = z
    .object({
      action: z.enum([
        "metadata-retry",
        "anilist-cover-backfill",
        "cover-recompress",
        "purge-expired",
      ]),
      scope: z.enum(["user", "global"]),
      userId: z.string().uuid().optional(),
    })
    .safeParse(req.query);
  if (!parsed.success || (parsed.data.scope === "user" && !parsed.data.userId))
    return err(reply, 400, "MAINTENANCE_SCOPE_REQUIRED");
  const batch = await operationalValue("admin.actionBatchSize");
  if (parsed.data.action === "metadata-retry") {
    const result = await pool.query(
      `SELECT count(DISTINCT (l.user_id,l.media_id))::int AS count FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id LEFT JOIN media_metadata mm ON mm.media_id=l.media_id WHERE l.status IN ('matched','accepted','review') AND l.media_id IS NOT NULL AND i.event<>'removed' AND (mm.media_id IS NULL OR mm.status IN ('FAILED','FALLBACK','STALE')) AND ($1='global' OR l.user_id=$2)`,
      [parsed.data.scope, parsed.data.userId ?? null],
    );
    return {
      readOnly: true,
      action: parsed.data.action,
      scope: parsed.data.scope,
      count: Math.min(result.rows[0].count, batch),
      total: result.rows[0].count,
      batchLimit: batch,
    };
  }
  if (parsed.data.action === "anilist-cover-backfill") {
    const [result, states, candidates] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS count FROM media m WHERE m.type='ANIME' AND EXISTS(SELECT 1 FROM bookmark_media_link l WHERE l.media_id=m.id AND l.status IN ('matched','accepted')) AND NOT EXISTS(SELECT 1 FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM media_enrichment_state s WHERE s.media_id=m.id AND s.provider='anilist' AND s.connector_version='${CONNECTOR_VERSIONS.anilistMetadata}' AND (s.status='TERMINAL' OR s.status IN ('NO_MATCH','FAILED') AND s.next_attempt_at>now()))`,
      ),
      pool.query(
        `SELECT count(*) FILTER(WHERE status IN ('FAILED','NO_MATCH') AND next_attempt_at>now())::int AS deferred,count(*) FILTER(WHERE status='TERMINAL')::int AS terminal,count(*) FILTER(WHERE resolution_code='FORCED_FIRST_RESULT')::int AS forced FROM media_enrichment_state WHERE provider='anilist' AND connector_version='${CONNECTOR_VERSIONS.anilistMetadata}'`,
      ),
      pool.query(
        `SELECT media_id AS "mediaId",candidate_snapshot AS candidates,status,resolution_code AS resolution FROM media_enrichment_state WHERE provider='anilist' AND connector_version='${CONNECTOR_VERSIONS.anilistMetadata}' AND candidate_snapshot IS NOT NULL ORDER BY updated_at DESC LIMIT $1`,
        [batch],
      ),
    ]);
    const count = Math.min(result.rows[0].count, batch);
    return {
      readOnly: true,
      networkAccess: false,
      sourceDomainsQueried: false,
      action: parsed.data.action,
      scope: "global",
      count,
      total: result.rows[0].count,
      batchLimit: batch,
      states: states.rows[0],
      candidates: candidates.rows,
      estimatedCallCeiling: { perItem: 4, total: count * 4 },
    };
  }
  if (parsed.data.action === "cover-recompress") {
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM media_cover WHERE status='ACTIVE' AND (mime_type<>'image/webp' OR byte_size>512000 OR width IS NULL OR height IS NULL)",
    );
    return {
      readOnly: true,
      action: parsed.data.action,
      scope: "global",
      count: Math.min(result.rows[0].count, batch),
      total: result.rows[0].count,
      batchLimit: batch,
    };
  }
  const result = await pool.query(
    "SELECT (SELECT count(*) FROM pairing_challenge WHERE expires_at<now())+(SELECT count(*) FROM password_reset_token WHERE expires_at<now())+(SELECT count(*) FROM metadata_attempt WHERE created_at<now()-interval '90 days') AS count",
  );
  return {
    readOnly: true,
    action: parsed.data.action,
    scope: "global",
    count: Number(result.rows[0].count),
    total: Number(result.rows[0].count),
    batchLimit: null,
  };
});
app.post(
  "/api/v1/admin/actions/metadata-retry",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const parsed = z
      .object({
        scope: z.enum(["user", "global"]),
        userId: z.string().uuid().optional(),
      })
      .safeParse(req.body);
    if (
      !parsed.success ||
      (parsed.data.scope === "user" && !parsed.data.userId)
    )
      return err(reply, 400, "MAINTENANCE_SCOPE_REQUIRED");
    const batch = await operationalValue("admin.actionBatchSize");
    const rows = await pool.query(
      `SELECT DISTINCT ON (l.user_id,l.media_id) l.user_id AS "userId",l.media_id AS "mediaId",m.type,COALESCE(i.payload->>'title','') AS title,i.payload->>'url' AS url FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id JOIN media m ON m.id=l.media_id LEFT JOIN media_metadata mm ON mm.media_id=l.media_id WHERE l.status IN ('matched','accepted','review') AND l.media_id IS NOT NULL AND i.event<>'removed' AND (mm.media_id IS NULL OR mm.status IN ('FAILED','FALLBACK','STALE')) AND i.payload->>'url' IS NOT NULL AND ($1='global' OR l.user_id=$2) ORDER BY l.user_id,l.media_id,i.created_at DESC LIMIT $3`,
      [parsed.data.scope, parsed.data.userId ?? null, batch],
    );
    for (const row of rows.rows) {
      const task=row.type==='ANIME'?'anilist-enrichment':['MANGA','MANHWA','MANHUA'].includes(row.type)?'mangaupdates-enrichment':null;
      if(!task)continue;
      await pool.query(
        "SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3,job_key_mode := 'replace')",
        [
          task,
          JSON.stringify({mediaId:row.mediaId,forceRefresh:true}),
          `metadata-retry:${task}:${row.mediaId}`,
        ],
      );
    }
    return reply.code(202).send({ ok: true, enqueued: rows.rowCount });
  },
);
app.post(
  "/api/v1/admin/actions/cover-recompress",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const parsed = z.object({ scope: z.literal("global") }).safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "MAINTENANCE_SCOPE_REQUIRED");
    const batch = await operationalValue("admin.actionBatchSize");
    const rows = await pool.query(
      "SELECT media_id AS \"mediaId\" FROM media_cover WHERE status='ACTIVE' AND (mime_type<>'image/webp' OR byte_size>512000 OR width IS NULL OR height IS NULL) LIMIT $1",
      [batch],
    );
    for (const row of rows.rows)
      await pool.query(
        "SELECT graphile_worker.add_job('cover-recompress',$1)",
        [JSON.stringify(row)],
      );
    return reply.code(202).send({ ok: true, enqueued: rows.rowCount });
  },
);
app.post(
  "/api/v1/admin/actions/anilist-cover-backfill",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const parsed = z.object({ scope: z.literal("global") }).safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "MAINTENANCE_SCOPE_REQUIRED");
    const batch = await operationalValue("admin.actionBatchSize");
    const rows = await pool.query(
      `SELECT m.id AS "mediaId",s.input_fingerprint AS fingerprint FROM media m LEFT JOIN media_enrichment_state s ON s.media_id=m.id AND s.provider='anilist' AND s.purpose='metadata' AND s.connector_version='${CONNECTOR_VERSIONS.anilistMetadata}' WHERE m.type IN ('ANIME','MANGA','MANHWA','MANHUA') AND EXISTS(SELECT 1 FROM bookmark_media_link l WHERE l.media_id=m.id AND l.status IN ('matched','accepted','review')) AND NOT EXISTS(SELECT 1 FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM media_enrichment_state x WHERE x.media_id=m.id AND x.provider='anilist' AND x.connector_version='${CONNECTOR_VERSIONS.anilistMetadata}' AND (x.status='TERMINAL' OR x.status IN ('NO_MATCH','FAILED') AND x.next_attempt_at>now())) ORDER BY m.id LIMIT $1`,
      [batch],
    );
    for (const row of rows.rows) {
      const fingerprint =
        row.fingerprint ??
        createHash("sha256").update(row.mediaId).digest("hex");
      await pool.query(
        "SELECT graphile_worker.add_job('anilist-enrichment',$1,job_key := $2,max_attempts := 3)",
        [
          JSON.stringify({ mediaId: row.mediaId }),
          `anilist-cover:${row.mediaId}:${CONNECTOR_VERSIONS.anilistCover}:${fingerprint}`,
        ],
      );
    }
    await pool.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,summary,request_id) VALUES($1,'anilist-cover.backfill','media_enrichment',$2,$3)",
      [
        req.user.id,
        {
          enqueued: rows.rowCount,
          batch,
          connectorVersion: CONNECTOR_VERSIONS.anilistMetadata,
        },
        req.requestId,
      ],
    );
    return reply.code(202).send({ ok: true, enqueued: rows.rowCount });
  },
);
app.post(
  "/api/v1/admin/actions/purge-expired",
  async (req: any, reply: any) => {
    if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
    const parsed = z.object({ scope: z.literal("global") }).safeParse(req.body);
    if (!parsed.success) return err(reply, 400, "MAINTENANCE_SCOPE_REQUIRED");
    const retentionDays = await operationalValue(
      "retention.metadataAttemptsDays",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pairing = await client.query(
        "DELETE FROM pairing_challenge WHERE expires_at<now()",
      );
      const exports = await client.query(
        "UPDATE account_export SET status='PURGED',payload='{}'::jsonb WHERE purge_after<now() AND status<>'PURGED'",
      );
      const password = await client.query(
        "DELETE FROM password_reset_token WHERE expires_at<now()",
      );
      const attempts = await client.query(
        "DELETE FROM metadata_attempt WHERE created_at<now()-make_interval(days=>$1)",
        [retentionDays],
      );
      await client.query("COMMIT");
      return {
        ok: true,
        purged: {
          pairingChallenges: pairing.rowCount,
          exports: exports.rowCount,
          passwordResets: password.rowCount,
          metadataAttempts: attempts.rowCount,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
);
app.get("/api/v1/admin/catalog/reset/preview", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(`SELECT
  (SELECT count(*) FROM media_title WHERE connector IN ('anilist','mangaupdates'))::int AS "providerTitles",
  (SELECT count(*) FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates'))::int AS assertions,
  (SELECT count(*) FROM media_enrichment_state WHERE provider IN ('anilist','mangaupdates'))::int AS "enrichmentStates",
  (SELECT count(*) FROM app_user)::int AS users,(SELECT count(*) FROM bookmark_import_item)::int AS favorites,
  (SELECT count(*) FROM favorite_progress)::int AS progress,(SELECT count(*) FROM extension_device)::int AS devices,
  (SELECT count(*) FROM media_cover)::int AS covers,(SELECT count(*) FROM catalog_image_asset)::int AS "imageAssets",
  (SELECT md5(COALESCE(string_agg(sha256,',' ORDER BY sha256),'')) FROM catalog_image_asset)::text AS "imageHashSet"`);
  return {
    readOnly: true,
    destructive: false,
    confirmation: "RESET-FAVLIB-CATALOG",
    affected: {
      providerTitles: result.rows[0].providerTitles,
      providerAssertions: result.rows[0].assertions,
      enrichmentStates: result.rows[0].enrichmentStates,
    },
    preserved: {
      users: result.rows[0].users,
      favorites: result.rows[0].favorites,
      progress: result.rows[0].progress,
      devices: result.rows[0].devices,
      covers: result.rows[0].covers,
      imageAssets: result.rows[0].imageAssets,
      imageHashSet: result.rows[0].imageHashSet,
    },
    media: 0,
    assets: 0,
    assertions: result.rows[0].assertions,
  };
});
app.post("/api/v1/admin/catalog/reset", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const parsed = z
    .object({ confirmation: z.literal("RESET-FAVLIB-CATALOG") })
    .safeParse(req.body);
  if (!parsed.success)
    return err(
      reply,
      400,
      "RESET_CONFIRMATION_REQUIRED",
      "Prévisualisez puis saisissez RESET-FAVLIB-CATALOG.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT favlib_reset_catalog($1) AS result",
      [parsed.data.confirmation],
    );
    await client.query(
      "INSERT INTO admin_audit_event(actor_user_id,action,target_type,summary,request_id) VALUES($1,'catalog.reset','catalog',$2,$3)",
      [
        req.user.id,
        { ...result.rows[0].result, imageAssetsPreserved: true },
        req.requestId,
      ],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      reset: true,
      ...result.rows[0].result,
      imageAssetsPreserved: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.get("/api/v1/admin/reset/preview", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const result = await pool.query(
    `SELECT (SELECT count(*) FROM bookmark_import_item WHERE user_id=$1)+(SELECT count(*) FROM bookmark_media_link WHERE user_id=$1)+(SELECT count(*) FROM progression_observation WHERE user_id=$1)+(SELECT count(*) FROM personal_notification WHERE user_id=$1)+(SELECT count(*) FROM source_snapshot WHERE user_id=$1) AS count`,
    [req.user.id],
  );
  return {
    readOnly: true,
    scope: "user",
    userId: req.user.id,
    count: Number(result.rows[0].count),
    preserved: {
      account: true,
      session: true,
      preferences: true,
      extensionDevices: true,
    },
  };
});
app.post("/api/v1/admin/reset", async (req: any, reply: any) => {
  if (req.user.role !== "admin") return err(reply, 403, "FORBIDDEN");
  const parsed = z
    .object({ email: z.string().email(), confirmation: z.literal("RESET") })
    .safeParse(req.body);
  if (
    !parsed.success ||
    parsed.data.email.toLocaleLowerCase() !== req.user.email.toLocaleLowerCase()
  )
    return err(
      reply,
      400,
      "RESET_CONFIRMATION_REQUIRED",
      "Saisissez votre e-mail et RESET.",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const affected = await client.query(
      "SELECT DISTINCT media_id FROM bookmark_media_link WHERE user_id=$1 AND media_id IS NOT NULL",
      [req.user.id],
    );
    const affectedMedia = affected.rows.map((row) => row.media_id);
    const workerSchema = await client.query(
      "SELECT to_regclass('graphile_worker._private_jobs') AS jobs",
    );
    if (workerSchema.rows[0].jobs)
      await client.query(
        "DELETE FROM graphile_worker._private_jobs WHERE payload->>'userId'=$1",
        [req.user.id],
      );
    await client.query("DELETE FROM personal_notification WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM favorite_progress WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM progression_observation WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM release_origin WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM source_snapshot WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM url_check WHERE user_id=$1", [req.user.id]);
    await client.query("DELETE FROM favorite_update_log WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM classification_run WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM metadata_attempt WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query("DELETE FROM bookmark_media_link WHERE user_id=$1", [
      req.user.id,
    ]);
    await client.query(
      "DELETE FROM bookmark_import_batch WHERE device_id IN (SELECT id FROM extension_device WHERE user_id=$1)",
      [req.user.id],
    );
    await client.query(
      "DELETE FROM reconciliation_cursor WHERE device_id IN (SELECT id FROM extension_device WHERE user_id=$1)",
      [req.user.id],
    );
    await client.query(
      "UPDATE extension_device SET last_sync_at=NULL,verified_sync_at=NULL WHERE user_id=$1",
      [req.user.id],
    );
    const media = await client.query(
      "DELETE FROM media m WHERE m.id=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM bookmark_media_link l WHERE l.media_id=m.id)",
      [affectedMedia],
    );
    await client.query(
      "INSERT INTO security_event(actor_user_id,event,target_id,result,request_id) VALUES($1,'admin_library_reset',($1::uuid)::text,'success',$2)",
      [req.user.id, req.requestId],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      reset: true,
      removedOrphanMedia: media.rowCount,
      preserved: {
        account: true,
        session: true,
        preferences: true,
        extensionDevices: true,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.delete("/api/v1/account", async (req: any, reply: any) => {
  const p = z.object({ confirmEmail: z.string().email() }).safeParse(req.body);
  if (!p.success || p.data.confirmEmail.toLowerCase() !== req.user.email)
    return err(reply, 400, "CONFIRMATION_REQUIRED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO deletion_tombstone(entity_type,entity_id,reason) SELECT 'user',$1,'account_delete' WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstone WHERE entity_type='user' AND entity_id=$1)",
      [req.user.id],
    );
    await client.query("DELETE FROM app_user WHERE id=$1", [req.user.id]);
    await client.query("COMMIT");
    return { ok: true, deleted: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.get("/api/v1/extension/progression", async (req: any, reply: any) => {
  const bookmarkId =
    typeof req.query?.bookmarkId === "string"
      ? req.query.bookmarkId.slice(0, 200)
      : "";
  if (!bookmarkId) return err(reply, 400, "VALIDATION_FAILED");
  const link = await pool.query(
    `SELECT media_id AS "mediaId" FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND status IN ('matched','accepted') AND ${contentAllowedSql('bookmark_media_link.media_id')} LIMIT 1`,
    [req.user.id, req.device.installation_id, bookmarkId],
  );
  if (!link.rowCount)
    return { linked: false, progress: null, availableCount: 0, delta: null };
  const mediaId = link.rows[0].mediaId;
  const progress = await pool.query(
    'SELECT position_kind AS "kind",position_number AS "number",position_raw AS "raw",updated_at AS "updatedAt" FROM favorite_progress WHERE user_id=$1 AND media_id=$2 ORDER BY updated_at DESC LIMIT 1',
    [req.user.id, mediaId],
  );
  const available = await pool.query(
    "SELECT release_key AS \"releaseKey\" FROM release_origin WHERE media_id=$1 AND status='AVAILABLE' AND (user_id=$2 OR user_id IS NULL)",
    [mediaId, req.user.id],
  );
  const current =
    progress.rows[0]?.number === null || progress.rows[0]?.number === undefined
      ? null
      : Number(progress.rows[0].number);
  const numbers = available.rows
    .map((row) => Number(String(row.releaseKey).split("|")[3]))
    .filter(Number.isFinite);
  const next = numbers.length ? Math.max(...numbers) : null;
  return {
    linked: true,
    mediaId,
    progress: progress.rows[0] ?? null,
    availableCount: available.rowCount,
    delta: current !== null && next !== null ? next - current : null,
  };
});
app.post("/api/v1/extension/page-metadata", async (req: any, reply: any) => {
  const parsed = extensionPageMetadataContract.safeParse(req.body);
  if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
  if (
    !sameSiteUrl(parsed.data.pageUrl, parsed.data.canonicalUrl) ||
    suspiciousPageMetadata(parsed.data)
  )
    return reply
      .code(202)
      .send({ accepted: false, reason: "PAGE_METADATA_DIVERTED" });
  const wanted =
    sourceIdentityFromUrl(parsed.data.pageUrl) ??
    sourceIdentityFromUrl(parsed.data.canonicalUrl);
  const links = await pool.query(
    `SELECT l.media_id AS "mediaId",i.payload->>'url' AS url FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id WHERE l.user_id=$1 AND l.installation_id=$2 AND l.status IN ('matched','accepted') AND i.event<>'removed'`,
    [req.user.id, req.device.installation_id],
  );
  const link = links.rows.find(
    (row) =>
      row.url === parsed.data.pageUrl ||
      (wanted && sourceIdentityFromUrl(row.url)?.key === wanted.key),
  );
  if (!link)
    return reply
      .code(202)
      .send({ accepted: false, reason: "PAGE_NOT_FAVORITED" });
  const inputFingerprint = digest(JSON.stringify(parsed.data)),
    pageKey = digest(parsed.data.canonicalUrl);
  let changed = false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const receipt = await client.query(
      "INSERT INTO extension_metadata_receipt(device_id,media_id,page_key,input_fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,media_id,page_key) DO UPDATE SET input_fingerprint=excluded.input_fingerprint,received_at=now() WHERE extension_metadata_receipt.input_fingerprint<>excluded.input_fingerprint RETURNING input_fingerprint",
      [req.device.id, link.mediaId, pageKey, inputFingerprint],
    );
    changed = Boolean(receipt.rowCount);
    if (changed && parsed.data.title)
      await client.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,connector,provenance) VALUES($1,$2,$3,NULL,'page','source-page',$4) ON CONFLICT DO NOTHING",
        [
          link.mediaId,
          parsed.data.title,
          normalizeText(parsed.data.title),
          {
            sourceUrl: parsed.data.canonicalUrl,
            confidence: parsed.data.confidence,
          },
        ],
      );
    if (changed)
      for (const [field, value] of Object.entries({
        title: parsed.data.title,
        image: parsed.data.image,
        canonicalUrl: parsed.data.canonicalUrl,
        type: parsed.data.type,
        year: parsed.data.year,
        format: parsed.data.format,
      })) {
        if (value !== undefined)
          await client.query(
            "INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,'source-page',$4,$5,NULL) ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,asserted_at=now()",
            [
              link.mediaId,
              field,
              JSON.stringify(value),
              parsed.data.canonicalUrl,
              parsed.data.confidence,
            ],
          );
      }
    if (changed && parsed.data.image && parsed.data.title)
      await enqueueMetadata(
        client,
        req.user.id,
        link.mediaId,
        parsed.data.title,
        parsed.data.pageUrl,
      );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return reply.code(202).send({ accepted: true, unchanged: !changed });
});
app.get("/api/v1/extension/page-resolution", async (req: any, reply: any) => {
  const parsed = z.string().url().max(4096).safeParse(req.query?.url);
  if (!parsed.success || !/^https?:/i.test(parsed.data))
    return err(reply, 400, "VALIDATION_FAILED");
  const wanted = sourceIdentityFromUrl(parsed.data);
  const candidates = await pool.query(
    `SELECT i.bookmark_id AS "bookmarkId",i.payload->>'url' AS url,l.media_id AS "mediaId",l.status FROM bookmark_import_item i LEFT JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id AND l.classifier_version='source-v1' WHERE i.user_id=$1 AND i.installation_id=$2 AND i.event<>'removed'`,
    [req.user.id, req.device.installation_id],
  );
  const match = candidates.rows.find(
    (row) =>
      row.url === parsed.data ||
      (wanted && sourceIdentityFromUrl(row.url)?.key === wanted.key),
  );
  if (!match) return { state: "untracked" };
  if (!match.mediaId || !["matched", "accepted"].includes(match.status))
    return { state: "associating" };
  const details = await pool.query(
    `SELECT m.id,m.type,m.format,favlib_display_title(m.id,$2::uuid)->>'title' AS title,favlib_display_title(m.id,$2::uuid) AS "titleSelection",
      EXISTS(SELECT 1 FROM media_cover c LEFT JOIN catalog_image_asset asset ON asset.sha256=c.asset_sha256 WHERE c.media_id IN (SELECT m.id UNION SELECT im.target_media_id FROM media_identity_merge im WHERE im.source_media_id=m.id) AND c.status='ACTIVE' AND COALESCE(asset.data,c.data) IS NOT NULL) AS "hasCover"
    FROM media m WHERE m.id=$1 AND ${contentAllowedSql('m.id','$2')}`,
    [match.mediaId, req.user.id],
  );
  if (!details.rowCount) return { state: "excluded" };
  const progress = await pool.query(
    'SELECT position_kind AS "kind",position_raw AS "raw",updated_at AS "updatedAt" FROM favorite_progress WHERE user_id=$1 AND media_id=$2 ORDER BY updated_at DESC LIMIT 1',
    [req.user.id, match.mediaId],
  );
  return {
    state: "known",
    media: details.rows[0] ?? {
      id: match.mediaId,
      title: null,
      format: null,
      type: "UNKNOWN",
    },
    sourceIdentity: wanted,
    progress: progress.rows[0] ?? null,
    coverUrl: details.rows[0].hasCover ? `/api/v1/extension/favorites/${encodeURIComponent(match.mediaId)}/cover` : null,
  };
});
app.get("/api/v1/extension/favorites", async (req: any, reply: any) => {
  const parsed = z.coerce
    .number()
    .int()
    .min(1)
    .max(30)
    .default(12)
    .safeParse(req.query?.limit);
  if (!parsed.success) return err(reply, 400, "VALIDATION_FAILED");
  const result = await pool.query(
    `WITH favorites AS (
    SELECT DISTINCT l.media_id FROM bookmark_media_link l
    JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id
    WHERE l.user_id=$1 AND l.status IN ('matched','accepted') AND i.event<>'removed'
  ) SELECT m.id,COALESCE(favlib_display_title(m.id,$1::uuid)->>'title',m.id) AS title,
    favlib_display_title(m.id,$1::uuid) AS "titleSelection",
    m.type,m.format,
    (SELECT jsonb_build_object('kind',p.position_kind,'number',p.position_number::numeric,'raw',p.position_raw,'updatedAt',p.updated_at) FROM favorite_progress p WHERE p.user_id=$1 AND p.media_id=m.id ORDER BY p.updated_at DESC LIMIT 1) AS progress,
    (SELECT jsonb_build_object('kind',pp.available_position_kind,'number',pp.available_position_number,'raw',pp.available_position_raw) FROM provider_progress pp WHERE pp.media_id=m.id AND pp.status='ACTIVE' AND pp.available_position_kind IS NOT NULL ORDER BY pp.updated_at DESC LIMIT 1) AS availability,
    CASE WHEN EXISTS(SELECT 1 FROM media_cover c LEFT JOIN catalog_image_asset asset ON asset.sha256=c.asset_sha256 WHERE c.media_id IN (SELECT m.id UNION SELECT im.target_media_id FROM media_identity_merge im WHERE im.source_media_id=m.id) AND c.status='ACTIVE' AND COALESCE(asset.data,c.data) IS NOT NULL) THEN '/api/v1/extension/favorites/'||replace(m.id,'/','%2F')||'/cover' END AS "coverUrl"
  FROM favorites f JOIN media m ON m.id=f.media_id WHERE ${contentAllowedSql('m.id')}
  ORDER BY COALESCE((SELECT max(p.updated_at) FROM favorite_progress p WHERE p.user_id=$1 AND p.media_id=m.id),m.created_at) DESC,m.id LIMIT $2`,
    [req.user.id, parsed.data],
  );
  return { items: result.rows };
});
app.get(
  "/api/v1/extension/favorites/:mediaId/cover",
  async (req: any, reply: any) => {
    const cover = await pool.query(
      `SELECT c.mime_type,COALESCE(a.data,c.data) AS data,c.provider,c.attribution FROM media_cover c
    LEFT JOIN catalog_image_asset a ON a.sha256=c.asset_sha256
    WHERE c.media_id IN (SELECT $1::text UNION SELECT im.target_media_id FROM media_identity_merge im WHERE im.source_media_id=$1) AND c.status='ACTIVE' AND COALESCE(a.data,c.data) IS NOT NULL AND ${contentAllowedSql('c.media_id','$2')} AND EXISTS(SELECT 1 FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id WHERE l.media_id=$1 AND l.user_id=$2 AND l.status IN ('matched','accepted') AND i.event<>'removed')
    ORDER BY (c.media_id=$1) DESC LIMIT 1`,
      [req.params.mediaId, req.user.id],
    );
    if (!cover.rowCount || !cover.rows[0].data)
      return err(
        reply,
        404,
        "COVER_NOT_AVAILABLE",
        "Aucune couverture favorite locale n’est disponible.",
      );
    const data = Buffer.from(cover.rows[0].data, "base64"),
      etag = `"${createHash("sha256").update(data).digest("base64url")}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply
      .type(cover.rows[0].mime_type)
      .header("Cache-Control", "private, max-age=2592000, immutable")
      .header("ETag", etag)
      .header("Content-Length", String(data.length))
      .header("X-FavLib-Cover-Provider", cover.rows[0].provider)
      .send(data);
  },
);
app.post(
  "/api/v1/extension/devices/:id/rotate",
  async (req: any, reply: any) => {
    const token = newOpaqueSecret(32);
    const r = await pool.query(
      "UPDATE extension_device SET token_hash=$1,revoked_at=NULL WHERE id=$2 AND user_id=$3 RETURNING id",
      [digest(token), req.params.id, req.user.id],
    );
    if (!r.rowCount) return err(reply, 404, "DEVICE_NOT_FOUND");
    await pool.query(
      "INSERT INTO security_event(actor_user_id,event,target_id,result) VALUES($1,'device_token_rotated',$2,'success')",
      [req.user.id, req.params.id],
    );
    return { ok: true, deviceId: r.rows[0].id, deviceToken: token };
  },
);
app.post("/api/v1/account/deletion-requests", async (req: any, reply: any) => {
  const token = newOpaqueSecret(32);
  const r = await pool.query(
    'INSERT INTO account_deletion_request(user_id,token_hash) VALUES($1,$2) RETURNING id,expires_at AS "expiresAt"',
    [req.user.id, digest(token)],
  );
  return reply
    .code(201)
    .send({ requestId: r.rows[0].id, token, expiresAt: r.rows[0].expiresAt });
});
app.delete("/api/v1/account/deletion", async (req: any, reply: any) => {
  const parsed = z
    .object({
      token: z
        .string()
        .min(32)
        .max(100)
        .regex(/^[A-Za-z0-9_-]+$/),
    })
    .safeParse(req.body);
  if (!parsed.success) return err(reply, 400, "INVALID_DELETION_TOKEN");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const request = await client.query(
      "SELECT id,user_id,completed_at FROM account_deletion_request WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE",
      [digest(parsed.data.token), req.user.id],
    );
    if (!request.rowCount) {
      await client.query("ROLLBACK");
      return err(reply, 404, "DELETION_REQUEST_NOT_FOUND");
    }
    if (request.rows[0].completed_at) {
      await client.query("COMMIT");
      return { ok: true, deleted: true, idempotent: true };
    }
    await client.query(
      "INSERT INTO deletion_tombstone(entity_type,entity_id,reason) SELECT 'user',$1,'account_delete' WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstone WHERE entity_type='user' AND entity_id=$1)",
      [req.user.id],
    );
    await client.query(
      "UPDATE account_deletion_request SET completed_at=now() WHERE id=$1",
      [request.rows[0].id],
    );
    await client.query("DELETE FROM app_user WHERE id=$1", [req.user.id]);
    await client.query("COMMIT");
    return { ok: true, deleted: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.get("/api/v1/extension/diagnostic/covers-missing", async (req: any) => {
  const result = await pool.query(
    `SELECT m.id AS "mediaId",m.type,COALESCE(string_agg(DISTINCT t.text,' · ' ORDER BY t.text),'(sans titre)') AS titles FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.user_id=$1 AND l.installation_id=$2 AND l.status IN ('matched','accepted','review') LEFT JOIN media_title t ON t.media_id=m.id LEFT JOIN media_cover c ON c.media_id=m.id AND c.status='ACTIVE' WHERE c.media_id IS NULL AND ${contentAllowedSql('m.id')} GROUP BY m.id,m.type ORDER BY titles,m.id`,
    [req.user.id, req.device.installation_id],
  );
  return { count: result.rowCount, items: result.rows };
});
app.setErrorHandler((e, req, reply) => {
  if ((e as any).statusCode === 413)
    return err(reply, 413, "PAYLOAD_TOO_LARGE", "Corps trop volumineux.");
  req.log.error(e);
  return err(reply, 500, "INTERNAL_ERROR", "Erreur interne.");
});
if (runtime.nodeEnv !== "test") {
  await app.listen({ host: "0.0.0.0", port: runtime.port });
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info({ signal }, "graceful shutdown");
    await app.close();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}
export { app, pool, runtimeOpenApi, runtimeRouteOperations };
