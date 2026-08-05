import { readFileSync } from "node:fs";
import { prepareTitleCandidates, sourceIdentityFromUrl, titleVariants } from "@favlib/metadata";

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
      providerObservationUsedAsQuery: (favorite.providerTitles ?? []).some((title) => afterQueries.includes(title)),
    },
    changed: JSON.stringify(beforeQueries) !== JSON.stringify(afterQueries),
  };
});

console.log(JSON.stringify({
  purpose: "Detached before/after comparison; providerTitles are observations only",
  count: report.length,
  changedCount: report.filter((item) => item.changed).length,
  cases: report,
}, null, 2));
