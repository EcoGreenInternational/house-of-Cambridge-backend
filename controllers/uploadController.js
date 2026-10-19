import { generateSignature } from '../utils/cloudinaryHelper.js';
import ErrorResponse from '../utils/errorResponse.js';

const ALLOWED_SUBFOLDERS = new Set(['products', 'avatars', 'categories', 'returns']);

export const getSignature = (req, res, next) => {
  try {
    const { subfolder = 'misc' } = req.query;
    if (!ALLOWED_SUBFOLDERS.has(subfolder)) {
      return next(new ErrorResponse('Invalid subfolder', 400));
    }
    if (['products', 'categories'].includes(subfolder) && !['admin', 'superadmin'].includes(req.user?.role)) {
      return next(new ErrorResponse('Access denied for this upload subfolder', 403));
    }
    const data = generateSignature(subfolder);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
};