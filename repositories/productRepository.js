import Product from '../model/Product.js';
import Order from '../model/Order.js';

export const findById = (id) => Product.findById(id).populate('category').populate('brand', 'name slug');

export const findAll = (query) => Product.find(query).populate('category').populate('brand', 'name slug');

export const create = (data) => Product.create(data);

export const update = (id, data) =>
  Product.findByIdAndUpdate(id, data, { returnDocument: 'after', runValidators: true });

export const remove = (id) => Product.findByIdAndDelete(id);

export const count = (query) => Product.countDocuments(query);

export const findFlashSale = (limit = 8) =>
  Product.find({ isFlashSale: true, isActive: true, stock: { $gt: 0 } })
    .limit(limit)
    .populate('category')
    .populate('brand', 'name slug');

export const findFeatured = (limit = 8) =>
  Product.find({ isFeatured: true, isActive: true })
    .limit(limit)
    .populate('category')
    .populate('brand', 'name slug');

export const findPopular = async (limit = 8) => {
  const topItems = await Order.aggregate([
    { $match: { orderStatus: { $in: ['confirmed', 'processing', 'shipped', 'delivered'] } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.product', count: { $sum: '$items.quantity' } } },
    { $sort: { count: -1 } },
    { $limit: limit * 3 },
  ]);

  if (topItems.length === 0) {
    return Product.find({ isActive: true })
      .sort({ numReviews: -1, ratings: -1 })
      .limit(limit)
      .populate('category')
      .populate('brand', 'name slug');
  }

  const ids = topItems.map((i) => i._id);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).populate('category').populate('brand', 'name slug');
  return ids
    .map((id) => products.find((p) => p._id.equals(id)))
    .filter(Boolean)
    .slice(0, limit);
};

export const findNewArrivals = (limit = 8) =>
  Product.find({ isNewArrival: true, isActive: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('category')
    .populate('brand', 'name slug');