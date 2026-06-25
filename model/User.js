import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Please enter your name'], trim: true, maxlength: 100 },
    email: {
      type: String,
      required: [true, 'Please enter your email'],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    password: { type: String, minlength: 8, maxlength: 128, select: false },
    googleId: { type: String, default: '' },
    facebookId: { type: String, default: '' },
    provider: { type: String, enum: ['local', 'google', 'facebook'], default: 'local' },
    role: { type: String, enum: ['user', 'admin', 'superadmin'], default: 'user' },
    avatar: {
      public_id: { type: String, default: '' },
      url: { type: String, default: '' },
    },
    phone: { type: String, default: '', maxlength: 20 },
    displayName: { type: String, default: '', maxlength: 100 },
    dob: { type: Date },
    gender: { type: String, enum: ['Male', 'Female', 'Non-binary', 'Prefer not to say', ''], default: '' },
    language: { type: String, default: 'English', maxlength: 50 },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    
    loyaltyPoints:      { type: Number, default: 0, min: 0 },
    totalOrdersEarned:  { type: Number, default: 0, min: 0 }, 
    totalReviewsEarned: { type: Number, default: 0, min: 0 }, 
  

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpire: { type: Date, select: false },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpire: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.index({ role: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.getJwtToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
  return resetToken;
};

userSchema.methods.getEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpire = Date.now() + 24 * 60 * 60 * 1000;
  return token;
};

export default mongoose.model('User', userSchema);