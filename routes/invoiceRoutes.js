import { Router } from 'express';
import * as ctrl from '../controllers/invoiceController.js';
import { protect, authorize } from '../middleware/auth.js';
import { param, body } from 'express-validator';
import { validate } from '../middleware/validate.js';

const router = Router();


router.use(protect, authorize('admin', 'superadmin'));

router.route('/')
  .get(ctrl.getInvoices)
  .post(
    body('invoiceType').isIn(['online', 'manual']).withMessage('Invoice type must be online or manual'),
    body('clientDetails.clientName').trim().notEmpty().withMessage('Client name is required').escape(),
    body('clientDetails.email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Invalid email format').normalizeEmail(),
    body('items').isArray({ min: 1 }).withMessage('Invoice must contain at least one item'),
    body('items.*.productId')
      .optional({ nullable: true, checkFalsy: true })
      .isMongoId()
      .withMessage('Valid Product ID is required when productId is provided'),
    body('items.*.name')
      .optional({ nullable: true, checkFalsy: true })
      .trim()
      .isLength({ max: 300 })
      .withMessage('Item name must not exceed 300 characters'),
    body('items.*.unitPrice')
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0 })
      .withMessage('Unit price must be a non-negative number'),
    body('items.*.quantity')
      .notEmpty()
      .withMessage('Quantity is required')
      .isFloat({ min: 1 })
      .withMessage('Quantity must be at least 1')
      .toFloat(),
    body('deliveryFee')
      .optional({ nullable: true, checkFalsy: true })
      .isFloat({ min: 0 })
      .withMessage('Delivery fee must be a non-negative number'),
    validate,
    ctrl.createInvoice
  );
  router.route('/:id')
  .put(
    param('id').isMongoId().withMessage('Invalid Invoice ID format'),
    validate,
    ctrl.updateInvoice 
  )
  .delete(
    param('id').isMongoId().withMessage('Invalid Invoice ID format'),
    validate,
    ctrl.deleteInvoice
  );

export default router;