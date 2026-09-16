export const CODE_CONTEXT_POLICY = [
  'Code-context tool routing (retain for this task):',
  '- For cross-file relationships, impact, architecture, or review scope, use the code-review-graph MCP before native search: start with get_minimal_context_tool, then use only targeted CRG follow-ups.',
  '- Use rg and direct file reads for exact-text lookup, line-level confirmation, unsupported or unindexed files, and deterministic verification after graph context.',
  '- Trust CRG only when _graph.head_matches_build is true; otherwise run npm run crg:update, retry once, and state any native-tool fallback.',
].join('\n');
