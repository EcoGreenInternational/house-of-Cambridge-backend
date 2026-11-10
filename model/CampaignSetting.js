import mongoose from 'mongoose';

const campaignSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'active_campaign', unique: true },
    isEnabled: { type: Boolean, default: true },
    theme: {
      type: String,
      enum: ['11_11', 'christmas', 'new_year', 'default'],
      default: '11_11',
    },
    campaignName: { type: String, default: '11:11 Mega Sale', trim: true, maxlength: 120 },
    badgeText: { type: String, default: '11:11 MEGA SHOPPING FESTIVAL', trim: true, maxlength: 120 },
    heading: { type: String, default: '11 : 11', trim: true, maxlength: 120 },
    subheading: { type: String, default: 'BIGGEST SALE OF THE YEAR', trim: true, maxlength: 150 },
    discountPercent: { type: Number, default: 5, min: 0, max: 100 },
    greetingText: {
      type: String,
      default: 'Applied automatically on EVERY product across the entire store!',
      trim: true,
      maxlength: 600,
    },
    ctaText: { type: String, default: 'Claim 5% OFF & Shop Now', trim: true, maxlength: 100 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

export default mongoose.model('CampaignSetting', campaignSettingSchema);
