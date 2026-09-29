import multer from 'multer';
import ErrorResponse from '../utils/errorResponse.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ErrorResponse('Only JPEG, PNG, WebP, and GIF images are allowed', 400), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 15 },
  fileFilter,
});

export default upload;