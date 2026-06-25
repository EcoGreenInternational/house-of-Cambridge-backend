import User from '../model/User.js';
import Product from '../model/Product.js';
import Order from '../model/Order.js';
import Category from '../model/Category.js';
import Coupon from '../model/Coupon.js';
import Review from '../model/Review.js';
import Return from '../model/Return.js';
import Notification from '../model/Notification.js';
import Address from '../model/Address.js';
import Cart from '../model/Cart.js';
import Wishlist from '../model/Wishlist.js';
import { uploadBuffer, deleteResource } from '../utils/cloudinaryHelper.js';
import ErrorResponse from '../utils/errorResponse.js';
import sendEmail from '../utils/sendEmail.js';
import * as productService from '../services/productService.js';
import { awardLoyaltyPoints } from '../utils/loyaltyHelper.js';
import LoyaltyTransaction from '../model/LoyaltyTransaction.js';
import { 
  ORDER_STATUSES, 
  PAYMENT_STATUSES, 
  RETURN_STATUSES, 
  RETURN_REASONS,
  ALLOWED_RESOLUTIONS 
} from '../constants/order.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_ORDER_STATUSES   = Object.freeze(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned']);
const VALID_PAYMENT_STATUSES = Object.freeze(['pending', 'paid', 'failed', 'refunded']);
const VALID_RETURN_STATUSES  = Object.freeze(['pending', 'in_review', 'approved', 'rejected', 'collected', 'qc', 'refunded']);
const VALID_REVIEW_STATUSES  = Object.freeze(['pending', 'approved', 'rejected']);
const VALID_NOTIFY_TYPES     = Object.freeze(['promotion', 'order', 'return', 'system']);
const VALID_TARGET_ROLES     = Object.freeze(['user', 'admin']);
const ALLOWED_USER_ROLES     = Object.freeze(['user', 'admin', 'superadmin']);
const ADMIN_ROLES             = Object.freeze(['admin', 'superadmin']);
const NON_COD_METHODS         = Object.freeze(new Set(['card', 'paypal', 'koko', 'bank_transfer']));
const ALLOWED_COUPON_TYPES    = Object.freeze(['percentage', 'fixed']);
const NOTIFICATION_BATCH      = 500;
const MIN_PASSWORD_LEN        = 8;

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const validateObjectId = (id, label = 'ID') => {
  if (!id || !OBJECT_ID_RE.test(id)) throw new ErrorResponse(`Invalid ${label}`, 400);
};

const parsePage = (raw, defaultLimit = 20) => {
  const page  = Math.max(1, parseInt(raw?.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(raw?.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const sanitiseRegex = (str) =>
  typeof str === 'string' ? str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100) : null;

const mapCouponData = (body) => {
  const {
    code, discountType, discountValue, minOrderAmount,
    maxDiscount, usageLimit, validTo, isActive,
  } = body;

  const data = {};

  if (code !== undefined) {
    const c = String(code).trim().toUpperCase().slice(0, 32);
    if (!/^[A-Z0-9_-]{1,32}$/.test(c)) throw new ErrorResponse('Invalid coupon code format', 400);
    data.code = c;
  }
  if (discountType !== undefined) {
    if (!ALLOWED_COUPON_TYPES.includes(discountType)) throw new ErrorResponse('Invalid discount type', 400);
    data.discountType = discountType;
  }
  if (discountValue !== undefined) {
    const n = Number(discountValue);
    if (!Number.isFinite(n) || n <= 0) throw new ErrorResponse('Discount value must be a positive number', 400);
    data.discountValue = n;
  }
  if (minOrderAmount !== undefined) {
    const n = Number(minOrderAmount);
    data.minOrderAmount = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (maxDiscount !== undefined) {
    const n = Number(maxDiscount);
    data.maxDiscount = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (usageLimit !== undefined) {
    const n = parseInt(usageLimit, 10);
    data.usageLimit = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (validTo) {
    const d = new Date(validTo);
    if (isNaN(d.getTime()) || d <= new Date()) throw new ErrorResponse('validTo must be a future date', 400);
    data.expiryDate = d;
  }
  if (isActive !== undefined) data.isActive = isActive === true || isActive === 'true';

  return data;
};

export const getDashboardStats = async (req, res, next) => {
  try {
    const now            = new Date();
    const monthStart     = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalOrders, monthOrders, lastMonthOrders,
      totalUsers, monthUsers,
      totalProducts, lowStockProducts,
      pendingReviews, pendingReturns,
      revenueAgg, monthRevenueAgg,
      ordersByStatus, recentOrders, topProducts,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: monthStart } }),
      Order.countDocuments({ createdAt: { $gte: lastMonthStart, $lt: monthStart } }),
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', createdAt: { $gte: monthStart } }),
      Product.countDocuments({ isActive: true }),
      Product.countDocuments({ stock: { $lte: 5 }, isActive: true }),
      Review.countDocuments({ status: 'pending' }),
      Return.countDocuments({ status: { $in: ['pending', 'in_review'] } }),
      Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.aggregate([
        { $match: { paymentStatus: 'paid', createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      Order.find().select('orderNumber total orderStatus paymentStatus createdAt user').populate('user', 'name email').sort('-createdAt').limit(10).lean(),
      Order.aggregate([
        { $unwind: '$items' },
        { $group: {
          _id:      '$items.product',
          name:     { $first: '$items.name' },
          image:    { $first: '$items.image' },
          totalQty: { $sum: '$items.quantity' },
          revenue:  { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        }},
        { $sort: { totalQty: -1 } },
        { $limit: 5 },
      ]),
    ]);

    return res.json({
      success: true,
      stats: {
        totalOrders, monthOrders, lastMonthOrders,
        totalUsers, monthUsers,
        totalProducts, lowStockProducts,
        pendingReviews, pendingReturns,
        totalRevenue:   revenueAgg[0]?.total      ?? 0,
        monthRevenue:   monthRevenueAgg[0]?.total ?? 0,
        ordersByStatus: ordersByStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
      },
      recentOrders,
      topProducts,
    });
  } catch (err) { return next(err); }
};

export const getUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { role, isActive } = req.query;
    const search = sanitiseRegex(req.query.search);

    const query = {};
    if (search) query.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
    if (role && ALLOWED_USER_ROLES.includes(role)) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -resetPasswordToken -emailVerificationToken -__v')
        .sort('-createdAt').skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);

    return res.json({ success: true, users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { return next(err); }
};

export const getUser = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'user ID');

    const user = await User.findById(req.params.id).select('-password -__v').lean();
    if (!user) return next(new ErrorResponse('User not found', 404));

    const [orders, addresses] = await Promise.all([
      Order.find({ user: user._id }).select('orderNumber total orderStatus paymentStatus createdAt').sort('-createdAt').limit(10).lean(),
      Address.find({ user: user._id }).lean(),
    ]);

    return res.json({ success: true, user, orders, addresses });
  } catch (err) { return next(err); }
};

export const updateUser = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'user ID');

    if (req.params.id === req.user._id.toString()) {
      return next(new ErrorResponse('Use the profile endpoint to update your own account', 400));
    }

    const { role, isActive, loyaltyPoints } = req.body;

    if (role !== undefined) {
      if (!ALLOWED_USER_ROLES.includes(role)) return next(new ErrorResponse('Invalid role', 400));
      if (ADMIN_ROLES.includes(role) && req.user.role !== 'superadmin') {
        return next(new ErrorResponse('Only super admin can assign admin roles', 403));
      }
    }

    if (loyaltyPoints !== undefined) {
      const n = Number(loyaltyPoints);
      if (!Number.isFinite(n) || n < 0) return next(new ErrorResponse('Invalid loyalty points value', 400));
    }

    const update = {};
    if (role          !== undefined) update.role          = role;
    if (isActive      !== undefined) update.isActive      = isActive === true || isActive === 'true';
    if (loyaltyPoints !== undefined) update.loyaltyPoints = Number(loyaltyPoints);

    if (!Object.keys(update).length) return next(new ErrorResponse('No valid fields provided', 400));

    const user = await User.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' })
      .select('-password -__v');
    if (!user) return next(new ErrorResponse('User not found', 404));

    return res.json({ success: true, user });
  } catch (err) { return next(err); }
};

export const deleteUser = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'user ID');

    if (req.user.role !== 'superadmin') {
      return next(new ErrorResponse('Only super admin can delete users', 403));
    }
    if (req.params.id === req.user._id.toString()) {
      return next(new ErrorResponse('Cannot delete your own account', 400));
    }

    const user = await User.findById(req.params.id);
    if (!user) return next(new ErrorResponse('User not found', 404));

    const activeOrders = await Order.countDocuments({
      user: user._id,
      orderStatus: { $in: ['pending', 'confirmed', 'processing', 'shipped'] },
    });
    if (activeOrders > 0) {
      return next(new ErrorResponse(`Cannot delete: user has ${activeOrders} active order(s). Resolve them first.`, 409));
    }

    await Promise.allSettled([
      Address.deleteMany({ user: user._id }),
      Wishlist.deleteMany({ user: user._id }),
      Notification.deleteMany({ user: user._id }),
    ]);
    await user.deleteOne();

    return res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) { return next(err); }
};

export const createAdmin = async (req, res, next) => {
  try {
    if (req.user.role !== 'superadmin') {
      return next(new ErrorResponse('Only super admin can create admin accounts', 403));
    }

    const name     = typeof req.body.name     === 'string' ? req.body.name.trim().slice(0, 100)     : '';
    const email    = typeof req.body.email    === 'string' ? req.body.email.trim().toLowerCase()     : '';
    const password = typeof req.body.password === 'string' ? req.body.password                       : '';
    const role     = req.body.role ?? 'admin';

    if (!name)                          return next(new ErrorResponse('Name is required', 400));
    if (!email || !EMAIL_RE.test(email)) return next(new ErrorResponse('A valid email is required', 400));
    if (!password || password.length < MIN_PASSWORD_LEN) {
      return next(new ErrorResponse(`Password must be at least ${MIN_PASSWORD_LEN} characters`, 400));
    }
    if (!ADMIN_ROLES.includes(role))    return next(new ErrorResponse('Invalid role', 400));

    if (await User.exists({ email })) return next(new ErrorResponse('Email already registered', 409));

    const admin = await User.create({
      name, email, password, role,
      isVerified: true,
      createdBy:  req.user._id,
    });

    sendEmail({
      to:      email,
      subject: 'Welcome to House of Cambridge Admin Panel',
      html: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#FFB700">Admin Account Created</h2>
        <p>Hi ${escapeHtml(name)}, your admin account has been created.</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}<br><strong>Role:</strong> ${escapeHtml(role)}</p>
        <p>Please log in and change your password immediately.</p>
        <a href="${escapeHtml(process.env.CLIENT_URL ?? '')}/login" style="background:#FFB700;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Login to Admin Panel</a>
      </div>`,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      admin: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    });
  } catch (err) { return next(err); }
};


export const getOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { status } = req.query;
    const search = sanitiseRegex(req.query.search);

    const query = {};
    if (status) {
      if (!VALID_ORDER_STATUSES.includes(status)) {
        return next(new ErrorResponse(`Invalid status. Must be one of: ${VALID_ORDER_STATUSES.join(', ')}`, 400));
      }
      query.orderStatus = status;
    }
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { guestEmail:  { $regex: search, $options: 'i' } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('user', 'name email')
        .sort('-createdAt')
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    return res.json({ success: true, orders, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { return next(err); }
};


export const getOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    let order;
    if (OBJECT_ID_RE.test(id)) {
      order = await Order.findById(id);
    } else {
      order = await Order.findOne({ orderNumber: id.toUpperCase() });
    }

    if (!order) return next(new ErrorResponse('Order not found', 404));

    const populated = await order.populate([
      { path: 'user',          select: 'name email phone' },
      { path: 'items.product', select: 'name images price' },
    ]);

    return res.json({ success: true, order: populated });
  } catch (err) { return next(err); }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'order ID');

    const { status, paymentStatus, trackingNumber, adminNotes } = req.body;

    if (!status || !ORDER_STATUSES.includes(status)) {
      return next(new ErrorResponse(`Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}`, 400));
    }
    if (paymentStatus && !PAYMENT_STATUSES.includes(paymentStatus)) {
      return next(new ErrorResponse('Invalid payment status', 400));
    }

    const currentOrder = await Order.findById(req.params.id);
    if (!currentOrder) return next(new ErrorResponse('Order not found', 404));

    const updateData = {
      orderStatus: status,
      ...(trackingNumber && { trackingNumber: String(trackingNumber).trim().slice(0, 100) }),
      ...(adminNotes && { adminNotes: String(adminNotes).trim().slice(0, 1000) }),
    };

   
    if (paymentStatus) {
      updateData.paymentStatus = paymentStatus;
    } else if (status === 'delivered') {
      updateData.paymentStatus = currentOrder.paymentMethod === 'cod' ? 'paid' : currentOrder.paymentStatus;
      updateData.deliveredAt = new Date();
    }
    if (status === 'cancelled') updateData.cancelledAt = new Date();

    const order = await Order.findByIdAndUpdate(req.params.id, updateData, { 
      returnDocument: 'after' 
    }).populate('user', 'name email');

    if (status === 'delivered' && order.user && !order.loyaltyPointsEarned) {
      await awardLoyaltyPoints({
        userId: order.user._id,
        reason: 'order',
        refId: order._id,
        refModel: 'Order',
        desc: `Order #${order.orderNumber}`,
      });
      order.loyaltyPointsEarned = 1;
      await order.save();
    }

    
    if (order.user) {
      Notification.create({
        user: order.user._id,
        title: 'Order Status Updated',
        message: `Your order #${order.orderNumber} is now ${status.replace(/_/g, ' ')}.`,
        type: 'order',
        link: `/track-order/${order._id}`,
      }).catch(() => {});
    }

    return res.json({ success: true, order });
  } catch (err) {
    return next(err);
  }
};

export const getAdminProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { category, isActive } = req.query;
    const search = sanitiseRegex(req.query.search);

    const query = {};
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { sku:  { $regex: search, $options: 'i' } },
    ];
    if (category) {
      if (!OBJECT_ID_RE.test(category)) return next(new ErrorResponse('Invalid category ID', 400));
      query.category = category;
    }
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const [products, total] = await Promise.all([
      Product.find(query).populate('category', 'name').sort('-createdAt').skip(skip).limit(limit).lean(),
      Product.countDocuments(query),
    ]);

    return res.json({ success: true, products, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { return next(err); }
};

export const createProduct = async (req, res, next) => {
  try {
    const product = await productService.createProduct(req.body, req.files ?? []);
    return res.status(201).json({ success: true, product });
  } catch (err) { return next(err); }
};

export const updateProduct = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');
    const product = await productService.updateProduct(req.params.id, req.body, req.files ?? []);
    return res.json({ success: true, product });
  } catch (err) { return next(err); }
};

export const updateFlashSale = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');

    const isFlashSale = req.body.isFlashSale === true || req.body.isFlashSale === 'true';
    const update      = { isFlashSale };

    if (isFlashSale) {
      const price = Number(req.body.flashSalePrice);
      if (!Number.isFinite(price) || price < 0) return next(new ErrorResponse('Invalid flash sale price', 400));
      update.flashSalePrice = price;
      if (req.body.flashSaleEnds) {
        const d = new Date(req.body.flashSaleEnds);
        if (isNaN(d.getTime()) || d <= new Date()) return next(new ErrorResponse('flashSaleEnds must be a future date', 400));
        update.flashSaleEnds = d;
      } else {
        update.flashSaleEnds = null;
      }
    } else {
      update.flashSalePrice = 0;
      update.flashSaleEnds  = null;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, update, {
      returnDocument: 'after',
      runValidators:  true,
    }).populate('category', 'name');
    if (!product) return next(new ErrorResponse('Product not found', 404));

    return res.json({ success: true, product });
  } catch (err) { return next(err); }
};

export const deleteProduct = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');
    await productService.deleteProduct(req.params.id);
    return res.json({ success: true, message: 'Product deleted' });
  } catch (err) { return next(err); }
};

export const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find().populate('parent', 'name').sort('order name').lean();
    const withCounts = await Promise.all(
      categories.map(async (c) => ({
        ...c,
        productCount: await Product.countDocuments({ category: c._id, isActive: true }),
      })),
    );
    return res.json({ success: true, categories: withCounts });
  } catch (err) { return next(err); }
};

export const createCategory = async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 100) : '';
    if (!name) return next(new ErrorResponse('Name is required', 400));

    let slug = typeof req.body.slug === 'string'
      ? req.body.slug.trim().toLowerCase()
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    if (!SLUG_RE.test(slug)) return next(new ErrorResponse('Invalid slug format', 400));

    const data = { name, slug };
    if (typeof req.body.description === 'string') data.description = req.body.description.trim().slice(0, 500);
    if (req.body.parent && OBJECT_ID_RE.test(req.body.parent)) data.parent = req.body.parent;
    if (req.body.order !== undefined) {
      const n = parseInt(req.body.order, 10);
      if (Number.isFinite(n)) data.order = n;
    }
    if (req.body.isActive !== undefined) data.isActive = req.body.isActive === true || req.body.isActive === 'true';

    if (req.file) {
      const result = await uploadBuffer(req.file.buffer, 'categories');
      if (!result?.public_id || !result?.secure_url) return next(new ErrorResponse('Image upload failed', 502));
      data.image = { public_id: result.public_id, url: result.secure_url };
    }

    const category = await Category.create(data);
    return res.status(201).json({ success: true, category });
  } catch (err) { return next(err); }
};

export const updateCategory = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'category ID');

    const data = {};
    if (typeof req.body.name === 'string')        data.name        = req.body.name.trim().slice(0, 100);
    if (typeof req.body.description === 'string') data.description = req.body.description.trim().slice(0, 500);
    if (req.body.parent && OBJECT_ID_RE.test(req.body.parent)) data.parent = req.body.parent;
    if (req.body.order !== undefined) {
      const n = parseInt(req.body.order, 10);
      if (Number.isFinite(n)) data.order = n;
    }
    if (req.body.isActive !== undefined) data.isActive = req.body.isActive === true || req.body.isActive === 'true';
    if (req.body.slug) {
      const s = req.body.slug.trim().toLowerCase();
      if (!SLUG_RE.test(s)) return next(new ErrorResponse('Invalid slug format', 400));
      data.slug = s;
    }

    if (req.file) {
      const result = await uploadBuffer(req.file.buffer, 'categories');
      if (!result?.public_id || !result?.secure_url) return next(new ErrorResponse('Image upload failed', 502));
      const cat = await Category.findById(req.params.id).select('image').lean();
      if (cat?.image?.public_id) await deleteResource(cat.image.public_id).catch(() => {});
      data.image = { public_id: result.public_id, url: result.secure_url };
    }

    const category = await Category.findByIdAndUpdate(req.params.id, data, {
      returnDocument: 'after',
      runValidators:  true,
    });
    if (!category) return next(new ErrorResponse('Category not found', 404));

    return res.json({ success: true, category });
  } catch (err) { return next(err); }
};

export const deleteCategory = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'category ID');

    const productCount = await Product.countDocuments({ category: req.params.id });
    if (productCount > 0) {
      return next(new ErrorResponse(`Cannot delete: ${productCount} product(s) use this category. Reassign them first.`, 409));
    }

    const category = await Category.findById(req.params.id);
    if (!category) return next(new ErrorResponse('Category not found', 404));

    if (category.image?.public_id) await deleteResource(category.image.public_id).catch(() => {});
    await category.deleteOne();

    return res.json({ success: true, message: 'Category deleted' });
  } catch (err) { return next(err); }
};

export const getCoupons = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { isActive } = req.query;
    const search = sanitiseRegex(req.query.search);

    const query = {};
    if (search)              query.code     = { $regex: search, $options: 'i' };
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const [coupons, total] = await Promise.all([
      Coupon.find(query).sort('-createdAt').skip(skip).limit(limit).lean(),
      Coupon.countDocuments(query),
    ]);

    const normalised = coupons.map((c) => ({ ...c, validTo: c.expiryDate }));
    return res.json({ success: true, coupons: normalised, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { return next(err); }
};

export const createCoupon = async (req, res, next) => {
  try {
    if (!req.body.code)          return next(new ErrorResponse('Coupon code is required', 400));
    if (!req.body.discountType)  return next(new ErrorResponse('Discount type is required', 400));
    if (!req.body.discountValue) return next(new ErrorResponse('Discount value is required', 400));
    if (!req.body.validTo)       return next(new ErrorResponse('Expiry date (validTo) is required', 400));

    const data   = mapCouponData(req.body);
    const coupon = await Coupon.create(data);
    return res.status(201).json({ success: true, coupon: { ...coupon.toObject(), validTo: coupon.expiryDate } });
  } catch (err) { return next(err); }
};

export const updateCoupon = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'coupon ID');
    const data   = mapCouponData(req.body);
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, data, {
      returnDocument: 'after',
      runValidators:  true,
    });
    if (!coupon) return next(new ErrorResponse('Coupon not found', 404));
    return res.json({ success: true, coupon: { ...coupon.toObject(), validTo: coupon.expiryDate } });
  } catch (err) { return next(err); }
};

export const deleteCoupon = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'coupon ID');

    const coupon = await Coupon.findById(req.params.id).lean();
    if (!coupon) return next(new ErrorResponse('Coupon not found', 404));

    const cartsUsing = await Cart.countDocuments({ coupon: coupon._id });
    if (cartsUsing > 0) {
      return next(new ErrorResponse(`Coupon is applied to ${cartsUsing} cart(s). Disable it instead of deleting.`, 409));
    }

    await Coupon.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: 'Coupon deleted' });
  } catch (err) { return next(err); }
};

export const getReviews = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { status } = req.query;
    const search = sanitiseRegex(req.query.search);

    const query = {};
    if (status) {
      if (!VALID_REVIEW_STATUSES.includes(status)) return next(new ErrorResponse('Invalid status filter', 400));
      query.status = status;
    }
    if (search) query.$or = [
      { title:   { $regex: search, $options: 'i' } },
      { comment: { $regex: search, $options: 'i' } },
    ];

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate('user',    'name email avatar')
        .populate('product', 'name images')
        .sort('-createdAt').skip(skip).limit(limit).lean(),
      Review.countDocuments(query),
    ]);

    return res.json({ success: true, reviews, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { return next(err); }
};

export const approveReview = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'review ID');
    const adminNote = typeof req.body.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 500) : '';

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', adminNote },
      { returnDocument: 'after' },
    ).populate('product', 'name');
    if (!review) return next(new ErrorResponse('Review not found', 404));

    await productService.recalculateRatings(review.product._id ?? review.product);

    if (review.user) {
      const alreadyRewarded = await LoyaltyTransaction.exists({
        user:   review.user,
        reason: 'review',
        refId:  review._id,
      });

      if (!alreadyRewarded) {
        await awardLoyaltyPoints({
          userId:   review.user,
          reason:   'review',
          refId:    review._id,
          refModel: 'Review',
          desc:     `Review for "${review.product?.name ?? 'a product'}"`,
        });
      }
    }

    return res.json({ success: true, review });
  } catch (err) { return next(err); }
};

export const rejectReview = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'review ID');
    const adminNote = typeof req.body.adminNote === 'string' ? req.body.adminNote.trim().slice(0, 500) : '';
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', adminNote },
      { returnDocument: 'after' },
    );
    if (!review) return next(new ErrorResponse('Review not found', 404));
    await productService.recalculateRatings(review.product);
    return res.json({ success: true, review });
  } catch (err) { return next(err); }
};

export const deleteReview = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'review ID');
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return next(new ErrorResponse('Review not found', 404));

    await productService.recalculateRatings(review.product);
    if (review.images?.length) {
      await Promise.allSettled(review.images.map((img) => deleteResource(img.public_id)));
    }

    return res.json({ success: true, message: 'Review deleted' });
  } catch (err) { return next(err); }
};

export const getReturns = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { status } = req.query;
    const search = sanitiseRegex(req.query.search);

    const query = {};
    if (status) {
      if (!VALID_RETURN_STATUSES.includes(status)) return next(new ErrorResponse('Invalid status filter', 400));
      query.status = status;
    }
    if (search) query.returnId = { $regex: search, $options: 'i' };

    const [returns, total] = await Promise.all([
      Return.find(query)
        .populate('user',  'name email')
        .populate('order', 'orderNumber total')
        .sort('-createdAt').skip(skip).limit(limit).lean(),
      Return.countDocuments(query),
    ]);

    return res.json({ success: true, returns, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { return next(err); }
};

export const getReturn = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'return ID');
    const ret = await Return.findById(req.params.id)
      .populate('user',          'name email phone')
      .populate('order',         'orderNumber total shippingAddress items')
      .populate('items.product', 'name images');
    if (!ret) return next(new ErrorResponse('Return not found', 404));
    return res.json({ success: true, return: ret });
  } catch (err) { return next(err); }
};

export const updateReturnStatus = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'return ID');

    const { status, refundAmount, refundMethod, adminNotes } = req.body;

    if (!status || !RETURN_STATUSES.includes(status)) {
      return next(new ErrorResponse('Invalid return status', 400));
    }

    const ret = await Return.findById(req.params.id);
    if (!ret) return next(new ErrorResponse('Return not found', 404));

    const updateData = {
      status,
      adminNotes:   adminNotes   ? String(adminNotes).trim().slice(0, 500)   : undefined,
      refundMethod: refundMethod ? String(refundMethod).trim().slice(0, 50)  : undefined,
    };

    if (refundAmount !== undefined) {
      const amt = Number(refundAmount);
      if (!Number.isFinite(amt) || amt < 0) {
        return next(new ErrorResponse('Invalid refund amount', 400));
      }
      updateData.refundAmount = amt;
    }

    if (status === 'refunded') updateData.resolvedAt = new Date();

    const updatedReturn = await Return.findByIdAndUpdate(req.params.id, updateData, { 
      returnDocument: 'after' 
    }).populate('user', 'name email');

    // Sync order status
    if (status === 'approved') {
      await Order.findByIdAndUpdate(ret.order, { orderStatus: 'return_requested' });
    }
    if (status === 'refunded') {
      await Order.findByIdAndUpdate(ret.order, { 
        orderStatus:   'returned', 
        paymentStatus: 'refunded',
      });
    }

    if (updatedReturn.user) {
      Notification.create({
        user:    updatedReturn.user._id,
        title:   'Return Request Updated',
        message: `Your return ${updatedReturn.returnId} is now ${status.replace(/_/g, ' ')}.`,
        type:    'return',
        link:    `/return-status/${ret.order}`,
      }).catch(() => {});
    }

    return res.json({ success: true, return: updatedReturn });
  } catch (err) {
    return next(err);
  }
};

export const deleteReturn = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'return ID');
    const ret = await Return.findById(req.params.id);
    if (!ret) return next(new ErrorResponse('Return not found', 404));

    if (ret.images?.length) {
      await Promise.allSettled(
        ret.images.filter((img) => img?.public_id).map((img) => deleteResource(img.public_id)),
      );
    }

    await ret.deleteOne();
    return res.json({ success: true, message: 'Return deleted' });
  } catch (err) { return next(err); }
};

export const broadcastNotification = async (req, res, next) => {
  try {
    const title      = typeof req.body.title   === 'string' ? req.body.title.trim().slice(0, 200)   : '';
    const message    = typeof req.body.message === 'string' ? req.body.message.trim().slice(0, 500) : '';
    const type       = VALID_NOTIFY_TYPES.includes(req.body.type)       ? req.body.type       : 'promotion';
    const targetRole = VALID_TARGET_ROLES.includes(req.body.targetRole) ? req.body.targetRole : 'user';
    const link       = typeof req.body.link === 'string'                ? req.body.link.trim().slice(0, 200) : '';

    if (!title)   return next(new ErrorResponse('Title is required', 400));
    if (!message) return next(new ErrorResponse('Message is required', 400));

    const users = await User.find({ role: targetRole, isActive: true }).select('_id').lean();
    if (!users.length) {
      return res.json({ success: true, message: 'No active users found for this role' });
    }

    for (let i = 0; i < users.length; i += NOTIFICATION_BATCH) {
      const batch = users.slice(i, i + NOTIFICATION_BATCH).map((u) => ({
        user: u._id, title, message, type, link, isRead: false,
      }));
      await Notification.insertMany(batch, { ordered: false });
    }

    return res.json({ success: true, message: `Notification sent to ${users.length} user(s)` });
  } catch (err) { return next(err); }
};