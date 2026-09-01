import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DIAGRAM_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

export function listArchifyDiagrams(root = process.cwd()) {
  const directory = resolve(root, 'docs/architecture/src');
  const audiences = configuredSources(root);
  const files = existsSync(directory) ? readdirSync(directory).filter(file => file.endsWith('.json')).sort() : [];
  return files.map(file => {
    const source = join(directory, file);
    let document;
    try {
      document = JSON.parse(readFileSync(source, 'utf8'));
    } catch {
      throw new Error(`${relative(root, source)}: invalid Archify JSON source`);
    }
    if (!DIAGRAM_TYPES.has(document.diagram_type)) throw new Error(`${relative(root, source)}: missing or unsupported Archify diagram_type`);
    const relativeSource = relative(root, source).replace(/\\/gu, '/');
    const audience = audiences.internal.has(relativeSource) ? 'internal' : audiences.product.has(relativeSource) ? 'product' : null;
    if (!audience) throw new Error(`${relativeSource}: Archify source is not declared in architecture.documents or architecture.internalDocuments`);
    return { id: file.replace(/\.json$/u, ''), type: document.diagram_type, source: relativeSource, audience };
  });
}

export function selectArchifyDiagrams(selector = 'architecture', root = process.cwd()) {
  const diagrams = listArchifyDiagrams(root);
  if (selector === 'internal') return diagrams.filter(diagram => diagram.audience === 'internal');
  const available = diagrams.filter(diagram => diagram.audience === 'product');
  if (selector === 'all') return available;
  const matches = available.filter(diagram => diagram.id === selector || diagram.id.startsWith(`${selector}.`) || diagram.type === selector || diagram.source === selector || diagram.source.endsWith(`/${selector}`));
  if (!matches.length) throw new Error(`Unknown product Archify diagram "${selector}". Available: ${available.map(diagram => diagram.id).join(', ') || 'none yet'}`);
  return matches;
}

export function archifyOutput(root, diagram) {
  return resolve(root, 'dist', 'architecture', `${diagram.id}.html`);
}

export function productDiagramViolations(document) {
  const source = JSON.stringify(document);
  const forbidden = [
    ['CTXRoute', /ctxroute/iu],
    ['Progress MCP', /progress\s+mcp/iu],
    ['code-review-graph / CRG', /code-review-graph|\bcrg(?:\s+risk\s+gate)?\b/iu],
    ['Archify checker', /archify(?:\s+checker)?/iu],
    ['Sensor gate', /\bsensor\s+(?:gate|check|scanner)/iu],
    ['agent hooks', /stop\s+hook|lifecycle\s+hook|\.codex|\.claude|\.githooks/iu],
  ];
  return forbidden.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

function configuredSources(root) {
  try {
    const config = JSON.parse(readFileSync(resolve(root, '.project/project-config.json'), 'utf8'));
    if (!Array.isArray(config?.architecture?.documents)) throw new Error('architecture.documents must be an array');
    if (!Array.isArray(config?.architecture?.internalDocuments)) throw new Error('architecture.internalDocuments must be an array');
    const product = new Set(config.architecture.documents);
    const internal = new Set(config.architecture.internalDocuments);
    for (const source of product) if (internal.has(source)) throw new Error(`${source} cannot be both product and internal`);
    return { product, internal };
  } catch (error) {
    throw new Error(`Unable to classify Archify audiences: ${error.message}`);
  }
}
