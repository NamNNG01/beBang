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
  // TEMPLATE LAYOUT & HELPERS
  // =========================
  getEmailLayout(title, content) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #334155;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
          <tr>
            <td align="center" style="padding: 40px 10px 40px 10px; background-color: #f8fafc;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 550px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
                
                <!-- HEADER -->
                <tr>
                  <td align="center" style="padding: 32px 40px 24px 40px; background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);">
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td align="center">
                          <span style="font-size: 28px; font-weight: 800; color: #ffffff; letter-spacing: 1.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-transform: uppercase;">
                            Bang<span style="color: #6366f1;">AI</span>
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding-top: 8px;">
                          <span style="font-size: 13px; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; font-weight: 500;">Trợ Lý AI Thông Minh</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- CONTENT -->
                <tr>
                  <td style="padding: 40px 40px 32px 40px;">
                    ${content}
                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td align="center" style="padding: 0 40px 40px 40px; background-color: #ffffff;">
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin-bottom: 24px;">
                    <p style="font-size: 12px; color: #64748b; margin: 0; line-height: 1.6;">
                      Đây là email tự động từ hệ thống BangAI. Vui lòng không phản hồi email này trực tiếp.
                    </p>
                    <p style="font-size: 12px; color: #94a3b8; margin: 8px 0 0 0;">
                      © ${new Date().getFullYear()} BangAI. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  getTemplate(purpose, otp) {
    const isReset = purpose === "reset_password";
    const title = isReset ? "Đặt lại mật khẩu" : "Xác minh tài khoản";
    const desc = isReset 
      ? "Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng sử dụng mã OTP dưới đây để hoàn tất:"
      : "Cảm ơn bạn đã lựa chọn BangAI! Để kích hoạt và xác minh tài khoản của bạn, vui lòng nhập mã xác thực OTP dưới đây:";

    const content = `
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="font-size: 20px; font-weight: 700; color: #0f172a; padding-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            ${title}
          </td>
        </tr>
        <tr>
          <td style="font-size: 15px; line-height: 1.6; color: #475569; padding-bottom: 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            ${desc}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom: 32px;">
            <table border="0" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; border-radius: 12px; border: 1px dashed #cbd5e1;">
              <tr>
                <td style="padding: 16px 32px; font-size: 32px; font-weight: 800; color: #4f46e5; letter-spacing: 8px; font-family: 'Courier New', Courier, monospace;">
                  ${otp}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="font-size: 13px; line-height: 1.5; color: #64748b; background-color: #f8fafc; border-radius: 8px; padding: 16px; border-left: 4px solid #6366f1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <strong>Lưu ý bảo mật:</strong> Mã xác thực này có hiệu lực trong vòng 5 phút. Vui lòng KHÔNG chia sẻ mã này với bất kỳ ai để bảo vệ tài khoản của bạn.
          </td>
        </tr>
      </table>
    `;

    return {
      subject: isReset ? "Đặt lại mật khẩu - BangAI" : "Xác thực email - BangAI",
      html: this.getEmailLayout(title, content),
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
    const title = "Thanh toán thành công";

    let planDisplayName = plan;
    if (plan === "pro_monthly") planDisplayName = "Gói Pro Hàng Tháng";
    else if (plan === "pro_yearly") planDisplayName = "Gói Pro Hàng Năm";
    else if (plan === "credits_50") planDisplayName = "Nạp 50 Credits";
    else if (plan === "credits_100") planDisplayName = "Nạp 100 Credits";

    const content = `
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td align="center" style="padding-bottom: 24px;">
            <div style="display: inline-block; width: 64px; height: 64px; line-height: 64px; border-radius: 50%; background-color: #ecfdf5; color: #10b981; font-size: 32px; font-weight: bold; text-align: center; margin-bottom: 16px;">
              ✓
            </div>
            <div style="font-size: 22px; font-weight: 700; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Thanh toán thành công!</div>
          </td>
        </tr>
        <tr>
          <td style="font-size: 15px; line-height: 1.6; color: #475569; padding-bottom: 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            Cảm ơn bạn đã tin tưởng dịch vụ của BangAI. Giao dịch của bạn đã được đối soát thành công và hệ thống đã cập nhật quyền lợi tài khoản của bạn.
          </td>
        </tr>
        <tr>
          <td style="padding-bottom: 32px;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
              <tr>
                <td style="padding: 16px 20px; font-size: 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; width: 40%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Gói dịch vụ</td>
                <td style="padding: 16px 20px; font-size: 14px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${planDisplayName}</td>
              </tr>
              <tr>
                <td style="padding: 16px 20px; font-size: 14px; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Số tiền thanh toán</td>
                <td style="padding: 16px 20px; font-size: 14px; font-weight: 700; color: #10b981; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${formattedAmount}</td>
              </tr>
              <tr>
                <td style="padding: 16px 20px; font-size: 14px; font-weight: 600; color: #64748b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">Mã chuyển khoản</td>
                <td style="padding: 16px 20px; font-size: 14px; font-weight: 500; color: #334155; text-align: right; font-family: monospace;">${transferCode}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-bottom: 16px;">
            <a href="https://fe-rho-lemon.vercel.app" target="_blank" style="display: inline-block; background-color: #4f46e5; color: #ffffff; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              Bắt đầu trải nghiệm BangAI
            </a>
          </td>
        </tr>
      </table>
    `;

    const msg = {
      from: `"BangAI" <${this.fromEmail}>`,
      to: email,
      subject: subject,
      html: this.getEmailLayout(title, content),
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
