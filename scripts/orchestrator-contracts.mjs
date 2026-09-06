import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaDirectory = fileURLToPath(new URL('../.project/schemas/orchestrator/', import.meta.url));
const schemaDocuments = readdirSync(schemaDirectory)
  .filter(name => name.endsWith('.schema.json'))
  .sort()
  .map(name => JSON.parse(readFileSync(join(schemaDirectory, name), 'utf8')));

export const ORCHESTRATOR_SCHEMA_IDS = Object.freeze({
  config: 'https://ctxroute.dev/schemas/orchestrator/config.schema.json',
  state: 'https://ctxroute.dev/schemas/orchestrator/state.schema.json',
  transaction: 'https://ctxroute.dev/schemas/orchestrator/transaction.schema.json',
  missionRequest: 'https://ctxroute.dev/schemas/orchestrator/mission-request.schema.json',
  missionRecord: 'https://ctxroute.dev/schemas/orchestrator/mission-record.schema.json',
  missionView: 'https://ctxroute.dev/schemas/orchestrator/mission-view.schema.json',
  workerReport: 'https://ctxroute.dev/schemas/orchestrator/worker-report.schema.json',
  auditReport: 'https://ctxroute.dev/schemas/orchestrator/audit-report.schema.json',
  validationReceipt: 'https://ctxroute.dev/schemas/orchestrator/validation-receipt.schema.json',
  worktreeOperation: 'https://ctxroute.dev/schemas/orchestrator/worktree-operation.schema.json',
  decisionEvent: 'https://ctxroute.dev/schemas/orchestrator/decision-event.schema.json',
  bootstrapReport: 'https://ctxroute.dev/schemas/orchestrator/bootstrap-report.schema.json',
});

const aliases = new Map(Object.entries(ORCHESTRATOR_SCHEMA_IDS).flatMap(([key, id]) => [
  [key, id],
  [id.split('/').at(-1).replace('.schema.json', ''), id],
  [id, id],
]));
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of schemaDocuments) ajv.addSchema(schema);
for (const id of Object.values(ORCHESTRATOR_SCHEMA_IDS)) {
  if (!ajv.getSchema(id)) throw new Error(`Orchestrator schema was not compiled: ${id}`);
}

export function listOrchestratorContracts() {
  return Object.entries(ORCHESTRATOR_SCHEMA_IDS).map(([name, id]) => ({ name, id }));
}

export function getOrchestratorValidator(nameOrId) {
  const id = aliases.get(nameOrId);
  if (!id) throw new TypeError(`Unknown orchestrator contract: ${nameOrId}`);
  return ajv.getSchema(id);
}

export function validateOrchestratorContract(nameOrId, value) {
  const validate = getOrchestratorValidator(nameOrId);
  const valid = validate(value);
  return { valid, errors: valid ? [] : sanitizeErrors(validate.errors) };
}

export function assertOrchestratorContract(nameOrId, value) {
  const result = validateOrchestratorContract(nameOrId, value);
  if (result.valid) return value;
  const error = new TypeError(`Invalid ${nameOrId} contract: ${result.errors.map(item => `${item.instancePath || '/'} ${item.message}`).join('; ')}`);
  error.code = 'ORCHESTRATOR_CONTRACT_INVALID';
  error.validationErrors = result.errors;
  throw error;
}

function sanitizeErrors(errors = []) {
  return errors.map(({ instancePath, schemaPath, keyword, message, params }) => ({ instancePath, schemaPath, keyword, message, params }));
}
