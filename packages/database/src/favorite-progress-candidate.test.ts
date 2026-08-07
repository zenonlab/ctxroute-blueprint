import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration=readFileSync(new URL("../migrations/0036_favorite_progress_candidates.sql",import.meta.url),"utf8");

describe("favorite progress candidate migration",()=>{
  it("scopes candidates by owner, installation, bookmark and kind",()=>{
    expect(migration).toContain("UNIQUE(user_id, installation_id, bookmark_id, position_kind)");
    expect(migration).toContain("user_id=NEW.user_id AND installation_id=NEW.installation_id AND bookmark_id=NEW.bookmark_id");
  });
  it("materializes only resolved active links and refuses regressions",()=>{
    expect(migration).toContain("NEW.status NOT IN ('matched','accepted')");
    expect(migration).toContain("current.position_number >= candidate.position_number");
    expect(migration).toContain("favorite_progress.position_number < excluded.position_number");
  });
  it("persists raw values and provenance before marking a candidate applied",()=>{
    expect(migration).toContain("'rawTitle',candidate.raw_title");
    expect(migration).toContain("'rawUrl',candidate.raw_url");
    expect(migration).toContain("UPDATE favorite_progress_candidate SET applied_at=now()");
  });
});
