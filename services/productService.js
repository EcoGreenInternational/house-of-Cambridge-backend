import User from '../model/User.js';
import Review from '../model/Review.js';
import Order from '../model/Order.js';
import Product from '../model/Product.js';
import Category from '../model/Category.js';
import Brand from '../model/Brand.js';
import ErrorResponse from '../utils/errorResponse.js';
import ApiFeatures from '../utils/apiFeatures.js';
import { uploadBuffer, deleteResource } from '../utils/cloudinaryHelper.js';
import * as productRepo from '../repositories/productRepository.js';

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const SLUG_RE      = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_IMAGES   = 10;

const BOOL_FIELDS = Object.freeze([
  'isActive', 'showInUserView', 'isFeatured', 'isFlashSale', 'isPreOwned', 'isNewArrival',
]);

const NUM_FIELDS = Object.freeze([
  'price', 'comparePrice', 'discountPrice', 'discountPercent',
  'stock', 'flashSalePrice', 'weight',
]);

const ACTIVE_ORDER_STATUSES = Object.freeze([
  'pending', 'confirmed', 'processing', 'shipped',
]);

const ALLOWED_LIST_LIMITS  = Object.freeze([8, 12, 16, 20, 24, 48, 96]);
const DEFAULT_LIST_LIMIT   = 12;
const LOYALTY_POINTS_REVIEW = 20;
const PRODUCT_CODE_PREFIX   = 'HOC-';
const PRODUCT_CODE_LENGTH   = 4;

const generateSlug = (name) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const coerceBooleans = (data) => {
  for (const field of BOOL_FIELDS) {
    if (field in data) {
      data[field] = data[field] === true || data[field] === 'true' || data[field] === '1';
    }
  }
};

const coerceNumbers = (data) => {
  for (const field of NUM_FIELDS) {
    if (field in data && data[field] !== '' && data[field] !== undefined) {
      const n = Number(data[field]);
      if (!Number.isFinite(n) || n < 0) {
        throw new ErrorResponse(`Field "${field}" must be a non-negative number`, 400);
      }
      data[field] = n;
    }
  }
};

const uploadImages = async (files, folder) => {
  const capped    = files.slice(0, MAX_IMAGES);
  const uploaded  = await Promise.all(capped.map((f) => uploadBuffer(f.buffer, folder)));
  return uploaded
    .filter((r) => r?.public_id && r?.secure_url)
    .map((r) => ({ public_id: r.public_id, url: r.secure_url }));
};

const deleteImages = async (images = []) => {
  await Promise.allSettled(
    images.filter((img) => img?.public_id).map((img) => deleteResource(img.public_id)),
  );
};

const resolveSlug = async (base, excludeId = null) => {
  const filter = excludeId
    ? { slug: base, _id: { $ne: excludeId } }
    : { slug: base };
  const collision = await Product.findOne(filter).select('_id').lean();
  return collision ? `${base}-${Date.now()}` : base;
};

export const generateProductCode = async () => {
  const latestProduct = await Product.findOne().sort({ _id: -1 }).select('productCode').lean(); 
  const lastCode = latestProduct?.productCode;
  const match = typeof lastCode === 'string' ? lastCode.match(/^HOC-(\d+)$/i) : null;
  const nextNumber = match ? Number(match[1]) + 1 : 1;

  return `${PRODUCT_CODE_PREFIX}${String(nextNumber).padStart(PRODUCT_CODE_LENGTH, '0')}`;
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildKeywordSearchFilter = async (keyword) => {
  if (!keyword || typeof keyword !== 'string') return null;
  const rawKeyword = keyword.trim();
  if (!rawKeyword) return null;

  const rawTokens = rawKeyword.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (rawTokens.length === 0) return null;

  const tokenData = rawTokens.map((token) => {
    let clean = token.replace(/^[^\w]+|[^\w]+$/g, '');
    if (!clean) clean = token;
    clean = clean.replace(/['’]s$/i, '');

    let stem = clean;
    if (stem.length > 3 && stem.toLowerCase().endsWith('s') && !stem.toLowerCase().endsWith('ss')) {
      stem = stem.slice(0, -1);
    }

    const escapedStem = escapeRegex(stem || token);
    const regex = new RegExp(escapedStem + "['’]?s?", 'i');
    return { token, stem, regex };
  });

  const brandMatches = await Promise.all(
    tokenData.map(({ regex }) => Brand.find({ name: regex, isActive: true }).select('_id').lean())
  );
  const categoryMatches = await Promise.all(
    tokenData.map(({ regex }) => Category.find({ name: regex, isActive: true }).select('_id').lean())
  );

  const tokenConditions = tokenData.map(({ regex }, index) => {
    const brandIds = (brandMatches[index] || []).map((b) => b._id);
    const categoryIds = (categoryMatches[index] || []).map((c) => c._id);

    const condition = {
      $or: [
        { name: regex },
        { description: regex },
        { shortDescription: regex },
        { tags: regex },
        { productCode: regex },
        { sku: regex },
      ],
    };

    if (brandIds.length > 0) {
      condition.$or.push({ brand: { $in: brandIds } });
    }
    if (categoryIds.length > 0) {
      condition.$or.push({ category: { $in: categoryIds } });
    }

    return condition;
  });

  return {
    rawKeyword,
    tokenData,
    tokenConditions,
  };
};

export const getProducts = async (queryStr) => {
  const rawLimit  = parseInt(queryStr.limit, 10);
  const resPerPage = ALLOWED_LIST_LIMITS.includes(rawLimit) ? rawLimit : DEFAULT_LIST_LIMIT;
  const currentPage = Math.max(1, Number(queryStr.page) || 1);

  const processedQuery = { ...queryStr };

  if (processedQuery.category) {
    if (OBJECT_ID_RE.test(processedQuery.category)) {
      // valid ObjectId - pass through
    } else if (typeof processedQuery.category === 'string') {
      const cat = await Category.findOne({
        slug:     processedQuery.category.slice(0, 100),
        isActive: true,
      }).select('_id').lean();
      processedQuery.category = cat ? cat._id.toString() : '__none__';
    } else {
      processedQuery.category = '__none__';
    }
  }

  if (processedQuery.brand) {
    if (OBJECT_ID_RE.test(processedQuery.brand)) {
      // valid ObjectId - pass through
    } else if (typeof processedQuery.brand === 'string') {
      const b = await Brand.findOne({
        slug:     processedQuery.brand.slice(0, 100),
        isActive: true,
      }).select('_id').lean();
      processedQuery.brand = b ? b._id.toString() : '__none__';
    } else {
      processedQuery.brand = '__none__';
    }
  }

  const baseFilter = {
    isActive: true,
    showInUserView: { $ne: false },
    approvalStatus: { $nin: ['pending', 'rejected', 'draft'] },
  };
  let searchResultInfo = null;

  if (processedQuery.keyword) {
    const searchFilter = await buildKeywordSearchFilter(processedQuery.keyword);
    if (searchFilter && searchFilter.tokenConditions.length > 0) {
      searchResultInfo = searchFilter;
      const { tokenConditions } = searchFilter;

      if (tokenConditions.length === 1) {
        Object.assign(baseFilter, tokenConditions[0]);
      } else {
        const andFilter = { ...baseFilter, $and: tokenConditions };
        const andCount = await Product.countDocuments(andFilter);
        if (andCount > 0) {
          baseFilter.$and = tokenConditions;
        } else {
          baseFilter.$or = tokenConditions;
        }
      }
    }
    delete processedQuery.keyword;
  }

  const isDefaultSort = !queryStr.sort || queryStr.sort === 'newest';

  const features = new ApiFeatures(
    Product.find(baseFilter).populate('category', 'name slug').populate('brand', 'name slug'),
    processedQuery,
  ).filter().sort();

  const countFeatures = new ApiFeatures(
    Product.find(baseFilter),
    processedQuery,
  ).filter();

  if (searchResultInfo && isDefaultSort) {
    const [total, rawProducts] = await Promise.all([
      countFeatures.query.countDocuments(),
      features.query.limit(300),
    ]);

    const scoredProducts = rawProducts.map((p) => {
      const obj = p.toObject ? p.toObject() : p;
      let score = 0;
      const pName = (obj.name || '').toLowerCase();
      const kw = searchResultInfo.rawKeyword.toLowerCase();
      const brandName = (obj.brand?.name || '').toLowerCase();
      const catName = (obj.category?.name || '').toLowerCase();
      const tags = Array.isArray(obj.tags) ? obj.tags.map((t) => String(t).toLowerCase()) : [];
      const shortDesc = (obj.shortDescription || '').toLowerCase();
      const desc = (obj.description || '').toLowerCase();

      if (pName === kw) score += 300;
      else if (pName.startsWith(kw)) score += 150;
      else if (pName.includes(kw)) score += 100;

      searchResultInfo.tokenData.forEach(({ regex }) => {
        if (regex.test(pName)) score += 50;
        if (regex.test(brandName)) score += 45;
        if (regex.test(catName)) score += 25;
        if (tags.some((t) => regex.test(t))) score += 20;
        if (regex.test(shortDesc)) score += 15;
        if (regex.test(desc)) score += 5;
      });

      if (obj.ratings) score += obj.ratings * 2;

      return { product: p, score };
    });

    scoredProducts.sort((a, b) => b.score - a.score);

    const skip = resPerPage * (currentPage - 1);
    const products = scoredProducts.slice(skip, skip + resPerPage).map((s) => s.product);

    return { products, total, resPerPage };
  }

  const [total, products] = await Promise.all([
    countFeatures.query.countDocuments(),
    features.paginate(resPerPage).query,
  ]);

  return { products, total, resPerPage };
};

export const getProductById = async (id) => {
  if (!OBJECT_ID_RE.test(id)) throw new ErrorResponse('Invalid product ID', 400);

  const product = await productRepo.findById(id);
  if (
    !product ||
    !product.isActive ||
    product.showInUserView === false ||
    ['pending', 'rejected', 'draft'].includes(product.approvalStatus)
  ) throw new ErrorResponse('Product not found', 404);

  const reviews = await Review.find({ product: id, status: 'approved' })
    .populate('user', 'name avatar')
    .sort('-createdAt')
    .lean();

  return { ...product.toObject(), reviews };
};

const processVariantsAndImages = async (data, files) => {
  if (typeof data.variantAttributes === 'string' && data.variantAttributes.trim()) {
    try {
      data.variantAttributes = JSON.parse(data.variantAttributes);
    } catch {
      data.variantAttributes = [];
    }
  }

  let variants = [];
  if (Array.isArray(data.variants)) {
    variants = data.variants;
  } else if (typeof data.variants === 'string' && data.variants.trim()) {
    try {
      variants = JSON.parse(data.variants);
    } catch {
      variants = [];
    }
  }

  if (Array.isArray(variants) && variants.length > 0) {
    const variantImageMap = new Map();
    for (const f of files) {
      if (f.fieldname && f.fieldname.startsWith('variant_image_')) {
        const idx = parseInt(f.fieldname.replace('variant_image_', ''), 10);
        if (!Number.isNaN(idx)) {
          variantImageMap.set(idx, f);
        }
      }
    }

    data.variants = await Promise.all(
      variants.map(async (v, idx) => {
        const fileForVariant = variantImageMap.get(idx);
        let image = v.image || { public_id: '', url: '' };

        if (fileForVariant) {
          const res = await uploadBuffer(fileForVariant.buffer, 'products');
          if (res?.public_id && res?.secure_url) {
            image = { public_id: res.public_id, url: res.secure_url };
          }
        }

        return {
          sku: v.sku ? String(v.sku).trim() : '',
          name: v.name ? String(v.name).trim() : '',
          attributes: typeof v.attributes === 'object' && v.attributes !== null ? v.attributes : {},
          price: Number(v.price) >= 0 ? Number(v.price) : 0,
          comparePrice: Number(v.comparePrice) >= 0 ? Number(v.comparePrice) : 0,
          stock: Number(v.stock) >= 0 ? Math.floor(Number(v.stock)) : 0,
          image,
          isActive: v.isActive !== false,
        };
      })
    );
  }
};

const sanitizeProductData = (data) => {
  coerceBooleans(data);
  coerceNumbers(data);

  if (data.brand === '' || data.brand === 'null' || data.brand === 'undefined' || !data.brand) {
    data.brand = null;
  } else if (typeof data.brand === 'object' && data.brand?._id) {
    data.brand = data.brand._id;
  }

  if (typeof data.category === 'object' && data.category?._id) {
    data.category = data.category._id;
  }

  if (!data.sku || (typeof data.sku === 'string' && data.sku.trim() === '')) {
    data.sku = null;
  }

  if (typeof data.usageInstructions === 'string') {
    data.usageInstructions = [data.usageInstructions];
  }
  if (Array.isArray(data.usageInstructions)) {
    data.usageInstructions = data.usageInstructions.filter(Boolean);
  }
};

export const createProduct = async (data, files = []) => {
  if (!data.productCode) {
    data.productCode = await generateProductCode();
  }

  sanitizeProductData(data);

  if (data.name && typeof data.name !== 'string') {
    throw new ErrorResponse('Product name must be a string', 400);
  }

  if (data.slug) {
    if (!SLUG_RE.test(data.slug)) throw new ErrorResponse('Invalid slug format', 400);
    data.slug = await resolveSlug(data.slug);
  } else if (data.name) {
    data.slug = await resolveSlug(generateSlug(data.name));
  }

  await processVariantsAndImages(data, files);

  const mainFiles = files.filter(
    (f) => f.fieldname === 'images' || (!f.fieldname?.startsWith('variant_image_'))
  );
  data.images = mainFiles.length ? await uploadImages(mainFiles, 'products') : [];

  const product = await productRepo.create(data);
  return product.populate([
    { path: 'category', select: 'name slug variantAttributes' },
    { path: 'brand', select: 'name' }
  ]);
};

export const updateProduct = async (id, data, files = []) => {
  if (!OBJECT_ID_RE.test(id)) throw new ErrorResponse('Invalid product ID', 400);

  const product = await productRepo.findById(id);
  if (!product) throw new ErrorResponse('Product not found', 404);

  sanitizeProductData(data);

  const safeFiles = Array.isArray(files) ? files : [];
  await processVariantsAndImages(data, safeFiles);

  const mainFiles = safeFiles.filter(
    (f) => f.fieldname === 'images' || (!f.fieldname?.startsWith('variant_image_'))
  );

  let keptImages = product.images || [];
  if (data.existingImages !== undefined) {
    try {
      const parsed = typeof data.existingImages === 'string' ? JSON.parse(data.existingImages) : data.existingImages;
      if (Array.isArray(parsed)) {
        keptImages = parsed;
      }
    } catch (e) {
      keptImages = product.images || [];
    }
  }

  if (mainFiles.length) {
    const newImages = await uploadImages(mainFiles, 'products');
    const keptPublicIds = new Set(keptImages.map((img) => img.public_id).filter(Boolean));
    const imagesToDelete = (product.images || []).filter((img) => img.public_id && !keptPublicIds.has(img.public_id));
    if (imagesToDelete.length > 0) {
      await deleteImages(imagesToDelete);
    }
    data.images = [...keptImages, ...newImages];
  } else if (data.existingImages !== undefined) {
    const keptPublicIds = new Set(keptImages.map((img) => img.public_id).filter(Boolean));
    const imagesToDelete = (product.images || []).filter((img) => img.public_id && !keptPublicIds.has(img.public_id));
    if (imagesToDelete.length > 0) {
      await deleteImages(imagesToDelete);
    }
    data.images = keptImages;
  }

  if (!data.slug && data.name && data.name !== product.name) {
    data.slug = await resolveSlug(generateSlug(data.name), id);
  } else if (data.slug) {
    if (!SLUG_RE.test(data.slug)) throw new ErrorResponse('Invalid slug format', 400);
    data.slug = await resolveSlug(data.slug, id);
  }

  const updatedProduct = await Product.findByIdAndUpdate(id, data, {
    returnDocument: 'after',
    runValidators: true,
  });
  if (!updatedProduct) throw new ErrorResponse('Product not found', 404);

  return updatedProduct;
};

export const deleteProduct = async (id) => {
  if (!OBJECT_ID_RE.test(id)) throw new ErrorResponse('Invalid product ID', 400);

  const product = await productRepo.findById(id);
  if (!product) throw new ErrorResponse('Product not found', 404);

  const activeOrder = await Order.findOne({
    'items.product': id,
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
  }).select('_id').lean();

  if (activeOrder) {
    throw new ErrorResponse(
      'Cannot delete: product is part of an active order. Cancel the order first.',
      409,
    );
  }

  const variantImages = (product.variants || [])
    .map((v) => v.image)
    .filter((img) => img?.public_id);
  await deleteImages([...product.images, ...variantImages]);
  await productRepo.remove(id);
};

export const createReview = async (productId, userId, reviewData, files = []) => {
  if (!OBJECT_ID_RE.test(productId)) throw new ErrorResponse('Invalid product ID', 400);
  if (!OBJECT_ID_RE.test(String(userId)))  throw new ErrorResponse('Invalid user ID',    400);

  const product = await productRepo.findById(productId);
  if (!product) throw new ErrorResponse('Product not found', 404);

  const existing = await Review.findOne({ product: productId, user: userId }).select('_id').lean();
  if (existing) throw new ErrorResponse('You have already reviewed this product', 409);

  const { rating, title, comment } = reviewData;

  const parsedRating = parseInt(rating, 10);
  if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    throw new ErrorResponse('Rating must be an integer between 1 and 5', 400);
  }

  const purchase = await Order.findOne({
    user:             userId,
    'items.product':  productId,
    orderStatus:      'delivered',
  }).select('_id').lean();

  const images = files.length ? await uploadImages(files, 'reviews') : [];

  const review = await Review.create({
    rating:             parsedRating,
    title:              typeof title   === 'string' ? title.slice(0, 200)   : '',
    comment:            typeof comment === 'string' ? comment.slice(0, 2000) : '',
    images,
    product:            productId,
    user:               userId,
    isVerifiedPurchase: !!purchase,
    status:             'pending',
  });

  if (purchase) {
    await Order.updateOne(
      { _id: purchase._id, 'items.product': productId },
      { $set: { 'items.$.isReviewed': true } },
    );
  }

  return review;
};

export const recalculateRatings = async (productId) => {
  if (!OBJECT_ID_RE.test(productId)) throw new ErrorResponse('Invalid product ID', 400);

  const reviews    = await Review.find({ product: productId, status: 'approved' }).select('rating').lean();
  const numReviews = reviews.length;
  const ratings    = numReviews > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / numReviews
    : 0;

  await Product.findByIdAndUpdate(productId, { ratings, numReviews });
};