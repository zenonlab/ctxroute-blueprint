---
name: session-auditor
description: Audit bounded local session traces and worker reports when execution evidence, task decomposition, context routing, validation, orchestration, or a skill may be defective.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: orchestrator
---

# Session auditor

Audit session evidence without loading raw logs into the primary interactive
context. This skill is available in both swarm modes. In `SWARM_ON`, use a
dedicated worker mission; in `SWARM_OFF`, the primary agent may invoke it
directly when an audit signal exists.

## Workflow

1. Obtain the mission contract, trace paths, and explicit approved trace roots.
   Treat `.codex/sessions` as an opportunistic source, never a runtime API.
2. Run `node scripts/session-audit.mjs --root <approved-absolute-root>
   --mission <mission.json> --current-session <current-trace>
   --output <this-audit-output> <trace...>`.
   Use only its redacted compact output; never paste or load a raw trace into
   the primary conversation. Only regular, non-symlinked, inactive traces under
   an approved root are eligible; the audit's mission and output are excluded.
3. Compare mission, selected skill/version, touched files, required commands,
   exit codes, material evidence, and actual result. Classify defects as skill,
   context, decomposition, validation, or orchestration failures.
4. Prepare the smallest skill patch or objective adjustment supported by the
   evidence. All goal changes go through `audit.apply` in the orchestrator API;
   never edit orchestrator state directly.
5. Run the changed skill's validation and `npm run blueprint:review`. The
   blueprint audit must inspect this skill's own patch before it is accepted.

Return only the current audit contract: categorical signals, typed subject,
decision, bounded evidence references, distinct proposed/applied action,
structured validations, and rollback reference. Do not
schedule recurring audits without a concrete failure or review signal.
