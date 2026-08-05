import { describe, expect, it, vi } from "vitest";
import {
  extractPageMetadata,
  fetchAniList,
  fetchMangaUpdatesReleases,
  matchAniList,
  matchMangaUpdates,
  resolveMangaUpdatesSeries,
  isDeadMangaUpdatesSeries,
  searchAniList,
  sourceDispositionFromUrl,
  sourceIdentityFromUrl,
  compactTitleKey,
  prepareTitleCandidates,
  titleCandidateFromBookmark,
  titleVariants,
} from "./index.js";

describe("AniList catalogue", () => {
  it("prepares bookmark and URL titles using URL release evidence", () => {
    const anime = sourceIdentityFromUrl("https://v5.voiranime.com/anime/remonster/re-monster-02-vostfr/");
    expect(anime).toMatchObject({ title: "Re Monster", type: "ANIME", slug: "remonster" });
    const prepared = prepareTitleCandidates({
      bookmarkTitle: "Re:Monster - Re Monster - 02 VOSTFR - 02 - Voiranime",
      url: "https://v5.voiranime.com/anime/remonster/re-monster-02-vostfr/",
      source: anime,
    });
    expect(prepared.candidates).toContain("Re:Monster");
    expect(prepared.candidates[0]).toBe("Re:Monster");
    expect(compactTitleKey("Re:Monster")).toBe(compactTitleKey("Re Monster"));
    expect(compactTitleKey("Re Monster")).toBe(compactTitleKey("Remonster"));
  });

  it("uses path type over an anime-looking hostname and removes scan markers", () => {
    expect(sourceIdentityFromUrl("https://anime-sama.fr/catalogue/child-of-the-sheath/scan/vf/")).toMatchObject({
      title: "Child Of The Sheath", type: "MANGA",
    });
    expect(sourceIdentityFromUrl("https://anime-sama.fr/catalogue/maybe-meant-to-be/scan/vf/")).toMatchObject({
      title: "Maybe Meant To Be", type: "MANGA",
    });
  });

  it("keeps title words that merely resemble release markers", () => {
    expect(prepareTitleCandidates({
      bookmarkTitle: "Sub Zero",
      url: "https://reader.example/series/sub-zero",
    }).personal).toBe("Sub Zero");
    expect(prepareTitleCandidates({
      bookmarkTitle: "Sasaki to P-chan 7",
      url: "https://reader.example/series/sasaki-to-p-chan-7",
    }).personal).toBe("Sasaki to P-chan 7");
  });

  it("uses path evidence for release suffixes without deleting title words", () => {
    expect(sourceIdentityFromUrl("https://v5.voiranime.com/anime/remonster/re-monster-02-vostfr/")).toMatchObject({
      releaseSuffix: "02-vostfr",
    });
    expect(sourceIdentityFromUrl("https://reader.example/im-a-sub/dub-01")).toMatchObject({
      title: "Im A Sub",
      releaseSuffix: "dub-01",
    });
    expect(prepareTitleCandidates({
      bookmarkTitle: "Watch My Series",
      url: "https://reader.example/saison1/vostfr/",
    }).personal).toBe("My Series");
  });

  it("resolves source releases without using the personal bookmark title", () => {
    expect(
      sourceIdentityFromUrl(
        "https://reader.example/series/solo-leveling/chapter/42",
      ),
    ).toMatchObject({
      title: "Solo Leveling",
      type: "MANGA",
      canonicalUrl: "https://reader.example/series/solo-leveling",
    });
    expect(
      sourceIdentityFromUrl(
        "https://comix.to/title/2l25-moral-less-scandal/10088140-chapter-44",
      ),
    ).toMatchObject({
      title: "Moral Less Scandal",
      canonicalUrl: "https://comix.to/title/2l25-moral-less-scandal",
    });
    expect(
      sourceIdentityFromUrl(
        "https://classroomoftheelite.com/manga/classroom-of-the-elite-chapter-74/",
      ),
    ).toMatchObject({ title: "Classroom Of The Elite" });
    expect(
      sourceIdentityFromUrl(
        "https://mangareader.to/read/dame-skill-jidou-kinou-ga-kakusei-shimashita-56218/en/chapter-15",
      ),
    ).toMatchObject({ title: "Dame Skill Jidou Kinou Ga Kakusei Shimashita" });
    expect(
      sourceIdentityFromUrl(
        "https://comick.io/comic/beneath-the-lady-s-mask/8sOey0Vd-chapter-51-en",
      ),
    ).toMatchObject({
      title: "Beneath The Lady S Mask",
      type: "MANGA",
      canonicalUrl: "https://comick.io/comic/beneath-the-lady-s-mask",
    });
    expect(
      sourceIdentityFromUrl(
        "https://comick.to/comic/beneath-the-lady-s-mask/8sOey0Vd-chapter-51-en",
      ),
    ).toMatchObject({
      title: "Beneath The Lady S Mask",
      type: "MANGA",
      canonicalUrl: "https://comick.to/comic/beneath-the-lady-s-mask",
    });
    expect(
      titleCandidateFromBookmark("Wrong personal label — Chapter 42"),
    ).toBe("Wrong personal label");
    expect(
      titleCandidateFromBookmark(
        "I Became the Villainess’s Favorite Chapter 31 – English | ResetScans",
      ),
    ).toBe("I Became the Villainess’s Favorite");
    expect(titleCandidateFromBookmark("Moral-less Scandal · Ch.44")).toBe(
      "Moral-less Scandal",
    );
  });
  it("extracts only public page metadata", () =>
    expect(
      extractPageMetadata(
        '<title>Frieren</title><meta property="og:image" content="/cover.jpg">',
        "https://reader.example/episode/2",
      ),
    ).toMatchObject({
      title: "Frieren",
      image: "https://reader.example/cover.jpg",
    }));
  it("searches AniList through one bounded GraphQL request and matches uniquely", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            p0: {
              media: [
                {
                  id: 1,
                  type: "ANIME",
                  title: { romaji: "Frieren", userPreferred: "Frieren" },
                  synonyms: ["Sousou no Frieren"],
                  genres: [],
                  coverImage: { large: "https://img.example/f.jpg" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const items = await searchAniList("Frieren", {
      endpoint: "https://anilist.test",
      fetch: fetcher,
      now: 1,
    });
    expect(
      matchAniList({ aliases: ["Sousou no Frieren"], type: "ANIME" }, items)
        ?.media.id,
    ).toBe(1);
    const body = String(fetcher.mock.calls[0][1]?.body);
    expect(body).not.toContain("tags");
    expect(body).not.toContain("streamingEpisodes");
    expect(body).not.toContain("bannerImage color siteUrl");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not accept an unrelated first AniList result", () => {
    const item = (id: number, title: string) => ({ id, type: "ANIME", title: { userPreferred: title }, synonyms: [], genres: [], tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [] });
    expect(matchAniList({ aliases: ["Re:Monster"], type: "ANIME" }, [item(1, "Digimon Universe: Appli Monsters") as any, item(2, "Monster") as any, item(3, "Remonster") as any])?.media.id).toBe(3);
  });
  it("coalesces simultaneous title searches into one HTTP request", async () => {
    const media = (id: number, title: string) => ({
      id,
      type: "MANGA",
      title: { romaji: title, userPreferred: title },
      synonyms: [],
      genres: [],
      coverImage: { large: `https://img.example/${id}.jpg` },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            p0: { media: [media(2, "Alpha")] },
            p1: { media: [media(3, "Beta")] },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const [alpha, beta] = await Promise.all([
      searchAniList("Alpha", {
        endpoint: "https://anilist.batch.test",
        fetch: fetcher,
        now: 100,
      }),
      searchAniList("Beta", {
        endpoint: "https://anilist.batch.test",
        fetch: fetcher,
        now: 100,
      }),
    ]);
    expect(alpha[0]?.id).toBe(2);
    expect(beta[0]?.id).toBe(3);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("can force a fresh observed request for every manual audit lookup", async () => {
    const payload = { data: { p0: { media: [] } } };
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await searchAniList("Audit Cache Probe", {
      endpoint: "https://anilist.audit.test",
      fetch: fetcher,
      cache: false,
    });
    await searchAniList("Audit Cache Probe", {
      endpoint: "https://anilist.audit.test",
      fetch: fetcher,
      cache: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("coalesces known AniList IDs through Page id_in", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Page: {
              media: [
                {
                  id: 101,
                  type: "MANGA",
                  title: { romaji: "Known One" },
                  synonyms: [],
                  genres: [],
                  coverImage: { large: "https://img.example/101.jpg" },
                },
                {
                  id: 102,
                  type: "MANGA",
                  title: { romaji: "Known Two" },
                  synonyms: [],
                  genres: [],
                  coverImage: { large: "https://img.example/102.jpg" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const [one, two] = await Promise.all([
      fetchAniList(101, {
        endpoint: "https://anilist.ids.test",
        fetch: fetcher,
      }),
      fetchAniList(102, {
        endpoint: "https://anilist.ids.test",
        fetch: fetcher,
      }),
    ]);
    expect(one.id).toBe(101);
    expect(two.id).toBe(102);
    const body = String(fetcher.mock.calls[0][1]?.body);
    expect(body).toContain("id_in");
    expect(body).toContain("tags");
    expect(body).toContain("streamingEpisodes");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("batches 50 AniList IDs per GraphQL request", async () => {
    const fetcher = vi.fn(async (_input, init) => {
      const ids = JSON.parse(String(init?.body)).variables.ids as number[];
      return new Response(
        JSON.stringify({
          data: {
            Page: {
              media: ids.map((id) => ({
                id,
                type: "MANGA",
                title: { romaji: `Title ${id}` },
                synonyms: [],
                genres: [],
              })),
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const hooks = { beforeRequest: async () => async () => {} };
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        fetchAniList(1000 + index, { fetch: fetcher, hooks, cache: false }),
      ),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    await Promise.all(
      Array.from({ length: 51 }, (_, index) =>
        fetchAniList(2000 + index, { fetch: fetcher, hooks, cache: false }),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("releases the current slot and retries after AniList HTTP 429", async () => {
    const release = vi.fn(async () => {});
    const beforeRequest = vi.fn(async () => release);
    const onRateLimit = vi.fn(async () => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "0.01" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              Page: {
                media: [
                  {
                    id: 9090,
                    type: "ANIME",
                    title: { romaji: "Retry" },
                    synonyms: [],
                    genres: [],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const started = Date.now();
    await fetchAniList(9090, {
      fetch: fetcher,
      hooks: { beforeRequest, onRateLimit },
      cache: false,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(8);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(onRateLimit).toHaveBeenCalledOnce();
  });
  it("parses the global MangaUpdates release feed and matches multilingual titles", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          releases: [
            {
              series_id: 42,
              series_title: "나 혼자만 레벨업",
              chapter: "201",
              release_date: "2026-08-03",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const releases = await fetchMangaUpdatesReleases({
      endpoint: "https://mu.test/v1",
      fetch: fetcher,
    });
    expect(releases[0]).toMatchObject({ seriesId: "42", chapter: "201" });
    expect(
      matchMangaUpdates(
        {
          aliases: [
            "Solo Leveling",
            "俺だけレベルアップな件",
            "나 혼자만 레벨업",
          ],
        },
        [{ id: "42", title: "Solo Leveling", titles: ["나 혼자만 레벨업"], image: "https://img.example/solo.jpg" }],
      )?.series.id,
    ).toBe("42");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
    });
  });
  it("scores every result and rejects dead records and novels", () => {
    const results = [
      { id: "47749967463", title: "Wrong result", type: "Manga" as const },
      { id: "novel", title: "The Beginning", type: "Light Novel", image: "https://img/novel.jpg" },
      { id: "24277219018", title: "The Beginning", type: "Manhwa", image: "https://img/good.jpg", description: "A series", latestChapter: "0" },
    ];
    expect(resolveMangaUpdatesSeries(["The Beginning"], results)?.id).toBe("24277219018");
    expect(resolveMangaUpdatesSeries(["The Beginning"], [...results].reverse())?.id).toBe("24277219018");
    expect(matchMangaUpdates({ aliases: ["The Beginning"] }, results)?.series.id).toBe("24277219018");
  });

  it("uses all aliases, including a later alias, and does not reject chapter zero with identity", () => {
    const zeroChapter = { id: "1", title: "Preferred title", type: "Manga", image: "https://img/cover.jpg", latestChapter: "0" };
    expect(isDeadMangaUpdatesSeries(zeroChapter)).toBe(false);
    expect(resolveMangaUpdatesSeries(["Source label", "Preferred title"], [zeroChapter])?.id).toBe("1");
  });

  it("rejects genuinely dead MangaUpdates records", () => {
    expect(isDeadMangaUpdatesSeries({ id: "dead", title: "Dead record" })).toBe(true);
    expect(resolveMangaUpdatesSeries(["Dead record"], [{ id: "dead", title: "Dead record" }])).toBeNull();
  });
  it("excludes only the exact catalogue utility path", () => {
    expect(sourceDispositionFromUrl("https://anime-sama.fr/catalogue")).toEqual(
      { status: "excluded", reason: "UTILITY_PAGE" },
    );
    expect(
      sourceDispositionFromUrl("https://anime-sama.fr/catalogue/index.php?page=11"),
    ).toEqual({ status: "excluded", reason: "UTILITY_PAGE" });
    expect(
      sourceIdentityFromUrl("https://anime-sama.fr/catalogue/frieren"),
    ).toMatchObject({ title: "Frieren" });
  });
  it("parses MangaUpdates result records and associated multilingual titles", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              record: {
                id: 77,
                title: "Kami ni Aisareta Ko",
                type: "Manhwa",
                associated: [
                  { title: "신에게 사랑받은 아이" },
                  { title: { ja: "神に愛された子" } },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const series = await (
      await import("./index.js")
    ).searchMangaUpdatesSeries("Kami ni Aisareta Ko", {
      endpoint: "https://mu.record.test/v1",
      fetch: fetcher,
    });
    expect(series[0]).toMatchObject({ id: "77", title: "Kami ni Aisareta Ko" });
    expect(series[0]?.titles).toEqual(
      expect.arrayContaining(["신에게 사랑받은 아이", "神に愛された子"]),
    );
    expect(series[0]?.titles).not.toContain("ja");
    expect(matchMangaUpdates(
      { aliases: ["Titre français"], type: "MANHWA" },
      [{ id: "78", title: "Titre anglais", titles: ["Titre français"], type: "Manhwa", image: "https://img.example/mu.jpg" }],
    )?.series.id).toBe("78");
  });
  it("keeps compact and normalized variants for multi-signal searches", () =>
    expect(titleVariants(["Café — Blue Sky"])).toEqual(
      expect.arrayContaining([
        "Café — Blue Sky",
        "cafe blue sky",
        "cafebluesky",
      ]),
    ));
});
