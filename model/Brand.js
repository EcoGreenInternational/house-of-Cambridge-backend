import mongoose from 'mongoose';
const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Brand name is required'], trim: true, maxlength: 100 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      maxlength: 120,
    },
    description: { type: String, default: '', maxlength: 500 },
    logo: {
      public_id: { type: String, default: '' },
      url: { type: String, default: '' },
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
    },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);
brandSchema.index({ category: 1, isActive: 1 });
// brandSchema.pre('validate', function (next) {
//   if (!this.slug && this.name) {
//     this.slug = this.name
//       .toLowerCase()
//       .trim()
//       .replace(/[^a-z0-9]+/g, '-')
//       .replace(/(^-|-$)/g, '');
//   }
//   next();
// });
export default mongoose.model('Brand', brandSchema);