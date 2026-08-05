import { fetchAniList } from "@favlib/metadata";

const ids = process.argv.slice(2).join(" ").split(/\s+/).filter(Boolean);
(async () => {
  for (const id of ids) {
    try {
      const media = await fetchAniList(Number(id));
      if (!media.coverImage) continue;
      const quote = (value: string) => value.replaceAll("'", "''");
      console.log(`UPDATE favorite_review_candidate c SET image='${quote(media.coverImage)}', payload=jsonb_set(c.payload, '{coverImage}', to_jsonb('${quote(media.coverImage)}'::text), true) FROM favorite_review r WHERE c.review_id=r.id AND c.provider_id='${quote(id)}' AND r.provider='anilist' AND r.status='PENDING' AND COALESCE(c.image,'')='';`);
    } catch {}
  }
})();
