import { Router } from 'express';
import * as ctrl from '../controllers/productController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { param, body } from 'express-validator';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', ctrl.getProducts);
router.get('/flash-sale', ctrl.getFlashSaleProducts);
router.get('/featured', ctrl.getFeaturedProducts);
router.get('/popular', ctrl.getPopularProducts);
router.get('/new-arrivals', ctrl.getNewArrivalProducts);
router.get('/categories', ctrl.getCategories);
router.get('/:id', param('id').isMongoId(), validate, ctrl.getProduct);

router.post(
  '/:id/reviews',
  protect,
  param('id').isMongoId(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').trim().notEmpty().isLength({ max: 2000 }).escape(),
  body('title').optional().trim().isLength({ max: 200 }).escape(),
  validate,
  upload.array('images', 5),
  ctrl.createReview,
);

router.post(
  '/',
  protect,
  authorize('admin', 'superadmin'),
  upload.any(),
  ctrl.createProduct,
);

router.put(
  '/:id',
  protect,
  authorize('admin', 'superadmin'),
  param('id').isMongoId(),
  validate,
  upload.any(),
  ctrl.updateProduct,
);

router.delete(
  '/:id',
  protect,
  authorize('admin', 'superadmin'),
  param('id').isMongoId(),
  validate,
  ctrl.deleteProduct,
);

export default router;