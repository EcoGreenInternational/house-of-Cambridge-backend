import Order from '../model/Order.js';
import * as orderService from '../services/orderService.js';
import * as orderRepo from '../repositories/orderRepository.js';
import ErrorResponse from '../utils/errorResponse.js';
import { awardLoyaltyPoints } from '../utils/loyaltyHelper.js';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../constants/order.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const ORDER_NUM_RE = /^HOC-\d{4}-\d{5}$/i;

const ALLOWED_ROLES = Object.freeze(['admin', 'manager', 'superadmin']);

const sanitiseListQuery = (query) => ({
  page: Math.max(1, parseInt(query.page, 10) || 1),
  limit: Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20)),
  sort: ['createdAt', '-createdAt', 'total', '-total'].includes(query.sort)
    ? query.sort
    : '-createdAt',
  status: ORDER_STATUSES.includes(query.status) ? query.status : undefined,
});

export const createOrder = async (req, res, next) => {
  try {
    const userId = req.user?._id ?? null;
    const sessionId = req.cookies?.sessionId ?? req.headers['x-session-id'] ?? null;

    if (!userId && !sessionId) {
      return next(new ErrorResponse('No session or user identity found', 401));
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(new ErrorResponse('Invalid order payload', 400));
    }

    const order = await orderService.createOrder(userId, sessionId, req.body);
    return res.status(201).json({ success: true, order });
  } catch (err) {
    return next(err);
  }
};

export const getOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    let order;

    if (OBJECT_ID_RE.test(id)) {
      order = await Order.findById(id)
        .populate('user', 'name email phone')
        .populate('items.product', 'name images price');
    } else if (ORDER_NUM_RE.test(id.toUpperCase())) {
      order = await Order.findOne({ orderNumber: id.toUpperCase() })
        .populate('user', 'name email phone')
        .populate('items.product', 'name images price');
    } else {
      return next(new ErrorResponse('Invalid order ID or order number', 400));
    }

    if (!order) return next(new ErrorResponse('Order not found', 404));

  
    if (req.user) {
      const isAdmin = ['admin', 'superadmin', 'manager'].includes(req.user.role);
      if (!isAdmin && order.user && String(order.user._id || order.user) !== String(req.user._id)) {
        return next(new ErrorResponse('Access denied', 403));
      }
    }

    return res.json({ success: true, order });
  } catch (err) {
    return next(err);
  }
};

export const getMyOrders = async (req, res, next) => {
  try {
    if (!req.user?._id) {
      return next(new ErrorResponse('Authentication required', 401));
    }

    const { page, limit, sort, status } = sanitiseListQuery(req.query || {});

    const result = await orderService.getUserOrders(req.user._id, { page, limit, sort, status });

    return res.json({
      success: true,
      orders: result.orders,
      total: result.total,
      page: result.page,
    });
  } catch (err) {
    return next(err);
  }
};

export const getAllOrders = async (req, res, next) => {
  try {
    if (!req.user?._id) {
      return next(new ErrorResponse('Authentication required', 401));
    }

    if (!ALLOWED_ROLES.includes(req.user.role)) {
      return next(new ErrorResponse('Forbidden', 403));
    }

    const { page, limit, sort, status } = sanitiseListQuery(req.query);
    const filter = status ? { orderStatus: status } : {};

    const [orders, total] = await Promise.all([
      orderRepo.findAll(filter, { page, limit, sort }),
      orderRepo.count(filter),
    ]);

    return res.json({
      success: true,
      count: orders.length,
      total,
      page,
      orders,
    });
  } catch (err) {
    return next(err);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) {
      return next(new ErrorResponse('Invalid order ID', 400));
    }

    if (!req.user?._id || !ALLOWED_ROLES.includes(req.user.role)) {
      return next(new ErrorResponse('Forbidden', 403));
    }

    const { status, paymentStatus, trackingNumber, adminNotes } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      return next(new ErrorResponse(`Status must be one of: ${ORDER_STATUSES.join(', ')}`, 400));
    }
    if (paymentStatus && !PAYMENT_STATUSES.includes(paymentStatus)) {
      return next(new ErrorResponse('Invalid payment status', 400));
    }

    const currentOrder = await orderService.getOrderById(req.params.id);

    if (!currentOrder) {
      return next(new ErrorResponse('Order not found', 404));
    }

    const updateData = {
      orderStatus: status,
      ...(trackingNumber && { trackingNumber: String(trackingNumber).trim().slice(0, 100) }),
      ...(adminNotes && { adminNotes: String(adminNotes).trim().slice(0, 1000) }),
    };

    if (paymentStatus) {
      updateData.paymentStatus = paymentStatus;
    } else if (status === 'delivered') {
      updateData.paymentStatus =
        currentOrder.paymentMethod === 'cod' ? 'paid' : currentOrder.paymentStatus;
      updateData.deliveredAt = new Date();
    }

    if (status === 'cancelled') {
      updateData.cancelledAt = new Date();
    }

    const updatedOrder = await orderService.updateOrderStatus(req.params.id, updateData);

    if (
      status === 'delivered' &&
      updatedOrder.user &&
      !updatedOrder.loyaltyPointsEarned
    ) {
      await awardLoyaltyPoints({
        userId: updatedOrder.user,
        reason: 'order',
        refId: updatedOrder._id,
        refModel: 'Order',
        desc: `Order #${updatedOrder.orderNumber}`,
      });
      updatedOrder.loyaltyPointsEarned = 1;
      await updatedOrder.save();
    }

    return res.json({ success: true, order: updatedOrder });
  } catch (err) {
    return next(err);
  }
};