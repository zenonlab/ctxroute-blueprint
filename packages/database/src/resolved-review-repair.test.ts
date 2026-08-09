import { describe, expect, it } from 'vitest';
import { applyResolvedReviewRepairBatch, mergedIdentityRepairPreviewSql, previewResolvedReviewRepair, repairPreservationSnapshotSql, resolvedReviewRepairAnomalySql, resolvedReviewRepairPreviewSql } from './resolved-review-repair.js';

const proof=(provider:'anilist'|'mangaupdates',suffix:string)=>({
  linkId:`link-${suffix}`,reviewId:`review-${suffix}`,userId:'00000000-0000-4000-8000-000000000001',
  installationId:'synthetic-device',bookmarkId:`bookmark-${suffix}`,previousMediaId:`source:${suffix}`,
  targetMediaId:`${provider}:${suffix}`,previousStatus:'review',provider,providerId:`provider-${suffix}`,
});

describe('resolved favorite review repair',()=>{
  it('plans AniList and MangaUpdates decisions symmetrically, including legitimate duplicate links',async()=>{
    const rows=[proof('anilist','anime-a'),proof('anilist','anime-b'),proof('mangaupdates','manga-a'),proof('mangaupdates','manga-b')];
    let call=0;
    const result=await previewResolvedReviewRepair(async()=>({rows:call++===0?rows:[]}));
    expect(result.changes).toEqual(rows);
    expect(resolvedReviewRepairPreviewSql).toContain("r.provider IN ('anilist','mangaupdates')");
    expect(resolvedReviewRepairPreviewSql).toContain('external.provider=evidence.provider AND external.external_id=evidence.provider_id');
    expect(resolvedReviewRepairPreviewSql).not.toMatch(/popularity|favourites|favorites_count/iu);
  });

  it('converges only active links on a fully validated provider merge without overriding terminal review decisions',()=>{
    expect(mergedIdentityRepairPreviewSql).toContain("merge.provider IN ('anilist','mangaupdates')");
    expect(mergedIdentityRepairPreviewSql).toContain('external.media_id=merge.target_media_id');
    expect(mergedIdentityRepairPreviewSql).toContain("metadata.status='ACTIVE'");
    expect(mergedIdentityRepairPreviewSql).toContain("l.status IN ('matched','accepted','review')");
    expect(mergedIdentityRepairPreviewSql).toContain("terminal.status IN ('RESOLVED','NO_MATCH')");
    expect(mergedIdentityRepairPreviewSql).not.toMatch(/popularity|favourites|favorites_count/iu);
  });

  it.each(['anilist','mangaupdates'])('validates a synthetic %s automatic decision without a selected candidate',provider=>{
    expect(resolvedReviewRepairPreviewSql).toContain("evidence.decision->>'kind'='automatic-provider-resolution'");
    expect(resolvedReviewRepairPreviewSql).toContain("evidence.decision->>'provider'=evidence.provider");
    expect(resolvedReviewRepairPreviewSql).toContain("NULLIF(r.decision->>'mediaId','') AS decision_media_id");
    expect(resolvedReviewRepairPreviewSql).toContain('evidence.decision_media_id=external.media_id');
    expect(provider).toMatch(/^(?:anilist|mangaupdates)$/u);
  });

  it('is idempotent and only rewrites identity/status while appending repair proof',async()=>{
    const batches=[[proof('anilist','one'),proof('mangaupdates','two')],[]];
    const query=async(sql:string)=>({rows:sql.includes('UPDATE bookmark_media_link')?(batches.shift()??[]):[]});
    expect(await applyResolvedReviewRepairBatch(query,100)).toHaveLength(2);
    expect(await applyResolvedReviewRepairBatch(query,100)).toEqual([]);
    expect(resolvedReviewRepairPreviewSql).toContain("l.status<>'matched'");
    expect(resolvedReviewRepairPreviewSql).toContain("l.status IN ('matched','accepted','review')");
    expect(repairPreservationSnapshotSql).toContain("'imports'");
    expect(repairPreservationSnapshotSql).toContain("'linkInventory'");
    expect(repairPreservationSnapshotSql).toContain("'titles'");
    expect(repairPreservationSnapshotSql).toContain("'progressCandidates'");
    expect(repairPreservationSnapshotSql).not.toContain("'progressValues'");
  });

  it('reports and skips malformed or conflicting resolved decisions',()=>{
    expect(resolvedReviewRepairAnomalySql).toContain('DECISION_PROVIDER_MISMATCH');
    expect(resolvedReviewRepairAnomalySql).toContain('DECISION_PROVIDER_ID_MISSING');
    expect(resolvedReviewRepairAnomalySql).toContain('CONFLICTING_CANONICAL_TARGETS');
    expect(resolvedReviewRepairAnomalySql).toContain('CONFLICTING_DECISION_TARGET');
    expect(resolvedReviewRepairAnomalySql).toContain('CANONICAL_TARGET_NOT_FOUND');
  });
});
