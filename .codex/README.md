# Template governance

`.project/project-config.json` is the single source for project decisions,
source directories, code extensions, contracts, and commands.

While the project status is `template`, its `starter` paths are also a
completeness manifest: every declared infrastructure root and root file must
exist. Derived projects may revise that manifest during approved initialization
and cleanup.

`.codex/architecture-policy.json` only locates that configuration and declares
allowed states. CTXRoute loads relevant rules from `.claude/hooks/docs/` through
the shared lifecycle dispatcher. Codex selects its portable shells; Claude
selects CTXRoute's native shells. The dispatcher executes those project-local
entry points directly instead of starting a nested wrapper process.

```text
flowchart TD
    Session[SessionStart] --> SessionContext[Bounded CTXRoute and active Progress context]
    Session --> CRGStatus[Existing CRG status only]
    Request[Requested action] --> PreTool[PreToolUse dispatcher]
    PreTool --> Governance[Governance policy]
    Governance -->|allow| Route[CTXRoute context injection]
    Governance -->|block| Refusal[Immediate refusal with reason]
    Route -->|allow| Edit[Authorized action]
    Route -->|deny| Refusal
    Edit --> PostTool[PostToolUse dispatcher]
    PostTool --> Guard[CTXRoute document guard]
    Guard -->|allow| Sensor[Blocking Sensor]
    Sensor --> CRGUpdate[CRG single-flight update]
    CRGUpdate --> Audit[Local change audit]
    Guard -->|block| Refusal
    Audit --> Index[Git index]
    Index --> PreCommit[Authoritative pre-commit]
    PreCommit --> Architecture[Architecture and ADR checks]
    PreCommit --> Documentation[Links, placeholders, and Archify]
    PreCommit --> Quality[Targeted mutation testing when configured]
    Architecture --> PrePush[Pre-push]
    Documentation --> PrePush
    Quality --> PrePush
    PrePush --> Commands[Complete project commands]
    Commands --> Stop[Stop dispatcher and final audit]
    Prompt[UserPromptSubmit] --> Count[Turn counter]
    Count --> Canary[Canary]
    Compact[PreCompact] --> Reset[CTXRoute reset]
    Reset --> Resume[PostCompact active Progress reminder]
    Spawn[SubagentStart] --> Claim[Claim automatic Progress ticket]
    Claim --> Worker[Subagent work]
    Worker --> Result[SubagentStop structured footer]
    Result --> Settle[DONE or BLOCKED]
    SessionEnd --> Release[Release session IN_PROGRESS claims]
```

PreToolUse provides immediate feedback. Git hooks remain authoritative because
they inspect the index and capture files produced by commands or external tools.
The registered lifecycle handlers intentionally omit custom status messages.
Read-only tools skip the architecture subprocess, and PostToolUse is limited to
mutation-capable tools to reduce lifecycle noise and process startup overhead.
Only the three subagent/session lifecycle hooks mutate Progress automatically;
the main agent receives only a small advisory reminder and uses MCP or CLI when
details or a mutation are actually useful.

The lifecycle is independent from the two project-scoped MCP servers declared
in `.codex/config.toml`: `ctxroute-progress` and `code-review-graph` are
started by the Codex client over stdio. No PostToolUse handler starts or proxies
an MCP transport. A trusted project and a refreshed Codex session may be needed
before `/mcp` shows a newly added manifest. Codex waits up to three seconds for
optional servers while assembling the initial catalog so CRG's Python process
can expose its tools without becoming a required, session-blocking dependency.

CRG's `apply_refactor_tool` is permitted only for `dry_run: true`. Normal edit
tools own accepted mutations so architecture, Sensor, and audit enforcement
cannot be bypassed.
