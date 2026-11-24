import mongoose from 'mongoose';

export const BANNER_PLACEMENTS = ['hero', 'promo', 'department'];
export const BANNER_BACKGROUNDS = ['image', 'christmas'];
export const BUTTON_STYLES = ['primary', 'secondary', 'outline', 'christmas'];

const imageSchema = new mongoose.Schema(
  {
    public_id: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: false },
);

const buttonSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 40, required: true },
    link: { type: String, trim: true, maxlength: 300, default: '/shop' },
    style: { type: String, enum: BUTTON_STYLES, default: 'primary' },
  },
  { _id: false },
);

const bannerSchema = new mongoose.Schema(
  {
    placement: { type: String, enum: BANNER_PLACEMENTS, default: 'hero', index: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    subtitle: { type: String, trim: true, maxlength: 240, default: '' },
    // Where the whole banner links to (used when it has no buttons, e.g. promo cards)
    link: { type: String, trim: true, maxlength: 300, default: '' },
    // 'image' = uploaded picture, 'christmas' = built-in Christmas background (no upload needed)
    background: { type: String, enum: BANNER_BACKGROUNDS, default: 'image' },
    image: { type: imageSchema, default: () => ({}) },
    mobileImage: { type: imageSchema, default: () => ({}) },
    buttons: { type: [buttonSchema], default: [] },
    // Draws pine branches + baubles around the banner
    christmasFrame: { type: Boolean, default: false },
    showText: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

bannerSchema.index({ placement: 1, isActive: 1, order: 1 });

export default mongoose.model('Banner', bannerSchema);
