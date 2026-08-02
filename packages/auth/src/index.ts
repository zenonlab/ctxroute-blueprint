import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const PASSWORD_MIN_LENGTH = 15;
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;
export async function hashPassword(password: string) { validatePassword(password); return argon2.hash(password, ARGON2_OPTIONS); }
export async function verifyPassword(hash: string, password: string) { return argon2.verify(hash, password); }
export function validatePassword(password: string) { if (password.length < PASSWORD_MIN_LENGTH || password.length > 128) throw new Error('PASSWORD_POLICY'); }
export function newOpaqueSecret(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function safeEqual(a: string, b: string) { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
