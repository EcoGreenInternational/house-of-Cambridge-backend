import mongoose from 'mongoose';

const discountRequestSchema = new mongoose.Schema(
  {
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    action: { type: String, enum: ['apply', 'reset'], default: 'apply' },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reason: { type: String, default: '', maxlength: 500 },
    rejectionNote: { type: String, default: '', maxlength: 500 },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model('DiscountRequest', discountRequestSchema);
