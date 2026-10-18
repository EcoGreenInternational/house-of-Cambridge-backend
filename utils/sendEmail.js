import transporter from '../config/mailer.js';

const sendEmail = async ({ to, subject, html }) => {
  if (process.env.EMAIL_ENABLED === 'false') {
    console.log(`[email disabled] skipped "${subject}" to ${to}`);
    return;
  }

  await transporter.sendMail({
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    to,
    subject,
    html,
  });
};

export default sendEmail;