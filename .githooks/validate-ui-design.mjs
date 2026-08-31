import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const defaultPath = '.project/ui-design-contract.json';

export function validateUiContract(document) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) return ['contract must be an object'];
  if (document.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
  if (document.policy !== 'framework-neutral') errors.push('policy must be framework-neutral');
  for (const category of ['color', 'spacing', 'typography', 'radius', 'motion']) {
    const values = document.tokens?.[category];
    if (!Array.isArray(values) || !values.length || values.some(value => typeof value !== 'string' || !value)) errors.push(`tokens.${category} must be a non-empty array of strings`);
    else if (new Set(values).size !== values.length) errors.push(`tokens.${category} must not contain duplicates`);
  }
  if (!Array.isArray(document.components) || !document.components.length) errors.push('components must be a non-empty array');
  else {
    const ids = new Set();
    for (const component of document.components) {
      if (!component || typeof component !== 'object' || !component.id || typeof component.id !== 'string') { errors.push('every component needs a string id'); continue; }
      if (ids.has(component.id)) errors.push(`component id is duplicated: ${component.id}`);
      ids.add(component.id);
      for (const field of ['anatomy', 'variants', 'states', 'slots', 'accessibility']) {
        if (!Array.isArray(component[field])) errors.push(`${component.id}.${field} must be an array`);
      }
      if (!component.states?.some(state => ['focus', 'focused'].includes(state)) && component.id !== 'surface') errors.push(`${component.id}.states must include focus or an explicit non-interactive contract`);
      if (component.tokenPolicy !== 'tokens-only') errors.push(`${component.id}.tokenPolicy must be tokens-only`);
    }
  }
  const rules = document.rules;
  for (const key of ['reuseBeforeCreate', 'noArbitraryValues', 'noInlineStyle', 'noLayerFusion']) if (typeof rules?.[key] !== 'boolean') errors.push(`rules.${key} must be boolean`);
  if (!Array.isArray(rules?.requiredEvidence) || !rules.requiredEvidence.length) errors.push('rules.requiredEvidence must be a non-empty array');
  if (rules?.allowedCustomComponents !== 'documented-with-rationale') errors.push('rules.allowedCustomComponents must require documented-with-rationale');
  if (document.adapters?.framework !== 'selected-by-derived-product' || document.adapters?.required !== false || document.adapters?.contractOnly !== true) errors.push('adapters must remain optional, product-selected, and contract-only');
  return errors;
}

function load(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { return { __error: error.message }; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv.find((value, index) => index > 1 && !value.startsWith('-')) ?? defaultPath;
  const document = load(path);
  const diagnostics = document.__error ? [`${path}: ${document.__error}`] : validateUiContract(document).map(message => `${path}: ${message}`);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, valid: diagnostics.length === 0, diagnostics })}\n`);
  if (diagnostics.length) process.exitCode = 1;
}
