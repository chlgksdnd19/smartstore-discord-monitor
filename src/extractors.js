import {
  calculateDiscountRate,
  cleanText,
  firstNonEmpty,
  normalizeProductUrl,
  productIdFromUrl,
  toNumber
} from './utils.js';

const ID_KEYS = ['channelProductNo', 'productNo', 'productId', 'channelProductId'];
const NAME_KEYS = ['channelProductName', 'productName', 'name', 'productTitle', 'title'];
const CURRENT_PRICE_KEYS = [
  'discountedPrice', 'discountPrice', 'salePrice', 'finalPrice', 'mobileDiscountedPrice',
  'mobileDiscountPrice', 'price'
];
const ORIGINAL_PRICE_KEYS = [
  'originalPrice', 'regularPrice', 'basePrice', 'normalPrice', 'listPrice', 'consumerPrice', 'salePrice'
];
const DISCOUNT_KEYS = ['discountRate', 'discountPercent', 'mobileDiscountRate', 'discountRatio'];
const STOCK_KEYS = ['stockQuantity', 'remainQuantity', 'remainingQuantity', 'stock', 'quantity'];
const IMAGE_KEYS = [
  'representativeImageUrl', 'representativeImage', 'imageUrl', 'image', 'thumbnailUrl', 'thumbnail'
];
const URL_KEYS = ['productUrl', 'channelProductUrl', 'url', 'link'];
const STATUS_KEYS = [
  'saleStatusType', 'productStatusType', 'statusType', 'stockStatusType', 'saleStatus', 'status',
  'soldOut', 'isSoldOut', 'available', 'isAvailable'
];

export function extractProductsFromJson(payload, storeUrl) {
  const products = [];
  const seenObjects = new WeakSet();

  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 18) return;
    if (seenObjects.has(value)) return;
    seenObjects.add(value);

    if (!Array.isArray(value)) {
      const product = productFromObject(value, storeUrl);
      if (product) products.push(product);
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') walk(child, depth + 1);
    }
  }

  walk(payload);
  return mergeProducts(products);
}

export function extractProductDetail(payload, productUrl, storeUrl) {
  const id = productIdFromUrl(productUrl);
  const candidates = extractProductsFromJson(payload, storeUrl);
  const exact = candidates.find((item) => item.id === id);
  const root = payload && typeof payload === 'object' ? payload : {};

  const deep = {
    id,
    url: productUrl,
    name: cleanText(deepFind(root, NAME_KEYS)),
    currentPrice: toNumber(deepFind(root, CURRENT_PRICE_KEYS)),
    originalPrice: toNumber(deepFind(root, ORIGINAL_PRICE_KEYS)),
    discountRate: toNumber(deepFind(root, DISCOUNT_KEYS)),
    stockQuantity: extractStockQuantity(root),
    imageUrl: normalizeImage(deepFind(root, IMAGE_KEYS)),
    ...extractAvailability(root)
  };

  return finalizeProduct(mergeTwoProducts(deep, exact), storeUrl);
}

function productFromObject(object, storeUrl) {
  const idValue = directValue(object, ID_KEYS);
  const urlValue = directValue(object, URL_KEYS);
  const id = normalizeId(idValue) || productIdFromUrl(urlValue);
  if (!id) return null;

  const name = cleanText(directValue(object, NAME_KEYS));
  const currentPrice = toNumber(directValue(object, CURRENT_PRICE_KEYS));
  const originalPrice = toNumber(directValue(object, ORIGINAL_PRICE_KEYS));
  const imageUrl = normalizeImage(directValue(object, IMAGE_KEYS));
  const status = extractAvailability(object);
  const stockQuantity = toNumber(directValue(object, STOCK_KEYS));

  const hasProductSignal = Boolean(
    name || currentPrice !== null || imageUrl || stockQuantity !== null || status.stockStatus !== '확인 불가' || urlValue
  );
  if (!hasProductSignal) return null;

  return finalizeProduct({
    id,
    url: normalizeProductUrl(urlValue, storeUrl) || `${storeUrl}/products/${id}`,
    name,
    currentPrice,
    originalPrice,
    discountRate: toNumber(directValue(object, DISCOUNT_KEYS)),
    stockQuantity,
    imageUrl,
    ...status
  }, storeUrl);
}

export function finalizeProduct(product, storeUrl) {
  if (!product?.id) return null;
  const currentPrice = toNumber(product.currentPrice);
  let originalPrice = toNumber(product.originalPrice);
  if (originalPrice !== null && currentPrice !== null && originalPrice < currentPrice) {
    [originalPrice] = [currentPrice];
  }

  const computedDiscount = calculateDiscountRate(originalPrice, currentPrice);
  const discountRate = firstNonEmpty(toNumber(product.discountRate), computedDiscount);
  const soldOut = typeof product.soldOut === 'boolean' ? product.soldOut : null;
  const stockQuantity = toNumber(product.stockQuantity);

  let stockStatus = cleanText(product.stockStatus, 80) || '확인 불가';
  if (soldOut === true) stockStatus = '품절';
  else if (soldOut === false && stockStatus === '확인 불가') stockStatus = '판매 가능';
  if (stockQuantity !== null && soldOut !== true) stockStatus = `${Math.max(0, Math.trunc(stockQuantity))}개`;

  return {
    id: String(product.id),
    url: normalizeProductUrl(product.url, storeUrl) || `${storeUrl}/products/${product.id}`,
    name: cleanText(product.name, 200) || `상품 ${product.id}`,
    currentPrice,
    originalPrice,
    discountRate,
    stockQuantity,
    soldOut,
    stockStatus,
    imageUrl: normalizeImage(product.imageUrl),
    source: product.source || 'unknown'
  };
}

export function mergeProducts(products) {
  const map = new Map();
  for (const raw of products) {
    if (!raw?.id) continue;
    const existing = map.get(String(raw.id));
    map.set(String(raw.id), mergeTwoProducts(existing, raw));
  }
  return [...map.values()];
}

export function mergeTwoProducts(base, incoming) {
  if (!base) return incoming ? { ...incoming } : null;
  if (!incoming) return { ...base };

  const output = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined && value !== '' && value !== '확인 불가' && value !== 'unknown') {
      output[key] = value;
    }
  }
  return output;
}

function directValue(object, keys) {
  if (!object || typeof object !== 'object') return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  const entries = Object.entries(object);
  for (const wanted of keys) {
    const found = entries.find(([key]) => key.toLowerCase() === wanted.toLowerCase());
    if (found) return found[1];
  }
  return null;
}

function deepFind(root, keys, maxDepth = 10) {
  const queue = [{ value: root, depth: 0 }];
  const seen = new WeakSet();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > maxDepth) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (!Array.isArray(value)) {
      const direct = directValue(value, keys);
      if (direct !== null && direct !== undefined && direct !== '') return direct;
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

function extractStockQuantity(root) {
  const optionRecords = [];
  const totals = [];
  const seen = new WeakSet();

  function walk(value, path = '', depth = 0) {
    if (!value || typeof value !== 'object' || depth > 14) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) {
      const quantity = toNumber(directValue(value, STOCK_KEYS));
      if (quantity !== null) {
        const optionLabel = cleanText(firstNonEmpty(
          directValue(value, ['optionName', 'optionValue', 'combinationName', 'name']),
          directValue(value, ['optionId', 'combinationId'])
        ));
        const looksLikeOption = /option|combination/i.test(path) || Boolean(optionLabel);
        if (looksLikeOption) optionRecords.push({ key: optionLabel || path, quantity });
        else totals.push(quantity);
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === 'object') walk(child, `${path}.${key}`, depth + 1);
    }
  }

  walk(root, 'root');
  if (optionRecords.length) {
    const unique = new Map();
    for (const item of optionRecords) unique.set(item.key, item.quantity);
    return [...unique.values()].reduce((sum, value) => sum + Math.max(0, value), 0);
  }
  return totals.length ? totals[0] : null;
}

function extractAvailability(root) {
  const entries = [];
  const queue = [{ value: root, depth: 0 }];
  const seen = new WeakSet();

  while (queue.length && entries.length < 100) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > 8) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (!Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (STATUS_KEYS.some((wanted) => key.toLowerCase() === wanted.toLowerCase())) {
          entries.push({ key, value: child });
        }
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
      }
    } else {
      for (const child of value) {
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
      }
    }
  }

  for (const entry of entries) {
    const key = entry.key.toLowerCase();
    if (typeof entry.value !== 'boolean') continue;
    if (/soldout/.test(key)) {
      return entry.value
        ? { soldOut: true, stockStatus: '품절' }
        : { soldOut: false, stockStatus: '판매 가능' };
    }
    if (/available/.test(key)) {
      return entry.value
        ? { soldOut: false, stockStatus: '판매 가능' }
        : { soldOut: true, stockStatus: '품절' };
    }
  }

  const joined = entries.map((entry) => String(entry.value)).join(' ').toUpperCase();
  if (/(OUT_OF_STOCK|OUTOFSTOCK|SOLD_OUT|SOLDOUT|품절|판매종료|판매 종료|SUSPEND|CLOSE)/i.test(joined)) {
    return {
      soldOut: true,
      stockStatus: /판매종료|판매 종료|SUSPEND|CLOSE/i.test(joined) ? '판매 종료' : '품절'
    };
  }

  if (/(^|\W)(SALE|ON_SALE|AVAILABLE|판매중|판매 가능)(\W|$)/i.test(joined)) {
    return { soldOut: false, stockStatus: '판매 가능' };
  }

  return { soldOut: null, stockStatus: '확인 불가' };
}

function normalizeId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const match = String(value || '').match(/\d{6,}/);
  return match?.[0] || null;
}

function normalizeImage(value) {
  if (!value) return null;
  if (typeof value === 'object') {
    const nested = firstNonEmpty(value.url, value.src, value.imageUrl);
    if (!nested) return null;
    value = nested;
  }
  const text = String(value).trim();
  if (text.startsWith('//')) return `https:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return null;
}
