# External research

Research was limited to primary or first-party documentation relevant to this local blueprint. External sources support recommendations or analogies; they do not prove repository behavior. Access date: 2026-09-06.

## Evidence scale

- **Documented fact**: normative or official documentation about the named system.
- **Observed implementation**: public API/tool behavior documented by its publisher.
- **Recommendation**: application of a source to this blueprint.
- **Analogy**: conceptual parallel only.
- **Unconfirmed hypothesis**: insufficient evidence; excluded from conclusions.

## Sources

| Source | Short citation or supported claim | Classification | Evidence level / use here |
| --- | --- | --- | --- |
| [JSON Schema 2020-12 validation](https://json-schema.org/draft/2020-12/json-schema-validation) — JSON Schema project | “Validation keywords … impose requirements” on instances; `required` names mandatory properties. | Documented fact | High. Supports declarative local JSON contracts. It does not choose the repository validator. |
| [JSON Schema basics](https://json-schema.org/understanding-json-schema/basics) — JSON Schema project | `$schema` identifies the dialect and `$id` gives a stable schema identity. | Documented fact; recommendation | High. Use one stable, unversioned schema identity per current contract. |
| [OpenAPI Specification 3.1.2](https://spec.openapis.org/oas/v3.1.2.html) — OpenAPI Initiative | OAS is an interface description for HTTP APIs. | Documented fact; exclusion | High. No OpenAPI target while the blueprint has no HTTP API. JSON Schema remains usable independently. |
| [Kubernetes Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) — Kubernetes | Controllers move current state toward desired state and report observed state. | Documented fact; analogy | High. Inspires bounded worktree reconciliation only; does not justify Kubernetes or a resident controller. |
| [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) — Kubernetes | `resourceVersion` supports conflict detection and clients handle stale updates. | Documented fact; analogy | High. Comparable to the existing expected revision, not proof of equivalent transactions. |
| [Flux Kustomization](https://fluxcd.io/flux/components/kustomize/kustomizations/) — Flux project | Drift correction, retry interval, prune toggle, deletion policies and `force: false` are explicit controls. | Observed implementation; analogy | High. Supports separating reconcile, deletion policy and force; no GitOps runtime dependency proposed. |
| [OpenGitOps principles v1.0.0](https://github.com/open-gitops/documents/blob/v1.0.0/PRINCIPLES.md) — OpenGitOps | Desired state is declarative, versioned/immutable and continuously reconciled. | Documented fact; analogy | High. Only versioning and convergence are retained. Automatic pull/resident loops are out of scope. |
| [git-worktree](https://git-scm.com/docs/git-worktree) — Git project | Linked worktrees have separate checkout metadata but share repository data; `list`, `remove`, `prune`, `lock`, and `repair` cover distinct operations. | Documented fact | High. Proves Git isolation is not a security sandbox and supports an inspect-first reconciler. |
| [Git reset/restore/revert overview](https://git-scm.com/docs/git) and [git-revert](https://git-scm.com/docs/git-revert) — Git project | Revert records inverse history; restore affects files/index; reset moves refs and can discard work. | Documented fact; recommendation | High. “Rollback” must name the intended operation; destructive reset is not automatic cleanup. |
| [git-update-ref](https://git-scm.com/docs/git-update-ref) — Git project | Ref updates can verify an old OID and use transaction phases. | Documented fact; analogy | High for Git refs only. It does not make arbitrary state files transactional. |
| [Node.js test runner](https://nodejs.org/api/test.html) — Node.js project | Mock timers control time without waiting and make time-dependent tests predictable. | Observed implementation; recommendation | High. The repository supports Node 22; exact APIs must be checked against that supported version before implementation. |
| [Bazel Test Encyclopedia](https://bazel.build/reference/test-encyclopedia) — Bazel project | Hermetic tests control external dependencies and resource assumptions. | Documented fact; recommendation | High conceptually. Bazel adoption is not proposed. |
| [Hermetic Servers](https://testing.googleblog.com/2012/10/hermetic-servers.html) — Google Testing Blog | External network dependencies create nondeterminism; controlled local doubles improve repeatability. | Primary engineering publication; recommendation | Medium-high. Supports a zero-network HOOTL fixture, not a new framework. |
| [GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — GitHub | Permissions, timeouts, concurrency, maximum parallelism and failure behavior are explicit workflow controls. | Documented fact | High. Used to compare actual YAML, not infer unconfigured controls. |
| [GitHub Actions security guidance](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats) — GitHub | Declare minimum token permissions and pin third-party actions to full commit SHAs. | Documented fact; recommendation | High. The current workflows substantially implement both. |
| [Epsilon3 procedure execution primer](https://www.epsilon3.io/behind-the-console/what-is-a-procedure-execution-system) — Epsilon3 | The publisher describes versioned, role-guided procedures with sign-offs, evidence and an as-run record. | Publisher-documented claim; industry analogy | Medium. Commercial first-party content, not independent verification and not evidence about this repository. |
| [Epsilon3 API guide](https://docs.epsilon3.io/) — Epsilon3 | Public documentation exposes procedure states, revisions and role/permission concepts. | Observed public surface | Medium-high for the documented API only. No claim about backend transaction guarantees. |

No SpaceX claim is used. Epsilon3’s references to customers or employee backgrounds were not treated as proof of SpaceX practices. No source supports adding hardware simulation, a product canary, an HTTP framework, or a resident controller to this blueprint.

## Research limits

- Several official pages are living documentation without a stable publication date; the access date is recorded instead.
- Epsilon3 material is commercial first-party content and was not independently product-tested.
- Kubernetes, Flux and GitOps are analogies across different operational domains; only narrow principles are transferred.
- External research cannot establish local implementation. Repository facts and passing tests remain the higher-priority evidence for current behavior.
- Diminishing-return stop: every requested source family has primary coverage, the HTTP/non-HTTP boundary is resolved, and further vendor examples would not change the priorities.
