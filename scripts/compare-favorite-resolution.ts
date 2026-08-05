import { readFileSync } from "node:fs";
import { matchAniList, prepareTitleCandidates, sourceIdentityFromUrl, titleVariants } from "@favlib/metadata";

type Favorite = { id: string; title: string; url: string; providerTitles?: string[] };

const fixture = JSON.parse(readFileSync(new URL("../fixtures/bookmarks/wave-0.synthetic.json", import.meta.url), "utf8"));
const favorites: Favorite[] = fixture.cases
  .filter((item: any) => item.expectedMediaHint)
  .map((item: any) => ({ id: item.id, title: item.title, url: item.url }));

// These two cases represent provider observations seen during the old
// candidate-discovery fallback. They are deliberately labelled as external
// observations, not as source aliases or persisted favorite data.
favorites.push(
  { id: "regression-isekai", title: "Isekai Ojisan", url: "https://fixture-anime.test/anime/isekaiojisan", providerTitles: ["Isekai Oji-san"] },
  { id: "regression-dragon", title: "Good Bye, Dragon Life, Hello Human Life", url: "https://fixture-anime.test/anime/goodbye-dragon-life", providerTitles: ["Sayonara Ryuusei, Konnichiwa Jinsei"] },
);

function unique(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
function queryVariants(values: string[]) { return titleVariants(values).filter((value) => value.length > 2); }

const report = favorites.map((favorite) => {
  const source = sourceIdentityFromUrl(favorite.url);
  const prepared = prepareTitleCandidates({ bookmarkTitle: favorite.title, url: favorite.url, source });
  const localAliases = unique([source?.title ?? "", prepared.personal ?? ""]);
  const beforeAliases = unique([...localAliases, ...(favorite.providerTitles ?? [])]);
  const beforeQueries = queryVariants(beforeAliases);
  const afterQueries = queryVariants(localAliases);
  const afterDiscoveryQueries = unique([...afterQueries, ...queryVariants(favorite.providerTitles ?? [])]);
  return {
    id: favorite.id,
    favoriteTitle: favorite.title,
    url: favorite.url,
    slug: source?.slug ?? null,
    parsedSourceTitle: source?.title ?? null,
    parsedPersonalTitle: prepared.personal ?? null,
    before: {
      aliases: beforeAliases,
      queries: beforeQueries,
      providerObservationUsedAsQuery: (favorite.providerTitles ?? []).some((title) => beforeQueries.includes(title)),
    },
    after: {
      aliases: localAliases,
      queries: afterQueries,
      discoveryQueries: afterDiscoveryQueries,
      providerObservationUsedAsQuery: (favorite.providerTitles ?? []).some((title) => afterDiscoveryQueries.includes(title)),
    },
    changed: JSON.stringify(beforeQueries) !== JSON.stringify(afterQueries),
  };
});

const checks: Array<{ stage: string; passed: boolean; detail: string }> = [];
const check = (stage: string, passed: boolean, detail: string) => checks.push({ stage, passed, detail });

// Stage 1: URL parser and bookmark preparation must produce a usable source
// identity and preserve the personal title separately.
check("01-parser", report.filter((item) => item.slug && item.parsedSourceTitle).length === report.length,
  `${report.filter((item) => item.slug && item.parsedSourceTitle).length}/${report.length} favoris ont un slug et un titre source`);
check("01-parser-personal", report.filter((item) => item.parsedPersonalTitle).length === report.length,
  `${report.filter((item) => item.parsedPersonalTitle).length}/${report.length} favoris conservent un titre personnel`);

// Stage 2: provider observations may be compared, but must not enter the new
// local alias set.
const providerLeak = report.filter((item) => {
  const favorite = favorites.find((candidate) => candidate.id === item.id);
  return (favorite?.providerTitles ?? []).some((title) => item.after.aliases.includes(title));
});
check("02-provenance", providerLeak.length === 0, providerLeak.length ? `${providerLeak.length} fuite(s) d’alias fournisseur` : "aucune observation fournisseur dans les alias locaux");

// Stage 3: the before/after query plan is observable and bounded.
const changed = report.filter((item) => item.changed);
check("03-query-plan", report.every((item) => item.after.discoveryQueries.length <= 48), `${Math.max(...report.map((item) => item.after.discoveryQueries.length))} requêtes logiques maximum dans le corpus`);
check("03-regression-signal", changed.some((item) => item.id === "regression-dragon" && item.after.providerObservationUsedAsQuery), "le cas de découverte secondaire reste couvert après séparation de provenance");

// Stage 4: detached provider responses exercise the current matching contract.
const isekai = { id: 1, type: "ANIME" as const, title: { userPreferred: "Isekai Oji-san" }, synonyms: [], genres: [], tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [] };
const manga = { ...isekai, id: 2, type: "MANGA" as const };
check("04-exact-compact", matchAniList({ aliases: ["Isekai Ojisan"], type: "ANIME" }, [isekai]).media.id === 1, "Isekai Ojisan ↔ Isekai Oji-san");
check("04-type", matchAniList({ aliases: ["Isekai Ojisan"], type: "ANIME" }, [manga]) === null, "un candidat manga n’est pas accepté pour un anime");
check("04-low-confidence", matchAniList({ aliases: ["Good Bye Dragon Life"], type: "ANIME" }, [{ ...isekai, id: 3, title: { userPreferred: "Sayonara Ryuusei Konnichiwa Jinsei" } }]) === null, "un titre seulement ressemblant reste non résolu");

// Stage 5: the old fallback can discover a provider title, but this remains a
// query hint only; it is never promoted to source/personal provenance.
const dragon = report.find((item) => item.id === "regression-dragon");
check("05-observation-fallback", Boolean(dragon?.before.providerObservationUsedAsQuery) && Boolean(dragon?.after.providerObservationUsedAsQuery) && !dragon?.after.aliases.includes("Sayonara Ryuusei, Konnichiwa Jinsei"),
  "le fallback est conservé comme hint sans devenir alias local");

const passed = checks.filter((item) => item.passed).length;
for (const item of checks) console.log(`[${item.passed ? "PASS" : "FAIL"}] ${item.stage}: ${item.detail}`);
if (passed !== checks.length) process.exitCode = 1;

console.log(JSON.stringify({
  purpose: "Detached before/after comparison; providerTitles are observations only",
  count: report.length,
  changedCount: report.filter((item) => item.changed).length,
  stages: { passed, total: checks.length },
  cases: report,
}, null, 2));
