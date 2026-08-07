#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

for command_name in git rg jq ruby shasum awk find; do
  command -v "$command_name" >/dev/null || {
    printf 'Commande requise absente: %s\n' "$command_name" >&2
    exit 1
  }
done

git diff --check

while IFS= read -r -d '' fixture_file; do
  if [[ "$fixture_file" == *.json ]]; then
    jq empty "$fixture_file"
  else
    line_number=0
    while IFS= read -r fixture_line || [[ -n "$fixture_line" ]]; do
      line_number=$((line_number + 1))
      [[ -z "$fixture_line" ]] || jq -e . >/dev/null <<<"$fixture_line" || {
        printf 'NDJSON invalide: %s:%s\n' "$fixture_file" "$line_number" >&2
        exit 1
      }
    done < "$fixture_file"
  fi
done < <(find fixtures -type f \( -name '*.json' -o -name '*.ndjson' -o -name '*.jsonl' \) -print0)

dataset_file="fixtures/catalog/wave-0.dataset-records.ndjson"
manifest_file="fixtures/catalog/wave-0.dataset-manifest.json"
actual_sha="$(shasum -a 256 "$dataset_file" | awk '{print $1}')"
expected_sha="$(jq -r '.artifacts[0].sha256' "$manifest_file")"
actual_bytes="$(wc -c < "$dataset_file" | tr -d ' ')"
expected_bytes="$(jq -r '.artifacts[0].bytes' "$manifest_file")"
[[ "$actual_sha" == "$expected_sha" ]] || {
  printf 'Checksum dataset différent du manifest\n' >&2
  exit 1
}
[[ "$actual_bytes" == "$expected_bytes" ]] || {
  printf 'Taille dataset différente du manifest\n' >&2
  exit 1
}

scenario_file="fixtures/scenarios/wave-0.feature"
scenario_count="$(rg '^  Scenario:' "$scenario_file" | wc -l | tr -d ' ')"
[[ "$scenario_count" -gt 0 ]]
duplicate_scenarios="$(rg '^  Scenario:' "$scenario_file" | sed 's/^  Scenario: //' | sort | uniq -d)"
[[ -z "$duplicate_scenarios" ]] || {
  printf 'Scénarios dupliqués:\n%s\n' "$duplicate_scenarios" >&2
  exit 1
}
awk '
  /^  Scenario:/ {
    if (scenario != "" && (!given_step || !when_step || !then_step)) {
      print "Scénario incomplet: " scenario > "/dev/stderr"
      invalid=1
    }
    scenario=$0
    given_step=when_step=then_step=0
  }
  /^    Given / { given_step=1 }
  /^    When / { when_step=1 }
  /^    Then / { then_step=1 }
  END {
    if (scenario != "" && (!given_step || !when_step || !then_step)) {
      print "Scénario incomplet: " scenario > "/dev/stderr"
      invalid=1
    }
    exit invalid
  }
' "$scenario_file"

ruby <<'RUBY'
bad_links = []
markdown_files = Dir.glob('{README.md,CLAUDE.md,THIRD_PARTY_NOTICES.md,docs/**/*.md}')
markdown_files.each do |file|
  File.read(file).scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw_target|
    target = raw_target.strip
    next if target.match?(%r{^(https?://|mailto:|#)})

    target = target.split('#', 2).first.gsub('%20', ' ')
    next if target.empty?

    resolved = File.expand_path(target, File.dirname(file))
    bad_links << "#{file}: #{raw_target}" unless File.exist?(resolved)
  end
end
abort "Liens locaux invalides:\n#{bad_links.join("\n")}" unless bad_links.empty?
RUBY

for documentation_file in docs/[0-9][0-9]-*.md docs/VALIDATION-*.md; do
  documentation_name="${documentation_file#docs/}"
  rg -Fq "docs/$documentation_name" README.md || {
    printf 'Document absent de README.md: %s\n' "$documentation_file" >&2
    exit 1
  }
done

for adr_file in docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
  adr_name="${adr_file#docs/adr/}"
  rg -Fq "($adr_name)" docs/adr/README.md || {
    printf 'ADR absent de son index: %s\n' "$adr_file" >&2
    exit 1
  }
done

if rg -n '[[:blank:]]+$' README.md CLAUDE.md THIRD_PARTY_NOTICES.md docs fixtures scripts; then
  printf 'Espaces de fin de ligne détectés\n' >&2
  exit 1
fi

printf 'Documentation valide: %s scénarios historiques, dataset %s octets, sha256 %s\n' \
  "$scenario_count" "$actual_bytes" "$actual_sha"
