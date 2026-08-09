import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compareStatisticalLanguageDetectors } from '../src/language.js';

type Sample = { language: string; text: string };
const corpus = JSON.parse(await readFile(resolve(process.cwd(), 'test-fixtures/language-corpus.json'), 'utf8')) as Sample[];
const rows = corpus.map(sample => ({ expected: sample.language, ...compareStatisticalLanguageDetectors(sample.text) }));
const accuracy = (detector: 'franc' | 'eld') => rows.filter(row => row[detector] === row.expected).length / rows.length;
console.log(JSON.stringify({ samples: rows.length, francMin: { accuracy: accuracy('franc') }, eld: { accuracy: accuracy('eld') }, rows }, null, 2));
