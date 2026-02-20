import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import router from "./auth";
import { prisma } from "../server";
import { sendVerificationEmail } from "../utils/sendVerificationEmail";
import { sendResetEmail } from "../utils/sendResetEmail";
import { checkRateLimit } from "../utils/rateLimiting";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

vi.mock("../server", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    account: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    apiKey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../utils/sendVerificationEmail", () => ({
  sendVerificationEmail: vi.fn(),
}));

vi.mock("../utils/sendResetEmail", () => ({
  sendResetEmail: vi.fn(),
}));

vi.mock("../utils/rateLimiting", () => ({
  checkRateLimit: vi.fn(),
  TIER_LIMITS: {
    HOBBY: {
      requestsPerHour: 20,
      requestsPerDay: 200,
      requestsPerMonth: 1000,
      allowLocationSearch: false,
      allowStats: false,
    },
    DEVELOPER: {
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      requestsPerMonth: 100000,
      allowLocationSearch: true,
      allowStats: true,
    },
    BUSINESS: {
      requestsPerHour: 5000,
      requestsPerDay: 50000,
      requestsPerMonth: 500000,
      allowLocationSearch: true,
      allowStats: true,
    },
  },
}));

const app = express();
app.use(express.json());
app.use("/auth", router);

const mockedUserFindUnique = prisma.user.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUserFindFirst = prisma.user.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUserCreate = prisma.user.create as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUserUpdate = prisma.user.update as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAccountCreate = prisma.account.create as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAccountFindFirst = prisma.account
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedAccountUpdateMany = prisma.account
  .updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedApiKeyFindMany = prisma.apiKey.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockedApiKeyFindFirst = prisma.apiKey.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedTransaction = prisma.$transaction as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCheckRateLimit = checkRateLimit as unknown as ReturnType<
  typeof vi.fn
>;
const mockedSendVerificationEmail =
  sendVerificationEmail as unknown as ReturnType<typeof vi.fn>;
const mockedSendResetEmail = sendResetEmail as unknown as ReturnType<
  typeof vi.fn
>;

describe("POST /auth/register", () => {
  beforeEach(() => {
    mockedUserFindUnique.mockReset();
    mockedUserCreate.mockReset();
    mockedAccountCreate.mockReset();
    mockedSendVerificationEmail.mockReset();
  });

  it("returns 400 when request body is invalid", async () => {
    const response = await request(app).post("/auth/register").send({
      email: "not-an-email",
      password: "123",
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
    expect(mockedUserCreate).not.toHaveBeenCalled();
    expect(mockedAccountCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when email is already registered", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({ id: "existing-user" } as any);

    const response = await request(app).post("/auth/register").send({
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Email already registered" });
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { email: "jane@example.com" },
    });
    expect(mockedUserCreate).not.toHaveBeenCalled();
    expect(mockedAccountCreate).not.toHaveBeenCalled();
  });

  it("returns 409 when username is already taken", async () => {
    mockedUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing-user" } as any);

    const response = await request(app).post("/auth/register").send({
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Username already taken" });
    expect(mockedUserFindUnique).toHaveBeenNthCalledWith(1, {
      where: { email: "jane@example.com" },
    });
    expect(mockedUserFindUnique).toHaveBeenNthCalledWith(2, {
      where: { username: "janedoe" },
    });
    expect(mockedUserCreate).not.toHaveBeenCalled();
    expect(mockedAccountCreate).not.toHaveBeenCalled();
  });

  it("creates user, account, and sends verification email", async () => {
    mockedUserFindUnique.mockResolvedValue(null);
    mockedUserCreate.mockResolvedValue({
      id: "user_123",
      email: "jane@example.com",
    } as any);
    mockedAccountCreate.mockResolvedValue({ id: "acct_123" } as any);

    const response = await request(app).post("/auth/register").send({
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: "User registered" });

    expect(mockedUserCreate).toHaveBeenCalledTimes(1);
    const userCreateArg = mockedUserCreate.mock.calls[0][0];
    expect(userCreateArg.data).toMatchObject({
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      approved: false,
    });
    expect(typeof userCreateArg.data.verificationToken).toBe("string");
    expect(userCreateArg.data.verificationToken).toHaveLength(64);
    expect(userCreateArg.data.verificationExpiry).toBeInstanceOf(Date);

    expect(mockedAccountCreate).toHaveBeenCalledWith({
      data: {
        userId: "user_123",
        type: "credentials",
        provider: "local",
        providerAccountId: "user_123",
        access_token: expect.any(String),
      },
    });

    const passwordHash = mockedAccountCreate.mock.calls[0][0].data.access_token;
    expect(passwordHash).not.toBe("password123");

    expect(mockedSendVerificationEmail).toHaveBeenCalledWith(
      "jane@example.com",
      userCreateArg.data.verificationToken
    );
  });
});

describe("POST /auth/login", () => {
  beforeEach(() => {
    mockedUserFindUnique.mockReset();
    mockedAccountFindFirst.mockReset();
  });

  it("returns 400 when request body is invalid", async () => {
    const response = await request(app).post("/auth/login").send({
      email: "not-an-email",
      password: "123",
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
    expect(mockedAccountFindFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when user does not exist", async () => {
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app).post("/auth/login").send({
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { email: "jane@example.com" },
    });
    expect(mockedAccountFindFirst).not.toHaveBeenCalled();
  });

  it("returns 403 when email is not verified", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      email: "jane@example.com",
      emailVerified: false,
      approved: false,
      admin: false,
    } as any);

    const response = await request(app).post("/auth/login").send({
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Please verify your email before logging in",
    });
    expect(mockedAccountFindFirst).not.toHaveBeenCalled();
  });

  it("returns 401 when local account is missing", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      email: "jane@example.com",
      emailVerified: true,
      approved: false,
      admin: false,
    } as any);
    mockedAccountFindFirst.mockResolvedValueOnce(null);

    const response = await request(app).post("/auth/login").send({
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
    expect(mockedAccountFindFirst).toHaveBeenCalledWith({
      where: { userId: "user_1", provider: "local" },
    });
  });

  it("returns 401 when password is invalid", async () => {
    const storedHash = await bcrypt.hash("different-password", 10);

    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      email: "jane@example.com",
      emailVerified: true,
      approved: false,
      admin: false,
    } as any);
    mockedAccountFindFirst.mockResolvedValueOnce({
      userId: "user_1",
      provider: "local",
      access_token: storedHash,
    } as any);

    const response = await request(app).post("/auth/login").send({
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid credentials" });
  });

  it("returns token when credentials are valid", async () => {
    const storedHash = await bcrypt.hash("password123", 10);

    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      email: "jane@example.com",
      emailVerified: true,
      approved: true,
      admin: false,
    } as any);
    mockedAccountFindFirst.mockResolvedValueOnce({
      userId: "user_1",
      provider: "local",
      access_token: storedHash,
    } as any);

    const response = await request(app).post("/auth/login").send({
      email: "jane@example.com",
      password: "password123",
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
    expect(mockedAccountFindFirst).toHaveBeenCalledWith({
      where: { userId: "user_1", provider: "local" },
    });
  });
});

describe("POST /auth/forgot-password", () => {
  beforeEach(() => {
    mockedUserFindUnique.mockReset();
    mockedUserUpdate.mockReset();
    mockedSendResetEmail.mockReset();
  });

  it("returns 400 when request body is invalid", async () => {
    const response = await request(app).post("/auth/forgot-password").send({
      email: "not-an-email",
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(mockedSendResetEmail).not.toHaveBeenCalled();
  });

  it("returns generic message when user does not exist", async () => {
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app).post("/auth/forgot-password").send({
      email: "missing@example.com",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "If the email exists, a reset link has been sent",
    });
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { email: "missing@example.com" },
    });
    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(mockedSendResetEmail).not.toHaveBeenCalled();
  });

  it("updates reset fields and sends reset email when user exists", async () => {
    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      email: "jane@example.com",
    } as any);
    mockedUserUpdate.mockResolvedValueOnce({ id: "user_1" } as any);

    const response = await request(app).post("/auth/forgot-password").send({
      email: "jane@example.com",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "If the email exists, a reset link has been sent",
    });

    expect(mockedUserUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockedUserUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "user_1" });
    expect(typeof updateArg.data.resetToken).toBe("string");
    expect(updateArg.data.resetToken).toHaveLength(64);
    expect(updateArg.data.resetExpiry).toBeInstanceOf(Date);

    expect(mockedSendResetEmail).toHaveBeenCalledWith(
      "jane@example.com",
      updateArg.data.resetToken
    );
  });
});

describe("POST /auth/reset-password", () => {
  beforeEach(() => {
    mockedUserFindFirst.mockReset();
    mockedAccountUpdateMany.mockReset();
    mockedUserUpdate.mockReset();
  });

  it("returns 400 when request body is invalid", async () => {
    const response = await request(app).post("/auth/reset-password").send({
      token: "",
      password: "123",
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(mockedUserFindFirst).not.toHaveBeenCalled();
    expect(mockedAccountUpdateMany).not.toHaveBeenCalled();
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when reset token is invalid or expired", async () => {
    mockedUserFindFirst.mockResolvedValueOnce(null);

    const response = await request(app).post("/auth/reset-password").send({
      token: "invalid-token",
      password: "newpassword123",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Reset token is invalid or expired",
    });
    expect(mockedUserFindFirst).toHaveBeenCalledWith({
      where: {
        resetToken: "invalid-token",
        resetExpiry: { gt: expect.any(Date) },
      },
    });
    expect(mockedAccountUpdateMany).not.toHaveBeenCalled();
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });

  it("updates password and clears reset token when token is valid", async () => {
    mockedUserFindFirst.mockResolvedValueOnce({
      id: "user_1",
      resetToken: "valid-token",
    } as any);
    mockedAccountUpdateMany.mockResolvedValueOnce({ count: 1 } as any);
    mockedUserUpdate.mockResolvedValueOnce({ id: "user_1" } as any);

    const response = await request(app).post("/auth/reset-password").send({
      token: "valid-token",
      password: "newpassword123",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: "Password has been reset successfully",
    });

    expect(mockedAccountUpdateMany).toHaveBeenCalledTimes(1);
    const accountUpdateArg = mockedAccountUpdateMany.mock.calls[0][0];
    expect(accountUpdateArg.where).toEqual({
      userId: "user_1",
      provider: "local",
    });
    expect(accountUpdateArg.data.access_token).toEqual(expect.any(String));
    expect(accountUpdateArg.data.access_token).not.toBe("newpassword123");

    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { resetToken: null, resetExpiry: null },
    });
  });
});

describe("POST /auth/forgot-api-key", () => {
  beforeEach(() => {
    mockedUserFindUnique.mockReset();
    mockedApiKeyFindMany.mockReset();
    mockedTransaction.mockReset();
  });

  it("returns 400 when request body is invalid", async () => {
    const response = await request(app).post("/auth/forgot-api-key").send({
      email: "not-an-email",
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
    expect(mockedApiKeyFindMany).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("returns 404 when account is not found", async () => {
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app).post("/auth/forgot-api-key").send({
      email: "missing@example.com",
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: "No account found for that email",
    });
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { email: "missing@example.com" },
      select: { id: true, subscriptionTier: true },
    });
    expect(mockedApiKeyFindMany).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
  });

  it("creates a replacement key and migrates usage from existing keys", async () => {
    const futureReset = new Date(Date.now() + 24 * 60 * 60 * 1000);

    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      subscriptionTier: "DEVELOPER",
    } as any);
    mockedApiKeyFindMany.mockResolvedValueOnce([
      {
        id: "key_1",
        usageCount: 10,
        currentMonthUsage: 4,
        monthlyResetDate: futureReset,
      },
      {
        id: "key_2",
        usageCount: 6,
        currentMonthUsage: 3,
        monthlyResetDate: null,
      },
    ] as any);

    const txCreate = vi.fn().mockResolvedValue({
      id: "new_key_id",
      name: "DEVELOPER API Key",
      keyPrefix: "pk_develope...",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
      permissions: ["read:pubs", "location:search"],
    });
    const txUsageUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 2 });

    mockedTransaction.mockImplementationOnce(async (callback: any) =>
      callback({
        apiKey: {
          create: txCreate,
          deleteMany: txDeleteMany,
        },
        apiKeyUsage: {
          updateMany: txUsageUpdateMany,
        },
      })
    );

    const response = await request(app).post("/auth/forgot-api-key").send({
      email: "jane@example.com",
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("A new API key has been generated.");
    expect(response.body.apiKey.name).toBe("DEVELOPER API Key");
    expect(response.body.apiKey.tier).toBe("DEVELOPER");
    expect(response.body.apiKey.keyStatus).toBe("ACTIVE");
    expect(response.body.apiKey.permissions).toEqual([
      "read:pubs",
      "location:search",
    ]);
    expect(response.body.apiKey.key).toMatch(/^pk_developer_[a-f0-9]{48}$/);

    expect(mockedApiKeyFindMany).toHaveBeenCalledWith({
      where: { userId: "user_1", isActive: true },
      select: {
        id: true,
        usageCount: true,
        currentMonthUsage: true,
        monthlyResetDate: true,
      },
    });

    expect(txCreate).toHaveBeenCalledTimes(1);
    const createdArg = txCreate.mock.calls[0][0];
    expect(createdArg.data).toMatchObject({
      name: "DEVELOPER API Key",
      userId: "user_1",
      tier: "DEVELOPER",
      keyStatus: "ACTIVE",
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      requestsPerMonth: 100000,
      usageCount: 16,
      currentMonthUsage: 7,
      permissions: ["read:pubs", "location:search"],
    });
    expect(typeof createdArg.data.keyHash).toBe("string");
    expect(createdArg.data.keyHash).toHaveLength(64);

    expect(txUsageUpdateMany).toHaveBeenCalledWith({
      where: { apiKeyId: { in: ["key_1", "key_2"] } },
      data: { apiKeyId: "new_key_id" },
    });
    expect(txDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["key_1", "key_2"] } },
    });
  });

  it("falls back for missing usage, default monthly reset, and unknown tier config", async () => {
    const pastReset = new Date(Date.now() - 24 * 60 * 60 * 1000);

    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_2",
      subscriptionTier: "UNKNOWN_TIER",
    } as any);
    mockedApiKeyFindMany.mockResolvedValueOnce([
      {
        id: "legacy_1",
        usageCount: null,
        currentMonthUsage: undefined,
        monthlyResetDate: pastReset,
      },
      {
        id: "legacy_2",
        usageCount: 2,
        currentMonthUsage: null,
        monthlyResetDate: null,
      },
    ] as any);

    const txCreate = vi.fn().mockResolvedValue({
      id: "new_key_id",
      name: "UNKNOWN_TIER API Key",
      keyPrefix: "pk_hobby_abc...",
      tier: "UNKNOWN_TIER",
      keyStatus: "ACTIVE",
      permissions: ["read:pubs"],
    });
    const txUsageUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const txDeleteMany = vi.fn().mockResolvedValue({ count: 2 });

    mockedTransaction.mockImplementationOnce(async (callback: any) =>
      callback({
        apiKey: {
          create: txCreate,
          deleteMany: txDeleteMany,
        },
        apiKeyUsage: {
          updateMany: txUsageUpdateMany,
        },
      })
    );

    const response = await request(app).post("/auth/forgot-api-key").send({
      email: "fallback@example.com",
    });

    expect(response.status).toBe(200);
    expect(txCreate).toHaveBeenCalledTimes(1);

    const createdArg = txCreate.mock.calls[0][0];
    expect(createdArg.data.usageCount).toBe(2);
    expect(createdArg.data.currentMonthUsage).toBe(0);
    expect(createdArg.data.requestsPerHour).toBe(20);
    expect(createdArg.data.requestsPerDay).toBe(200);
    expect(createdArg.data.requestsPerMonth).toBe(1000);
    expect(createdArg.data.permissions).toEqual(["read:pubs"]);

    const expectedDefaultMonthlyReset = new Date();
    expectedDefaultMonthlyReset.setMonth(
      expectedDefaultMonthlyReset.getMonth() + 1
    );
    expectedDefaultMonthlyReset.setDate(1);

    expect(createdArg.data.monthlyResetDate).toBeInstanceOf(Date);
    expect(createdArg.data.monthlyResetDate.getFullYear()).toBe(
      expectedDefaultMonthlyReset.getFullYear()
    );
    expect(createdArg.data.monthlyResetDate.getMonth()).toBe(
      expectedDefaultMonthlyReset.getMonth()
    );
    expect(createdArg.data.monthlyResetDate.getDate()).toBe(1);
  });
});

describe("GET /auth/verify", () => {
  beforeEach(() => {
    mockedUserFindFirst.mockReset();
    mockedUserUpdate.mockReset();
  });

  it("returns 400 when token is missing", async () => {
    const response = await request(app).get("/auth/verify");

    expect(response.status).toBe(400);
    expect(response.text).toBe("Invalid or missing token.");
    expect(mockedUserFindFirst).not.toHaveBeenCalled();
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when verification token is invalid or expired", async () => {
    mockedUserFindFirst.mockResolvedValueOnce(null);

    const response = await request(app).get("/auth/verify?token=bad-token");

    expect(response.status).toBe(400);
    expect(response.text).toBe("Verification link is invalid or expired.");
    expect(mockedUserFindFirst).toHaveBeenCalledWith({
      where: {
        verificationToken: "bad-token",
        verificationExpiry: { gt: expect.any(Date) },
      },
    });
    expect(mockedUserUpdate).not.toHaveBeenCalled();
  });

  it("marks email as verified when token is valid", async () => {
    mockedUserFindFirst.mockResolvedValueOnce({ id: "user_1" } as any);
    mockedUserUpdate.mockResolvedValueOnce({ id: "user_1" } as any);

    const response = await request(app).get("/auth/verify?token=valid-token");

    expect(response.status).toBe(200);
    expect(response.text).toBe(
      "✅ Your email has been verified. You can now log in."
    );
    expect(mockedUserUpdate).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: {
        emailVerified: true,
        verificationToken: null,
        verificationExpiry: null,
      },
    });
  });
});

describe("GET /auth/me", () => {
  beforeEach(() => {
    mockedUserFindUnique.mockReset();
  });

  it("returns 401 when token is missing", async () => {
    const response = await request(app).get("/auth/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Missing token" });
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when authenticated user is not found", async () => {
    const token = jwt.sign(
      {
        userId: "missing-user-id",
        email: "missing@example.com",
      },
      "supersecret",
      { expiresIn: "1h" }
    );
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "User not found" });
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { id: "missing-user-id" },
    });
  });

  it("returns current user profile when authenticated", async () => {
    const token = jwt.sign(
      {
        userId: "user_1",
        email: "jane@example.com",
      },
      "supersecret",
      { expiresIn: "1h" }
    );
    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      approved: true,
      emailVerified: true,
    } as any);

    const response = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: "user_1",
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      approved: true,
      emailVerified: true,
    });
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { id: "user_1" },
    });
  });
});

describe("GET /auth/dashboard", () => {
  beforeEach(() => {
    mockedUserFindUnique.mockReset();
    mockedApiKeyFindFirst.mockReset();
    mockedCheckRateLimit.mockReset();
  });

  it("returns 401 when token is missing", async () => {
    const response = await request(app).get("/auth/dashboard");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Missing token" });
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when authenticated user is not found", async () => {
    const token = jwt.sign(
      {
        userId: "missing-user-id",
        email: "missing@example.com",
      },
      "supersecret",
      { expiresIn: "1h" }
    );
    mockedUserFindUnique.mockResolvedValueOnce(null);

    const response = await request(app)
      .get("/auth/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "User not found" });
  });

  it("returns dashboard data with limits and summary", async () => {
    const token = jwt.sign(
      {
        userId: "user_1",
        email: "jane@example.com",
      },
      "supersecret",
      { expiresIn: "1h" }
    );

    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      approved: true,
      emailVerified: true,
      apiKeys: [
        {
          name: "Developer Key",
          tier: "DEVELOPER",
          keyStatus: "ACTIVE",
          keyPrefix: "pk_dev_123...",
          isActive: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastUsed: new Date("2026-02-01T00:00:00.000Z"),
          usageCount: 30,
        },
        {
          name: "Missing Full Key",
          tier: "HOBBY",
          keyStatus: "ACTIVE",
          keyPrefix: "pk_hobby_123...",
          isActive: true,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          lastUsed: null,
          usageCount: 5,
        },
      ],
    } as any);

    mockedApiKeyFindFirst
      .mockResolvedValueOnce({ id: "api_key_1", tier: "DEVELOPER" } as any)
      .mockResolvedValueOnce(null);

    mockedCheckRateLimit.mockResolvedValueOnce({
      allowed: true,
      remaining: { hour: 900, day: 9000, month: 90000 },
      resetTimes: {
        hour: new Date("2026-02-20T13:00:00.000Z"),
        day: new Date("2026-02-21T00:00:00.000Z"),
        month: new Date("2026-03-01T00:00:00.000Z"),
      },
    });

    const response = await request(app)
      .get("/auth/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      approved: true,
      emailVerified: true,
    });
    expect(response.body.summary).toEqual({
      totalApiKeys: 2,
      totalUsage: 35,
    });
    expect(response.body.apiKeys).toHaveLength(2);
    expect(response.body.apiKeys[0].remaining).toEqual({
      hour: 900,
      day: 9000,
      month: 90000,
    });
    expect(response.body.apiKeys[0].limits).toEqual({
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      requestsPerMonth: 100000,
    });
    expect(response.body.apiKeys[1].remaining).toEqual({
      hour: 0,
      day: 0,
      month: 0,
    });

    expect(mockedCheckRateLimit).toHaveBeenCalledWith("api_key_1", "DEVELOPER");
    expect(mockedApiKeyFindFirst).toHaveBeenCalledTimes(2);
  });

  it("falls back to zero in summary when usageCount is missing", async () => {
    const token = jwt.sign(
      {
        userId: "user_1",
        email: "jane@example.com",
      },
      "supersecret",
      { expiresIn: "1h" }
    );

    mockedUserFindUnique.mockResolvedValueOnce({
      id: "user_1",
      name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      approved: true,
      emailVerified: true,
      apiKeys: [
        {
          name: "Missing Usage A",
          tier: "HOBBY",
          keyStatus: "ACTIVE",
          keyPrefix: "pk_hobby_a...",
          isActive: true,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastUsed: null,
          usageCount: null,
        },
        {
          name: "Missing Usage B",
          tier: "HOBBY",
          keyStatus: "ACTIVE",
          keyPrefix: "pk_hobby_b...",
          isActive: true,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          lastUsed: null,
          usageCount: undefined,
        },
      ],
    } as any);

    mockedApiKeyFindFirst.mockResolvedValue(null);

    const response = await request(app)
      .get("/auth/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      totalApiKeys: 2,
      totalUsage: 0,
    });
  });

  it("returns 500 when dashboard lookup throws", async () => {
    const token = jwt.sign(
      {
        userId: "user_1",
        email: "jane@example.com",
      },
      "supersecret",
      { expiresIn: "1h" }
    );
    mockedUserFindUnique.mockRejectedValueOnce(new Error("db failure"));

    const response = await request(app)
      .get("/auth/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: "Internal server error",
      message: "Failed to load dashboard data",
    });
  });
});
