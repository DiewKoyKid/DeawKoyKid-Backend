const nodemailer = require("nodemailer");

const DEFAULT_FROM = "Togethr <no-reply@togethr.local>";

let transporter;

// Sends through SMTP when SMTP_HOST is set. Without it (dev, tests) nodemailer's
// JSON transport builds the message without sending it, and we log it instead.
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = process.env.SMTP_HOST
      ? nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port,
          secure: port === 465,
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        })
      : nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
}

async function sendMail({ to, subject, text }) {
  const info = await getTransporter().sendMail({
    from: process.env.MAIL_FROM || DEFAULT_FROM,
    to,
    subject,
    text,
  });
  if (!process.env.SMTP_HOST) {
    console.log(`[mail] SMTP_HOST is not set, so this email was not sent: ${info.message}`);
  }
  return info;
}

// US2-3: confirmation sent to the address the account had before it was wiped.
function sendAccountDeletedEmail({ to, firstname }) {
  return sendMail({
    to,
    subject: "Your Togethr account has been deleted",
    text: [
      `Hi ${firstname},`,
      "",
      "Your Togethr account has been deleted as you requested. Your personal details",
      "have been removed and you can no longer sign in. Past bookings and reviews",
      "stay on record without your name.",
      "",
      "You can register again with this email address at any time.",
      "",
      "The Togethr team",
    ].join("\n"),
  });
}

// US1-5: the reset link points at the frontend, which posts the token back.
function sendPasswordResetEmail({ to, firstname, token }) {
  const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173";
  const link = `${frontendUrl.replace(/\/$/, "")}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: "Reset your Togethr password",
    text: [
      `Hi ${firstname},`,
      "",
      "We received a request to reset your Togethr password. Open this link to",
      "choose a new one. It works once and expires in 15 minutes:",
      "",
      link,
      "",
      "If you didn't ask for this, you can ignore this email and your password",
      "will stay the same.",
      "",
      "The Togethr team",
    ].join("\n"),
  });
}

module.exports = { sendMail, sendAccountDeletedEmail, sendPasswordResetEmail };
