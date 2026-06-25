import { Router } from 'express';
import * as ctrl from '../controllers/orderController.js';
import * as returnCtrl from '../controllers/returnController.js';
import upload from '../middleware/upload.js';
import { protect, authorize, optionalAuth } from '../middleware/auth.js';
import { param, body } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { ORDER_STATUSES, RETURN_REASONS, ALLOWED_RESOLUTIONS } from '../constants/order.js';

const router = Router();

const orderIdParam = (name = 'id') =>
  param(name).custom((val) => {
    const mongoId = /^[a-f\d]{24}$/i.test(val);
    const orderNum = /^HOC-\d{4}-\d{5}$/i.test(val);
    if (!mongoId && !orderNum) throw new Error('Invalid order ID or order number');
    return true;
  });


router.post('/', optionalAuth, ctrl.createOrder);


router.get('/my-orders', protect, ctrl.getMyOrders);


router.get('/my-returns', protect, returnCtrl.getMyReturns);


router.post(
  '/:id/return',
  protect,
  param('id').isMongoId(),
  body('reason').isIn(RETURN_REASONS),
  body('resolution').optional().isIn(ALLOWED_RESOLUTIONS),
  body('description').optional().trim().isLength({ max: 1000 }).escape(),
  validate,
  upload.array('images', 5),
  returnCtrl.createReturn,
);


router.get(
  '/returns/:id',
  protect,
  param('id').isMongoId(),
  validate,
  returnCtrl.getReturn,
);

router.get(
  '/',
  protect,
  authorize('admin', 'superadmin'),
  ctrl.getAllOrders,
);


router.get(
  '/:id',
  optionalAuth,
  orderIdParam('id'),
  validate,
  ctrl.getOrder,
);


router.put(
  '/:id/status',
  protect,
  authorize('admin', 'superadmin'),
  param('id').isMongoId(),
  body('status').isIn(ORDER_STATUSES),
  body('paymentStatus').optional().isIn(['pending', 'paid', 'failed', 'refunded']),
  body('trackingNumber').optional().trim().isLength({ max: 100 }),
  body('adminNotes').optional().trim().isLength({ max: 1000 }),
  validate,
  ctrl.updateOrderStatus,
);

export default router;