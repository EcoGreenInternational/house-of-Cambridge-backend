import Order from '../model/Order.js';
import Notification from '../model/Notification.js';
import ErrorResponse from '../utils/errorResponse.js';
import {
  verifyPayHereNotification,
  buildPayHereCheckout,
  formatPayHereAmount,
} from '../utils/payhereUtils.js';
import { createPayPalOrder, capturePayPalOrder } from '../utils/paypalUtils.js';
import axios from 'axios';
import { logger } from '../utils/logger.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const ALLOWED_CURRENCIES = Object.freeze(['LKR', 'USD', 'EUR', 'GBP']);

// https://support.payhere.lk/api-&-mobile-sdk/checkout-api
const PAYHERE_STATUS = Object.freeze({
  SUCCESS:     '2',
  PENDING:     '0',
  CANCELLED:   '-1',
  FAILED:      '-2',
  CHARGEDBACK: '-3',
});

const sanitiseOrderId = (id, next) => {
  if (!id || !OBJECT_ID_RE.test(id)) {
    next(new ErrorResponse('Invalid order ID', 400));
    return false;
  }
  return true;
};

const createPaymentNotification = async (order, message) => {
  if (!order.user) return;
  await Notification.create({
    user:    order.user,
    title:   'Payment Confirmed',
    message,
    type:    'order',
    link:    `/track-order/${order._id}`,
  });
};

export const createPayHereCheckout = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!sanitiseOrderId(orderId, next)) return;

    const order = await Order.findById(orderId)
      .select('user guestEmail guestName orderNumber items shippingAddress total paymentMethod paymentStatus orderStatus')
      .populate('user', 'name email phone')
      .lean();
    if (!order) return next(new ErrorResponse('Order not found', 404));

    if (order.user) {
      const isOwner = req.user && String(order.user._id) === String(req.user._id);
      if (!isOwner) return next(new ErrorResponse('Access denied', 403));
    }

    if (order.paymentMethod !== 'card') {
      return next(new ErrorResponse('This order is not a card payment order', 400));
    }
    if (order.paymentStatus === 'paid') {
      return next(new ErrorResponse('This order has already been paid', 400));
    }
    if (order.orderStatus === 'cancelled') {
      return next(new ErrorResponse('This order has been cancelled', 400));
    }
    if (!Number.isFinite(order.total) || order.total <= 0) {
      return next(new ErrorResponse('Order total is invalid', 422));
    }
    if (!process.env.PAYHERE_NOTIFY_URL) {
      return next(new ErrorResponse('PayHere notify URL is not configured', 500));
    }

    const checkout = buildPayHereCheckout(order);
    return res.json({ success: true, ...checkout });
  } catch (err) {
    return next(err);
  }
};

export const payHereNotify = async (req, res) => {
  try {
    const data = req.body;

    const valid = verifyPayHereNotification(data);
    if (!valid) return res.status(400).send('Invalid signature');

    if (String(data.merchant_id) !== String(process.env.PAYHERE_MERCHANT_ID)) {
      return res.status(400).send('Merchant mismatch');
    }

    if (!data.order_id || typeof data.order_id !== 'string') {
      return res.status(400).send('Missing order_id');
    }

    const order = await Order.findOne({ orderNumber: data.order_id }).select(
      'user orderNumber total paymentMethod paymentStatus orderStatus paymentId adminNotes',
    );
    if (!order) return res.status(404).send('Order not found');

    // The signature only proves PayHere sent it; also make sure the amount is the one we charged
    const amountMatches =
      data.payhere_currency === 'LKR' &&
      formatPayHereAmount(data.payhere_amount) === formatPayHereAmount(order.total);
    if (!amountMatches) {
      logger.warn('PayHere amount mismatch', {
        orderNumber: order.orderNumber,
        amount:      data.payhere_amount,
        currency:    data.payhere_currency,
      });
      return res.status(400).send('Amount mismatch');
    }

    const status = String(data.status_code);

    if (status === PAYHERE_STATUS.SUCCESS) {
      if (order.paymentStatus !== 'paid') {
        order.paymentStatus = 'paid';
        if (order.orderStatus === 'pending') order.orderStatus = 'confirmed';
        order.paymentId = String(data.payment_id || '');
        await order.save();
        await createPaymentNotification(
          order,
          `Payment for order #${order.orderNumber} was successful.`,
        );
      }
    } else if (status === PAYHERE_STATUS.CANCELLED || status === PAYHERE_STATUS.FAILED) {
      // Never downgrade an order that has already been paid
      if (order.paymentStatus === 'pending') {
        order.paymentStatus = 'failed';
        await order.save();
      }
    } else if (status === PAYHERE_STATUS.CHARGEDBACK) {
      order.paymentStatus = 'refunded';
      order.adminNotes = `${order.adminNotes ? `${order.adminNotes}\n` : ''}PayHere chargeback on payment ${data.payment_id || ''}`.slice(0, 1000);
      await order.save();
    }
    // PENDING: leave the order as it is and wait for the next notification

    return res.send('OK');
  } catch (err) {
    logger.error('PayHere notify failed', { error: err.message });
    return res.status(500).send('Error');
  }
};

export const createPayPalPayment = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!sanitiseOrderId(orderId, next)) return;

    const order = await Order.findById(orderId).select('total user').lean();
    if (!order) return next(new ErrorResponse('Order not found', 404));

    if (order.user && String(order.user) !== String(req.user._id)) {
      return next(new ErrorResponse('Access denied', 403));
    }

    if (!Number.isFinite(order.total) || order.total <= 0) {
      return next(new ErrorResponse('Order total is invalid', 422));
    }

    const paypalOrder = await createPayPalOrder(order.total, 'USD');
    return res.json({ success: true, paypalOrderId: paypalOrder.id });
  } catch (err) {
    return next(err);
  }
};

export const capturePayPalPayment = async (req, res, next) => {
  try {
    const { paypalOrderId, orderId } = req.body;

    if (!orderId || !OBJECT_ID_RE.test(orderId)) {
      return next(new ErrorResponse('Invalid order ID', 400));
    }

    if (!paypalOrderId || typeof paypalOrderId !== 'string' || paypalOrderId.length > 64) {
      return next(new ErrorResponse('Invalid PayPal order ID', 400));
    }

    const order = await Order.findById(orderId).select(
      'user orderNumber paymentStatus orderStatus paymentId',
    );
    if (!order) return next(new ErrorResponse('Order not found', 404));

    if (order.user && String(order.user) !== String(req.user._id)) {
      return next(new ErrorResponse('Access denied', 403));
    }

    const capture = await capturePayPalOrder(paypalOrderId);
    if (capture.status !== 'COMPLETED') {
      return next(new ErrorResponse('PayPal capture failed', 400));
    }

    order.paymentStatus = 'paid';
    order.orderStatus   = 'confirmed';
    order.paymentId     = paypalOrderId;
    await order.save();

    await createPaymentNotification(
      order,
      `PayPal payment for order #${order.orderNumber} was successful.`,
    );

    return res.json({ success: true, order });
  } catch (err) {
    return next(err);
  }
};

export const initiateKoko = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    if (!sanitiseOrderId(orderId, next)) return;

    const order = await Order.findById(orderId).select('orderNumber total _id user').lean();
    if (!order) return next(new ErrorResponse('Order not found', 404));

    if (order.user && String(order.user) !== String(req.user._id)) {
      return next(new ErrorResponse('Access denied', 403));
    }

    const kokoRes = await axios.post(
      'https://api.koko.lk/v1/orders',
      {
        merchant_id: process.env.KOKO_MERCHANT_ID,
        order_id:    order.orderNumber,
        amount:      order.total,
        currency:    'LKR',
        notify_url:  process.env.KOKO_NOTIFY_URL,
        return_url:  `${process.env.CLIENT_URL}/order-confirmation/${order._id}`,
        cancel_url:  `${process.env.CLIENT_URL}/payment-denied`,
      },
      { headers: { Authorization: `Bearer ${process.env.KOKO_API_KEY}` } },
    );

    if (!kokoRes.data?.checkout_url) {
      return next(new ErrorResponse('KOKO did not return a checkout URL', 502));
    }

    return res.json({ success: true, redirectUrl: kokoRes.data.checkout_url });
  } catch (err) {
    return next(err);
  }
};

export const kokoNotify = async (req, res) => {
  try {
    const { order_id, status } = req.body;

    if (!order_id || typeof order_id !== 'string') {
      return res.status(400).send('Missing order_id');
    }

    // Verify webhook signature or auth token if configured
    const signature = req.headers['x-koko-signature'] || req.headers['authorization'];
    if (process.env.KOKO_WEBHOOK_SECRET && signature !== process.env.KOKO_WEBHOOK_SECRET) {
      logger.warn('Koko unauthorized webhook attempt', { order_id });
      return res.status(401).send('Unauthorized webhook signature');
    }

    const order = await Order.findOne({ orderNumber: order_id }).select(
      'paymentStatus orderStatus user orderNumber',
    );
    if (!order) return res.status(404).send('Not found');

    if (status === 'SUCCESS') {
      if (process.env.KOKO_API_KEY) {
        try {
          const verifyRes = await axios.get(
            `https://api.koko.lk/v1/orders/${encodeURIComponent(order_id)}`,
            { headers: { Authorization: `Bearer ${process.env.KOKO_API_KEY}` }, timeout: 5000 }
          );
          if (verifyRes.data?.status !== 'SUCCESS') {
            logger.warn('Koko payment status verification mismatch', { order_id, returnedStatus: verifyRes.data?.status });
            return res.status(400).send('Payment not verified with Koko gateway');
          }
        } catch (verifyErr) {
          logger.warn('Could not verify status with Koko endpoint', { error: verifyErr.message });
        }
      }

      order.paymentStatus = 'paid';
      order.orderStatus   = 'confirmed';
      await order.save();

      await createPaymentNotification(
        order,
        `Payment for order #${order.orderNumber} via Koko was successful.`,
      );
    }

    return res.send('OK');
  } catch (err) {
    return res.status(500).send('Error');
  }
};