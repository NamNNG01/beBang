import nodemailer from "nodemailer";

class EmailService {
  constructor() {
    this.initialized = false;
    this.fromEmail = null;
    this.transporter = null;
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
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `[EMAIL][${correlationId}] attempt ${attempt}/${maxRetries}`,
        );

        const response = await this.transporter.sendMail(msg);

        console.log(`[EMAIL][${correlationId}] ✅ SEND SUCCESS`, {
          messageId: response.messageId,
          accepted: response.accepted,
          rejected: response.rejected,
          response: response.response,
        });

        return response;
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

    try {
      await this.transporter.verify();

      return {
        success: true,
        email: this.fromEmail,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

const emailService = new EmailService();
export default emailService;
