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

import { sendApiKeyEmail } from "./sendApiKeyEmail";

describe("sendApiKeyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the API key to the given email address", async () => {
    mockSend.mockResolvedValueOnce({ id: "mail_1" });

    await sendApiKeyEmail("user@example.com", "pk_hobby_abc123", "HOBBY");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toBe("user@example.com");
    expect(payload.subject).toBe("Your New API Key");
    expect(payload.html).toContain("pk_hobby_abc123");
    expect(payload.html).toContain("HOBBY");
  });

  it("throws wrapped error when resend fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValueOnce(new Error("resend down"));

    await expect(
      sendApiKeyEmail("user@example.com", "pk_hobby_abc123", "HOBBY")
    ).rejects.toThrow("Failed to send API key email");

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to send API key email:",
      expect.any(Error)
    );
  });
});
