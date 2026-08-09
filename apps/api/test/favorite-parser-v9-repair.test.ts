import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source=readFileSync(resolve(process.cwd(),'src/repair-favorite-parser-v9.ts'),'utf8');

describe('favorite parser global repair safety',()=>{
  it('requires a fresh preview proof and a restore-tested backup before apply',()=>{
    expect(source).toContain("--proof=/absolute/path is required");
    expect(source).toContain("--apply requires --backup-manifest=/absolute/path");
    expect(source).toContain("manifest.restoreTest!=='VERIFIED'");
    expect(source).toContain('BACKUP_CHECKSUM_MISMATCH');
    expect(source).toContain('PREVIEW_PROOF_STALE_OR_INVALID');
  });

  it('preserves raw imports, progression, prior decisions and provider ids',()=>{
    expect(source).toContain('REPAIR_INVARIANT_RAW_IMPORT_OR_PROVIDER_ID_CHANGED');
    expect(source).toContain('REPAIR_INVARIANT_EXISTING_DECISIONS_CHANGED');
    expect(source).toContain('provider=$6 AND decision IS NULL');
    expect(source).toContain('previousDerivedTitle');
    expect(source).toContain("favorite.parser-v${FAVORITE_IDENTITY_PARSER_VERSION}.repair");
  });

  it('previews changed progressions, MangaUpdates rechecks and protected decisions before idempotent apply',()=>{
    expect(source).toContain('progressionsChanged');
    expect(source).toContain('mangaUpdatesRechecks');
    expect(source).toContain('protectedReviews');
    expect(source).toContain('progress_parser_version=$6');
    expect(source).toContain("provenance->>'installationId'=$7");
    expect(source).toContain("provenance->>'bookmarkId'=$8");
    expect(source).toContain("ON CONFLICT DO NOTHING");
  });

  it('replaces obsolete candidates and invalidates only their parser-derived observation',()=>{
    expect(source).toContain('position_number=excluded.position_number');
    expect(source).not.toContain('GREATEST(favorite_progress_candidate.position_number,excluded.position_number)');
    expect(source).toContain("consented=false,confidence='low'");
    expect(source).toContain("'invalidatedByParser',$2::text");
    expect(source).toContain('rebuildMaterializedProgress');
    expect(source).toContain('candidateRepairs');
    expect(source).toContain('removedProgressCandidates');
    expect(source).toContain("i.event='removed'");
    expect(source).toContain('c.position_number IS DISTINCT FROM');
    expect(source).toContain('row.oldArtifact?.progression??row.storedCandidate??null');
    expect(source).toContain('row.materializedParserDrift??row.oldArtifact?.progression');
    expect(source).toContain('item.materializedMediaId??item.mediaId');
    expect(source).toContain("fp.position_number BETWEEN 1900 AND EXTRACT(year FROM now())+1");
    expect(source).toContain("o.provenance->>'evidence'='numeric-url-segment-after-source-identity'");
  });

  it('removes only candidate-free technical reviews and requeues semantic outcomes',()=>{
    expect(source).toContain("NOT EXISTS(SELECT 1 FROM favorite_review_candidate c WHERE c.review_id=r.id)");
    expect(source).toContain("r.reason IN ('AMBIGUOUS','LOW_CONFIDENCE','NO_RESULT','NO_MATCH','TYPE_MISMATCH','FORMAT_MISMATCH','OVA_REQUIRED_NOT_FOUND')");
    expect(source).toContain('corroborated_technical_titles');
    expect(source).toContain('unique_resolved_pending');
  });
});
