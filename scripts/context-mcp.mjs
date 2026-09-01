import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { boundedResponse, CONTEXT_TOKENIZER, ContextError, DEFAULT_CONTEXT_TOKENS, listSymbols, summarizeFile, findDefinition, findReferences, getRelevantContext } from './context-ast.mjs';

export const CONTEXT_TOOL_NAMES = Object.freeze(['list_symbols', 'summarize_file', 'find_definition', 'find_references', 'get_relevant_context']);
const scopeSchema = z.enum(['product', 'blueprint']).default('product');
const budgetSchema = z.number().int().min(128).max(10000).default(DEFAULT_CONTEXT_TOKENS);
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const invoke = operation => async input => {
  try { return result(await operation(input)); }
  catch (error) {
    const contextError = error instanceof ContextError ? error : new ContextError('INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    const budget = Number.isInteger(input?.max_tokens) && input.max_tokens >= 128 && input.max_tokens <= 10000 ? input.max_tokens : DEFAULT_CONTEXT_TOKENS;
    const response = boundedResponse({ error: { code: contextError.code, message: contextError.message, details: contextError.details } }, { scope: input?.scope ?? 'product', mode: contextError.details.mode ?? 'error', grammar: contextError.details.grammar ?? null }, budget);
    return { ...result(response), isError: true };
  }
};

export function createContextServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-context-ast', version: '1.0.0' });
  const path = z.object({ path: z.string().min(1), max_tokens: budgetSchema });
  server.registerTool('list_symbols', { description: 'List AST symbols without returning full source.', inputSchema: path }, invoke(({ path: value, max_tokens }) => listSymbols(value, root, max_tokens)));
  server.registerTool('summarize_file', { description: 'Return a bounded structural AST summary.', inputSchema: path }, invoke(({ path: value, max_tokens }) => summarizeFile(value, root, max_tokens)));
  server.registerTool('find_definition', { description: 'Find AST definitions in one strict repository scope.', inputSchema: z.object({ symbol: z.string().min(1), path: z.string().optional(), scope: scopeSchema, max_tokens: budgetSchema }) }, invoke(({ symbol, path: value, scope, max_tokens }) => findDefinition(symbol, value, root, scope, max_tokens)));
  server.registerTool('find_references', { description: 'Find syntax-aware references in one strict repository scope.', inputSchema: z.object({ symbol: z.string().min(1), path: z.string().optional(), scope: scopeSchema, max_tokens: budgetSchema }) }, invoke(({ symbol, path: value, scope, max_tokens }) => findReferences(symbol, value, root, scope, max_tokens)));
  server.registerTool('get_relevant_context', { description: `Return ranked structural summaries under a deterministic ${CONTEXT_TOKENIZER} budget.`, inputSchema: z.object({ query: z.string().min(1), paths: z.array(z.string().min(1)).optional(), scope: scopeSchema, max_tokens: budgetSchema }) }, invoke(({ query, paths, scope, max_tokens }) => getRelevantContext(query, paths, max_tokens, root, scope)));
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) serveStdio(() => createContextServer());
