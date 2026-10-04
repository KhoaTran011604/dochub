import * as nodemailer from "nodemailer";

export interface MailerService {
  sendDocumentInviteEmail(options: {
    toEmail: string;
    documentId: string;
    documentUrl: string;
    permission: string;
  }): Promise<void>;
}

export function createMailerService(
  smtpHost?: string,
  smtpPort?: number,
  smtpUser?: string,
  smtpPass?: string,
  fromAddress: string = "HD Document <no-reply@hd-document.example.com>"
): MailerService {
  if (!smtpHost || !smtpPort) {
    return {
      sendDocumentInviteEmail() {
        console.warn("SMTP_HOST or SMTP_PORT is not set. Skipping sending document invite email.");
        return Promise.resolve();
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465, false for other ports
    auth: (smtpUser && smtpPass) ? {
      user: smtpUser,
      pass: smtpPass,
    } : undefined,
  });

  return {
    async sendDocumentInviteEmail(options) {
      const { toEmail, documentUrl, permission } = options;
      try {
        await transporter.sendMail({
          from: fromAddress,
          to: toEmail,
          subject: "You have been invited to a document",
          html: `<p>Hello,</p>
          <p>You have been invited to collaborate on a document.</p>
          <p>Your permission level: <strong>${permission}</strong></p>
          <p><a href="${documentUrl}">Click here to view the document</a></p>`,
        });
      } catch (error) {
        console.error("Failed to send email via SMTP:", error);
      }
    },
  };
}
