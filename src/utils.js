import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

export function productIdFromUrl(url) {
  const match = String(url || '').match(/\/products\/(\d+)/);
  return match?.[1] || null;
}

export function normalizeProductUrl(url, storeUrl) {
  if (!url) return null;
  try {
    const absolute = new URL(url, storeUrl);
    const id = productIdFromUrl(absolute.href);
    if (!id) return null;
    const storeSlug = new URL(storeUrl).pathname.split('/').filter(Boolean)[0];
    return `https://smartstore.naver.com/${storeSlug}/products/${id}`;
  } catch {
    return null;
  }
}

export function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function formatWon(value) {
  const number = toNumber(value);
  return number === null ? '확인 불가' : `${Math.round(number).toLocaleString('ko-KR')}원`;
}

export function formatPercent(value) {
  const number = toNumber(value);
  return number === null ? '확인 불가' : `${Math.round(number)}%`;
}

export function calculateDiscountRate(originalPrice, currentPrice) {
  const original = toNumber(originalPrice);
  const current = toNumber(currentPrice);
  if (original === null || current === null || original <= 0 || current > original) return null;
  return Math.round(((original - current) / original) * 100);
}

export function cleanText(value, maxLength = 300) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatKoreanTime(iso, timezone = 'Asia/Seoul') {
  const date = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

export function errorToString(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (key !== null && key !== undefined) map.set(key, item);
  }
  return [...map.values()];
}
