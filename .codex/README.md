# Template governance

`.project/project-config.json` is the single source for project decisions,
source directories, code extensions, contracts, and commands.

While the project status is `template`, its `starter` paths are also a
completeness manifest: every declared infrastructure root and root file must
exist. Derived projects may revise that manifest during approved initialization
and cleanup.

`.codex/architecture-policy.json` only locates that configuration and declares
allowed states. CTXRoute keeps its rule corpus under `.claude/hooks/docs/` and
resolves it only through explicit bounded MCP/CLI queries. Lifecycle hooks do
not inject that corpus for each tool call.

```text
flowchart TD
    Session[SessionStart] --> Mission[Targeted worker mission when present]
    Request[Requested action] --> PreTool[PreToolUse dispatcher]
    PreTool --> Governance[Governance policy]
    Governance -->|allow| Edit[Authorized action]
    Governance -->|block| Refusal[Immediate refusal with reason]
    Edit --> PostTool[PostToolUse dispatcher]
    PostTool --> Sensor[Blocking Sensor]
    Sensor --> Audit[Local change audit]
    Audit --> Index[Git index]
    Index --> PreCommit[Authoritative pre-commit]
    PreCommit --> Architecture[Architecture and ADR checks]
    PreCommit --> Documentation[Links, placeholders, and Archify]
    PreCommit --> Quality[Targeted mutation testing when configured]
    Architecture --> PrePush[Pre-push]
    Documentation --> PrePush
    Quality --> PrePush
    PrePush --> Commands[Complete project commands]
    Commands --> Stop[Fail-open Stop review]
    Prompt[UserPromptSubmit] --> Observe[Passive problem observation]
    Compact[PreCompact] --> Reset[CTXRoute reset]
    Query[Explicit context request] --> Route[Bounded CTXRoute lookup]
```

PreToolUse provides immediate feedback. Git hooks remain authoritative because
they inspect the index and capture files produced by commands or external tools.
The registered lifecycle handlers intentionally omit custom status messages.
Read-only tools skip the architecture subprocess, and PostToolUse is limited to
mutation-capable tools to reduce lifecycle noise and process startup overhead.

The lifecycle is independent from the two project-scoped MCP servers declared
in `.codex/config.toml`: `ctxroute-orchestrator` and `code-review-graph` are
started by the Codex client over stdio. No PostToolUse handler starts or proxies
an MCP transport. The orchestrator also supplies an emergency CLI and explicit
CTXRoute lookup; `SWARM_OFF` requires neither interface for ordinary work. A
trusted project and a refreshed Codex session may be needed before `/mcp` shows
a newly added manifest.

CRG's `apply_refactor_tool` is permitted only for `dry_run: true`. Normal edit
tools own accepted mutations so architecture, Sensor, and audit enforcement
cannot be bypassed.
