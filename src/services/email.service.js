import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";
import { Resend } from "resend";

class EmailService {
  constructor() {
    this.initialized = false;
    this.fromEmail = null;
    this.transporter = null;
    this.resendClient = null;
  }

  // =========================
  // INIT + DEBUG FULL
  // =========================
  initialize() {
    console.log("\n========== [EMAIL INIT] ==========");

    if (this.initialized) {
      console.log("[EMAIL] already initialized → skip");
      return;
    }

    const service = process.env.EMAIL_SERVICE || "gmail";
    console.log("[EMAIL] Selected Service:", service);

    if (service === "sendgrid") {
      console.log("[EMAIL] ENV CHECK:", {
        SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? "SET" : "MISSING",
        EMAIL_USER: process.env.EMAIL_USER ? "SET" : "MISSING",
      });

      if (!process.env.SENDGRID_API_KEY || !process.env.EMAIL_USER) {
        console.error("[EMAIL] ❌ Missing SENDGRID_API_KEY or EMAIL_USER");
        return;
      }

      try {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        this.fromEmail = process.env.EMAIL_USER;
        this.initialized = true;
        console.log("[EMAIL] SendGrid client initialized successfully");
        console.log("[EMAIL] fromEmail =", this.fromEmail);
      } catch (err) {
        console.error("[EMAIL] ❌ SendGrid INIT ERROR:", err);
      }
    } else if (service === "resend") {
      console.log("[EMAIL] ENV CHECK:", {
        RESEND_API_KEY: process.env.RESEND_API_KEY ? "SET" : "MISSING",
      });

      if (!process.env.RESEND_API_KEY) {
        console.error("[EMAIL] ❌ Missing RESEND_API_KEY");
        return;
      }

      try {
        this.resendClient = new Resend(process.env.RESEND_API_KEY);
        this.fromEmail = process.env.EMAIL_USER || "onboarding@resend.dev";
        this.initialized = true;
        console.log("[EMAIL] Resend client initialized successfully");
        console.log("[EMAIL] fromEmail =", this.fromEmail);
      } catch (err) {
        console.error("[EMAIL] ❌ Resend INIT ERROR:", err);
      }
    } else {
      // Default / Gmail SMTP
      console.log("[EMAIL] ENV CHECK:", {
        EMAIL_USER: process.env.EMAIL_USER ? "SET" : "MISSING",
        EMAIL_PASSWORD: process.env.EMAIL_PASSWORD ? "SET" : "MISSING",
      });

      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.error("[EMAIL] ❌ Missing EMAIL_USER or EMAIL_PASSWORD");
        return;
      }

      try {
        this.transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD, // ⚠️ phải là App Password
          },
        });

        this.fromEmail = process.env.EMAIL_USER;
        this.initialized = true;

        console.log("[EMAIL] transporter created");
        console.log("[EMAIL] fromEmail =", this.fromEmail);

        // VERIFY SMTP (quan trọng nhất)
        this.transporter.verify((error, success) => {
          if (error) {
            console.error("[EMAIL] ❌ SMTP VERIFY FAILED:", error);
          } else {
            console.log("[EMAIL] ✅ SMTP VERIFIED OK");
          }
        });
      } catch (err) {
        console.error("[EMAIL] ❌ INIT ERROR:", err);
      }
    }
  }

  // =========================
  // CORRELATION ID
  // =========================
  generateCorrelationId() {
    return `email-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  // =========================
  // TEMPLATE
  // =========================
  getTemplate(purpose, otp) {
    return {
      subject:
        purpose === "reset_password"
          ? "Đặt lại mật khẩu - BangAI"
          : "Xác thực email - BangAI",
      html: `
        <h2>${purpose}</h2>
        <p>OTP của bạn:</p>
        <h1 style="letter-spacing:5px">${otp}</h1>
      `,
    };
  }

  // =========================
  // SEND WITH RETRY + FULL DEBUG
  // =========================
  async sendWithRetry(msg, correlationId, maxRetries = 3) {
    const service = process.env.EMAIL_SERVICE || "gmail";
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `[EMAIL][${correlationId}] attempt ${attempt}/${maxRetries} using ${service}`,
        );

        let response;
        if (service === "sendgrid") {
          response = await sgMail.send({
            to: msg.to,
            from: msg.from,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
          });

          console.log(`[EMAIL][${correlationId}] ✅ SEND SUCCESS (SendGrid)`, response[0]?.headers);
          return { messageId: response[0]?.headers["x-message-id"] || "sendgrid-success" };
        } else if (service === "resend") {
          response = await this.resendClient.emails.send({
            from: msg.from,
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
          });

          if (response.error) {
            throw new Error(response.error.message || JSON.stringify(response.error));
          }

          console.log(`[EMAIL][${correlationId}] ✅ SEND SUCCESS (Resend)`, response.data);
          return { messageId: response.data?.id || "resend-success" };
        } else {
          // Default to Gmail SMTP
          response = await this.transporter.sendMail(msg);

          console.log(`[EMAIL][${correlationId}] ✅ SEND SUCCESS`, {
            messageId: response.messageId,
            accepted: response.accepted,
            rejected: response.rejected,
            response: response.response,
          });

          return response;
        }
      } catch (error) {
        console.error(`[EMAIL][${correlationId}] ❌ SEND ERROR`, {
          attempt,
          message: error.message,
          code: error.code,
          response: error.response,
        });

        if (attempt === maxRetries) throw error;

        const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
        console.log(`[EMAIL] retrying in ${delay}ms...`);

        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // =========================
  // SEND OTP (MAIN)
  // =========================
  async sendOTP(email, otp, purpose) {
    this.initialize();

    const correlationId = this.generateCorrelationId();
    console.log("==== SEND OTP CALLED ====");
    console.log("transporter exists:", !!this.transporter);
    console.log("initialized:", this.initialized);
    console.log("\n========== [EMAIL SEND OTP] ==========");
    console.log(`[${correlationId}] START`, {
      to: email,
      purpose,
      from: this.fromEmail,
      otp,
    });

    if (!this.fromEmail) {
      console.error(`[${correlationId}] ❌ EMAIL NOT CONFIGURED`);
      throw new Error("EMAIL_SERVICE_NOT_CONFIGURED");
    }

    const template = this.getTemplate(purpose, otp);

    const msg = {
      from: `"BangAI" <${this.fromEmail}>`,
      to: email,
      subject: template.subject,
      html: template.html,
      text: `OTP: ${otp}`,
    };

    console.log(`[${correlationId}] MESSAGE READY`, msg);

    try {
      const response = await this.sendWithRetry(msg, correlationId);

      console.log(`[${correlationId}] 🎉 EMAIL SENT DONE`);

      return {
        success: true,
        correlationId,
        messageId: response.messageId,
      };
    } catch (error) {
      console.error(`[${correlationId}] ❌ FINAL FAIL`, {
        message: error.message,
        code: error.code,
        response: error.response,
      });

      throw new Error("EMAIL_SEND_FAILED");
    }
  }

  // =========================
  // TEST CONNECTION
  // =========================
  async verifyConnection() {
    this.initialize();

    if (!this.fromEmail) {
      return {
        success: false,
        error: "NOT_CONFIGURED",
      };
    }

    const service = process.env.EMAIL_SERVICE || "gmail";
    if (service === "sendgrid") {
      try {
        if (!process.env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY is not set");
        return {
          success: true,
          email: this.fromEmail,
          service: "sendgrid",
        };
      } catch (err) {
        return {
          success: false,
          error: err.message,
        };
      }
    } else if (service === "resend") {
      try {
        if (!this.resendClient) throw new Error("Resend client not initialized");
        return {
          success: true,
          email: this.fromEmail,
          service: "resend",
        };
      } catch (err) {
        return {
          success: false,
          error: err.message,
        };
      }
    } else {
      try {
        await this.transporter.verify();

        return {
          success: true,
          email: this.fromEmail,
          service: "gmail",
        };
      } catch (err) {
        return {
          success: false,
          error: err.message,
        };
      }
    }
  }

  // =========================
  // SEND PAYMENT CONFIRMATION
  // =========================
  async sendPaymentConfirmation(email, plan, amount, transferCode) {
    this.initialize();

    const correlationId = this.generateCorrelationId();
    console.log("==== SEND PAYMENT CONFIRMATION CALLED ====");
    console.log(`[${correlationId}] START`, {
      to: email,
      plan,
      amount,
      transferCode,
    });

    if (!this.fromEmail) {
      console.error(`[${correlationId}] ❌ EMAIL NOT CONFIGURED`);
      throw new Error("EMAIL_SERVICE_NOT_CONFIGURED");
    }

    const formattedAmount = new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(amount);

    const subject = "Xác nhận thanh toán thành công - BangAI";
    const html = `
      <h2>Cảm ơn bạn đã thanh toán!</h2>
      <p>Giao dịch của bạn đã được xác nhận thành công.</p>
      <ul>
        <li><strong>Gói dịch vụ:</strong> ${plan}</li>
        <li><strong>Số tiền:</strong> ${formattedAmount}</li>
        <li><strong>Mã chuyển khoản:</strong> ${transferCode}</li>
      </ul>
      <p>Tài khoản của bạn đã được nâng cấp/cộng credits tương ứng. Chúc bạn có trải nghiệm tuyệt vời cùng BangAI!</p>
    `;

    const msg = {
      from: `"BangAI" <${this.fromEmail}>`,
      to: email,
      subject: subject,
      html: html,
      text: `Xác nhận thanh toán gói ${plan} số tiền ${formattedAmount}. Mã giao dịch: ${transferCode}`,
    };

    try {
      const response = await this.sendWithRetry(msg, correlationId);
      console.log(`[${correlationId}] 🎉 PAYMENT EMAIL SENT DONE`);
      return {
        success: true,
        correlationId,
        messageId: response.messageId,
      };
    } catch (error) {
      console.error(`[${correlationId}] ❌ PAYMENT EMAIL FINAL FAIL`, error);
      throw new Error("EMAIL_SEND_FAILED");
    }
  }
}

const emailService = new EmailService();
export default emailService;
