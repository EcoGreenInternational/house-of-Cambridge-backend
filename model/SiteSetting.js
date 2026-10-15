import mongoose from 'mongoose';

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    booleanValue: { type: Boolean, default: false },
    image: {
      public_id: { type: String, default: '' },
      url: { type: String, default: '' },
    },
  },
  { timestamps: true },
);

export default mongoose.model('SiteSetting', siteSettingSchema);
