import { readFileSync as readCommitMessage, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const messagePath = realpathSync(resolve(process.argv[2]));
const gitDirectory = `${realpathSync(resolve('.git'))}${sep}`;
if (!messagePath.startsWith(gitDirectory)) throw new Error('Commit message must be read from the repository Git directory.');
const message = readCommitMessage(messagePath, 'utf8').split(/\r?\n/u)[0].trim();
const valid = /^(?:feat|fix|refactor|test|docs|chore|perf)(?:\([^)]+\))?!?: .{1,72}$/u;
if (!valid.test(message)) {
  console.error('Invalid commit. Expected format: type(scope): short description');
  process.exit(1);
}
