# Security policy

## Supported versions

Only the latest revision of `main` and the latest published extension package
are supported during initial development.

## Trust boundaries

Private library, progress, agenda, and preference data remain local by default.
The optional public API must not receive browsing history or a private library.
Extension messages, imported files, content-source responses, and HTTP payloads
are untrusted and require runtime validation.

Manifest permissions are budgeted per user flow. The extension uses Manifest
V3, a strict CSP, and no remotely hosted executable code. Provider credentials
exist only in approved deployment environments and never in extension bundles,
logs, diagrams, fixtures, or committed environment files.

## Reporting a vulnerability

Do not open a public issue with vulnerability details. Use GitHub private
vulnerability reporting and include reproduction steps, impact, affected
browser/version, and any mitigation. If private reporting is unavailable, open
an issue without sensitive details and request a secure contact channel.

An initial acknowledgement target is seven days. A release requires explicit
approval after the fix, regression evidence, and rollback review.
