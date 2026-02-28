import type { Plan } from '@/app/plan-engine/types';
import { Buffer } from 'buffer';

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

export function encodePlanBase64Url(plan: Plan): string {
  return toBase64Url(JSON.stringify(plan));
}

export function decodePlanBase64Url(encoded: string): Plan {
  const json = fromBase64Url(encoded);
  return JSON.parse(json) as Plan;
}
