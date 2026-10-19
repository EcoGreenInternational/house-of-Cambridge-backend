import sendEmail from '../utils/sendEmail.js';
import ErrorResponse from '../utils/errorResponse.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^0\d{9}$/;
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const sendContactMessage = async (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';

    if (name.length < 2 || name.length > 100) {
      return next(new ErrorResponse('Please enter a valid name', 400));
    }
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return next(new ErrorResponse('Please enter a valid email address', 400));
    }
    if (!PHONE_RE.test(phone)) {
      return next(new ErrorResponse('Please enter a valid 10-digit mobile number', 400));
    }
    if (message.length > 1000) {
      return next(new ErrorResponse('Message must not exceed 1000 characters', 400));
    }

    const recipient = process.env.CONTACT_EMAIL || process.env.FROM_EMAIL;
    if (!recipient) return next(new ErrorResponse('Contact email is not configured', 503));

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone);
    const safeMessage = escapeHtml(message || '(No message provided)').replace(/\n/g, '<br>');

    await sendEmail({
      to: recipient,
      subject: `New contact message from ${name}`,
      replyTo: email,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${safeName}</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>Phone:</strong> ${safePhone}</p>
        <p><strong>Message:</strong><br>${safeMessage}</p>
      `,
    });

    try {
      await sendEmail({
        to: email,
        subject: 'We received your message - House of Cambridge',
        html: `
          <p>Hi ${safeName},</p>
          <p>Thank you for contacting House of Cambridge. We received your message and will get back to you within 24 hours.</p>
          <p>Regards,<br>House of Cambridge</p>
        `,
      });
    } catch (acknowledgementError) {
      console.error('Contact acknowledgement email failed:', acknowledgementError.message);
    }

    return res.status(202).json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    return next(err);
  }
};
