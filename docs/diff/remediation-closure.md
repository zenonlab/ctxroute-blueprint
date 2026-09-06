# V2 remediation closure

This matrix links the historical R-01…R-20 observations to the V2 delivery
scope and its executable evidence. Commit references use the coherent commit
subject so they remain stable across rebases; the release handoff records the
final hashes and command results. `PASS` means the cited behavior is exercised
by the repository gate, while `LIMITATION ACCEPTED` is an explicit boundary,
not an implementation claim.

| Risk | Commit scope | Executable evidence | Required result |
| --- | --- | --- | --- |
| R-01 | `feat(orchestrator): implement transactional v2 core` | Contract/replay cases in `tests/orchestrator-core.test.mjs` | PASS: any full-payload difference rejects before effects; identical replay converges |
| R-02 | `feat(orchestrator): add strict v2 contracts` | `npm run orchestrator:contracts` and state load fixtures | PASS: malformed, unknown-field, secret-bearing, corrupt, and unknown-version state rejects |
| R-03 | `feat(orchestrator): harden skill registration` | skill registration negative matrix plus `npm run skills:verify` | PASS: artifact, digest, validation receipt, and accepted blueprint audit are mandatory |
| R-04 | `feat(orchestrator): implement recoverable worktrees` | HOOTL crash points around intent, Git creation, and finalization | PASS: `PENDING` resumes to one converged allocation |
| R-05 | `feat(orchestrator): implement recoverable worktrees` | clean/dirty/orphan reconciliation fixtures | PASS: only clean terminal worktrees auto-remove; ambiguity becomes `NEEDS_ATTENTION` |
| R-06 | `feat(orchestrator): implement transactional v2 core` | live/dead/token-changed lock and timeout fixtures | PASS: live locks remain; only unchanged dead stale owners are reclaimed |
| R-07 | `docs(governance): align v2 policy and evidence` | `npm run validate:docs -- --all` and ADR-0027 | LIMITATION ACCEPTED: cooperative local policy boundary; no hostile-process sandbox claim |
| R-08 | `feat(orchestrator): execute structured validations` | exact argv, no-shell, timeout, nonzero, redaction, and missing-validation cases | PASS: worker claims cannot complete a mission without an orchestrator receipt |
| R-09 | `feat(orchestrator): add strict v2 contracts` | exhaustive goal and mission transition table | PASS: illegal and terminal-state transitions reject |
| R-10 | `feat(orchestrator): implement v2 mission routing` | environment/state/default plus direct/coordinated/auto cases | PASS: precedence and `mode_source` are exact; environment `SWARM_OFF` is direct |
| R-11 | `feat(orchestrator): harden session audit` | outside-root, symlink, active/self trace, file-count and redaction fixtures | PASS: only approved regular inactive traces are read |
| R-12 | `feat(orchestrator): add strict v2 contracts` | deep key/value/diagnostic secret matrix and telemetry scan | PASS: sensitive content rejects or is redacted before persistence |
| R-13 | `feat(orchestrator): implement recoverable worktrees` | injected free-space floor cases | PASS: allocation blocks categorically below the configured floor |
| R-14 | `test(orchestrator): add deterministic HOOTL bench` | injected crash windows and Node child-process barrier races | PASS: zero network/LLM, deterministic convergence, one revision winner |
| R-15 | `docs(governance): align v2 policy and evidence` | `npm run validate:docs -- --all` and `npm run check:coherence` | PASS: active docs expose stdio/CLI/local files only and describe the exact CI matrix |
| R-16 | `docs(governance): align v2 policy and evidence` | `npm run validate:decisions` and duplicate-ID negative test | PASS: numeric IDs are unique; supersession targets must exist; historical dashboard ADR is archived |
| R-17 | `docs(governance): align v2 policy and evidence` | `tests/ci-security.test.mjs` and `npm run check:coherence` | PASS: `fail-on-risk: high` and the `CRG risk gate` name are enforced |
| R-18 | `feat(orchestrator): add bounded decision telemetry` | transition coverage, monotone sequence, byte rotation, redaction, and write-failure fixtures | PASS: categorical events are complete; telemetry failure cannot corrupt state |
| R-19 | `feat(orchestrator): implement transactional v2 core` | injected temp/write/fsync/rename failures and reload after every crash point | PASS with platform limitation: file and supported directory sync occur; unsupported directory sync is explicit |
| R-20 | `feat(orchestrator): implement recoverable worktrees` | traversal, symlink, case collision, actual out-of-scope diff, and managed-root fixtures | PASS: canonical no-follow scope checks honor repository case behavior |

## Release gate

Closure requires all cited targeted suites plus:

```sh
npm run hooks:performance
npm run validate:docs -- --all
npm run validate:decisions
npm run blueprint:review
npm run crg:smoke
npm run integration
npm run verify
git diff --check
```

The final source scan must also confirm that orchestration and HOOTL introduced
no HTTP, Kubernetes, daemon, canary, LLM, or network dependency. Hosted CI and
branch-protection behavior still require a real GitHub run and repository
settings inspection; local `PASS` cannot establish either.
