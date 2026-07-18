import { v4 as uuidv4 } from 'uuid';

/** Generate a unique ID. */
export function generateId(): string {
  return uuidv4();
}

/** Current ISO timestamp. */
export function now(): string {
  return new Date().toISOString();
}

/** Safely parse a JSON string with a fallback. */
export function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}