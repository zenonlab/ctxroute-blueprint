import { describe, expect, it, vi } from "vitest";

const { searchAniList, fetchAniList, saveCover } = vi.hoisted(() => ({
  searchAniList: vi.fn(),
  fetchAniList: vi.fn(),
  saveCover: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
}));

vi.mock("@favlib/metadata", async () => {
  const actual = await vi.importActual<typeof import("@favlib/metadata")>(
    "@favlib/metadata",
  );
  return { ...actual, searchAniList, fetchAniList };
});
vi.mock("../settings.js", () => ({
  operationalValue: vi.fn(async (_h: unknown, key: string) =>
    key === "metadata.maxAttempts" ? 3 : 1000,
  ),
}));
vi.mock("../anilist-gate.js", () => ({ aniListHooks: vi.fn(() => ({})) }));
vi.mock("../cover-store.js", () => ({ saveCover }));
vi.mock("../enrichment-state.js", async () => {
  const actual = await vi.importActual<typeof import("../enrichment-state.js")>(
    "../enrichment-state.js",
  );
  return {
    ...actual,
    claimEnrichment: vi.fn(async () => ({ attempt_count: 1, owner: "test" })),
    finishEnrichment: vi.fn(async () => undefined),
  };
});

import {
  anilistProviderVariants,
  anilistAnchorVariants,
  enrichAniList,
} from "./anilist-enrichment.js";

const anime = {
  id: 176053,
  type: "ANIME" as const,
  title: {
    english: "Good Bye, Dragon Life, Hello Human Life",
    romaji: "Sayonara Ryuusei, Konnichiwa Jinsei",
    userPreferred: "Good Bye, Dragon Life, Hello Human Life",
  },
  synonyms: ["Goodbye Dragon Life, Hello Human Life"],
  genres: [],
  tags: [],
  coverImage: "https://img.example/176053.jpg",
  startYear: 2024,
  relations: [
    {
      id: 999999,
      type: "ANIME" as const,
      relationType: "SEQUEL",
      title: { romaji: "Related Anime" },
    },
  ],
};
const manga = {
  ...anime,
  id: 87415,
  type: "MANGA" as const,
  title: {
    english: "Goodbye Dragon Life, Hello Human Life",
    romaji: "Sayonara Ryuusei, Konnichiwa Jinsei",
    userPreferred: "Goodbye Dragon Life, Hello Human Life",
  },
};

describe("AniList enrichment resolution", () => {
  it("uses one bounded anchor when the provider needs candidate discovery", () => {
    expect(anilistAnchorVariants(["Sasaki to P-chan 7"])).toContain("sasaki");
    expect(anilistAnchorVariants(["Sasaki to P-chan 7"])).not.toContain("p");
  });
  it("adds generic singular token variants without title-specific rules", () => {
    expect(
      anilistProviderVariants([
        "The Strongest Tanks Labyrinth Raids A Tank with a Rare Resistance Skill",
      ]),
    ).toContain("The Strongest Tank Labyrinth Raids");
    expect(
      anilistProviderVariants(["Sousou no Frieren (VF) - Sousou no Frieren - 28 VF"]),
    ).toContain("Sousou no Frieren");
  });

  it("keeps source aliases separate from provider observations", () => {
    const variants = anilistProviderVariants(["Isekai Ojisan"]);
    expect(variants).toContain("Isekai Ojisan");
    expect(variants).not.toContain("Isekai Oji-san");
  });

  it("skips a manga first result and resolves the anime through a returned romaji title", async () => {
    searchAniList.mockImplementation(async (query: string) =>
      /sayonara/i.test(query) ? [anime] : [manga],
    );
    fetchAniList.mockResolvedValue(anime);
    const calls: { sql: string; values?: unknown[] }[] = [];
    const helpers = {
      logger: { warn: vi.fn() },
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("SELECT m.type,COALESCE"))
          return {
            rows: [
              {
                type: "ANIME",
                titles: ["Goodbye Dragon Life Hello Human Life", "Sayonara Ryuusei, Konnichiwa Jinsei"],
                year: null,
                anilist_id: null,
              },
            ],
          };
        return { rows: [] };
      }),
    };

    const result = await enrichAniList({ mediaId: "source:dragon-life" }, helpers);

    expect(result).toMatchObject({ status: "SUCCESS", externalId: 176053 });
    expect(searchAniList.mock.calls.map(([query]) => query)).toContain(
      "Sayonara Ryuusei, Konnichiwa Jinsei",
    );
    expect(searchAniList.mock.calls.map(([query]) => query)).not.toContain(
      "Good Bye Dragon Life Hello Human Life",
    );
    expect(searchAniList.mock.calls.every(([, options]) => options.type === "ANIME")).toBe(true);
    expect(helpers.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('externalId=87415 type=MANGA'),
    );
    expect(saveCover).toHaveBeenCalledWith(
      expect.anything(),
      "anilist:176053",
      anime.coverImage,
      "anilist",
      "AniList",
      expect.objectContaining({ externalId: "176053" }),
    );
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO media(id,type)"))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes("kind='relation'"))).toBe(false);
    const relationsAssertion = calls.find(
      ({ sql, values }) => sql.includes("INSERT INTO metadata_assertion") && values?.[1] === "relations",
    );
    expect(relationsAssertion?.values?.[2]).toEqual(JSON.stringify(anime.relations));
    expect(calls.some(({ sql }) => sql.includes("source-url"))).toBe(false);
  });

  it("uses a provider title as a bounded discovery hint without making it a source alias", async () => {
    searchAniList.mockImplementation(async (query: string) =>
      /sayonara/i.test(query) ? [anime] : [manga],
    );
    fetchAniList.mockResolvedValue(anime);
    const calls: { sql: string; values?: unknown[] }[] = [];
    const helpers = {
      logger: { warn: vi.fn() },
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("SELECT m.type,COALESCE"))
          return { rows: [{ type: "ANIME", titles: ["Goodbye Dragon Life Hello Human Life"], year: null, anilist_id: null }] };
        return { rows: [] };
      }),
    };
    const result = await enrichAniList({ mediaId: "source:dragon-discovery" }, helpers);
    expect(result).toMatchObject({ status: "SUCCESS", externalId: 176053 });
    expect(searchAniList.mock.calls.map(([query]) => query)).toContain("Sayonara Ryuusei, Konnichiwa Jinsei");
    const sourceQuery = calls.find(({ sql }) => sql.includes("SELECT m.type,COALESCE"));
    expect(sourceQuery?.values?.[0]).toBe("source:dragon-discovery");
  });
});
