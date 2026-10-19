import Cart from '../model/Cart.js';
import * as cartRepo from '../repositories/cartRepository.js';
import Product from '../model/Product.js';
import Coupon from '../model/Coupon.js';
import ErrorResponse from '../utils/errorResponse.js';

const MAX_ITEM_QTY = 100;

const itemKey = (item) => `${String(item.product?._id || item.product)}::${item.selectedVariant?.name || ''}`;

// Moves a guest's cart into their account the first time they're seen signed in
const mergeGuestCart = async (userId, sessionId) => {
  const guestCart = await Cart.findOne({ sessionId, user: null });
  if (!guestCart) return;

  if (guestCart.items.length) {
    const userCart = await Cart.findOne({ user: userId });
    if (!userCart) {
      guestCart.user = userId;
      guestCart.sessionId = null;
      await guestCart.save();
      return;
    }

    const byKey = new Map(userCart.items.map((item) => [itemKey(item), item]));
    for (const item of guestCart.items) {
      const existing = byKey.get(itemKey(item));
      if (existing) {
        existing.quantity = Math.min(MAX_ITEM_QTY, Math.max(existing.quantity, item.quantity));
      } else {
        userCart.items.push(item.toObject());
      }
    }
    await userCart.save();
  }

  await Cart.deleteOne({ _id: guestCart._id });
};

export const getCart = async (userId, sessionId) => {
  if (userId) {
    if (sessionId) await mergeGuestCart(userId, sessionId);
    return cartRepo.findByUser(userId);
  }
  if (sessionId) return cartRepo.findBySession(sessionId);
  return null;
};

export const addToCart = async (userId, sessionId, productId, quantity, selectedVariant = null) => {
  const qty = Math.max(1, Math.floor(Number(quantity)));
  const product = await Product.findById(productId);
  if (!product || !product.isActive) throw new ErrorResponse('Product not found', 404);

  let variantData = null;
  const flashSalePrice = Number(product.flashSalePrice);
  const hasFlashSalePrice = product.isFlashSale === true && Number.isFinite(flashSalePrice) && flashSalePrice > 0;
  let itemPrice = hasFlashSalePrice
    ? flashSalePrice
    : product.discountPrice > 0
      ? product.discountPrice
      : product.price;
  let maxStock = product.stock;

  if (selectedVariant && product.variants?.length) {
    const matchedVariant = product.variants.find((v) => {
      if (selectedVariant.sku && v.sku && v.sku === selectedVariant.sku) return true;
      if (selectedVariant.name && v.name && v.name === selectedVariant.name) return true;
      if (selectedVariant.attributes && v.attributes) {
        const vKeys = Object.keys(v.attributes);
        const sKeys = Object.keys(selectedVariant.attributes);
        if (vKeys.length === sKeys.length && vKeys.every((k) => String(v.attributes[k]) === String(selectedVariant.attributes[k]))) {
          return true;
        }
      }
      return false;
    });

    if (!matchedVariant) {
      throw new ErrorResponse('Selected variant does not exist', 400);
    }
    if (!matchedVariant.isActive) {
      throw new ErrorResponse('Selected variant is unavailable', 400);
    }

    maxStock = matchedVariant.stock;
    if (!hasFlashSalePrice && matchedVariant.price > 0) itemPrice = matchedVariant.price;
    variantData = {
      sku: matchedVariant.sku || '',
      name: matchedVariant.name || '',
      attributes: matchedVariant.attributes || {},
      price: itemPrice,
      image: matchedVariant.image?.url || '',
    };
  } else {
    variantData = null;
  }

  if (maxStock < qty) throw new ErrorResponse('Insufficient stock', 400);

  let cart = await getCart(userId, sessionId);

  const isSameItem = (item) => {
    const pId = (item.product._id || item.product).toString();
    if (pId !== productId) return false;
    const v1Name = item.selectedVariant?.name || '';
    const v2Name = variantData?.name || '';
    const v1Sku = item.selectedVariant?.sku || '';
    const v2Sku = variantData?.sku || '';
    if (v1Sku && v2Sku) return v1Sku === v2Sku;
    return v1Name === v2Name;
  };

  if (cart) {
    const existingItem = cart.items.find(isSameItem);
    if (existingItem) {
      existingItem.quantity = Math.min(existingItem.quantity + qty, maxStock);
      existingItem.price = itemPrice;
      if (existingItem.selectedVariant) {
        existingItem.selectedVariant.price = itemPrice;
      }
    } else {
      cart.items.push({
        product: productId,
        quantity: qty,
        price: itemPrice,
        selectedVariant: variantData || undefined,
      });
    }
    await recalculateCartDiscount(cart);
    await cart.save();
    return cart.populate('items.product');
  }

  const data = {
    items: [
      {
        product: productId,
        quantity: qty,
        price: itemPrice,
        selectedVariant: variantData || undefined,
      },
    ],
  };
  if (userId) {
    data.user = userId;
    return cartRepo.upsertForUser(userId, data);
  }
  data.sessionId = sessionId;
  return cartRepo.upsertForSession(sessionId, data);
};

export const recalculateCartDiscount = async (cart) => {
  if (!cart || !cart.coupon) {
    if (cart) cart.discount = 0;
    return;
  }
  const coupon = await Coupon.findById(cart.coupon);
  if (!coupon || !coupon.isActive || (coupon.expiryDate && new Date(coupon.expiryDate) < new Date())) {
    cart.coupon = null;
    cart.discount = 0;
    return;
  }
  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (coupon.minOrderAmount > 0 && subtotal < coupon.minOrderAmount) {
    cart.coupon = null;
    cart.discount = 0;
    return;
  }
  let discount =
    coupon.discountType === 'percentage'
      ? (subtotal * coupon.discountValue) / 100
      : coupon.discountValue;

  if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  cart.discount = Math.min(Math.round(discount), subtotal);
};

export const updateCartItem = async (userId, sessionId, productId, quantity, itemId = null, variantName = null) => {
  const cart = await getCart(userId, sessionId);
  if (!cart) throw new ErrorResponse('Cart not found', 404);

  const item = cart.items.find((i) => {
    if (itemId && i._id && i._id.toString() === itemId.toString()) return true;
    const pId = (i.product._id || i.product).toString();
    if (pId !== productId) return false;
    if (variantName !== null && variantName !== undefined) {
      return (i.selectedVariant?.name || '') === variantName;
    }
    return true;
  });
  if (!item) throw new ErrorResponse('Item not in cart', 404);

  const qty = Number(quantity);
  if (qty <= 0) {
    cart.items = cart.items.filter((i) => i !== item);
  } else {
    item.quantity = qty;
  }

  await recalculateCartDiscount(cart);
  await cart.save();
  return cart.populate('items.product');
};

export const removeFromCart = async (userId, sessionId, productId, itemId = null, variantName = null) => {
  const cart = await getCart(userId, sessionId);
  if (!cart) throw new ErrorResponse('Cart not found', 404);
  cart.items = cart.items.filter((i) => {
    if (itemId && i._id && i._id.toString() === itemId.toString()) return false;
    const pId = (i.product._id || i.product).toString();
    if (pId === productId) {
      if (variantName !== null && variantName !== undefined) {
        return (i.selectedVariant?.name || '') !== variantName;
      }
      return false;
    }
    return true;
  });

  await recalculateCartDiscount(cart);
  await cart.save();
  return cart.populate('items.product');
};

export const applyCoupon = async (userId, sessionId, code) => {
  const cart = await getCart(userId, sessionId);
  if (!cart) throw new ErrorResponse('Cart not found', 404);

  const normalizedCode = String(code).toUpperCase().trim();
  const coupon = await Coupon.findOne({
    code: normalizedCode,
    isActive: true,
    expiryDate: { $gt: new Date() },
  });
  if (!coupon) throw new ErrorResponse('Invalid or expired coupon', 400);

  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw new ErrorResponse('Coupon usage limit reached', 400);
  }

  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (coupon.minOrderAmount > 0 && subtotal < coupon.minOrderAmount) {
    throw new ErrorResponse(`Minimum order amount is LKR ${coupon.minOrderAmount}`, 400);
  }

  let discount =
    coupon.discountType === 'percentage'
      ? (subtotal * coupon.discountValue) / 100
      : coupon.discountValue;

  if (coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);

  cart.coupon = coupon._id;
  cart.discount = Math.round(discount);
  await cart.save();
  return cart.populate('items.product coupon');
};

export const clearCart = async (userId, sessionId) => {
  const cart = await getCart(userId, sessionId);
  if (cart) {
    cart.items = [];
    cart.coupon = null;
    cart.discount = 0;
    await cart.save();
  }
};