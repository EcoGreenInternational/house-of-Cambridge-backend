import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    invoiceType: { type: String, enum: ['online', 'manual'], required: true },
    invoiceDate: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date },
    assignedPeople: { type: String, default: '' },
    clientDetails: {
      clientName: { type: String, required: true },
      companyName: { type: String, default: '' },
      address: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      vatTaxNo: { type: String, default: '' }
    },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        name: { type: String, required: true }, 
        quantity: { type: Number, required: true, min: 1 },
        unitPrice: { type: Number, required: true, min: 0 },
        total: { type: Number, required: true }
      }
    ],
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxAmount: { type: Number, default: 0, min: 0 },
    totalAmountDue: { type: Number, required: true, min: 0 },
    issuedBy: { type: String, default: '' },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    }
  },
  { timestamps: true }
);

// Indexing for faster admin table lookups
invoiceSchema.index({ invoiceNo: 1 });
invoiceSchema.index({ invoiceType: 1 });

export default mongoose.model('Invoice', invoiceSchema);