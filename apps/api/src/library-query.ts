import { z } from 'zod';

export const libraryFilterKeys = ['type', 'theme', 'genre', 'category', 'status', 'year', 'contentRating', 'demographic'] as const;
export type LibraryFilterKey = typeof libraryFilterKeys[number];

const repeated = (max = 100) => z.preprocess(
  value => value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value],
  z.array(z.string().trim().min(1).max(max)).max(50),
);

const years = z.preprocess(
  value => value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value],
  z.array(z.coerce.number().int().min(1900).max(2200)).max(50),
);

export const libraryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(30),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  q: z.string().trim().max(200).default(''),
  type: repeated(), theme: repeated(), genre: repeated(), category: repeated(), status: repeated(), year: years,
  contentRating: repeated(), demographic: repeated(),
  excludeType: repeated(), excludeTheme: repeated(), excludeGenre: repeated(), excludeCategory: repeated(), excludeStatus: repeated(), excludeYear: years,
  excludeContentRating: repeated(), excludeDemographic: repeated(),
  // Kept as a private compatibility parameter. It is deliberately absent from facets and the UI.
  provider: repeated(),
  // Contextual filters are created from modal metadata chips. They are not
  // permanent facets and remain user-scoped through the personal CTE.
  author: repeated(200),
  studio: repeated(200),
  sort: z.enum(['inventory', 'title', 'type', 'year', 'release', 'favorites']).default('inventory'),
  direction: z.enum(['asc', 'desc']).default('asc'),
}).strict();

export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
export const activeProviderSql = "l.status IN ('matched','accepted')";
// A review link is visible in the personal library, but it is not an
// accepted provider identity. Keep the stricter predicate above for provider
// operations and use this one only for the read-only library projection.
export const libraryVisibleLinkSql = "l.status IN ('matched','accepted','review')";

/** One canonical user-scoped projection is shared by result and facet queries. */
export const libraryProjectionSql = `personal AS (
  SELECT l.media_id,count(DISTINCT (l.installation_id,l.bookmark_id))::int AS favorite_count,
    (SELECT i.payload->>'url' FROM bookmark_media_link source_link JOIN bookmark_import_item i ON i.user_id=source_link.user_id AND i.installation_id=source_link.installation_id AND i.bookmark_id=source_link.bookmark_id WHERE source_link.user_id=$1 AND source_link.media_id=l.media_id AND i.event<>'removed' ORDER BY i.created_at DESC LIMIT 1) AS source_url
  FROM bookmark_media_link l
  JOIN bookmark_import_item active_import ON active_import.user_id=l.user_id AND active_import.installation_id=l.installation_id AND active_import.bookmark_id=l.bookmark_id AND active_import.event<>'removed'
  WHERE l.user_id=$1 AND l.status IN ('matched','accepted','review') AND l.media_id IS NOT NULL
  GROUP BY l.media_id
), projected AS (
  SELECT p.media_id AS "id",
    favlib_display_title(p.media_id,$1::uuid)->>'title' AS "title",
    favlib_display_title(p.media_id,$1::uuid) AS "titleSelection",
    m.type,m.season_year AS "seasonYear",
    m.format,
    (SELECT jsonb_build_object('provider',mm.provider,'status',mm.status,'latestChapter',CASE WHEN mm.provider='mangaupdates' THEN mm.latest_chapter ELSE NULL END,'sourceUrl',mm.source_url,'metadata',COALESCE((SELECT jsonb_object_agg(a.field,a.value) FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.provider=CASE WHEN EXISTS(SELECT 1 FROM mangadex_promotion_state ps WHERE ps.media_id=p.media_id) THEN 'mangadex' ELSE mm.provider END AND NOT (a.provider='mangadex' AND a.field='latestChapter')),'{}'::jsonb),'promotion',(SELECT jsonb_build_object('status',ps.status,'mangaDexId',ps.mangadex_id,'mangaUpdatesId',ps.mangaupdates_id,'nextAttemptAt',ps.next_attempt_at,'lastAttemptAt',ps.last_attempt_at,'lastError',ps.last_error,'matcherVersion',ps.matcher_version) FROM mangadex_promotion_state ps WHERE ps.media_id=p.media_id)) FROM media_metadata mm WHERE mm.media_id=p.media_id AND mm.status='ACTIVE' LIMIT 1) AS metadata,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',mm.provider,'sourceUrl',mm.source_url,'status',mm.status) ORDER BY mm.provider) FROM media_metadata mm WHERE mm.media_id=p.media_id AND mm.provider IN ('anilist','mangaupdates','mangadex') AND mm.status='ACTIVE'),'[]'::jsonb) AS "providerPages",
    p.favorite_count AS "favoriteCount",
    CASE WHEN EXISTS(SELECT 1 FROM bookmark_media_link review_link WHERE review_link.user_id=$1 AND review_link.media_id=p.media_id AND review_link.status='review' AND NOT EXISTS(SELECT 1 FROM favorite_review resolved_review WHERE resolved_review.user_id=review_link.user_id AND resolved_review.installation_id=review_link.installation_id AND resolved_review.bookmark_id=review_link.bookmark_id AND resolved_review.status='RESOLVED' AND resolved_review.decision IS NOT NULL)) THEN 'review' ELSE 'classified' END AS "classificationStatus",
    (SELECT jsonb_build_object('kind',fp.position_kind,'number',COALESCE(fp.global_position_number,fp.position_number::numeric),'raw',fp.position_raw,'season',fp.season,'localNumber',fp.local_position_number,'globalNumber',fp.global_position_number,'updatedAt',fp.updated_at) FROM favorite_progress fp WHERE fp.user_id=$1 AND fp.media_id=p.media_id ORDER BY COALESCE(fp.global_position_number,fp.position_number::numeric) DESC NULLS LAST,fp.updated_at DESC LIMIT 1) AS progress,
    (SELECT jsonb_build_object('kind',pp.available_position_kind,'number',COALESCE(pp.global_position_number,pp.available_position_number),'raw',pp.available_position_raw,'season',pp.season,'localNumber',pp.local_position_number,'globalNumber',pp.global_position_number,'provider',pp.provider,'provenance',pp.available_position_provenance,'verifiedAt',pp.last_checked_at) FROM provider_progress pp WHERE pp.media_id=p.media_id AND pp.status='ACTIVE' AND pp.available_position_kind IS NOT NULL AND pp.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END ORDER BY pp.updated_at DESC LIMIT 1) AS availability,
    CASE WHEN p.source_url IS NULL THEN NULL ELSE jsonb_build_object('url',p.source_url,'domain',split_part(regexp_replace(p.source_url,'^https?://',''),'/',1)) END AS "sourceIdentity",
    COALESCE(
      (SELECT jsonb_build_object('provider',c.provider,'sourceUrl',c.source_url,'attribution',c.attribution,'fetchedAt',c.fetched_at) FROM media_cover c WHERE c.media_id=p.media_id AND c.status='ACTIVE'),
      (SELECT jsonb_build_object('provider',c.provider,'sourceUrl',c.source_url,'attribution',c.attribution,'fetchedAt',c.fetched_at,'provenance',jsonb_build_object('source','media-identity-merge','targetMediaId',im.target_media_id))
       FROM media_identity_merge im JOIN media_cover c ON c.media_id=im.target_media_id AND c.status='ACTIVE'
       WHERE im.source_media_id=p.media_id LIMIT 1)
    ) AS "coverProvenance",
    COALESCE((SELECT jsonb_agg(v.value ORDER BY v.value) FROM (SELECT DISTINCT theme_value AS value FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements_text(a.value) theme_value WHERE a.media_id=p.media_id AND a.field='themes' AND jsonb_typeof(a.value)='array' AND (COALESCE((SELECT allow_adult FROM user_catalog_preference WHERE user_id=$1),false) OR NOT EXISTS(SELECT 1 FROM metadata_assertion aa CROSS JOIN LATERAL jsonb_array_elements_text(aa.value) av WHERE aa.media_id=p.media_id AND aa.field='adultCategories' AND av=theme_value))) v),'[]'::jsonb) AS themes,
    COALESCE((SELECT jsonb_agg(v.value ORDER BY v.value) FROM (SELECT DISTINCT genre_value AS value FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements_text(a.value) genre_value WHERE a.media_id=p.media_id AND a.field='genres' AND jsonb_typeof(a.value)='array') v),'[]'::jsonb) AS genres,
    COALESCE((SELECT jsonb_agg(v.value ORDER BY v.value) FROM (SELECT DISTINCT category_value AS value FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements_text(a.value) category_value WHERE a.media_id=p.media_id AND a.field='categories' AND jsonb_typeof(a.value)='array' AND (COALESCE((SELECT allow_adult FROM user_catalog_preference WHERE user_id=$1),false) OR NOT EXISTS(SELECT 1 FROM metadata_assertion aa CROSS JOIN LATERAL jsonb_array_elements_text(aa.value) av WHERE aa.media_id=p.media_id AND aa.field='adultCategories' AND av=category_value))) v),'[]'::jsonb) AS categories,
    CASE
      WHEN raw_status ~* '\\m(on[[:space:]]+)?hiatus\\M' THEN 'Hiatus'
      WHEN raw_status ~* '\\m(complete|completed|finished)\\M' THEN 'Completed'
      WHEN raw_status ~* '\\m(cancelled|canceled)\\M' THEN 'Cancelled'
      WHEN raw_status ~* '\\m(discontinued|dropped)\\M' THEN 'Cancelled'
      WHEN raw_status ~* '\\m(not[_ -]?yet[_ -]?released|upcoming|planned)\\M' THEN 'Ongoing'
      WHEN raw_status ~* '\\m(ongoing|releasing)\\M' THEN 'Ongoing'
      ELSE NULL
    END AS status,
    (SELECT a.value #>> '{}' FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.field='language' ORDER BY a.confidence DESC,a.asserted_at DESC LIMIT 1) AS language,
    (SELECT a.value #>> '{}' FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.field='contentRating' ORDER BY a.confidence DESC,a.asserted_at DESC LIMIT 1) AS "contentRating",
    (SELECT a.value #>> '{}' FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.field='publicationDemographic' ORDER BY a.confidence DESC,a.asserted_at DESC LIMIT 1) AS demographic,
    (SELECT max(a.value #>> '{}') FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.field='latestReleaseDate') AS "latestReleaseDate",
    COALESCE((SELECT jsonb_agg(DISTINCT a.provider) FROM metadata_assertion a WHERE a.media_id=p.media_id),'[]'::jsonb) AS providers,
    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('text',tt.text,'language',tt.language,'script',tt.script,'kind',tt.kind,'titleType',tt.title_type,'connector',tt.connector,'personalStatus',tt.personal_status,'provenance',tt.provenance,'externalId',tt.provenance->>'externalId')) FROM media_title tt WHERE tt.media_id=p.media_id),'[]'::jsonb) AS titles,
    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('name',person.name,'provider',person.provider,'sourceUrl',person.source_url,'verifiedAt',person.asserted_at) ORDER BY jsonb_build_object('name',person.name,'provider',person.provider,'sourceUrl',person.source_url,'verifiedAt',person.asserted_at)) FROM (SELECT CASE WHEN jsonb_typeof(credit_value)='string' THEN credit_value #>> '{}' ELSE credit_value->>'name' END AS name,a.provider,a.source_url,a.asserted_at FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements(a.value) credit_value WHERE a.media_id=p.media_id AND a.field='authors' AND jsonb_typeof(a.value)='array') person WHERE person.name IS NOT NULL AND btrim(person.name)<>'') ,'[]'::jsonb) AS authors,
    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('name',studio.name,'provider',studio.provider,'sourceUrl',studio.source_url,'verifiedAt',studio.asserted_at) ORDER BY jsonb_build_object('name',studio.name,'provider',studio.provider,'sourceUrl',studio.source_url,'verifiedAt',studio.asserted_at)) FROM (SELECT CASE WHEN jsonb_typeof(credit_value)='string' THEN credit_value #>> '{}' ELSE credit_value->>'name' END AS name,a.provider,a.source_url,a.asserted_at FROM metadata_assertion a CROSS JOIN LATERAL jsonb_array_elements(a.value) credit_value WHERE a.media_id=p.media_id AND a.field='studios' AND jsonb_typeof(a.value)='array') studio WHERE studio.name IS NOT NULL AND btrim(studio.name)<>'') ,'[]'::jsonb) AS studios,
    CASE WHEN m.type='ANIME' THEN (SELECT CASE WHEN jsonb_typeof(a.value)='number' THEN (a.value #>> '{}')::int WHEN jsonb_typeof(a.value)='string' AND (a.value #>> '{}') ~ '^[0-9]+$' THEN (a.value #>> '{}')::int END FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.provider='anilist' AND a.field IN ('episodes','episodeCount') ORDER BY a.asserted_at DESC LIMIT 1) ELSE NULL END AS "episodeTotal",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',pp.provider,'latestChapter',pp.latest_chapter,'latestVolume',pp.latest_volume,'availablePositionKind',pp.available_position_kind,'availablePositionNumber',pp.available_position_number,'availablePositionRaw',pp.available_position_raw,'availablePositionProvenance',pp.available_position_provenance,'latestReleaseAt',pp.latest_release_at,'status',pp.status,'lastCheckedAt',pp.last_checked_at,'lastError',pp.last_error) ORDER BY pp.provider) FROM provider_progress pp WHERE pp.media_id=p.media_id),'[]'::jsonb) AS "providerProgress",
    COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('provider',a.provider,'text',a.attribution,'sourceUrl',a.source_url)) FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.attribution IS NOT NULL),'[]'::jsonb) AS attributions,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('bookmarkId',i.bookmark_id,'url',i.payload->>'url','title',i.payload->>'title','parsedTitle',i.parse_artifact#>>'{identity,title}','progression',i.parse_artifact->'progression','device',COALESCE(d.name,'Profil'),'parserId',i.parser_id,'parserVersion',i.parser_version,'provenance',i.parse_artifact->'provenance') ORDER BY i.created_at DESC) FROM bookmark_media_link l2 JOIN bookmark_import_item i ON i.user_id=l2.user_id AND i.installation_id=l2.installation_id AND i.bookmark_id=l2.bookmark_id LEFT JOIN extension_device d ON d.user_id=i.user_id AND d.installation_id=i.installation_id WHERE l2.user_id=$1 AND l2.media_id=p.media_id AND l2.status IN ('matched','accepted','review') AND i.event<>'removed'),'[]'::jsonb) AS favorites,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('mediaId',o.media_id,'connector',o.connector,'canonicalUrl',o.canonical_url,'status',CASE WHEN o.provenance->>'statusCode'='404' OR o.provenance->>'httpStatus'='404' THEN 'MOVED' WHEN o.status='ERROR' THEN 'UNAVAILABLE' ELSE o.status END,'checkedAt',o.checked_at,'title',o.provenance->>'title','chapter',o.provenance->>'chapter','domain',split_part(regexp_replace(o.canonical_url,'^https?://',''),'/',1),'language',o.provenance->>'language','provenance',o.provenance) ORDER BY o.checked_at DESC) FROM release_origin o WHERE o.media_id=p.media_id AND (o.user_id IS NULL OR o.user_id=$1)),'[]'::jsonb) AS sources
  FROM personal p JOIN media m ON m.id=p.media_id
  LEFT JOIN LATERAL (SELECT a.value #>> '{}' AS raw_status FROM metadata_assertion a WHERE a.media_id=p.media_id AND a.field='status' ORDER BY a.confidence DESC,a.asserted_at DESC LIMIT 1) status_assertion ON true
)`;

const clauses: Record<LibraryFilterKey, string> = {
  type: `cardinality($3::text[])=0 OR "type"=ANY($3::text[])`,
  theme: `cardinality($4::text[])=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(themes) value WHERE lower(value)=ANY($4::text[]))`,
  genre: `cardinality($5::text[])=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(genres) value WHERE lower(value)=ANY($5::text[]))`,
  category: `cardinality($6::text[])=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(categories) value WHERE lower(value)=ANY($6::text[]))`,
  status: `cardinality($7::text[])=0 OR lower(COALESCE(status,''))=ANY($7::text[])`,
  year: `cardinality($8::int[])=0 OR "seasonYear"=ANY($8::int[])`,
  contentRating: `cardinality($9::text[])=0 OR lower(COALESCE("contentRating",''))=ANY($9::text[])`,
  demographic: `cardinality($10::text[])=0 OR lower(COALESCE(demographic,''))=ANY($10::text[])`,
};

const ignoredCasts:Record<LibraryFilterKey,string>={type:'$3::text[] IS NOT NULL',theme:'$4::text[] IS NOT NULL',genre:'$5::text[] IS NOT NULL',category:'$6::text[] IS NOT NULL',status:'$7::text[] IS NOT NULL',year:'$8::int[] IS NOT NULL',contentRating:'$9::text[] IS NOT NULL',demographic:'$10::text[] IS NOT NULL'};
const ignoredExclusionCasts:Record<LibraryFilterKey,string>={type:'$12::text[] IS NOT NULL',theme:'$13::text[] IS NOT NULL',genre:'$14::text[] IS NOT NULL',category:'$15::text[] IS NOT NULL',status:'$16::text[] IS NOT NULL',year:'$17::int[] IS NOT NULL',contentRating:'$18::text[] IS NOT NULL',demographic:'$19::text[] IS NOT NULL'};

export function libraryFilterSql(ignore?: LibraryFilterKey) {
  const exclusions:Record<LibraryFilterKey,string>={type:`cardinality($12::text[])=0 OR NOT ("type"=ANY($12::text[]))`,theme:`cardinality($13::text[])=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(themes) value WHERE lower(value)=ANY($13::text[]))`,genre:`cardinality($14::text[])=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(genres) value WHERE lower(value)=ANY($14::text[]))`,category:`cardinality($15::text[])=0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(categories) value WHERE lower(value)=ANY($15::text[]))`,status:`cardinality($16::text[])=0 OR NOT (lower(COALESCE(status,''))=ANY($16::text[]))`,year:`cardinality($17::int[])=0 OR NOT ("seasonYear"=ANY($17::int[]))`,contentRating:`cardinality($18::text[])=0 OR NOT (lower(COALESCE("contentRating",''))=ANY($18::text[]))`,demographic:`cardinality($19::text[])=0 OR NOT (lower(COALESCE(demographic,''))=ANY($19::text[]))`};
  return [`($2='' OR EXISTS(SELECT 1 FROM media_title search_title WHERE search_title.media_id=projected."id" AND (search_title.normalized_text LIKE '%'||lower($2)||'%' OR NOT EXISTS(SELECT 1 FROM regexp_split_to_table(lower($2),'\\s+') token WHERE token<>'' AND search_title.normalized_text NOT LIKE '%'||token||'%'))))`, ...libraryFilterKeys.map(key => `(${key===ignore?ignoredCasts[key]:clauses[key]})`), `(cardinality($11::text[])=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(providers) value WHERE lower(value)=ANY($11::text[])))`,...libraryFilterKeys.map(key=>`(${key===ignore?ignoredExclusionCasts[key]:exclusions[key]})`), `(cardinality($20::text[])=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(authors) value WHERE lower(value->>'name')=ANY($20::text[])))`, `(cardinality($21::text[])=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(studios) value WHERE lower(value->>'name')=ANY($21::text[])))`].join(' AND ');
}

export function libraryFilterValues(userId: string, query: LibraryQuery) {
  const lower = (values: string[]) => [...new Set(values.map(value => value.toLocaleLowerCase()))];
  return [userId, query.q, [...new Set(query.type.map(value => value.toUpperCase()))], lower(query.theme),lower(query.genre),lower(query.category),lower(query.status), [...new Set(query.year)], lower(query.contentRating), lower(query.demographic), lower(query.provider),[...new Set(query.excludeType.map(value=>value.toUpperCase()))],lower(query.excludeTheme),lower(query.excludeGenre),lower(query.excludeCategory),lower(query.excludeStatus),[...new Set(query.excludeYear)],lower(query.excludeContentRating),lower(query.excludeDemographic),lower(query.author),lower(query.studio)];
}

export function retainSelected(rows: Array<{value:string|number;count:number}>, selected: Array<string|number>) {
  const seen = new Set(rows.map(row => String(row.value).toLocaleLowerCase()));
  return [...rows, ...selected.filter(value => !seen.has(String(value).toLocaleLowerCase())).map(value => ({value,count:0}))];
}
