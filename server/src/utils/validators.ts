/**
 * validators.ts
 *
 * OWASP A03 (Injection) / A04 (Insecure Design) mitigation.
 * Centralised, schema-based input validators used across all route handlers.
 *
 * Rules:
 *  - Every public function is pure and throws nothing — it returns a typed Result.
 *  - Validation errors include a human-readable message safe for client responses.
 *  - All string inputs are trimmed before checks.
 */

import { humanizeFieldName } from './userMessages';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ValidationOk<T> {
  ok: true;
  value: T;
  // Empty string — present on both branches so callers can always access .message
  // without a type-narrowing check (discriminate via .ok instead)
  message: '';
}

export interface ValidationErr {
  ok: false;
  message: string;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

function ok<T>(value: T): ValidationOk<T> {
  return { ok: true, value, message: '' };
}

function err(message: string): ValidationErr {
  return { ok: false, message };
}

// ─── Field stripping (OWASP A03 — mass-assignment / prototype pollution) ─────

/**
 * Returns a new plain object containing ONLY the listed keys from `body`.
 * Any unexpected field (including __proto__, constructor, prototype) is silently
 * dropped, preventing prototype-pollution and mass-assignment attacks.
 *
 * @example
 *   const clean = pickFields(req.body, ['email', 'password']);
 */
export function pickFields<K extends string>(
  body: unknown,
  allowedKeys: readonly K[],
): Partial<Record<K, unknown>> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const result: Partial<Record<K, unknown>> = {};

  for (const key of allowedKeys) {
    // Only copy own enumerable properties; skip prototype-chain tricks.
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      result[key] = (body as Record<string, unknown>)[key];
    }
  }

  return result;
}

// ─── String validation ────────────────────────────────────────────────────────

/**
 * Validates a required string: non-empty after trim, length between min and max.
 */
export function validateString(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): ValidationResult<string> {
  const label = humanizeFieldName(fieldName);

  if (typeof value !== 'string') {
    return err(`Please enter a valid ${label}.`);
  }

  const trimmed = value.trim();

  if (trimmed.length < min) {
    return err(
      min === 1
        ? `Please enter your ${label}.`
        : `${label.charAt(0).toUpperCase()}${label.slice(1)} must be at least ${min} characters.`,
    );
  }

  if (trimmed.length > max) {
    return err(`${label.charAt(0).toUpperCase()}${label.slice(1)} must not exceed ${max} characters.`);
  }

  return ok(trimmed);
}

/**
 * Validates an optional string — returns null if the value is absent/empty,
 * or a ValidationErr if the value is present but fails the length check.
 */
export function validateOptionalString(
  value: unknown,
  fieldName: string,
  max: number,
): ValidationResult<string | null> {
  if (value === undefined || value === null || value === '') {
    return ok(null);
  }

  const label = humanizeFieldName(fieldName);

  if (typeof value !== 'string') {
    return err(`Please enter a valid ${label}.`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return ok(null);
  }

  if (trimmed.length > max) {
    return err(`${label.charAt(0).toUpperCase()}${label.slice(1)} must not exceed ${max} characters.`);
  }

  return ok(trimmed);
}

// ─── Email validation ─────────────────────────────────────────────────────────

// More permissive than RFC 5321 but catches obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates an email address: format + length check.
 * Returns the email in lowercase.
 */
export function validateEmail(value: unknown): ValidationResult<string> {
  const str = validateString(value, 'Email', 1, 254);

  if (!str.ok) return str;

  const lower = str.value.toLowerCase();

  if (!EMAIL_RE.test(lower)) {
    return err('A valid email address is required.');
  }

  return ok(lower);
}

// ─── Phone validation ─────────────────────────────────────────────────────────

// Allows digits, spaces, hyphens, parentheses, and leading +. 7–20 chars after trim.
const PHONE_RE = /^[+\d][\d\s\-().]{5,18}[\d)]$/;

/**
 * Validates a phone number: permissive format + length (7–20 chars).
 */
export function validatePhone(value: unknown): ValidationResult<string> {
  const str = validateString(value, 'Phone number', 7, 20);

  if (!str.ok) return str;

  if (!PHONE_RE.test(str.value)) {
    return err('Phone number must be 7–20 characters and contain only digits, spaces, hyphens, or parentheses.');
  }

  return ok(str.value);
}

// ─── Integer validation ───────────────────────────────────────────────────────

/**
 * Validates that a value is a finite integer within [min, max].
 */
export function validateInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const label = humanizeFieldName(fieldName);
  const n = Number(value);

  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return err(`Please enter a whole number for ${label}.`);
  }

  if (n < min || n > max) {
    return err(`${label.charAt(0).toUpperCase()}${label.slice(1)} must be between ${min} and ${max}.`);
  }

  return ok(n);
}

/**
 * Validates an optional integer — returns the default if absent.
 */
export function validateOptionalInteger(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
  defaultValue: number,
): ValidationResult<number> {
  if (value === undefined || value === null) {
    return ok(defaultValue);
  }

  return validateInteger(value, fieldName, min, max);
}

// ─── Positive number validation ───────────────────────────────────────────────

/**
 * Validates that a value is a finite, non-negative number.
 * Returns the default if absent.
 */
export function validatePositiveNumber(
  value: unknown,
  fieldName: string,
  max: number,
): ValidationResult<number> {
  const label = humanizeFieldName(fieldName);

  if (value === undefined || value === null) {
    return ok(0);
  }

  const n = Number(value);

  if (!Number.isFinite(n) || n < 0) {
    return err(`Please enter a valid amount for ${label}.`);
  }

  if (n > max) {
    return err(`${label.charAt(0).toUpperCase()}${label.slice(1)} is too large.`);
  }

  return ok(n);
}

// ─── Enum validation ──────────────────────────────────────────────────────────

/**
 * Validates that a value is one of an explicit allowlist.
 * OWASP A03: prevents injecting arbitrary strings into DB queries/logic.
 */
export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): ValidationResult<T> {
  const label = humanizeFieldName(fieldName);

  if (typeof value !== 'string') {
    return err(`Please choose a valid ${label}.`);
  }

  const trimmed = value.trim() as T;

  if (!allowedValues.includes(trimmed)) {
    return err(`Please choose a valid ${label}.`);
  }

  return ok(trimmed);
}

/**
 * Validates an optional enum — returns null if absent.
 */
export function validateOptionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): ValidationResult<T | null> {
  if (value === undefined || value === null || value === '') {
    return ok(null);
  }

  return validateEnum(value, fieldName, allowedValues);
}

// ─── CSV allowlist validation ─────────────────────────────────────────────────

/**
 * Parses a comma-separated string and filters values against an allowlist.
 * Values not in the allowlist are silently dropped (safe fail-open for search filters).
 * Returns an empty array if the input is absent or invalid.
 *
 * OWASP A03: prevents arbitrary strings from entering MongoDB `$in` queries.
 */
export function validateCsvAllowlist<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
): T[] {
  if (typeof value !== 'string' || value.trim() === '') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is T => allowedValues.includes(item as T));
}

// ─── Numeric query param validation ──────────────────────────────────────────

/**
 * Parses a numeric query parameter with a NaN guard.
 * Returns undefined (exclude from filter) if absent, NaN, or out of range.
 *
 * OWASP A03: NaN inserted into Mongoose comparisons is silently ignored,
 * which can return unexpected query results.
 */
export function parseNumericParam(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const n = Number(value);

  if (!Number.isFinite(n) || n < min || n > max) {
    return undefined;
  }

  return n;
}

// ─── Param ID validation ──────────────────────────────────────────────────────

/** Max length for ID-type URL params / body IDs (MongoDB ObjectId = 24 hex chars). */
export const MAX_ID_LENGTH = 100;

/**
 * Validates an ID string: non-empty after trim, max length.
 */
export function validateId(value: unknown, fieldName: string): ValidationResult<string> {
  return validateString(value, fieldName, 1, MAX_ID_LENGTH);
}
