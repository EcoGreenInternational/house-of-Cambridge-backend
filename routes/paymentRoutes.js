import { Router } from 'express';
import * as ctrl from '../controllers/paymentController.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { body } from 'express-validator';
import { validate } from '../middleware/validate.js';

const router = Router();

router.post(
  '/payhere/checkout',
  optionalAuth,
  body('orderId').isMongoId(),
  validate,
  ctrl.createPayHereCheckout,
);

router.post('/payhere/notify', ctrl.payHereNotify);

router.post(
  '/paypal/create',
  protect,
  body('orderId').isMongoId(),
  validate,
  ctrl.createPayPalPayment,
);

router.post(
  '/paypal/capture',
  protect,
  body('paypalOrderId').notEmpty().trim(),
  body('orderId').isMongoId(),
  validate,
  ctrl.capturePayPalPayment,
);

router.post(
  '/koko/initiate',
  protect,
  body('orderId').isMongoId(),
  validate,
  ctrl.initiateKoko,
);

router.post('/koko/notify', ctrl.kokoNotify);

export default router;