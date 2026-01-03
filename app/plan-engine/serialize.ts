import { PLAN_VERSION, type Plan } from './types';

function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function base64UrlEncode(input: string): string {
  return toBase64(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return fromBase64(normalized + padding);
}

export function serializePlan(plan: Plan): string {
  const json = JSON.stringify(plan);
  return base64UrlEncode(json);
}

export function deserializePlan(encoded: string): Plan {
  try {
    const json = base64UrlDecode(encoded);
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Plan payload is not an object');
    }

    const plan = parsed as Plan;

    if (!plan.version) {
      plan.version = PLAN_VERSION;
    }

    return plan;
  } catch (error) {
    throw new Error(`Failed to decode plan: ${(error as Error).message}`);
  }
}
