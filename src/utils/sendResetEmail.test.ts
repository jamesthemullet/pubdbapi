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

import { sendResetEmail } from "./sendResetEmail";

describe("sendResetEmail", () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FRONTEND_URL;
  });

  it("sends reset email using default frontend url", async () => {
    mockSend.mockResolvedValueOnce({ id: "mail_1" });

    await sendResetEmail("test@example.com", "token-123");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toBe("test@example.com");
    expect(payload.subject).toBe("Password Reset Request");
    expect(payload.html).toContain(
      "http://localhost:3000/reset-password?token=token-123"
    );
  });

  it("uses FRONTEND_URL when set", async () => {
    process.env.FRONTEND_URL = "https://app.example.com";
    mockSend.mockResolvedValueOnce({ id: "mail_2" });

    await sendResetEmail("test@example.com", "abc");

    const payload = mockSend.mock.calls[0][0];
    expect(payload.html).toContain(
      "https://app.example.com/reset-password?token=abc"
    );
  });

  it("throws wrapped error when resend fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValueOnce(new Error("resend down"));

    await expect(sendResetEmail("test@example.com", "x")).rejects.toThrow(
      "Failed to send reset email"
    );

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send reset email:",
      expect.any(Error)
    );
  });

  afterEach(() => {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });
});
