
import mongoose from 'mongoose';

const loyaltyTransactionSchema = new mongoose.Schema(
  {
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type:     { type: String, enum: ['earned', 'redeemed', 'expired'], required: true },
    reason:   { type: String, enum: ['order', 'review', 'redemption', 'expiry', 'manual'], required: true },
    points:   { type: Number, required: true }, 
    refId:    { type: mongoose.Schema.Types.ObjectId, default: null }, 
    refModel: { type: String, enum: ['Order', 'Review', null], default: null },
    desc:     { type: String, maxlength: 200, default: '' },
    expiresAt:{ type: Date, default: null },
  },
  { timestamps: true }
);

loyaltyTransactionSchema.index({ user: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ user: 1, type: 1 });
loyaltyTransactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('LoyaltyTransaction', loyaltyTransactionSchema);