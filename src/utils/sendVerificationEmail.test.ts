import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock("resend", () => {
  class Resend {
    emails = {
      send: mockSend,
    };
  }

  return {
    Resend,
  };
});

import { sendVerificationEmail } from "./sendVerificationEmail";

describe("sendVerificationEmail", () => {
  const originalApiBaseUrl = process.env.API_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_BASE_URL;
  });

  afterEach(() => {
    if (originalApiBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = originalApiBaseUrl;
  });

  it("sends verification email with expected payload", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockSend.mockResolvedValueOnce({ id: "mail_1" });

    await sendVerificationEmail("test@example.com", "token-1");

    expect(logSpy).toHaveBeenCalledWith(10, "test@example.com", "token-1");
    expect(mockSend).toHaveBeenCalledWith({
      from: "PubDB <noreply@thepubdb.com>",
      to: "test@example.com",
      subject: "Verify your PubDB account",
      html: expect.stringContaining(
        "http://localhost:4000/auth/verify?token=token-1"
      ),
    });
  });

  it("logs and does not throw when resend fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failure = new Error("send failed");
    mockSend.mockRejectedValueOnce(failure);

    await expect(
      sendVerificationEmail("test@example.com", "token-2")
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith("❌ Failed to send email:", failure);
  });

  it("uses API_BASE_URL when set", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.API_BASE_URL =
      "https://hopeful-playfulness-production.up.railway.app/";
    mockSend.mockResolvedValueOnce({ id: "mail_2" });

    await sendVerificationEmail("test@example.com", "token-3");

    expect(logSpy).toHaveBeenCalledWith(10, "test@example.com", "token-3");
    expect(mockSend).toHaveBeenCalledWith({
      from: "PubDB <noreply@thepubdb.com>",
      to: "test@example.com",
      subject: "Verify your PubDB account",
      html: expect.stringContaining(
        "https://hopeful-playfulness-production.up.railway.app/auth/verify?token=token-3"
      ),
    });
  });
});
