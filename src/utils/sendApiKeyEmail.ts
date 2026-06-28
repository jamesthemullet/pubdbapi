import { Resend } from "resend";

export async function sendApiKeyEmail(email: string, apiKey: string, tier: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: "noreply@thepubdb.com",
      to: email,
      subject: "Your New API Key",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #333;">Your New API Key</h1>
          <p>A new ${tier} API key has been generated for your account.</p>

          <div style="background-color: #f5f5f5; padding: 16px; border-radius: 5px; margin: 20px 0; word-break: break-all; font-family: monospace; font-size: 14px;">
            ${apiKey}
          </div>

          <p><strong>Store this key securely — it will not be shown again.</strong></p>

          <p>If you did not request a new API key, please contact support immediately as your previous key has been revoked.</p>

          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #999; font-size: 12px;">
            This is an automated message, please do not reply to this email.
          </p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Failed to send API key email:", error);
    throw new Error("Failed to send API key email");
  }
}
