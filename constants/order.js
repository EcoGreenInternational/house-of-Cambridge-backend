export const ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'shipped', 'delivered',
  'cancelled', 'return_requested', 'returned'
];

export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];

export const RETURN_STATUSES = [
  'pending', 'in_review', 'approved', 'rejected', 'collected', 'qc', 'refunded'
];

export const RETURN_REASONS = [
  'wrong_item', 'damaged', 'defective', 'not_as_described', 'changed_mind', 'other'
];

export const ALLOWED_RESOLUTIONS = ['refund', 'exchange', 'store_credit'];