import { Router } from 'express';
import * as ctrl from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate.js';

const router = Router();

// Note: authLimiter is already applied in server.js for the entire /api/auth prefix.
// Do NOT apply it again here on individual routes to avoid double rate-limiting.

router.post(
  '/register',
  body('name').trim().notEmpty().isLength({ min: 2, max: 100 }).escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8, max: 128 }),
  validate,
  ctrl.register,
);

router.post(
  '/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  validate,
  ctrl.login,
);

router.post(
  '/google',
  body('idToken').notEmpty().trim(),   
  validate,
  ctrl.googleAuth,
);

router.post(
  '/facebook',
  body('accessToken').notEmpty().trim(),
  validate,
  ctrl.facebookAuth,
);

router.post('/logout', ctrl.logout);

router.get('/me', protect, ctrl.getMe);

router.post(
  '/forgot-password',
  body('email').isEmail().normalizeEmail(),
  validate,
  ctrl.forgotPassword,
);

router.put(
  '/reset-password/:token',
  param('token').isHexadecimal().isLength({ min: 40, max: 40 }),
  body('password').isLength({ min: 8, max: 128 }),
  validate,
  ctrl.resetPassword,
);

router.get(
  '/verify-email/:token',
  param('token').isHexadecimal().isLength({ min: 40, max: 40 }),
  validate,
  ctrl.verifyEmail,
);

router.put(
  '/update-password',
  protect,
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8, max: 128 }),
  validate,
  ctrl.updatePassword,
);

export default router;