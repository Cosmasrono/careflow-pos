// Outbound email (SMTP via nodemailer). Node.js runtime only.
//
// Reads the MAIL_* variables from .env. When they are missing (e.g. a fresh
// checkout) the send functions throw, and callers surface a friendly error.
import nodemailer from "nodemailer";

export function mailConfigured(): boolean {
  return Boolean(process.env.MAIL_HOST && process.env.MAIL_USERNAME);
}

function transporter() {
  const port = Number(process.env.MAIL_PORT ?? 587);
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure: port === 465, // 587 uses STARTTLS, negotiated automatically
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  link: string;
}): Promise<void> {
  const from = `"${process.env.MAIL_FROM_NAME ?? "CareFlow"}" <${
    process.env.MAIL_FROM_ADDRESS ?? process.env.MAIL_USERNAME
  }>`;

  await transporter().sendMail({
    from,
    to: opts.to,
    subject: "Reset your CareFlow password",
    text: [
      `Hi ${opts.name},`,
      "",
      "Someone (hopefully you) asked to reset your CareFlow password.",
      "Open the link below to choose a new one. It expires in 30 minutes",
      "and can only be used once.",
      "",
      opts.link,
      "",
      "If you didn't request this, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Reset your CareFlow password</h2>
        <p style="color:#3f3f46;line-height:1.6">Hi ${opts.name},</p>
        <p style="color:#3f3f46;line-height:1.6">
          Someone (hopefully you) asked to reset your CareFlow password.
          Click the button below to choose a new one. The link expires in
          <strong>30 minutes</strong> and can only be used once.
        </p>
        <p style="margin:24px 0">
          <a href="${opts.link}"
             style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">
            Choose a new password
          </a>
        </p>
        <p style="color:#71717a;font-size:13px;line-height:1.6">
          If the button doesn't work, copy this link into your browser:<br/>
          <a href="${opts.link}" style="color:#0d9488;word-break:break-all">${opts.link}</a>
        </p>
        <p style="color:#71717a;font-size:13px">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>`,
  });
}

export async function sendAccountSetupEmail(opts: {
  to: string;
  name: string;
  link: string;
}): Promise<void> {
  const from = `"${process.env.MAIL_FROM_NAME ?? "CareFlow"}" <${
    process.env.MAIL_FROM_ADDRESS ?? process.env.MAIL_USERNAME
  }>`;

  await transporter().sendMail({
    from,
    to: opts.to,
    subject: "Set up your CareFlow account password",
    text: [
      `Hi ${opts.name},`,
      "",
      "An account has been created for you on CareFlow.",
      "Open the link below to choose your password.",
      "The link expires in 30 minutes and can only be used once.",
      "",
      opts.link,
      "",
      "If you were not expecting this, contact your administrator.",
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Set up your CareFlow password</h2>
        <p style="color:#3f3f46;line-height:1.6">Hi ${opts.name},</p>
        <p style="color:#3f3f46;line-height:1.6">
          An account has been created for you on CareFlow. Click the button below
          to choose your password. The link expires in <strong>30 minutes</strong>
          and can only be used once.
        </p>
        <p style="margin:24px 0">
          <a href="${opts.link}"
             style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block;font-weight:600">
            Set my password
          </a>
        </p>
        <p style="color:#71717a;font-size:13px;line-height:1.6">
          If the button doesn't work, copy this link into your browser:<br/>
          <a href="${opts.link}" style="color:#0d9488;word-break:break-all">${opts.link}</a>
        </p>
        <p style="color:#71717a;font-size:13px">
          If you were not expecting this, contact your administrator.
        </p>
      </div>`,
  });
}
