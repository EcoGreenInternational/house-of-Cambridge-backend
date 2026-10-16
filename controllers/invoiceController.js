import mongoose from 'mongoose';
import Invoice from '../model/Invoice.js';
import Product from '../model/Product.js';
import Order from '../model/Order.js';
import ErrorResponse from '../utils/errorResponse.js';

const nextOnlineInvoiceNo = async () => {
  const lastInvoice = await Invoice.findOne({ invoiceType: 'online' })
    .sort({ createdAt: -1 })
    .select('invoiceNo')
    .lean();
  const currentNumber = Number.parseInt(String(lastInvoice?.invoiceNo || '').replace(/^O/, ''), 10);
  return `O${Number.isFinite(currentNumber) ? currentNumber + 1 : 1001}`;
};

const createInvoiceFromOrder = async (order) => {
  const existing = await Invoice.findOne({
    $or: [{ sourceOrder: order._id }, { invoiceNo: order.invoiceNo || '__missing__' }],
  });
  if (existing) return existing;

  const invoice = await Invoice.create({
    invoiceNo: await nextOnlineInvoiceNo(),
    invoiceType: 'online',
    sourceOrder: order._id,
    invoiceDate: order.createdAt,
    dueDate: new Date(new Date(order.createdAt).getTime() + 10 * 24 * 60 * 60 * 1000),
    paymentMethod: order.paymentMethod === 'cod' ? 'COD' : 'online',
    clientDetails: {
      clientName: order.shippingAddress?.fullName || order.guestName || 'Online Customer',
      address: [
        order.shippingAddress?.addressLine1,
        order.shippingAddress?.addressLine2,
        order.shippingAddress?.city,
        order.shippingAddress?.state,
        order.shippingAddress?.country,
      ].filter(Boolean).join(', '),
      email: order.guestEmail || '',
      phone: order.shippingAddress?.phone || '',
    },
    items: order.items.map((item) => ({
      product: item.product,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.price * item.quantity,
    })),
    subtotal: order.subtotal,
    discount: order.discount,
    deliveryFee: order.shippingCost,
    taxAmount: order.tax,
    totalAmountDue: order.total,
  });

  if (order.invoiceNo !== invoice.invoiceNo) {
    await Order.updateOne({ _id: order._id }, { $set: { invoiceNo: invoice.invoiceNo } });
  }
  return invoice;
};

export const createInvoice = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { invoiceType, items, discount = 0, deliveryFee = 0, taxPercent = 0, clientDetails, dueDate, paymentMethod = 'cash', note = '', assignedPeople, approvedByName = '', approvedByDate, approvedBySignature = '', issuedBy } = req.body;

    if (!['online', 'manual'].includes(invoiceType)) {
      return next(new ErrorResponse('Invalid invoice type selection', 400));
    }

    const validPaymentMethods = ['online', 'credit', 'cash', 'COD'];
    const finalPaymentMethod = validPaymentMethods.includes(paymentMethod) ? paymentMethod : 'cash';

    // 1. Automatically Generate the Next Invoice Number based on sequence prefix code
    const prefix = invoiceType === 'online' ? 'O' : 'M';
    const lastInvoice = await Invoice.findOne({ invoiceType })
      .sort({ createdAt: -1 })
      .select('invoiceNo')
      .session(session);

    let nextNumber = 1001; 
    if (lastInvoice && lastInvoice.invoiceNo) {
      const currentNum = parseInt(lastInvoice.invoiceNo.substring(1), 10);
      if (!isNaN(currentNum)) nextNumber = currentNum + 1;
    }
    const finalInvoiceNo = `${prefix}${nextNumber}`;

    // 2. Map and Validate Items + Handle Inventory Deductions if MANUAL type
    let derivedSubtotal = 0;
    const processItems = [];

    for (const item of items) {
      const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

      if (item.productId) {
        const product = await Product.findById(item.productId).session(session);
        if (!product) throw new ErrorResponse(`Product not found for ID: ${item.productId}`, 404);

        if (invoiceType === 'manual') {
          if (product.stock < qty) {
            throw new ErrorResponse(`Insufficient stock balance for item: ${product.name}. Available: ${product.stock}`, 400);
          }
          product.stock -= qty;
          await product.save({ session });
        }

        const unitPrice = item.unitPrice !== undefined && item.unitPrice !== null && !isNaN(Number(item.unitPrice))
          ? Number(item.unitPrice)
          : product.price;
        const itemTotal = unitPrice * qty;
        derivedSubtotal += itemTotal;

        processItems.push({
          product: product._id,
          name: item.name || product.name,
          quantity: qty,
          unitPrice,
          total: itemTotal
        });
      } else {
        // Custom non-catalog item — name is required
        const customName = typeof item.name === 'string' ? item.name.trim() : '';
        if (!customName) {
          throw new ErrorResponse('Item name is required for custom line items', 400);
        }
        const unitPrice = Number(item.unitPrice) >= 0 ? Number(item.unitPrice) : 0;
        const itemTotal = unitPrice * qty;
        derivedSubtotal += itemTotal;

        processItems.push({
          product: null,
          name: customName,
          quantity: qty,
          unitPrice,
          total: itemTotal
        });
      }
    }

    const finalDeliveryFee = Math.max(0, Number(deliveryFee) || 0);
    const taxAmount = Math.round((derivedSubtotal - discount) * (taxPercent / 100));
    const totalAmountDue = derivedSubtotal - discount + taxAmount + finalDeliveryFee;

    const newInvoice = new Invoice({
      invoiceNo: finalInvoiceNo,
      invoiceType,
      dueDate,
      paymentMethod: finalPaymentMethod,
      note: (typeof note === 'string' ? note.trim() : ''),
      assignedPeople,
      approvedByName,
      approvedByDate: approvedByDate || null,
      approvedBySignature,
      clientDetails,
      items: processItems,
      subtotal: derivedSubtotal,
      discount,
      deliveryFee: finalDeliveryFee,
      taxPercent,
      taxAmount,
      totalAmountDue,
      issuedBy
    });

    await newInvoice.save({ session });
    await session.commitTransaction();

    return res.status(201).json({ success: true, invoice: newInvoice });
  } catch (err) {
    await session.abortTransaction();
    return next(err);
  } finally {
    session.endSession();
  }
};

// Get all invoices list 
export const getInvoices = async (req, res, next) => {
  try {
    const onlineOrders = await Order.find({}).sort({ createdAt: 1 });

    for (const order of onlineOrders) {
      await createInvoiceFromOrder(order);
    }

    const query = { isDeleted: { $ne: true } };
    if (['online', 'manual'].includes(req.query.status)) {
      query.invoiceType = req.query.status;
    }
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const search = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { invoiceNo: { $regex: search, $options: 'i' } },
        { 'clientDetails.clientName': { $regex: search, $options: 'i' } },
      ];
    }

    const invoices = await Invoice.find(query)
      .populate('items.product', 'name price stock productCode')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: invoices.length, total: invoices.length, invoices });
  } catch (err) {
    return next(err);
  }
};

export const updateInvoice = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { id } = req.params;
    const { invoiceType, items, discount = 0, deliveryFee = 0, taxPercent = 0, clientDetails, dueDate, paymentMethod, note, assignedPeople, approvedByName, approvedByDate, approvedBySignature } = req.body;

    // 1. Fetch the existing invoice
    const invoice = await Invoice.findOne({ _id: id, isDeleted: { $ne: true } }).session(session);
    if (!invoice) {
      throw new ErrorResponse('Invoice not found or has been deleted', 404);
    }

    // 2. DYNAMIC GENERATION: Handle invoiceType change and calculate new sequential number
    if (invoiceType && invoiceType !== invoice.invoiceType) {
      if (!['online', 'manual'].includes(invoiceType)) {
        throw new ErrorResponse('Invalid invoice type selection', 400);
      }

      const prefix = invoiceType === 'online' ? 'O' : 'M';
      
      // Look up the last invoice created under the NEW target type
      const lastInvoice = await Invoice.findOne({ invoiceType })
        .sort({ createdAt: -1 })
        .select('invoiceNo')
        .session(session);

      let nextNumber = 1001; 
      if (lastInvoice && lastInvoice.invoiceNo) {
        const currentNum = parseInt(lastInvoice.invoiceNo.substring(1), 10);
        if (!isNaN(currentNum)) nextNumber = currentNum + 1;
      }
      
      // Assign the new type and the newly calculated sequential invoice number
      invoice.invoiceType = invoiceType;
      invoice.invoiceNo = `${prefix}${nextNumber}`;
    }

    // 3. Map, Validate, and Recalculate Items (if items are passed)
    let derivedSubtotal = invoice.subtotal;
    let processItems = invoice.items;

    if (items && Array.isArray(items)) {
      derivedSubtotal = 0;
      processItems = [];

      for (const item of items) {
        const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

        if (item.productId) {
          const product = await Product.findById(item.productId).session(session);
          if (!product) {
            throw new ErrorResponse(`Product not found for ID: ${item.productId}`, 404);
          }

          const unitPrice = item.unitPrice !== undefined && item.unitPrice !== null && !isNaN(Number(item.unitPrice))
            ? Number(item.unitPrice)
            : product.price;
          const itemTotal = unitPrice * qty;
          derivedSubtotal += itemTotal;

          processItems.push({
            product: product._id,
            name: item.name || product.name,
            quantity: qty,
            unitPrice,
            total: itemTotal
          });
        } else {
          const customName = typeof item.name === 'string' ? item.name.trim() : '';
          if (!customName) {
            throw new ErrorResponse('Item name is required for custom line items', 400);
          }
          const unitPrice = Number(item.unitPrice) >= 0 ? Number(item.unitPrice) : 0;
          const itemTotal = unitPrice * qty;
          derivedSubtotal += itemTotal;

          processItems.push({
            product: null,
            name: customName,
            quantity: qty,
            unitPrice,
            total: itemTotal
          });
        }
      }
    }

    // 4. Recalculate financial breakdown
    const finalDiscount = discount !== undefined ? Math.max(0, Number(discount) || 0) : invoice.discount;
    const finalDeliveryFee = deliveryFee !== undefined ? Math.max(0, Number(deliveryFee) || 0) : invoice.deliveryFee;
    const finalTaxPercent = taxPercent !== undefined ? Math.max(0, Number(taxPercent) || 0) : invoice.taxPercent;
    
    const taxAmount = Math.round((derivedSubtotal - finalDiscount) * (finalTaxPercent / 100));
    const totalAmountDue = derivedSubtotal - finalDiscount + taxAmount + finalDeliveryFee;

    // 5. Apply standard fields to the document
    if (clientDetails) invoice.clientDetails = clientDetails;
    if (dueDate) invoice.dueDate = dueDate;
    if (assignedPeople) invoice.assignedPeople = assignedPeople;
    if (approvedByName !== undefined) invoice.approvedByName = approvedByName;
    if (approvedByDate !== undefined) invoice.approvedByDate = approvedByDate || null;
    if (approvedBySignature !== undefined) invoice.approvedBySignature = approvedBySignature;
    if (paymentMethod !== undefined) {
      const validPaymentMethods = ['online', 'credit', 'cash', 'COD'];
      invoice.paymentMethod = validPaymentMethods.includes(paymentMethod) ? paymentMethod : 'cash';
    }
    if (note !== undefined) invoice.note = typeof note === 'string' ? note.trim() : '';
    if (items) invoice.items = processItems;
    
    invoice.subtotal = derivedSubtotal;
    invoice.discount = finalDiscount;
    invoice.deliveryFee = finalDeliveryFee;
    invoice.taxPercent = finalTaxPercent;
    invoice.taxAmount = taxAmount;
    invoice.totalAmountDue = totalAmountDue;

    // Save changes inside the transaction session
    await invoice.save({ session });
    await session.commitTransaction();

    // Return the response matching your Redux setup expectations
    return res.status(200).json({ success: true, invoice });

  } catch (err) {
    await session.abortTransaction();
    return next(err);
  } finally {
    session.endSession();
  }
};

export const deleteInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;

    const invoice = await Invoice.findByIdAndUpdate(
      id,
      {
        isDeleted: true,
        deletedAt: new Date()
      },
      { new: true } 
    );

    if (!invoice) {
      return next(new ErrorResponse('Invoice not found', 404));
    }

    res.status(200).json({ message: 'Invoice soft-deleted successfully', id });
  } catch (error) {
    next(error);
  }
};