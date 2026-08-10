import { contentTaxonomyExclusion } from "@favlib/metadata";

type Query = (sql: string, values?: unknown[]) => Promise<any>;

export function providerContentExclusion(record: any) {
  return contentTaxonomyExclusion({
    genres: Array.isArray(record?.genres) ? record.genres : [],
    categories: Array.isArray(record?.categories)
      ? record.categories
      : Array.isArray(record?.tags)
        ? record.tags.map((tag: any) => typeof tag === "string" ? tag : tag?.name).filter(Boolean)
        : [],
  });
}

/** Keep the raw favorite and provider taxonomy evidence. Classification is
 * personal: only owners who have not opted in are excluded. */
export async function excludeFavoriteMediaByTaxonomy(
  query: Query,
  mediaId: string,
  provider: "anilist" | "mangaupdates" | "mangadex",
  record: any,
) {
  const exclusion = providerContentExclusion(record);
  if (!exclusion) return false;
  const evidence = { ...exclusion, provider };
  await query(
    `UPDATE bookmark_import_item item SET classification_status='excluded',classification_reason='BLOCKED_CONTENT_TAXONOMY'
     FROM bookmark_media_link link WHERE link.media_id=$1 AND item.user_id=link.user_id
       AND item.installation_id=link.installation_id AND item.bookmark_id=link.bookmark_id AND item.event<>'removed'
       AND NOT COALESCE((SELECT preference.allow_adult FROM user_catalog_preference preference WHERE preference.user_id=item.user_id),false)`,
    [mediaId],
  );
  await query(
    "UPDATE bookmark_media_link SET evidence=evidence||jsonb_build_object('contentExclusion',$2::jsonb) WHERE media_id=$1 AND status IN ('matched','accepted','review')",
    [mediaId, JSON.stringify(evidence)],
  );
  return true;
}
