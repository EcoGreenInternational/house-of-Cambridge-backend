import crypto from 'crypto';
import ErrorResponse from './errorResponse.js';

const REQUIRED_NOTIFY_FIELDS = Object.freeze([
  'merchant_id', 'order_id', 'payhere_amount',
  'payhere_currency', 'status_code', 'md5sig',
]);

const ALLOWED_CURRENCIES = Object.freeze(['LKR', 'USD', 'EUR', 'GBP']);

const CHECKOUT_URLS = Object.freeze({
  live:    'https://www.payhere.lk/pay/checkout',
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
});

// PayHere rejects emojis / markup in params ("Something Went Wrong")
const cleanParam = (value, max = 100) =>
  String(value ?? '')
    .replace(/[<>"'`]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u024F]/g, '')
    .trim()
    .slice(0, max);

export const formatPayHereAmount = (amount) => Number(amount).toFixed(2);

export const getPayHereCheckoutUrl = () =>
  process.env.PAYHERE_MODE === 'live' ? CHECKOUT_URLS.live : CHECKOUT_URLS.sandbox;

const hashSecret = (secret) =>
  crypto.createHash('md5').update(secret).digest('hex').toUpperCase();

const assertEnv = () => {
  if (!process.env.PAYHERE_MERCHANT_SECRET || !process.env.PAYHERE_MERCHANT_ID) {
    throw new ErrorResponse('PayHere is not configured', 500);
  }
};

export const generatePayHereHash = (merchantId, orderId, amount, currency) => {
  assertEnv();

  if (!merchantId || !orderId) {
    throw new ErrorResponse('merchantId and orderId are required', 400);
  }

  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new ErrorResponse('Amount must be a positive number', 400);
  }

  if (!ALLOWED_CURRENCIES.includes(currency)) {
    throw new ErrorResponse(`Currency must be one of: ${ALLOWED_CURRENCIES.join(', ')}`, 400);
  }

  const formattedAmount = formatPayHereAmount(parsedAmount);
  const hashed          = hashSecret(process.env.PAYHERE_MERCHANT_SECRET);
  const raw             = `${merchantId}${orderId}${formattedAmount}${currency}${hashed}`;

  return crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
};

export const buildPayHereCheckout = (order) => {
  assertEnv();

  const merchantId = process.env.PAYHERE_MERCHANT_ID;
  const clientUrl  = (process.env.CLIENT_URL || '').replace(/\/+$/, '');
  const currency   = 'LKR';
  const amount     = formatPayHereAmount(order.total);

  const addr      = order.shippingAddress ?? {};
  const fullName  = cleanParam(addr.fullName || order.guestName || order.user?.name || 'Customer');
  const [first, ...rest] = fullName.split(/\s+/);
  const email     = order.guestEmail || order.user?.email || '';
  const phone     = addr.phone || order.user?.phone || '';

  const params = {
    merchant_id: merchantId,
    return_url:  `${clientUrl}/order-confirmation/${order._id}`,
    cancel_url:  `${clientUrl}/payment-denied?order=${order._id}`,
    notify_url:  process.env.PAYHERE_NOTIFY_URL,
    order_id:    order.orderNumber,
    items:       cleanParam(`Order ${order.orderNumber}`),
    currency,
    amount,
    first_name:  first || 'Customer',
    last_name:   rest.join(' ') || first || 'Customer',
    email:       cleanParam(email, 254),
    phone:       cleanParam(phone, 20),
    address:     cleanParam([addr.addressLine1, addr.addressLine2].filter(Boolean).join(', '), 200),
    city:        cleanParam(addr.city),
    country:     cleanParam(addr.country || 'Sri Lanka'),
    custom_1:    String(order._id),
    hash:        generatePayHereHash(merchantId, order.orderNumber, amount, currency),
  };

  (order.items || []).forEach((item, i) => {
    const n = i + 1;
    params[`item_name_${n}`]   = cleanParam(item.name);
    params[`item_number_${n}`] = cleanParam(item.selectedVariant?.sku || item.product?._id || item.product, 50);
    params[`amount_${n}`]      = formatPayHereAmount(item.price);
    params[`quantity_${n}`]    = String(item.quantity);
  });

  return { action: getPayHereCheckoutUrl(), params };
};

export const verifyPayHereNotification = (data) => {
  assertEnv();

  if (!data || typeof data !== 'object') return false;

  for (const field of REQUIRED_NOTIFY_FIELDS) {
    if (!data[field] && data[field] !== 0) return false;
  }

  if (typeof data.md5sig !== 'string' || !/^[A-F0-9]{32}$/.test(data.md5sig)) return false;

  const hashed = hashSecret(process.env.PAYHERE_MERCHANT_SECRET);
  const raw    = `${data.merchant_id}${data.order_id}${data.payhere_amount}${data.payhere_currency}${data.status_code}${hashed}`;
  const local  = crypto.createHash('md5').update(raw).digest('hex').toUpperCase();

  return crypto.timingSafeEqual(Buffer.from(local), Buffer.from(data.md5sig.toUpperCase()));
};