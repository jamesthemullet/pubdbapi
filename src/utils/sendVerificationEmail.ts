import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVerificationEmail(to: string, token: string) {
  console.log(10, to, token);
  const apiBaseUrl = (
    process.env.API_BASE_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:4000"
  ).replace(/\/+$/, "");
  const verifyUrl = `${apiBaseUrl}/auth/verify?token=${token}`;

  try {
    await resend.emails.send({
      from: "PubDB <noreply@thepubdb.com>",
      to,
      subject: "Verify your PubDB account",
      html: `
      <h1>Welcome to PubDB 🍻</h1>
      <p>Click the link below to verify your account:</p>
      <a href="${verifyUrl}">${verifyUrl}</a>
      <p>This link expires in 24 hours.</p>
    `,
    });
  } catch (error) {
    console.error("❌ Failed to send email:", error);
  }
}
