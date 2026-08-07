import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { manualAuditEnvironment } from "../packages/config/src/index.ts";
import { createDatabase } from "../packages/database/src/index.ts";
import {
  fetchAniList,
  fetchMangaUpdatesSeries,
  matchAniList,
  matchMangaUpdates,
  searchAniList,
  searchMangaUpdatesSeries,
  type SearchClient,
} from "../packages/metadata/src/index.ts";

type Target = {
  id: string;
  type: string;
  aliases: string[];
  mangaupdatesId?: string;
  anilistId?: string;
};
type HttpObservation = {
  method: string;
  endpoint: string;
  status: string;
  mime: string;
  error?: string;
};
type Check = {
  id: string;
  type: string;
  title: string;
  provider: string;
  operation: string;
  outcome: string;
  candidate: string;
  observations: HttpObservation[];
  imageUrl?: string;
  imageResult?: string;
  error?: string;
};
type Fingerprint = { count: number; sha256: string };

const startedAt = new Date();
const environment = manualAuditEnvironment();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(
  repositoryRoot,
  environment.auditOutput ??
    `.runtime/audits/missing-covers-live-api-${startedAt.toISOString().replace(/[:.]/g, "-")}.md`,
);
const max = environment.auditLimit;
const muOptions = {};
const fingerprintGroups = {
  comptes: ["app_user", "user_session", "invitation", "password_reset_token"],
  favoris: [
    "bookmark_import_batch",
    "bookmark_import_item",
    "bookmark_media_link",
    "approved_site",
    "favorite_update_log",
    "favorite_update_proposal",
    "extension_preference",
  ],
  progression: ["progression_observation", "favorite_progress"],
  appareils: [
    "extension_device",
    "pairing_challenge",
    "reconciliation_cursor",
    "extension_metadata_receipt",
  ],
  couvertures: ["media_cover", "media_banner"],
  assets: ["catalog_image_asset"],
} as const;
const escaped = (value: unknown) =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

function observedClient(log: HttpObservation[]): SearchClient {
  return async (input, init = {}) => {
    const endpoint = new URL(input as string | URL).toString();
    const method = init.method ?? "GET";
    try {
      const response = await fetch(input, init);
      log.push({
        method,
        endpoint,
        status: String(response.status),
        mime: response.headers.get("content-type")?.split(";")[0] ?? "ABSENT",
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.push({
        method,
        endpoint,
        status: "NETWORK_ERROR",
        mime: "ABSENT",
        error: message,
      });
      throw error;
    }
  };
}

async function imageProbe(
  url: string | undefined,
): Promise<{ result: string; observation?: HttpObservation }> {
  if (!url) return { result: "ABSENT" };
  const observation: HttpObservation = {
    method: "GET",
    endpoint: url,
    status: "",
    mime: "",
  };
  try {
    const response = await fetch(url, {
      headers: {
        range: "bytes=0-0",
        "user-agent": "FavLib/manual-cover-audit-v2",
      },
      signal: AbortSignal.timeout(10_000),
    });
    observation.status = String(response.status);
    observation.mime =
      response.headers.get("content-type")?.split(";")[0] ?? "ABSENT";
    await response.body?.cancel();
    const valid = response.ok && observation.mime.startsWith("image/");
    return {
      result: `${valid ? "VALID" : "INVALID"} HTTP ${observation.status} ${observation.mime}`,
      observation,
    };
  } catch (error) {
    observation.status = "NETWORK_ERROR";
    observation.mime = "ABSENT";
    observation.error = error instanceof Error ? error.message : String(error);
    return { result: `ERROR ${observation.error}`, observation };
  }
}

async function fingerprints(
  databaseUrl: string,
): Promise<Record<string, Fingerprint>> {
  const { pool } = createDatabase(databaseUrl);
  const result: Record<string, Fingerprint> = {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    for (const [group, tables] of Object.entries(fingerprintGroups)) {
      const hash = createHash("sha256");
      let count = 0;
      for (const table of tables) {
        const rows = await client.query(
          `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
        );
        hash.update(`${table}\n`);
        count += rows.rowCount ?? 0;
        for (const row of rows.rows)
          hash.update(`${JSON.stringify(row.row)}\n`);
      }
      result[group] = { count, sha256: hash.digest("hex") };
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  return result;
}

async function loadTargets(databaseUrl: string) {
  const { pool } = createDatabase(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const rows = await client.query<Target>(`WITH targets AS (
      SELECT DISTINCT m.id,m.type FROM media m
      JOIN bookmark_media_link b ON b.media_id=m.id
      LEFT JOIN media_cover c ON c.media_id=m.id AND c.status='ACTIVE'
      WHERE b.status IN ('matched','accepted') AND c.media_id IS NULL
    ) SELECT t.id,t.type,COALESCE((SELECT array_agg(q.text ORDER BY q.priority,q.id) FROM (
        SELECT DISTINCT ON (lower(mt.normalized_text)) mt.text,mt.id,
          CASE WHEN mt.kind='source' THEN 0 WHEN mt.kind='official' THEN 1
               WHEN mt.connector='mangaupdates' OR mt.kind='supplier' THEN 2
               WHEN mt.kind='synonym' THEN 3 ELSE 4 END AS priority
        FROM media_title mt WHERE mt.media_id=t.id AND mt.kind<>'personal'
        ORDER BY lower(mt.normalized_text),priority,mt.id
      ) q),'{}'::text[]) AS aliases,
      max(e.external_id) FILTER (WHERE e.provider='mangaupdates') AS "mangaupdatesId",
      max(e.external_id) FILTER (WHERE e.provider='anilist') AS "anilistId"
    FROM targets t LEFT JOIN media_external_id e ON e.media_id=t.id
    GROUP BY t.id,t.type ORDER BY t.type,t.id`);
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const before = await fingerprints(environment.databaseUrl);
  const rows = await loadTargets(environment.databaseUrl);
  const targets = (max > 0 ? rows.rows.slice(0, max) : rows.rows).map(
    (row) => ({ ...row, aliases: (row.aliases ?? []).filter(Boolean) }),
  );
  const checks: Check[] = [];
  for (const [index, target] of targets.entries()) {
    const title = target.aliases[0] ?? target.id;
    process.stdout.write(
      `[${index + 1}/${targets.length}] ${target.type} ${title.slice(0, 80)}\n`,
    );
    let aliases = [...target.aliases];
    if (target.type !== "ANIME") {
      const observations: HttpObservation[] = [];
      try {
        if (target.mangaupdatesId) {
          const series = await fetchMangaUpdatesSeries(target.mangaupdatesId, {
            ...muOptions,
            fetch: observedClient(observations),
          });
          aliases = [
            ...new Set(
              [
                aliases[0] ?? "",
                series.title ?? "",
                ...series.titles,
                ...aliases.slice(1),
              ].filter(Boolean),
            ),
          ];
          checks.push({
            id: target.id,
            type: target.type,
            title,
            provider: "MangaUpdates",
            operation: "identity fetch",
            outcome: "EXTERNAL_ID_CONFIRMED",
            candidate: series.id,
            observations,
          });
        } else {
          let found = [];
          for (const alias of aliases) {
            found = await searchMangaUpdatesSeries(alias, {
              ...muOptions,
              fetch: observedClient(observations),
            });
            if (found.length) break;
          }
          const match = matchMangaUpdates(
            { aliases, type: target.type },
            found,
          );
          if (match)
            aliases = [
              ...new Set([
                aliases[0] ?? "",
                match.displayTitle,
                ...match.titles,
                ...aliases.slice(1),
              ]),
            ];
          checks.push({
            id: target.id,
            type: target.type,
            title,
            provider: "MangaUpdates",
            operation: "identity search",
            outcome: match ? "IDENTITY_CANDIDATE" : "NO_RESULT",
            candidate: match?.series.id ?? "NONE",
            observations,
          });
        }
      } catch (error) {
        checks.push({
          id: target.id,
          type: target.type,
          title,
          provider: "MangaUpdates",
          operation: target.mangaupdatesId
            ? "identity fetch"
            : "identity search",
          outcome: "API_ERROR",
          candidate: "NONE",
          observations,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const observations: HttpObservation[] = [];
    try {
      let match;
      if (target.anilistId && Number.isInteger(Number(target.anilistId))) {
        const full = await fetchAniList(Number(target.anilistId), {
          fetch: observedClient(observations),
          cache: false,
        });
        match = { media: full };
      } else {
        let found = [];
        for (const alias of aliases) {
          found = await searchAniList(alias, {
            type: target.type === "ANIME" ? "ANIME" : "MANGA",
            fetch: observedClient(observations),
            cache: false,
          });
          if (found.length) break;
        }
        match =
          matchAniList({ aliases, type: target.type }, found) ?? undefined;
      }
      if (!match)
        checks.push({
          id: target.id,
          type: target.type,
          title,
          provider: "AniList",
          operation: "image lookup",
          outcome: "NO_RESULT",
          candidate: "NONE",
          observations,
        });
      else {
        const full = match.media;
        const probe = await imageProbe(full.coverImage);
        if (probe.observation) observations.push(probe.observation);
        checks.push({
          id: target.id,
          type: target.type,
          title,
          provider: "AniList",
          operation: "image lookup",
          outcome: full.coverImage ? "COVER_FOUND" : "MATCH_WITHOUT_COVER",
          candidate: String(full.id),
          observations,
          imageUrl: full.coverImage,
          imageResult: probe.result,
        });
      }
    } catch (error) {
      checks.push({
        id: target.id,
        type: target.type,
        title,
        provider: "AniList",
        operation: "image lookup",
        outcome: "API_ERROR",
        candidate: "NONE",
        observations,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const after = await fingerprints(environment.databaseUrl);
  const invariant = Object.keys(before)
    .filter((group) => group !== "appareils")
    .every(
      (group) => JSON.stringify(before[group]) === JSON.stringify(after[group]),
    );
  const groups = [
    ...new Map(
      checks.map((x) => [
        `${x.provider}:${x.outcome}`,
        checks.filter(
          (y) => y.provider === x.provider && y.outcome === x.outcome,
        ).length,
      ]),
    ).entries(),
  ].sort();
  const lines = [
    "# Test réel des API — favoris sans couverture",
    "",
    `- Début : ${startedAt.toISOString()}`,
    `- Fin : ${new Date().toISOString()}`,
    `- Périmètre SQL observé : ${rows.rowCount} œuvres ; testées : ${targets.length} (${rows.rowCount === targets.length ? "100 %" : "PARTIEL"})`,
    "- Transactions SQL : `BEGIN READ ONLY` ; aucune association automatique",
    "- MangaUpdates : identité seulement ; AniList : fournisseur unique des images",
    "- MangaUpdates : accès public utilisé pour ce passage",
    `- Gate de non-mutation avant/après (hors appareils concurrents) : **${invariant ? "VERT" : "ROUGE"}**`,
    "- Les empreintes appareils restent informatives : une synchronisation utilisateur concurrente peut légitimement les modifier.",
    "",
    "## Empreintes de non-mutation",
    "",
    "| Groupe | Lignes avant | SHA-256 avant | Lignes après | SHA-256 après | Résultat |",
    "|---|---:|---|---:|---|---|",
    ...Object.keys(before).map(
      (k) =>
        `| ${k} | ${before[k].count} | \`${before[k].sha256}\` | ${after[k].count} | \`${after[k].sha256}\` | ${JSON.stringify(before[k]) === JSON.stringify(after[k]) ? "IDENTIQUE" : "MUTATION"} |`,
    ),
    "",
    "## Résultats agrégés",
    "",
    ...groups.map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Preuves par œuvre",
    "",
    "| Média | Type | Titre testé | API/opération | Résultat | Candidat | Image AniList | Erreur |",
    "|---|---|---|---|---|---|---|---|",
    ...checks.map(
      (x) =>
        `| ${escaped(x.id)} | ${escaped(x.type)} | ${escaped(x.title)} | ${escaped(`${x.provider} — ${x.operation}`)} | ${escaped(x.outcome)} | ${escaped(x.candidate)} | ${escaped(x.imageResult)} | ${escaped(x.error)} |`,
    ),
    "",
    "## Journal HTTP observé",
    "",
    "| Média | Fournisseur | Méthode | Endpoint | HTTP | MIME | Erreur |",
    "|---|---|---|---|---:|---|---|",
    ...checks.flatMap((x) =>
      x.observations.map(
        (o) =>
          `| ${escaped(x.id)} | ${escaped(x.provider)} | ${escaped(o.method)} | ${escaped(o.endpoint)} | ${escaped(o.status)} | ${escaped(o.mime)} | ${escaped(o.error)} |`,
      ),
    ),
    "",
    "> Rapport privé : il contient des titres issus des favoris réels et ne doit pas être versionné.",
  ];
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, lines.join("\n"), "utf8");
  console.log(`REPORT=${output}`);
  console.log(`SCOPE=${targets.length}/${rows.rowCount}`);
  console.log(`INVARIANT=${invariant}`);
  console.log(groups.map(([k, v]) => `${k}=${v}`).join("\n"));
  if (!invariant) process.exitCode = 2;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
