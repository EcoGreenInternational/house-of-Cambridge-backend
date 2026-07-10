import * as authService from '../services/authService.js';
import * as userRepo from '../repositories/userRepository.js';
import sendToken from '../utils/sendToken.js';
import ErrorResponse from '../utils/errorResponse.js';
import jwt from 'jsonwebtoken';
import User from '../model/User.js';

const EMAIL_RE         = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_CLEAR_OPTIONS = Object.freeze({
  httpOnly: true,
  secure:   IS_PROD,
  sameSite: IS_PROD ? 'strict' : 'lax',
  path:     '/',
  expires:  new Date(0),
});

export const register = async (req, res, next) => {
  try {
    await authService.register(req.body);
    return res.status(201).json({
      success: true,
      message: 'Registration successful. Please verify your email.',
    });
  } catch (err) {
    return next(err);
  }
};

export const login = async (req, res, next) => {
  try {
    const email    = typeof req.body.email    === 'string' ? req.body.email.trim().toLowerCase()    : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !EMAIL_RE.test(email)) {
      return next(new ErrorResponse('A valid email is required', 400));
    }
    if (!password) {
      return next(new ErrorResponse('Password is required', 400));
    }

    const user = await authService.login({ email, password });
    return await sendToken(user, 200, res);
  } catch (err) {
    return next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    if (req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
    }
  } catch (err) {
    // Log the error but don't block logout
  }
  res
    .cookie('token', '', COOKIE_CLEAR_OPTIONS)
    .cookie('refreshToken', '', { ...COOKIE_CLEAR_OPTIONS, path: '/api/auth/refresh-token' })
    .json({ success: true, message: 'Logged out' });
};

export const getMe = async (req, res, next) => {
  try {
    if (!req.user?._id) return next(new ErrorResponse('Authentication required', 401));
    const user = await userRepo.findById(req.user._id);
    if (!user) return next(new ErrorResponse('User not found', 404));
    return res.json({ success: true, user });
  } catch (err) {
    return next(err);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return next(new ErrorResponse('No refresh token', 401));

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return next(new ErrorResponse('Invalid or expired refresh token', 401));
    }

    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return next(new ErrorResponse('Refresh token revoked', 401));
    }

    const newAccessToken = user.getJwtToken();
    res.cookie('token', newAccessToken, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path:     '/',
      expires:  new Date(Date.now() + 60 * 60 * 1000),
    });

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_RE.test(email)) {
      return next(new ErrorResponse('A valid email is required', 400));
    }
    await authService.forgotPassword(email);
    return res.json({ success: true, message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    return next(err);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!password || password.length < MIN_PASSWORD_LEN) {
      return next(new ErrorResponse(`Password must be at least ${MIN_PASSWORD_LEN} characters`, 400));
    }
    const user = await authService.resetPassword(req.params.token, password);
    return sendToken(user, 200, res);
  } catch (err) {
    return next(err);
  }
};

export const verifyEmail = async (req, res, next) => {
  try {
    const user = await authService.verifyEmail(req.params.token);
    return sendToken(user, 200, res);
  } catch (err) {
    return next(err);
  }
};

export const googleAuth = async (req, res, next) => {
  try {
    
    const idToken = typeof req.body.idToken === 'string' ? req.body.idToken.trim() : '';
    if (!idToken) return next(new ErrorResponse('ID token is required', 400));
    const user = await authService.googleAuth(idToken);
    return sendToken(user, 200, res);
  } catch (err) {
    return next(err);
  }
};

export const facebookAuth = async (req, res, next) => {
  try {
    const accessToken = typeof req.body.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!accessToken) return next(new ErrorResponse('Access token is required', 400));
    const user = await authService.facebookAuth(accessToken);
    return sendToken(user, 200, res);
  } catch (err) {
    return next(err);
  }
};

export const updatePassword = async (req, res, next) => {
  try {
    if (!req.user?._id) return next(new ErrorResponse('Authentication required', 401));

    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword     = typeof req.body.newPassword     === 'string' ? req.body.newPassword     : '';

    if (!currentPassword || !newPassword) {
      return next(new ErrorResponse('Current and new passwords are required', 400));
    }
    if (newPassword.length < MIN_PASSWORD_LEN) {
      return next(new ErrorResponse(`New password must be at least ${MIN_PASSWORD_LEN} characters`, 400));
    }
    if (currentPassword === newPassword) {
      return next(new ErrorResponse('New password must differ from the current one', 400));
    }

    const user    = await userRepo.findByEmail(req.user.email);
    if (!user) return next(new ErrorResponse('User not found', 404));

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) return next(new ErrorResponse('Current password is incorrect', 401));

    user.password = newPassword;
    await user.save();

    return sendToken(user, 200, res);
  } catch (err) {
    return next(err);
  }
};