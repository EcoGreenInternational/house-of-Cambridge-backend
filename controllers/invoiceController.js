import mongoose from 'mongoose';
import Invoice from '../model/Invoice.js';
import Product from '../model/Product.js';
import ErrorResponse from '../utils/errorResponse.js';

export const createInvoice = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { invoiceType, items, discount = 0, deliveryFee = 0, taxPercent = 0, clientDetails, dueDate, assignedPeople, issuedBy } = req.body;

    if (!['online', 'manual'].includes(invoiceType)) {
      return next(new ErrorResponse('Invalid invoice type selection', 400));
    }

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
      assignedPeople,
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
    const invoices = await Invoice.find({ isDeleted: { $ne: true } })
      .populate('items.product', 'name price stock productCode')
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: invoices.length, invoices });
  } catch (err) {
    return next(err);
  }
};

export const updateInvoice = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { id } = req.params;
    const { invoiceType, items, discount = 0, deliveryFee = 0, taxPercent = 0, clientDetails, dueDate, assignedPeople } = req.body;

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