import fs from 'node:fs';
import { loadConfig, paths } from './src/config.js';
import {
  buildBaselinePayload,
  buildErrorPayload,
  buildRecoveryPayload,
  buildTestPayload,
  sendProductEvents,
  sendWebhook
} from './src/discord.js';
import { mergeTwoProducts } from './src/extractors.js';
import { scrapeSmartStore } from './src/scraper.js';
import { errorToString, nowIso, readJson, writeJsonAtomic } from './src/utils.js';

const EMPTY_STATE = {
  version: 1,
  initialized: false,
  failureCount: 0,
  heartbeatMonth: null,
  products: {}
};

const config = loadConfig();
let state = readJson(paths.state, EMPTY_STATE);
state = { ...EMPTY_STATE, ...state, products: state.products || {} };

if (!config.webhookUrl) {
  throw new Error('GitHub 저장소 Secret에 DISCORD_WEBHOOK_URL을 등록해야 합니다.');
}

if (config.runMode === 'test-webhook') {
  await sendWebhook(config.webhookUrl, buildTestPayload(config));
  console.log('Discord Webhook 테스트 메시지를 전송했습니다.');
  process.exit(0);
}

if (config.runMode === 'reset-baseline') {
  state = structuredClone(EMPTY_STATE);
  writeJsonAtomic(paths.state, state);
  console.log('기존 기준값을 초기화했습니다. 새 기준값을 수집합니다.');
}

try {
  const previousFailureCount = state.failureCount || 0;
  const result = await scrapeSmartStore(config, paths.debug);
  const detectedAt = result.collectedAt || nowIso();
  const currentMap = new Map(result.products.map((product) => [product.id, product]));

  if (!state.initialized) {
    state.products = Object.fromEntries(result.products.map((product) => {
      const stored = { ...product, firstSeenAt: detectedAt, lastChangedAt: detectedAt };
      delete stored.source;
      return [product.id, stored];
    }));
    state.initialized = true;
    state.failureCount = 0;
    state.heartbeatMonth = detectedAt.slice(0, 7);
    writeJsonAtomic(paths.state, state);

    if (config.notifyOnBaseline) {
      await sendWebhook(config.webhookUrl, buildBaselinePayload(config, result.products.length, detectedAt));
    }
    console.log(`기준값 저장 완료: ${result.products.length}개 상품`);
    process.exit(0);
  }

  const events = [];
  const nextProducts = { ...state.products };

  for (const [id, currentRaw] of currentMap) {
    const previous = state.products[id] || null;
    const current = mergeForComparison(previous, currentRaw);
    delete current.source;
    current.firstSeenAt = previous?.firstSeenAt || detectedAt;
    nextProducts[id] = current;

    if (!previous) {
      current.lastChangedAt = detectedAt;
      events.push({
        types: ['new'],
        product: current,
        changes: ['🆕 스토어에 새 상품이 등록되었습니다.'],
        detectedAt
      });
      continue;
    }

    const comparison = compareProduct(previous, current);
    if (comparison.types.length) {
      current.lastChangedAt = detectedAt;
      events.push({ ...comparison, product: current, detectedAt });
    } else {
      current.lastChangedAt = previous?.lastChangedAt || previous?.firstSeenAt || detectedAt;
    }
  }

  state.products = nextProducts;
  state.failureCount = 0;
  delete state.lastError;
  delete state.lastErrorAt;
  const currentMonth = detectedAt.slice(0, 7);
  if (state.heartbeatMonth !== currentMonth) state.heartbeatMonth = currentMonth;
  writeJsonAtomic(paths.state, state);

  if (previousFailureCount > 0 && config.notifyOnRecovery) {
    await sendWebhook(config.webhookUrl, buildRecoveryPayload(config));
  }

  if (events.length) {
    console.log(`${events.length}개 상품에서 변경을 감지했습니다.`);
    await sendProductEvents(config.webhookUrl, events, config);
  } else {
    console.log(`변경 없음: ${result.products.length}개 상품 확인 완료`);
  }
} catch (error) {
  const message = errorToString(error);
  state.failureCount = (state.failureCount || 0) + 1;
  state.lastErrorAt = nowIso();
  state.lastError = message;
  writeJsonAtomic(paths.state, state);

  if (state.failureCount === config.errorAlertAfterFailures) {
    try {
      await sendWebhook(config.webhookUrl, buildErrorPayload(config, state.failureCount, message));
    } catch (webhookError) {
      console.error('오류 알림 전송 실패:', errorToString(webhookError));
    }
  }

  console.error(message);
  process.exitCode = 1;
}

function mergeForComparison(previous, currentRaw) {
  const merged = mergeTwoProducts(previous, currentRaw) || currentRaw;
  // Missing values from a list card should not erase richer detail captured earlier.
  for (const field of ['stockQuantity', 'discountRate', 'originalPrice', 'currentPrice', 'imageUrl']) {
    if (currentRaw[field] === null || currentRaw[field] === undefined) {
      merged[field] = previous?.[field] ?? null;
    }
  }
  if (currentRaw.soldOut === null || currentRaw.soldOut === undefined) {
    merged.soldOut = previous?.soldOut ?? null;
    merged.stockStatus = previous?.stockStatus || currentRaw.stockStatus || '확인 불가';
  }
  return merged;
}

function compareProduct(previous, current) {
  const types = [];
  const changes = [];

  const previousSoldOut = previous.soldOut;
  const currentSoldOut = current.soldOut;

  if (previousSoldOut === true && currentSoldOut === false) {
    types.push('restock');
    changes.push('🟢 재고: 품절 → 판매 가능');
  } else if (previousSoldOut === false && currentSoldOut === true) {
    types.push('stock');
    changes.push('🔴 재고: 판매 가능 → 품절');
  }

  if (
    previous.stockQuantity !== null && current.stockQuantity !== null &&
    Number(previous.stockQuantity) !== Number(current.stockQuantity)
  ) {
    if (!types.includes('stock') && !types.includes('restock')) types.push('stock');
    changes.push(`📦 재고 수량: ${formatQuantity(previous.stockQuantity)} → ${formatQuantity(current.stockQuantity)}`);
  }

  const discountChanged = comparableChanged(previous.discountRate, current.discountRate);
  const priceChanged = comparableChanged(previous.currentPrice, current.currentPrice);
  const originalPriceChanged = comparableChanged(previous.originalPrice, current.originalPrice);

  if (discountChanged || priceChanged || originalPriceChanged) {
    types.push('discount');
    if (discountChanged) {
      changes.push(`🏷️ 할인율: ${formatRate(previous.discountRate)} → ${formatRate(current.discountRate)}`);
    }
    if (priceChanged) {
      changes.push(`💰 판매가: ${formatPrice(previous.currentPrice)} → ${formatPrice(current.currentPrice)}`);
    }
  }

  return { types: [...new Set(types)], changes };
}

function comparableChanged(before, after) {
  return before !== null && before !== undefined && after !== null && after !== undefined && Number(before) !== Number(after);
}

function formatQuantity(value) {
  return `${Math.trunc(Number(value)).toLocaleString('ko-KR')}개`;
}

function formatRate(value) {
  return value === null || value === undefined ? '확인 불가' : `${Math.round(Number(value))}%`;
}

function formatPrice(value) {
  return value === null || value === undefined ? '확인 불가' : `${Math.round(Number(value)).toLocaleString('ko-KR')}원`;
}
