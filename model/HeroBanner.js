import mongoose from 'mongoose';

const heroBannerSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    image: {
      public_id: { type: String, default: '' },
      url: { type: String, default: '' },
    },
    buttons: [
      {
        label: { type: String, default: '' },
        url: { type: String, default: '' },
        style: { type: String, enum: ['primary', 'secondary', 'outline'], default: 'primary' },
      },
    ],
    // optional order field to control display sequence
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('HeroBanner', heroBannerSchema);
