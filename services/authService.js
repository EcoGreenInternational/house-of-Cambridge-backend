import crypto from 'crypto';
import User from '../model/User.js';
import ErrorResponse from '../utils/errorResponse.js';
import sendEmail from '../utils/sendEmail.js';
import * as userRepo from '../repositories/userRepository.js';
import admin from 'firebase-admin';

const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE        = /^[a-f0-9]{40,64}$/i;
const MIN_PASSWORD_LEN = 8;

const ALLOWED_PICTURE_PROTOCOLS = Object.freeze(['https:']);

const escapeHtml = (str) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const assertClientUrl = () => {
  if (!process.env.CLIENT_URL) throw new ErrorResponse('CLIENT_URL is not configured', 500);
};

const sanitisePictureUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    return ALLOWED_PICTURE_PROTOCOLS.includes(parsed.protocol) ? url : '';
  } catch {
    return '';
  }
};

const validatePassword = (password, label = 'Password') => {
  if (!password || typeof password !== 'string') {
    throw new ErrorResponse(`${label} is required`, 400);
  }
  if (password.length < MIN_PASSWORD_LEN) {
    throw new ErrorResponse(`${label} must be at least ${MIN_PASSWORD_LEN} characters`, 400);
  }
};

export const register = async ({ name, email, password }) => {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ErrorResponse('Name is required', 400);
  }
  if (!email || !EMAIL_RE.test(email)) {
    throw new ErrorResponse('A valid email is required', 400);
  }
  validatePassword(password);

  assertClientUrl();

  const sanitisedName = name.trim().slice(0, 100);
  const normEmail     = email.trim().toLowerCase();

  const user              = await userRepo.create({ name: sanitisedName, email: normEmail, password });
  const verificationToken = user.getEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  const verifyUrl = `${process.env.CLIENT_URL}/verify-email/${verificationToken}`;

  sendEmail({
    to:      normEmail,
    subject: 'House of Cambridge – Verify Your Email',
    html: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#FFB700">Welcome to House of Cambridge!</h2>
      <p>Hi ${escapeHtml(sanitisedName)}, please verify your email to activate your account.</p>
      <a href="${escapeHtml(verifyUrl)}" style="background:#FFB700;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Verify Email</a>
      <p style="color:#60717B;font-size:12px;margin-top:24px">Link expires in 24 hours.</p>
    </div>`,
  }).catch(() => {});

  return user;
};

export const login = async ({ email, password }) => {
  if (!email || !password) throw new ErrorResponse('Email and password are required', 400);

  const normEmail = email.trim().toLowerCase();
  const user      = await userRepo.findByEmail(normEmail);
  if (!user || !user.password) throw new ErrorResponse('Invalid credentials', 401);

  const isMatch = await user.comparePassword(password);
  if (!isMatch) throw new ErrorResponse('Invalid credentials', 401);

  if (!user.isActive) throw new ErrorResponse('Account is disabled', 403);

  return user;
};

export const forgotPassword = async (email) => {
  if (!email || !EMAIL_RE.test(email)) throw new ErrorResponse('A valid email is required', 400);

  assertClientUrl();

  const normEmail = email.trim().toLowerCase();
  const user      = await userRepo.findByEmail(normEmail);
  if (!user) return;

  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

  sendEmail({
    to:      normEmail,
    subject: 'House of Cambridge – Password Reset',
    html: `<div style="font-family:Inter,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#FFB700">Reset Your Password</h2>
      <p>Click below to reset your password. This link expires in 15 minutes.</p>
      <a href="${escapeHtml(resetUrl)}" style="background:#FFB700;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">Reset Password</a>
    </div>`,
  }).catch(() => {});
};

export const resetPassword = async (token, password) => {
  if (!token || !TOKEN_RE.test(token)) throw new ErrorResponse('Invalid token format', 400);
  validatePassword(password, 'New password');

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user        = await userRepo.findByResetToken(hashedToken);
  if (!user) throw new ErrorResponse('Invalid or expired token', 400);

  user.password             = password;
  user.resetPasswordToken   = undefined;
  user.resetPasswordExpire  = undefined;
  await user.save();

  return user;
};

export const verifyEmail = async (token) => {
  if (!token || !TOKEN_RE.test(token)) throw new ErrorResponse('Invalid token format', 400);

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user        = await userRepo.findByVerificationToken(hashedToken);
  if (!user) throw new ErrorResponse('Invalid or expired token', 400);

  user.isVerified              = true;
  user.emailVerificationToken  = undefined;
  user.emailVerificationExpire = undefined;
  await user.save();

  return user;
};

export const googleAuth = async (idToken) => {
  if (!idToken || typeof idToken !== 'string') {
    throw new ErrorResponse('ID token is required', 400);
  }

  
  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch {
    throw new ErrorResponse('Invalid or expired Google token', 401);
  }

  const { uid: googleId, email, name, picture } = decoded;

  if (!googleId) throw new ErrorResponse('Incomplete Google profile', 400);
  if (!email || !EMAIL_RE.test(email)) throw new ErrorResponse('Google account has no valid email', 400);

  const normEmail = email.trim().toLowerCase();
  let user = await User.findOne({ $or: [{ googleId }, { email: normEmail }] }).select('+password');

  if (user) {
    if (!user.googleId) {
      user.googleId = googleId;
      await user.save({ validateBeforeSave: false });
    }
    if (!user.isActive) throw new ErrorResponse('Account is disabled', 403);
    return user;
  }

  return User.create({
    name:       typeof name === 'string' ? name.trim().slice(0, 100) : 'Google User',
    email:      normEmail,
    googleId,
    provider:   'google',
    isVerified: true,
    avatar:     { public_id: '', url: sanitisePictureUrl(picture) },
  });
};


export const facebookAuth = async (accessToken) => {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new ErrorResponse('Access token is required', 400);
  }

  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    throw new ErrorResponse('Facebook app credentials are not configured', 500);
  }

  const appTokenRes  = await fetch(
    `https://graph.facebook.com/oauth/access_token?client_id=${encodeURIComponent(process.env.FACEBOOK_APP_ID)}&client_secret=${encodeURIComponent(process.env.FACEBOOK_APP_SECRET)}&grant_type=client_credentials`,
  );
  const appTokenData = await appTokenRes.json();
  if (appTokenData.error) throw new ErrorResponse('Facebook app configuration error', 500);

  const debugRes  = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appTokenData.access_token)}`,
  );
  const { data: debugData } = await debugRes.json();

  if (!debugData?.is_valid)                              throw new ErrorResponse('Invalid Facebook token', 401);
  if (debugData.app_id !== process.env.FACEBOOK_APP_ID) throw new ErrorResponse('Facebook token app mismatch', 401);

  const profileRes = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`,
  );
  const { id: facebookId, name, email, picture } = await profileRes.json();

  if (!facebookId || typeof facebookId !== 'string') {
    throw new ErrorResponse('Could not retrieve Facebook profile', 400);
  }

  const normEmail = email && EMAIL_RE.test(email) ? email.trim().toLowerCase() : null;
  let user        = await User.findOne(
    normEmail ? { $or: [{ facebookId }, { email: normEmail }] } : { facebookId },
  ).select('+password');

  if (user) {
    if (!user.facebookId) {
      user.facebookId = facebookId;
      await user.save({ validateBeforeSave: false });
    }
    if (!user.isActive) throw new ErrorResponse('Account is disabled', 403);
    return user;
  }

  return User.create({
    name:       typeof name === 'string' ? name.trim().slice(0, 100) : 'Facebook User',
    email:      normEmail ?? `fb_${facebookId}@noemail.hoc`,
    facebookId,
    provider:   'facebook',
    isVerified: true,
    avatar:     { public_id: '', url: sanitisePictureUrl(picture?.data?.url) },
  });
};