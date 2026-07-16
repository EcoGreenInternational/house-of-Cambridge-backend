import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true, maxlength: 300 },
  image: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  isReviewed: { type: Boolean, default: false },
});

const addressSchema = new mongoose.Schema(
  {
    fullName:     { type: String, required: true, maxlength: 100 },
    addressLine1: { type: String, required: true, maxlength: 200 },
    addressLine2: { type: String, default: '', maxlength: 200 },
    city:         { type: String, required: true, maxlength: 100 },
    state:        { type: String, default: '', maxlength: 100 },
    postalCode:   { type: String, required: true, maxlength: 20 },
    country:      { type: String, required: true, maxlength: 100 },
    phone:        { type: String, default: '', maxlength: 20 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    guestEmail: { type: String, default: '', maxlength: 254 },
    guestName:  { type: String, default: '', maxlength: 100 },

    orderNumber: {
      type:   String,
      unique: true,
      index:  true,
    },

    items: [orderItemSchema],

    shippingAddress: { type: addressSchema, required: true },

    paymentMethod: {
      type:    String,
      enum:    ['card', 'paypal', 'koko', 'cod', 'bank_transfer'],
      default: 'card',
    },
    paymentStatus: {
      type:    String,
      enum:    ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentId: { type: String, default: '' },

    orderStatus: {
      type:    String,
      enum:    ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned'],
      default: 'pending',
      index:   true,
    },

    shippingMethod: {
      type:    String,
      enum:    ['pickup', 'courier', 'express', 'post', 'standard'],
      default: 'courier',
    },

    subtotal:    { type: Number, required: true, min: 0 },
    shippingCost: { type: Number, default: 0, min: 0 },
    discount:    { type: Number, default: 0, min: 0 },
    tax:         { type: Number, default: 0, min: 0 },
    total:       { type: Number, required: true, min: 0 },

    coupon:              { type: String, default: '' },
    loyaltyPointsUsed:   { type: Number, default: 0, min: 0 },
    loyaltyPointsEarned: { type: Number, default: 0, min: 0 },

    trackingNumber: { type: String, default: '' },
    deliveredAt:    Date,
    cancelledAt:    Date,
    shippedAt:      Date,

    notes:      { type: String, default: '', maxlength: 500 },
    adminNotes: { type: String, default: '', maxlength: 1000 },

    returnRequest: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Return',
      default: null,
    },
  },
  { timestamps: true },
);


orderSchema.pre('save', async function () {
  if (!this.orderNumber) {
    const year      = new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const count     = await mongoose.model('Order').countDocuments({
      createdAt: { $gte: yearStart },
    });
    this.orderNumber = `HOC-${year}-${String(count + 1).padStart(5, '0')}`;
  }
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ guestEmail: 1 });

export default mongoose.model('Order', orderSchema);