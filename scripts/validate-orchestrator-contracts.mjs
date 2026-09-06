import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertOrchestratorContract, listOrchestratorContracts } from './orchestrator-contracts.mjs';

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, '.project/orchestrator-config.json'), 'utf8'));
assertOrchestratorContract('config-v2', config);
console.log(JSON.stringify({ schemaVersion: 2, valid: true, contracts: listOrchestratorContracts().length }));
