import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXACT_ARTIFACT_FILES = new Set(['crg-comment.md', 'head-sha.txt', 'pr-number.txt']);
const ISSUE = /(?:^|\s)(#[1-9][0-9]*|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*)(?=$|[\s.,;:)])/u;

export async function evaluateCrgDisposition({ artifactDirectory, context, now = new Date() }) {
  const report = await validateCrgArtifact(artifactDirectory, context.pr, context.sha);
  if (!['HIGH', 'CRITICAL'].includes(report.risk)) return { conclusion: 'success', reason: 'RISK_BELOW_HIGH', report, attestation: null };
  const acceptance = selectRiskAcceptance(context, now, report.digest);
  if (!acceptance) return { conclusion: 'failure', reason: 'ADMIN_ACCEPTANCE_REQUIRED', report, attestation: null };
  const attestation = {
    pr: context.pr, sha: context.sha, score: report.score, risk: report.risk,
    threshold: 'high', report_digest: report.digest, approver: acceptance.approver,
    justification: acceptance.justification, tracking_issue: acceptance.tracking_issue,
    approved_at: acceptance.approved_at,
  };
  assertAttestation(attestation);
  return { conclusion: 'success', reason: 'ADMIN_ACCEPTANCE_VALID', report, attestation };
}

export async function validateCrgArtifact(directory, expectedPr, expectedSha) {
  const root = resolve(directory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('unsafe CRG artifact directory');
  const names = await readdir(root);
  if (names.length !== EXACT_ARTIFACT_FILES.size || names.some(name => !EXACT_ARTIFACT_FILES.has(name))) throw new Error('CRG artifact boundary mismatch');
  for (const name of names) { const details = await lstat(join(root, name)); if (!details.isFile() || details.isSymbolicLink()) throw new Error('CRG artifact entries must be regular files'); }
  const prSource = await boundedRead(join(root, 'pr-number.txt'), 12, 'ascii');
  const shaSource = await boundedRead(join(root, 'head-sha.txt'), 41, 'ascii');
  if (!/^[1-9][0-9]{0,9}\n?$/u.test(prSource) || Number.parseInt(prSource, 10) !== expectedPr) throw new Error('CRG artifact PR mismatch');
  const sha = shaSource.trim();
  if (!/^[0-9a-f]{40}$/u.test(sha) || sha !== expectedSha) throw new Error('CRG artifact SHA mismatch');
  const bytes = await readFile(join(root, 'crg-comment.md'));
  if (bytes.length === 0 || bytes.length > 60_000) throw new Error('CRG report size is invalid');
  if (!isUtf8(bytes)) throw new Error('CRG report must be UTF-8');
  const text = bytes.toString('utf8');
  if ([...text].some(character => (character.codePointAt(0) < 32 && !'\n\r\t'.includes(character)) || character === '\x7f')) throw new Error('CRG report contains control characters');
  if (!text.includes('## code-review-graph review') || !text.includes('*Powered by [code-review-graph]')) throw new Error('CRG report format is invalid');
  const match = /\*\*Overall risk:\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*\((LOW|MEDIUM|HIGH|CRITICAL)\)\*\*/u.exec(text);
  if (!match) throw new Error('CRG report risk is missing');
  return { score: Number(match[1]), risk: match[2], digest: createHash('sha256').update(bytes).digest('hex') };
}

export function selectRiskAcceptance(context, now = new Date(), reportDigest = context.report_digest) {
  const latest = new Map();
  for (const review of context.reviews ?? []) {
    const login = review.user?.login;
    if (!login || !review.submitted_at) continue;
    const previous = latest.get(login);
    if (!previous || Date.parse(review.submitted_at) > Date.parse(previous.submitted_at) || review.id > previous.id) latest.set(login, review);
  }
  for (const review of [...latest.values()].sort((left, right) => Date.parse(right.submitted_at) - Date.parse(left.submitted_at))) {
    const login = review.user.login;
    const body = String(review.body ?? '').trim();
    const issue = ISSUE.exec(body)?.[1];
    const justification = /^Justification:\s*(.{1,512})$/imu.exec(body)?.[1]?.trim();
    if (review.state !== 'APPROVED' || review.commit_id !== context.sha || login === context.author || context.permissions?.[login] !== 'admin') continue;
    if (!/^[a-f0-9]{64}$/u.test(String(reportDigest)) || !body.includes(`CRG-report-sha256:${reportDigest}`)) continue;
    if (body.length > 1024 || [...body].some(character => [0, 11, 12, 127].includes(character.codePointAt(0))) || !issue || !justification || justification.length < 32 || justification.length > 512) continue;
    if (Date.parse(review.submitted_at) > now.getTime()) continue;
    return { approver: login, justification, tracking_issue: issue, approved_at: new Date(review.submitted_at).toISOString() };
  }
  return null;
}

function assertAttestation(value) {
  if (!Number.isInteger(value.pr) || !/^[0-9a-f]{40}$/u.test(value.sha) || !['HIGH', 'CRITICAL'].includes(value.risk) || value.threshold !== 'high' || !/^[a-f0-9]{64}$/u.test(value.report_digest)) throw new Error('invalid CRG attestation');
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(value.approver) || value.justification.length < 32 || value.justification.length > 512 || !ISSUE.test(` ${value.tracking_issue}`)) throw new Error('invalid CRG acceptance evidence');
}
async function boundedRead(path, maximum, encoding) { const bytes = await readFile(path); if (bytes.length === 0 || bytes.length > maximum) throw new Error('CRG metadata size is invalid'); return bytes.toString(encoding); }

async function main() {
  const [artifactDirectory, contextPath, outputPath, attestationPath] = process.argv.slice(2);
  if (!artifactDirectory || !contextPath || !outputPath) throw new Error('usage: crg-disposition <artifact-dir> <context.json> <output.json>');
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const result = await evaluateCrgDisposition({ artifactDirectory, context });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  if (result.attestation && attestationPath) await writeFile(attestationPath, `${JSON.stringify(result.attestation, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ conclusion: result.conclusion, reason: result.reason, digest: result.report.digest, attestation: Boolean(result.attestation) })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
