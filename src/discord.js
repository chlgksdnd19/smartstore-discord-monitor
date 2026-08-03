import { formatKoreanTime, formatPercent, formatWon, sleep } from './utils.js';

const COLORS = {
  new: 0x3498db,
  restock: 0x2ecc71,
  discount: 0xf1c40f,
  stock: 0xe67e22,
  baseline: 0x5865f2,
  error: 0xe74c3c,
  recovery: 0x1abc9c,
  test: 0x9b59b6
};

export async function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) throw new Error('DISCORD_WEBHOOK_URL GitHub Secret가 설정되지 않았습니다.');
  const response = await fetch(`${webhookUrl}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord Webhook 전송 실패 (${response.status}): ${body.slice(0, 300)}`);
  }
}

export async function sendProductEvents(webhookUrl, events, config) {
  for (const event of events) {
    await sendWebhook(webhookUrl, buildProductPayload(event, config));
    await sleep(700);
  }
}

export function buildProductPayload(event, config) {
  const product = event.product;
  const primaryType = event.types.includes('restock') ? 'restock'
    : event.types.includes('new') ? 'new'
      : event.types.includes('discount') ? 'discount'
        : 'stock';

  const titles = {
    new: '🆕 새 상품 등록',
    restock: '🟢 재고 리스탁',
    discount: '🏷️ 할인율 변동',
    stock: '📦 재고 변동'
  };

  const changeText = event.changes.length ? event.changes.join('\n') : '변경 내용 확인';
  const priceText = product.currentPrice === null
    ? '확인 불가'
    : product.originalPrice && product.originalPrice > product.currentPrice
      ? `${formatWon(product.originalPrice)} → **${formatWon(product.currentPrice)}**`
      : formatWon(product.currentPrice);

  const stockText = product.stockQuantity !== null
    ? `${Math.trunc(product.stockQuantity).toLocaleString('ko-KR')}개`
    : product.stockStatus || '확인 불가';

  const embed = {
    title: titles[primaryType],
    url: product.url,
    color: COLORS[primaryType],
    fields: [
      { name: '상품명', value: truncate(product.name || `상품 ${product.id}`, 1024), inline: false },
      { name: '스토어 URL', value: config.storeUrl, inline: false },
      { name: '상품 URL', value: product.url, inline: false },
      { name: '금액', value: priceText, inline: true },
      { name: '할인율', value: product.discountRate === null ? '확인 불가' : formatPercent(product.discountRate), inline: true },
      { name: '재고', value: stockText, inline: true },
      { name: '변경 내용', value: truncate(changeText, 1024), inline: false },
      { name: '확인 시간', value: formatKoreanTime(event.detectedAt, config.timezone), inline: false }
    ],
    footer: { text: `${config.storeName} · SmartStore Monitor` },
    timestamp: event.detectedAt
  };

  if (product.imageUrl) embed.thumbnail = { url: product.imageUrl };
  return { username: '스마트스토어 모니터', embeds: [embed] };
}

export function buildBaselinePayload(config, count, collectedAt) {
  return {
    username: '스마트스토어 모니터',
    embeds: [{
      title: '✅ 스마트스토어 모니터링 시작',
      color: COLORS.baseline,
      description: '현재 상태를 기준값으로 저장했습니다. 다음 확인부터 변경된 내용만 알립니다.',
      fields: [
        { name: '스토어', value: config.storeName, inline: true },
        { name: '기준 상품 수', value: `${count.toLocaleString('ko-KR')}개`, inline: true },
        { name: '스토어 URL', value: config.storeUrl, inline: false },
        { name: '모니터링', value: '새 상품 등록 · 할인율 변동 · 재고 변동 · 재고 리스탁', inline: false },
        { name: '기준 저장 시간', value: formatKoreanTime(collectedAt, config.timezone), inline: false }
      ],
      timestamp: collectedAt
    }]
  };
}

export function buildTestPayload(config) {
  const timestamp = new Date().toISOString();
  return {
    username: '스마트스토어 모니터',
    embeds: [{
      title: '🧪 디스코드 웹훅 테스트 성공',
      color: COLORS.test,
      description: 'GitHub Actions에서 디스코드 채널로 정상적으로 연결되었습니다.',
      fields: [
        { name: '스토어 URL', value: config.storeUrl, inline: false },
        { name: '확인 시간', value: formatKoreanTime(timestamp, config.timezone), inline: false }
      ],
      timestamp
    }]
  };
}

export function buildErrorPayload(config, failureCount, message) {
  const timestamp = new Date().toISOString();
  return {
    username: '스마트스토어 모니터',
    embeds: [{
      title: '⚠️ 스마트스토어 확인 오류',
      color: COLORS.error,
      description: `${failureCount}회 연속으로 스토어 확인에 실패했습니다.`,
      fields: [
        { name: '스토어 URL', value: config.storeUrl, inline: false },
        { name: '오류', value: truncate(message, 1024), inline: false },
        { name: '확인 시간', value: formatKoreanTime(timestamp, config.timezone), inline: false }
      ],
      timestamp
    }]
  };
}

export function buildRecoveryPayload(config) {
  const timestamp = new Date().toISOString();
  return {
    username: '스마트스토어 모니터',
    embeds: [{
      title: '✅ 스마트스토어 확인 정상화',
      color: COLORS.recovery,
      description: '일시적인 확인 오류가 해소되어 모니터링이 정상적으로 다시 작동합니다.',
      fields: [
        { name: '스토어 URL', value: config.storeUrl, inline: false },
        { name: '확인 시간', value: formatKoreanTime(timestamp, config.timezone), inline: false }
      ],
      timestamp
    }]
  };
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
