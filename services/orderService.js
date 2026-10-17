
import User from '../model/User.js';
import Product from '../model/Product.js';
import LoyaltyTransaction from '../model/LoyaltyTransaction.js';
import Notification from '../model/Notification.js';
import ErrorResponse from '../utils/errorResponse.js';
import sendEmail from '../utils/sendEmail.js';
import * as orderRepo from '../repositories/orderRepository.js';
import * as cartService from './cartService.js';
import { calcShipping, calcTotalWeightKg } from '../utils/shippingUtils.js';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../constants/order.js';
import Order from '../model/Order.js';
import Invoice from '../model/Invoice.js';
import { validateShippingAddress, validateGuestContact } from '../utils/checkoutValidation.js';
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const TAX_RATE = process.env.TAX_RATE !== undefined ? Number(process.env.TAX_RATE) : 0.08;
const LOYALTY_EARN_RATE = 50;
const MAX_LOYALTY_REDEEM_RATIO = 0.25;
const COD_MAX_PRODUCTS = 3;

const ALLOWED_PAYMENT_METHODS = ['card', 'paypal', 'koko', 'cod'];
const ALLOWED_SHIPPING_METHODS = ['courier', 'express', 'pickup'];

const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sanitiseAddress = (addr) => {
  const errors = validateShippingAddress(addr);
  if (errors.length) throw new ErrorResponse(errors.join(', '), 400);

  return {
    fullName: addr.fullName.trim().slice(0, 100),
    addressLine1: addr.addressLine1.trim().slice(0, 200),
    addressLine2: typeof addr.addressLine2 === 'string' ? addr.addressLine2.trim().slice(0, 200) : '',
    city: addr.city.trim().slice(0, 100),
    state: typeof addr.state === 'string' ? addr.state.trim().slice(0, 100) : '',
    postalCode: addr.postalCode.trim().slice(0, 20),
    country: (typeof addr.country === 'string' && addr.country.trim()) ? addr.country.trim().slice(0, 100) : 'Sri Lanka',
    phone: addr.phone.trim(),
  };
};

export const createOrder = async (userId, sessionId, orderData) => {
  const cart = await cartService.getCart(userId, sessionId);
  if (!cart?.items?.length) throw new ErrorResponse('Cart is empty', 400);

  const paymentMethod = ALLOWED_PAYMENT_METHODS.includes(orderData.paymentMethod) ? orderData.paymentMethod : 'card';
  const shippingMethod = ALLOWED_SHIPPING_METHODS.includes(orderData.shippingMethod) ? orderData.shippingMethod : 'courier';

  const shippingAddress = sanitiseAddress(orderData.shippingAddress);

  if (!userId) {
    const guestErrors = validateGuestContact(orderData);
    if (guestErrors.length) throw new ErrorResponse(guestErrors.join(', '), 400);
  }

  if (paymentMethod === 'cod') {
    const totalQuantity = cart.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (totalQuantity > COD_MAX_PRODUCTS) {
      throw new ErrorResponse(`Cash on Delivery is limited to ${COD_MAX_PRODUCTS} products per order`, 400);
    }
  }


  const productIds = cart.items.map(i => String(i.product._id || i.product));
  const products = await Product.find({ _id: { $in: productIds } }).select('stock isActive name').lean();
  const productMap = new Map(products.map(p => [p._id.toString(), p]));

  for (const item of cart.items) {
    const pid = String(item.product._id || item.product);
    const prod = productMap.get(pid);
    if (!prod || !prod.isActive) throw new ErrorResponse('Product unavailable', 400);
    if (prod.stock < item.quantity) throw new ErrorResponse(`Insufficient stock for ${prod.name}`, 400);
  }

  const totalWeightKg = calcTotalWeightKg(cart.items);
  const shippingCost = calcShipping(shippingMethod, totalWeightKg);
  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const discount = Number(cart.discount) || 0;

  const loyaltyUsed = Number(orderData.loyaltyPointsUsed) || 0;
  if (loyaltyUsed < 0) {
    throw new ErrorResponse('Invalid loyalty points to redeem', 400);
  }
  if (loyaltyUsed > 0) {
    if (!userId) {
      throw new ErrorResponse('Guest checkout cannot redeem loyalty points', 400);
    }
    const user = await User.findById(userId).select('loyaltyPoints');
    if (!user) {
      throw new ErrorResponse('User not found', 404);
    }
    if (loyaltyUsed > user.loyaltyPoints) {
      throw new ErrorResponse(`Cannot redeem more points than available: ${user.loyaltyPoints}`, 400);
    }
    if (loyaltyUsed > subtotal) {
      throw new ErrorResponse('Loyalty discount cannot exceed order subtotal', 400);
    }
  }

  const taxable = Math.max(0, subtotal - discount - loyaltyUsed);
  const tax = Math.round(taxable * TAX_RATE);
  const total = taxable + shippingCost + tax;

  const loyaltyEarned = Math.floor(total / LOYALTY_EARN_RATE);

  const order = await orderRepo.create({
    user: userId || null,
    guestEmail: userId ? '' : orderData.guestEmail.trim().toLowerCase(),
    guestName: userId ? '' : (typeof orderData.guestName === 'string' ? orderData.guestName.trim().slice(0, 100) : ''),
    items: cart.items.map(i => ({
      product: i.product._id || i.product,
      name: i.product.name || '',
      image: i.selectedVariant?.image || i.product.images?.[0]?.url || '',
      price: i.price,
      quantity: i.quantity,
      selectedVariant: i.selectedVariant || undefined,
    })),
    shippingAddress,
    paymentMethod,
    shippingMethod,
    subtotal,
    shippingCost,
    discount,
    tax,
    total,
    coupon: cart.coupon?.code || '',
    loyaltyPointsUsed: loyaltyUsed,
    loyaltyPointsEarned: loyaltyEarned,
    loyaltyPointsAwarded: false,
    notes: (orderData.notes || orderData.orderNotes || '').trim().slice(0, 500),
  });

  const lastOnlineInvoice = await Invoice.findOne({ invoiceType: 'online' })
    .sort({ createdAt: -1 })
    .select('invoiceNo')
    .lean();
  const lastInvoiceNumber = Number.parseInt(
    String(lastOnlineInvoice?.invoiceNo || '').replace(/^O/, ''),
    10,
  );
  const invoiceNo = `O${Number.isFinite(lastInvoiceNumber) ? lastInvoiceNumber + 1 : 1001}`;

  await Invoice.create({
    invoiceNo,
    invoiceType: 'online',
    sourceOrder: order._id,
    dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    paymentMethod: paymentMethod === 'cod' ? 'COD' : 'online',
    clientDetails: {
      clientName: shippingAddress.fullName,
      address: [shippingAddress.addressLine1, shippingAddress.addressLine2, shippingAddress.city, shippingAddress.state, shippingAddress.country]
        .filter(Boolean)
        .join(', '),
      email: order.guestEmail || '',
      phone: shippingAddress.phone || '',
    },
    items: order.items.map((item) => ({
      product: item.product,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.price * item.quantity,
    })),
    subtotal,
    discount,
    deliveryFee: shippingCost,
    taxPercent: subtotal - discount > 0 ? (tax / (subtotal - discount)) * 100 : 0,
    taxAmount: tax,
    totalAmountDue: total,
  });

  await Order.findByIdAndUpdate(order._id, { invoiceNo });
  order.invoiceNo = invoiceNo;

  await Promise.allSettled(cart.items.map(async (item) => {
    const prodId = item.product._id || item.product;
    await Product.findByIdAndUpdate(prodId, { $inc: { stock: -item.quantity } });
    if (item.selectedVariant?.sku) {
      await Product.updateOne(
        { _id: prodId, 'variants.sku': item.selectedVariant.sku },
        { $inc: { 'variants.$.stock': -item.quantity } }
      );
    } else if (item.selectedVariant?.name) {
      await Product.updateOne(
        { _id: prodId, 'variants.name': item.selectedVariant.name },
        { $inc: { 'variants.$.stock': -item.quantity } }
      );
    }
  }));

  if (userId) {
    if (loyaltyUsed > 0) {
      await User.findByIdAndUpdate(userId, { $inc: { loyaltyPoints: -loyaltyUsed } });
      await LoyaltyTransaction.create({
        user: userId,
        type: 'redeemed',
        reason: 'redemption',
        points: loyaltyUsed,
        refId: order._id,
        refModel: 'Order',
        desc: `Redeemed points on order #${order.orderNumber}`,
      });
    }
    await Notification.create({
      user: userId,
      title: 'Order Placed',
      message: `Order #${order.orderNumber} placed. You will earn ${loyaltyEarned} points when it is delivered!`,
      type: 'order',
      link: `/track-order/${order._id}`,
    });
  }

  await cartService.clearCart(userId, sessionId);

  const emailTo = order.guestEmail || (userId && (await User.findById(userId).select('email')).email);
  if (emailTo) {
    sendEmail({
      to: emailTo,
      subject: `Order Confirmation - ${order.orderNumber}`,
      html: buildOrderEmail(order),
    }).catch(console.error);
  }

  return order;
};

const buildOrderEmail = (order) => {  };

export const getOrderById = async (id, userId, role) => {
  if (!OBJECT_ID_RE.test(id)) throw new ErrorResponse('Invalid ID', 400);
  const order = await orderRepo.findById(id);
  if (!order) throw new ErrorResponse('Order not found', 404);

  const isAdmin = ['admin', 'superadmin'].includes(role);
  if (!isAdmin && userId && String(order.user) !== String(userId)) {
    throw new ErrorResponse('Access denied', 403);
  }
  return order;
};

export const updateOrderStatus = async (id, updateData) => {
  if (!OBJECT_ID_RE.test(id)) throw new ErrorResponse('Invalid ID', 400);
  const order = await orderRepo.update(id, updateData);
  if (!order) throw new ErrorResponse('Order not found', 404);
  return order;
};

export const getUserOrders = async (userId, options = {}) => {
  const { page = 1, limit = 20, sort = '-createdAt', status } = options;

  const query = { user: userId };
  if (status) query.orderStatus = status;

  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(query)
  ]);

  return {
    orders,
    total,
    page,
    pages: Math.ceil(total / limit)
  };
};