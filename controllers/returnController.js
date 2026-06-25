import Return from '../model/Return.js';
import Order from '../model/Order.js';
import ErrorResponse from '../utils/errorResponse.js';
import { uploadBuffer } from '../utils/cloudinaryHelper.js';
import { RETURN_STATUSES, RETURN_REASONS, ALLOWED_RESOLUTIONS } from '../constants/order.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_IMAGES = 5;

const ALLOWED_ROLES = Object.freeze(['admin', 'superadmin']);

const validateObjectId = (id, label = 'ID') => {
  if (!id || !OBJECT_ID_RE.test(id)) {
    throw new ErrorResponse(`Invalid ${label}`, 400);
  }
};

const isAdmin = (user) => ALLOWED_ROLES.includes(user?.role);

const parseReturnItems = (rawItems, originalItems) => {
  
  if (!rawItems) {
    return originalItems.map((i) => ({
      product: i.product?._id || i.product,
      name: i.name || '',
      image: i.image || '',
      price: Number(i.price) || 0,
      quantity: Number(i.quantity) || 1,
    }));
  }

  
  const itemsArray = Array.isArray(rawItems) ? rawItems : [rawItems];

  return itemsArray.map((itemRaw) => {
    let item;
    if (typeof itemRaw === 'string') {
      try {
        item = JSON.parse(itemRaw);
      } catch {
        throw new ErrorResponse('Invalid item format in return request', 400);
      }
    } else {
      item = itemRaw;
    }

    const productId = item.product || item._id;
    if (!productId || !OBJECT_ID_RE.test(String(productId))) {
      throw new ErrorResponse('Each return item must have a valid product ID', 400);
    }

    const qty = parseInt(item.quantity, 10);
    if (!Number.isInteger(qty) || qty < 1) {
      throw new ErrorResponse('Each return item must have a positive integer quantity', 400);
    }

    return {
      product: productId,
      name: typeof item.name === 'string' ? item.name.trim().slice(0, 200) : '',
      image: typeof item.image === 'string' ? item.image.trim().slice(0, 500) : '',
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
      quantity: qty,
    };
  });
};

export const createReturn = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!OBJECT_ID_RE.test(id)) {
      return next(new ErrorResponse('Invalid order ID', 400));
    }

    const { reason, resolution, description } = req.body;

  
    if (!reason || !RETURN_REASONS.includes(reason)) {
      return next(new ErrorResponse(`Reason must be one of: ${RETURN_REASONS.join(', ')}`, 400));
    }

    
    const safeResolution =
      resolution && ALLOWED_RESOLUTIONS.includes(resolution) ? resolution : 'refund';

    const order = await Order.findById(id).lean();
    if (!order) return next(new ErrorResponse('Order not found', 404));

    if (!req.user?._id) {
      return next(new ErrorResponse('Authentication required', 401));
    }
    if (String(order.user) !== String(req.user._id)) {
      return next(new ErrorResponse('Access denied', 403));
    }
    if (order.orderStatus !== 'delivered') {
      return next(new ErrorResponse('Only delivered orders can be returned', 400));
    }

  
    const existingReturn = await Return.findOne({
      order: id,
      status: { $nin: ['rejected', 'refunded'] },
    });
    if (existingReturn) {
      return next(new ErrorResponse('A return request for this order already exists', 409));
    }

  
    const returnItems = parseReturnItems(req.body.items, order.items);

    if (!returnItems.length) {
      return next(new ErrorResponse('No items selected for return', 400));
    }

    
    let images = [];
    if (req.files?.length) {
      const uploads = await Promise.all(
        req.files.slice(0, MAX_IMAGES).map((f) => uploadBuffer(f.buffer, 'returns')),
      );
      images = uploads
        .filter((u) => u?.secure_url)
        .map((u) => ({ public_id: u.public_id, url: u.secure_url }));
    }

    const ret = await Return.create({
      order: order._id,
      user: req.user._id,
      items: returnItems,
      reason,
      description: typeof description === 'string' ? description.trim().slice(0, 1000) : '',
      resolution: safeResolution,
      images,
    });

    await Order.findByIdAndUpdate(id, { orderStatus: 'return_requested' });

    return res.status(201).json({ success: true, return: ret });
  } catch (err) {
    return next(err);
  }
};

export const getMyReturns = async (req, res, next) => {
  try {
    if (!req.user?._id) {
      return next(new ErrorResponse('Authentication required', 401));
    }

    const returns = await Return.find({ user: req.user._id })
      .populate('order', 'orderNumber total')
      .sort('-createdAt')
      .lean();

    return res.json({
      success: true,
      count: returns.length,
      returns,
    });
  } catch (err) {
    return next(err);
  }
};

export const getReturn = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'return ID');

    if (!req.user?._id) {
      return next(new ErrorResponse('Authentication required', 401));
    }

    const ret = await Return.findById(req.params.id)
      .populate('order', 'orderNumber total items shippingAddress')
      .populate('user', 'name email')
      .populate('items.product', 'name images');

    if (!ret) return next(new ErrorResponse('Return not found', 404));

    const isOwner = String(ret.user?._id || ret.user) === String(req.user._id);
    if (!isOwner && !isAdmin(req.user)) {
      return next(new ErrorResponse('Access denied', 403));
    }

    return res.json({ success: true, return: ret });
  } catch (err) {
    return next(err);
  }
};