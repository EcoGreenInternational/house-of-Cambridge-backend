
import User from '../model/User.js';
import Product from '../model/Product.js';
import Notification from '../model/Notification.js';
import ErrorResponse from '../utils/errorResponse.js';
import sendEmail from '../utils/sendEmail.js';
import * as orderRepo from '../repositories/orderRepository.js';
import * as cartService from './cartService.js';
import { calcShipping, calcTotalWeightKg } from '../utils/shippingUtils.js';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../constants/order.js';
import Order from '../model/Order.js';
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const TAX_RATE = 0.08;
const LOYALTY_EARN_RATE = 50;
const MAX_LOYALTY_REDEEM_RATIO = 0.25;

const ALLOWED_PAYMENT_METHODS = ['card', 'paypal', 'koko', 'cod'];
const ALLOWED_SHIPPING_METHODS = ['courier', 'express', 'pickup'];

const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const sanitiseAddress = (addr) => {
  if (!addr || typeof addr !== 'object') throw new ErrorResponse('Shipping address is required', 400);

  const required = ['fullName', 'addressLine1', 'city', 'postalCode', 'country'];
  for (const field of required) {
    if (!addr[field]?.trim()) throw new ErrorResponse(`Missing field: ${field}`, 400);
  }

  return {
    fullName: addr.fullName.trim().slice(0, 100),
    addressLine1: addr.addressLine1.trim().slice(0, 200),
    addressLine2: (addr.addressLine2 || '').trim().slice(0, 200),
    city: addr.city.trim().slice(0, 100),
    state: (addr.state || '').trim().slice(0, 100),
    postalCode: addr.postalCode.trim().slice(0, 20),
    country: addr.country.trim().slice(0, 100),
    phone: (addr.phone || '').trim().slice(0, 20),
  };
};

export const createOrder = async (userId, sessionId, orderData) => {
  const cart = await cartService.getCart(userId, sessionId);
  if (!cart?.items?.length) throw new ErrorResponse('Cart is empty', 400);

  const paymentMethod = ALLOWED_PAYMENT_METHODS.includes(orderData.paymentMethod) ? orderData.paymentMethod : 'card';
  const shippingMethod = ALLOWED_SHIPPING_METHODS.includes(orderData.shippingMethod) ? orderData.shippingMethod : 'courier';

  const shippingAddress = sanitiseAddress(orderData.shippingAddress);


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

  const loyaltyUsed = Math.min(
    Number(orderData.loyaltyPointsUsed) || 0,
    Math.floor(subtotal * MAX_LOYALTY_REDEEM_RATIO)
  );

  const taxable = Math.max(0, subtotal - discount - loyaltyUsed);
  const tax = Math.round(taxable * TAX_RATE);
  const total = taxable + shippingCost + tax;

  const loyaltyEarned = Math.floor(total / LOYALTY_EARN_RATE);

  const order = await orderRepo.create({
    user: userId || null,
    guestEmail: orderData.guestEmail?.trim() || '',
    guestName: orderData.guestName?.trim() || '',
    items: cart.items.map(i => ({
      product: i.product._id || i.product,
      name: i.product.name || '',
      image: i.product.images?.[0]?.url || '',
      price: i.price,
      quantity: i.quantity,
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
    notes: (orderData.notes || orderData.orderNotes || '').trim().slice(0, 500),
  });

  await Promise.allSettled(cart.items.map(item =>
    Product.findByIdAndUpdate(item.product._id || item.product, { $inc: { stock: -item.quantity } })
  ));

  if (userId) {
    await User.findByIdAndUpdate(userId, { $inc: { loyaltyPoints: loyaltyEarned - loyaltyUsed } });
    await Notification.create({
      user: userId,
      title: 'Order Placed',
      message: `Order #${order.orderNumber} placed. You earned ${loyaltyEarned} points!`,
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