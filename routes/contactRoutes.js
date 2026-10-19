import { Router } from 'express';
import { body } from 'express-validator';
import { sendContactMessage } from '../controllers/contactController.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.post(
  '/',
  body('name').trim().isLength({ min: 2, max: 100 }).escape(),
  body('email').isEmail().normalizeEmail(),
  body('phone').matches(/^0\d{9}$/),
  body('message').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  validate,
  sendContactMessage,
);

export default router;
