import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/bannerController.js';
import { protect, authorize } from '../middleware/auth.js';

const admin = [protect, authorize('admin', 'superadmin')];

const bannerMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP and GIF images are allowed'), false);
  },
}).fields([
  { name: 'image', maxCount: 1 },
  { name: 'mobileImage', maxCount: 1 },
]);

// Turn upload problems (too big, wrong type) into a clear 400 instead of a 500
const bannerUpload = (req, res, next) =>
  bannerMulter(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller' : err.message;
    return res.status(400).json({ success: false, message });
  });

// Public: GET /api/banners?placement=hero|promo|department, GET /api/banners/theme
export const publicBannerRoutes = Router();
publicBannerRoutes.get('/', ctrl.getPublicBanners);
publicBannerRoutes.get('/theme', ctrl.getPublicTheme);

// Admin: /api/admin/banners
export const adminBannerRoutes = Router();
adminBannerRoutes.get('/', ...admin, ctrl.getAdminBanners);
adminBannerRoutes.post('/', ...admin, bannerUpload, ctrl.createBanner);
adminBannerRoutes.put('/theme', ...admin, ctrl.updateTheme);
adminBannerRoutes.put('/reorder', ...admin, ctrl.reorderBanners);
adminBannerRoutes.put('/:id', ...admin, bannerUpload, ctrl.updateBanner);
adminBannerRoutes.delete('/:id', ...admin, ctrl.deleteBanner);
