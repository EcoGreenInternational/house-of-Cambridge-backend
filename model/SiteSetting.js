import mongoose from 'mongoose';

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: ['generic', 'heroBanner'], default: 'generic' },
    booleanValue: { type: Boolean, default: false },
    image: {
      public_id: { type: String, default: '' },
      url: { type: String, default: '' },
    },
    // For hero banners: optional title, subtitle, and an array of CTA buttons
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    buttons: [
      {
        label: { type: String, default: '' },
        url: { type: String, default: '' },
        style: { type: String, enum: ['primary', 'secondary', 'outline'], default: 'primary' },
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model('SiteSetting', siteSettingSchema);
