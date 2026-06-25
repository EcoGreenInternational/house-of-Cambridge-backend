import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import connectDB from './config/db.js';
import errorHandler from './middleware/errorHandler.js';
import { requestLogger } from './utils/logger.js';
import { apiLimiter } from './utils/rateLimiter.js';
import './config/firebaseAdmin.js';
import authRoutes    from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import cartRoutes    from './routes/cartRoutes.js';
import orderRoutes   from './routes/orderRoutes.js';
import userRoutes    from './routes/userRoutes.js';
import adminRoutes   from './routes/adminRoutes.js';
import uploadRoutes  from './routes/uploadRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import brandRoutes   from './routes/brandRoutes.js';
import loyaltyRoutes from './routes/loyaltyRoutes.js';

connectDB();

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());


const sanitiseValue = (value) => {
  if (typeof value === 'string') {
    return value.replace(/\$/g, '');
  }
  if (Array.isArray(value)) {
    return value.map(sanitiseValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitiseObject(value);
  }
  return value;
};

const sanitiseObject = (obj) => {
  const result = {};
  for (const key of Object.keys(obj)) {
    const safeKey = key.replace(/[$.]/, '');
    result[safeKey] = sanitiseValue(obj[key]);
  }
  return result;
};

const mongoSanitize = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitiseObject(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      req.query[key] = sanitiseValue(req.query[key]);
    }
  }
  if (req.params && typeof req.params === 'object') {
    for (const key of Object.keys(req.params)) {
      req.params[key] = sanitiseValue(req.params[key]);
    }
  }
  next();
};

app.use(mongoSanitize);


app.use(requestLogger);
app.use('/api', apiLimiter);

app.use('/api/auth',     authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart',     cartRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/admin',    adminRoutes);
app.use('/api/upload',   uploadRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/brands',   brandRoutes);
app.use('/api/loyalty',  loyaltyRoutes);  

app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  }
});