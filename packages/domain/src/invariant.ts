export type DomainInvariantCode =
  | 'duplicate-reference'
  | 'duplicate-work'
  | 'invalid-agenda-date'
  | 'invalid-datetime'
  | 'invalid-favorite-presence'
  | 'invalid-id'
  | 'invalid-number'
  | 'invalid-review-resolution'
  | 'invalid-text'
  | 'invalid-url';

export class DomainInvariantError extends Error {
  readonly code: DomainInvariantCode;

  constructor(code: DomainInvariantCode, message: string) {
    super(message);
    this.name = 'DomainInvariantError';
    this.code = code;
  }
}

export function invariant(condition: unknown, code: DomainInvariantCode, message: string): asserts condition {
  if (!condition) throw new DomainInvariantError(code, message);
}

export function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  invariant(normalized.length > 0, 'invalid-text', `${field} must not be empty.`);
  return normalized;
}

export function nonNegativeNumber(value: number, field: string): number {
  invariant(Number.isFinite(value) && value >= 0, 'invalid-number', `${field} must be a finite non-negative number.`);
  return value;
}

export function canonicalDateTime(value: string, field: string): string {
  const parsed = new Date(value);
  invariant(!Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value, 'invalid-datetime', `${field} must be a canonical ISO datetime.`);
  return value;
}
