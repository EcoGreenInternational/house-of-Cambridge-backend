import * as userRepo from '../repositories/userRepository.js';
import { uploadBuffer, deleteResource } from '../utils/cloudinaryHelper.js';
import Address from '../model/Address.js';
import Wishlist from '../model/Wishlist.js';
import Notification from '../model/Notification.js';
import ErrorResponse from '../utils/errorResponse.js';
import { STATES } from 'mongoose';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const ALLOWED_PROFILE_FIELDS = Object.freeze(['name', 'phone', 'displayName', 'dob', 'gender', 'language']);
const ALLOWED_GENDERS         = Object.freeze(['male', 'female', 'other', 'prefer_not_to_say']);
const ALLOWED_LANGUAGES       = Object.freeze(['en', 'si', 'ta']);
const MAX_ADDRESSES           = 5;
const NOTIFICATION_CAP        = 100;
const MAX_FILE_BYTES          = 5 * 1024 * 1024;

const AVATAR_TRANSFORM = Object.freeze([
  { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' },
]);

const assertAuth = (req, next) => {
  if (!req.user?._id) { next(new ErrorResponse('Authentication required', 401)); return false; }
  return true;
};

const validateObjectId = (id, label = 'ID') => {
  if (!id || !OBJECT_ID_RE.test(id)) throw new ErrorResponse(`Invalid ${label}`, 400);
};

const sanitiseProfileUpdate = (body) => {
  const update = {};

  for (const key of ALLOWED_PROFILE_FIELDS) {
    if (body[key] === undefined) continue;

    if (key === 'name' || key === 'displayName') {
      const val = typeof body[key] === 'string' ? body[key].trim().slice(0, 100) : null;
      if (val) update[key] = val;
    } else if (key === 'phone') {
      const val = typeof body[key] === 'string' ? body[key].trim().slice(0, 20) : null;
      if (val) update[key] = val;
    } else if (key === 'gender') {
      if (ALLOWED_GENDERS.includes(body[key])) update[key] = body[key];
    } else if (key === 'language') {
      if (ALLOWED_LANGUAGES.includes(body[key])) update[key] = body[key];
    } else if (key === 'dob') {
      const d = new Date(body[key]);
      if (!isNaN(d.getTime()) && d < new Date()) update[key] = d;
    } else {
      update[key] = body[key];
    }
  }

  return update;
};

const sanitiseAddress = (body) => {
  const required = ['fullName', 'addressLine1', 'city', 'postalCode', 'country'];
  for (const field of required) {
    if (!body[field] || typeof body[field] !== 'string' || !body[field].trim()) {
      throw new ErrorResponse(`Address is missing required field: ${field}`, 400);
    }
  }
  return {
    fullName:     body.fullName.trim().slice(0, 100),
    addressLine1: body.addressLine1.trim().slice(0, 200),
    addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2.trim().slice(0, 200) : '',
    city:         body.city.trim().slice(0, 100),
    state:        body.state.trim().slice(0, 100),
    postalCode:   body.postalCode.trim().slice(0, 20),
    country:      body.country.trim().slice(0, 100),
    phone:        typeof body.phone === 'string' ? body.phone.trim().slice(0, 20) : '',
    isDefault:    body.isDefault === true || body.isDefault === 'true',
    label:        ['Home', 'Work', 'Other'].includes(body.label) ? body.label : 'Home',
  };
};

export const getProfile = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    const user = await userRepo.findById(req.user._id);
    if (!user) return next(new ErrorResponse('User not found', 404));
    return res.json({ success: true, user });
  } catch (err) { return next(err); }
};

export const updateProfile = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;

    const update = sanitiseProfileUpdate(req.body);
    if (!Object.keys(update).length) {
      return next(new ErrorResponse('No valid fields provided', 400));
    }

    const user = await userRepo.update(req.user._id, update);
    return res.json({ success: true, user });
  } catch (err) { return next(err); }
};

export const updateAvatar = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    if (!req.file) return next(new ErrorResponse('No file uploaded', 400));

    if (req.file.size > MAX_FILE_BYTES) {
      return next(new ErrorResponse('Avatar must be under 5 MB', 400));
    }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(req.file.mimetype)) {
      return next(new ErrorResponse('Avatar must be a JPEG, PNG, or WebP image', 400));
    }

    const user = await userRepo.findById(req.user._id);
    if (!user) return next(new ErrorResponse('User not found', 404));

    const result = await uploadBuffer(req.file.buffer, 'avatars', { transformation: AVATAR_TRANSFORM });

    if (!result?.public_id || !result?.secure_url) {
      return next(new ErrorResponse('Avatar upload failed', 502));
    }

    if (user.avatar?.public_id) {
      await deleteResource(user.avatar.public_id).catch(() => {});
    }

    const updated = await userRepo.update(req.user._id, {
      avatar: { public_id: result.public_id, url: result.secure_url },
    });

    return res.json({ success: true, user: updated });
  } catch (err) { return next(err); }
};

export const removeAvatar = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;

    const user = await userRepo.findById(req.user._id);
    if (!user) return next(new ErrorResponse('User not found', 404));

    if (user.avatar?.public_id) {
      await deleteResource(user.avatar.public_id).catch(() => {});
    }

    const updated = await userRepo.update(req.user._id, { avatar: { public_id: '', url: '' } });
    return res.json({ success: true, user: updated });
  } catch (err) { return next(err); }
};

export const getAddresses = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    const addresses = await Address.find({ user: req.user._id })
      .sort('-isDefault createdAt')
      .lean();
    return res.json({ success: true, count: addresses.length, addresses });
  } catch (err) { return next(err); }
};

export const addAddress = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;

    const count = await Address.countDocuments({ user: req.user._id });
    if (count >= MAX_ADDRESSES) {
      return next(new ErrorResponse(`Maximum ${MAX_ADDRESSES} addresses allowed`, 400));
    }

    const sanitised = sanitiseAddress(req.body);

    if (sanitised.isDefault || count === 0) {
      await Address.updateMany({ user: req.user._id }, { isDefault: false });
      sanitised.isDefault = true;
    }

    const address = await Address.create({ ...sanitised, user: req.user._id });
    return res.status(201).json({ success: true, address });
  } catch (err) { return next(err); }
};

export const updateAddress = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    validateObjectId(req.params.id, 'address ID');

    const sanitised = sanitiseAddress(req.body);

    if (sanitised.isDefault) {
      await Address.updateMany({ user: req.user._id }, { isDefault: false });
    }

    const address = await Address.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      sanitised,
      { returnDocument: 'after', runValidators: true },
    );
    if (!address) return next(new ErrorResponse('Address not found', 404));

    return res.json({ success: true, address });
  } catch (err) { return next(err); }
};

export const deleteAddress = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    validateObjectId(req.params.id, 'address ID');

    const address = await Address.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!address) return next(new ErrorResponse('Address not found', 404));

    if (address.isDefault) {
      const next_ = await Address.findOne({ user: req.user._id }).sort('createdAt');
      if (next_) { next_.isDefault = true; await next_.save(); }
    }

    return res.json({ success: true, message: 'Address removed' });
  } catch (err) { return next(err); }
};

export const getWishlist = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    const wishlist = await Wishlist.findOne({ user: req.user._id })
      .populate('products', 'name price discountPrice images ratings numReviews isActive')
      .lean();
    return res.json({ success: true, wishlist: wishlist ?? { products: [] } });
  } catch (err) { return next(err); }
};

export const toggleWishlist = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;

    const { productId } = req.body;
    if (!productId || !OBJECT_ID_RE.test(productId)) {
      return next(new ErrorResponse('Valid productId is required', 400));
    }

    let wishlist = await Wishlist.findOne({ user: req.user._id });

    if (!wishlist) {
      wishlist = await Wishlist.create({ user: req.user._id, products: [productId] });
    } else {
      const idx = wishlist.products.findIndex((p) => p.toString() === productId);
      if (idx !== -1) wishlist.products.splice(idx, 1);
      else            wishlist.products.push(productId);
      await wishlist.save();
    }

    await wishlist.populate('products', 'name price discountPrice images ratings numReviews isActive');
    return res.json({ success: true, wishlist });
  } catch (err) { return next(err); }
};

export const getNotifications = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    const notifications = await Notification.find({ user: req.user._id })
      .sort('-createdAt')
      .limit(NOTIFICATION_CAP)
      .lean();
    return res.json({ success: true, count: notifications.length, notifications });
  } catch (err) { return next(err); }
};

export const markNotificationRead = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    validateObjectId(req.params.id, 'notification ID');

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true },
      { returnDocument: 'after' },
    );
    if (!notification) return next(new ErrorResponse('Notification not found', 404));

    return res.json({ success: true });
  } catch (err) { return next(err); }
};

export const markAllNotificationsRead = async (req, res, next) => {
  try {
    if (!assertAuth(req, next)) return;
    await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
    return res.json({ success: true });
  } catch (err) { return next(err); }
};