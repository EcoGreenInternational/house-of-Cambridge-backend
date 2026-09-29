import * as productService from '../services/productService.js';
import * as productRepo from '../repositories/productRepository.js';
import Category from '../model/Category.js';
import Product from '../model/Product.js';
import ErrorResponse from '../utils/errorResponse.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const ALLOWED_LIST_LIMITS = Object.freeze([8, 12, 16, 20, 24, 48]);
const DEFAULT_LIST_LIMIT   = 8;

const validateObjectId = (id, label = 'ID') => {
  if (!id || !OBJECT_ID_RE.test(id)) throw new ErrorResponse(`Invalid ${label}`, 400);
};

const sanitiseListLimit = (raw, fallback = DEFAULT_LIST_LIMIT) => {
  const n = parseInt(raw, 10);
  return ALLOWED_LIST_LIMITS.includes(n) ? n : fallback;
};

export const getProducts = async (req, res, next) => {
  try {
    const data = await productService.getProducts(req.query);
    return res.json({ success: true, ...data });
  } catch (err) {
    return next(err);
  }
};

export const getProduct = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');
    const product = await productService.getProductById(req.params.id);
    if (!product) return next(new ErrorResponse('Product not found', 404));
    return res.json({ success: true, product });
  } catch (err) {
    return next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(new ErrorResponse('Invalid product payload', 400));
    }

    if (!req.body.productCode) {
      req.body.productCode = await productService.generateProductCode();
    }

    if (req.body.attributes && typeof req.body.attributes === 'string') {
      try {
        const parsedAttributes = JSON.parse(req.body.attributes);
        
        req.body.specifications = Object.entries(parsedAttributes)
          .filter(([_, value]) => value !== undefined && value !== null && String(value).trim() !== '')
          .map(([key, value]) => ({
            key: key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()).trim(),
            value: String(value).trim(),
        }));
      } catch (e) {
        return next(new ErrorResponse('Malformed technical attributes metadata structure', 400));
      }
    }

    const product = await productService.createProduct(req.body, req.files ?? []);
    return res.status(201).json({ success: true, product });
  } catch (err) {
    return next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(new ErrorResponse('Invalid product payload', 400));
    }

    if (req.body.attributes && typeof req.body.attributes === 'string') {
      try {
        const parsedAttributes = JSON.parse(req.body.attributes);
        req.body.specifications = Object.entries(parsedAttributes)
          .filter(([_, value]) => value !== undefined && value !== null && String(value).trim() !== '')
          .map(([key, value]) => ({
            key: key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()).trim(),
            value: String(value).trim(),
        }));
      } catch (e) {
        return next(new ErrorResponse('Malformed technical attributes metadata structure', 400));
      }
    }

    const product = await productService.updateProduct(req.params.id, req.body, req.files ?? []);
    if (!product) return next(new ErrorResponse('Product not found', 404));
    return res.json({ success: true, product });
  } catch (err) {
    return next(err);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');
    await productService.deleteProduct(req.params.id);
    return res.json({ success: true, message: 'Product deleted successfully' });
  } catch (err) {
    return next(err);
  }
};

export const getFlashSaleProducts = async (req, res, next) => {
  try {
    const limit    = sanitiseListLimit(req.query.limit);
    const products = await productRepo.findFlashSale(limit);
    return res.json({ success: true, count: products.length, products });
  } catch (err) {
    return next(err);
  }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const limit    = sanitiseListLimit(req.query.limit);
    const products = await productRepo.findFeatured(limit);
    return res.json({ success: true, count: products.length, products });
  } catch (err) {
    return next(err);
  }
};

export const getPopularProducts = async (req, res, next) => {
  try {
    const limit    = sanitiseListLimit(req.query.limit);
    const products = await productRepo.findPopular(limit);
    return res.json({ success: true, count: products.length, products });
  } catch (err) {
    return next(err);
  }
};

export const getNewArrivalProducts = async (req, res, next) => {
  try {
    const limit    = sanitiseListLimit(req.query.limit);
    const products = await productRepo.findNewArrivals(limit);
    return res.json({ success: true, count: products.length, products });
  } catch (err) {
    return next(err);
  }
};

export const createReview = async (req, res, next) => {
  try {
    validateObjectId(req.params.id, 'product ID');

    if (!req.user?._id) return next(new ErrorResponse('Authentication required', 401));

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return next(new ErrorResponse('Invalid review payload', 400));
    }

    const review = await productService.createReview(
      req.params.id,
      req.user._id,
      req.body,
      req.files ?? [],
    );
    return res.status(201).json({ success: true, review });
  } catch (err) {
    return next(err);
  }
};

export const getCategories = async (req, res, next) => {
  try {
    const { preOwned, newArrival } = req.query;
    const isPreOwned   = preOwned   === 'true';
    const isNewArrival = newArrival === 'true';

    if (!isPreOwned && !isNewArrival) {
      const categories = await Category.find({ isActive: true })
        .populate('parent', 'name')
        .sort('order name')
        .lean();
      return res.json({ success: true, count: categories.length, categories });
    }

    const productFilter = { isActive: true, showInUserView: { $ne: false } };
    if (isPreOwned)   productFilter.isPreOwned   = true;
    if (isNewArrival) productFilter.isNewArrival = true;

    const catIds = await Product.distinct('category', productFilter);
    if (!catIds.length) return res.json({ success: true, count: 0, categories: [] });

    const matched = await Category.find({ _id: { $in: catIds }, isActive: true })
      .select('_id parent')
      .lean();

    const parentIds = matched
      .filter((c) => c.parent)
      .map((c) => c.parent.toString());

    const allIds = [...new Set([...catIds.map(String), ...parentIds])];

    const categories = await Category.find({ _id: { $in: allIds }, isActive: true })
      .populate('parent', 'name')
      .sort('order name')
      .lean();

    return res.json({ success: true, count: categories.length, categories });
  } catch (err) {
    return next(err);
  }
};