import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export const paths = {
  root: rootDir,
  config: path.join(rootDir, 'config.json'),
  state: path.join(rootDir, 'data', 'state.json'),
  debug: path.join(rootDir, 'debug')
};

export function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
  const storeUrl = String(raw.storeUrl || '').replace(/\/$/, '');
  if (!/^https:\/\/smartstore\.naver\.com\/[A-Za-z0-9_-]+$/.test(storeUrl)) {
    throw new Error(`config.json의 storeUrl 형식이 올바르지 않습니다: ${storeUrl}`);
  }

  return {
    ...raw,
    storeUrl,
    storeName: raw.storeName || new URL(storeUrl).pathname.split('/').filter(Boolean)[0],
    pinnedProductUrls: Array.isArray(raw.pinnedProductUrls) ? raw.pinnedProductUrls : [],
    maxStorePages: clampNumber(raw.maxStorePages, 1, 30, 5),
    maxProducts: clampNumber(raw.maxProducts, 1, 1000, 200),
    pageWaitMs: clampNumber(raw.pageWaitMs, 500, 15000, 2200),
    requestDelayMs: clampNumber(raw.requestDelayMs, 0, 10000, 900),
    notifyOnBaseline: raw.notifyOnBaseline !== false,
    notifyOnRecovery: raw.notifyOnRecovery !== false,
    errorAlertAfterFailures: clampNumber(raw.errorAlertAfterFailures, 1, 20, 3),
    timezone: raw.timezone || 'Asia/Seoul',
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    runMode: process.env.RUN_MODE || 'monitor'
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
