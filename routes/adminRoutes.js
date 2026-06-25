import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/adminController.js';
import * as brandCtrl from '../controllers/brandController.js';
import { protect, authorize } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import { param, body, query } from 'express-validator';
import { validate } from '../middleware/validate.js';

const router = Router();

const admin = [protect, authorize('admin', 'superadmin')];
const superOnly = [protect, authorize('superadmin')];

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});


const orderIdParam = param('id')
  .custom((val) => {
    const mongoId = /^[a-f\d]{24}$/i.test(val);
    const orderNum = /^HOC-\d{4}-\d{5}$/i.test(val);
    if (!mongoId && !orderNum) throw new Error('Invalid order ID or order number');
    return true;
  });

const mongoId = (name) => param(name).isMongoId();

router.get('/dashboard', ...admin, ctrl.getDashboardStats);

router.get('/users', ...admin, ctrl.getUsers);
router.get('/users/:id', ...admin, mongoId('id'), validate, ctrl.getUser);
router.put(
  '/users/:id',
  ...admin,
  mongoId('id'),
  body('role').optional().isIn(['user', 'admin', 'superadmin']),
  body('isActive').optional().isBoolean(),
  body('loyaltyPoints').optional().isInt({ min: 0 }),
  validate,
  ctrl.updateUser,
);
router.delete('/users/:id', ...superOnly, mongoId('id'), validate, ctrl.deleteUser);
router.post(
  '/users/create-admin',
  ...superOnly,
  body('name').trim().notEmpty().isLength({ max: 100 }).escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }),
  body('role').optional().isIn(['admin', 'superadmin']),
  validate,
  ctrl.createAdmin,
);

router.get('/orders', ...admin, ctrl.getOrders);

router.get('/orders/:id', ...admin, orderIdParam, validate, ctrl.getOrder);

router.put(
  '/orders/:id/status',
  ...admin,
  mongoId('id'),
  body('status').isIn(['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned']),
  body('paymentStatus').optional().isIn(['pending', 'paid', 'failed', 'refunded']),
  body('trackingNumber').optional().trim().isLength({ max: 100 }).escape(),
  body('adminNotes').optional().trim().isLength({ max: 1000 }).escape(),
  validate,
  ctrl.updateOrderStatus,
);

router.get('/products', ...admin, ctrl.getAdminProducts);
router.post('/products', ...admin, upload.array('images', 10), ctrl.createProduct);
router.put('/products/:id', ...admin, mongoId('id'), validate, upload.array('images', 10), ctrl.updateProduct);
router.patch(
  '/products/:id/flash-sale',
  ...admin,
  mongoId('id'),
  body('isFlashSale').isBoolean(),
  body('flashSalePrice').optional().isFloat({ min: 0 }),
  validate,
  ctrl.updateFlashSale,
);
router.delete('/products/:id', ...admin, mongoId('id'), validate, ctrl.deleteProduct);

router.get('/categories', ...admin, ctrl.getCategories);
router.post('/categories', ...admin, upload.single('image'), ctrl.createCategory);
router.put('/categories/:id', ...admin, mongoId('id'), validate, upload.single('image'), ctrl.updateCategory);
router.delete('/categories/:id', ...admin, mongoId('id'), validate, ctrl.deleteCategory);

router.get('/brands', ...admin, brandCtrl.getBrands);
router.post('/brands', ...admin, logoUpload.single('logo'), brandCtrl.createBrand);
router.put('/brands/:id', ...admin, mongoId('id'), validate, logoUpload.single('logo'), brandCtrl.updateBrand);
router.delete('/brands/:id', ...admin, mongoId('id'), validate, brandCtrl.deleteBrand);

router.get('/coupons', ...admin, ctrl.getCoupons);
router.post(
  '/coupons',
  ...admin,
  body('code').trim().notEmpty().isLength({ max: 50 }).toUpperCase(),
  body('discountType').isIn(['percentage', 'fixed']),
  body('discountValue').isFloat({ min: 0 }),
  body('validTo').isISO8601(),
  validate,
  ctrl.createCoupon,
);
router.put(
  '/coupons/:id',
  ...admin,
  mongoId('id'),
  body('discountType').optional().isIn(['percentage', 'fixed']),
  body('discountValue').optional().isFloat({ min: 0 }),
  body('validTo').optional().isISO8601(),
  validate,
  ctrl.updateCoupon,
);
router.delete('/coupons/:id', ...admin, mongoId('id'), validate, ctrl.deleteCoupon);

router.get('/reviews', ...admin, ctrl.getReviews);
router.put('/reviews/:id/approve', ...admin, mongoId('id'), validate, ctrl.approveReview);
router.put('/reviews/:id/reject', ...admin, mongoId('id'), validate, ctrl.rejectReview);
router.delete('/reviews/:id', ...admin, mongoId('id'), validate, ctrl.deleteReview);

router.get('/returns', ...admin, ctrl.getReturns);
router.get('/returns/:id', ...admin, mongoId('id'), validate, ctrl.getReturn);
router.put(
  '/returns/:id/status',
  ...admin,
  mongoId('id'),
  body('status').isIn(['pending', 'in_review', 'approved', 'rejected', 'collected', 'qc', 'refunded']),
  body('refundAmount').optional().isFloat({ min: 0 }),
  validate,
  ctrl.updateReturnStatus,
);
router.delete('/returns/:id', ...admin, mongoId('id'), validate, ctrl.deleteReturn);

router.post(
  '/notifications/broadcast',
  ...admin,
  body('title').trim().notEmpty().isLength({ max: 200 }).escape(),
  body('message').trim().notEmpty().isLength({ max: 1000 }).escape(),
  body('type').optional().isIn(['order', 'promotion', 'system', 'review', 'loyalty']),
  body('targetRole').optional().isIn(['user', 'admin']),
  body('link').optional().trim().isURL({ require_tld: false }),
  validate,
  ctrl.broadcastNotification,
);

export default router;