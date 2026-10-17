// Same rules as the frontend's src/utils/checkoutValidation.js — keep the two in sync
const NAME_RE      = /^[A-Za-z][A-Za-z .'-]{1,49}$/;
const FULL_NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,99}$/;
const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE     = /^\d{10}$/;
const POSTAL_RE    = /^\d{5}$/;
const CITY_RE      = /^[A-Za-z][A-Za-z .'-]{1,49}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export const isValidName  = (v) => NAME_RE.test(str(v));
export const isValidEmail = (v) => str(v).length <= 254 && EMAIL_RE.test(str(v));
export const isValidPhone = (v) => PHONE_RE.test(str(v));

// Returns a list of messages; empty when the address is valid
export const validateShippingAddress = (addr) => {
  if (!addr || typeof addr !== 'object' || Array.isArray(addr)) return ['Shipping address is required'];

  const errors = [];
  const fullName = str(addr.fullName);
  if (!fullName) errors.push('Full name is required');
  else if (!FULL_NAME_RE.test(fullName)) errors.push('Full name can only contain letters');

  const phone = str(addr.phone);
  if (!phone) errors.push('Phone number is required');
  else if (!PHONE_RE.test(phone)) errors.push('Phone number must be exactly 10 digits');

  const line1 = str(addr.addressLine1);
  if (!line1) errors.push('Address is required');
  else if (line1.length < 5) errors.push('Enter your full street address');
  else if (line1.length > 200) errors.push('Address is too long');

  if (str(addr.addressLine2).length > 200) errors.push('Address line 2 is too long');

  const city = str(addr.city);
  if (!city) errors.push('City is required');
  else if (!CITY_RE.test(city)) errors.push('Enter a valid city name');

  const postal = str(addr.postalCode);
  if (!postal) errors.push('Postal code is required');
  else if (!POSTAL_RE.test(postal)) errors.push('Postal code must be 5 digits');

  if (str(addr.state).length > 100) errors.push('Province is too long');

  return errors;
};

export const validateGuestContact = ({ guestEmail, guestName }) => {
  const errors = [];
  if (!str(guestEmail)) errors.push('Email is required');
  else if (!isValidEmail(guestEmail)) errors.push('Enter a valid email address');
  if (str(guestName) && !FULL_NAME_RE.test(str(guestName))) errors.push('Name can only contain letters');
  return errors;
};
