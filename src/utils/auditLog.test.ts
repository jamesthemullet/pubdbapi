import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuditLogCreate } = vi.hoisted(() => ({
  mockAuditLogCreate: vi.fn(),
}));

vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      auditLog = {
        create: mockAuditLogCreate,
      };
    },
  };
});

import { createAuditLog, getChangedFields, getClientInfo } from "./auditLog";

describe("auditLog utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAuditLog", () => {
    it("creates an audit log with the provided data", async () => {
      mockAuditLogCreate.mockResolvedValueOnce({ id: "log_1" });

      await createAuditLog({
        action: "UPDATE",
        entity: "Pub",
        entityId: "pub_1",
        userId: "user_1",
        oldValues: { name: "Old" },
        newValues: { name: "New" },
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          action: "UPDATE",
          entity: "Pub",
          entityId: "pub_1",
          userId: "user_1",
          oldValues: { name: "Old" },
          newValues: { name: "New" },
          ipAddress: "127.0.0.1",
          userAgent: "vitest",
        },
      });
    });

    it("swallows prisma errors and logs them", async () => {
      const error = new Error("db down");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockAuditLogCreate.mockRejectedValueOnce(error);

      await expect(
        createAuditLog({
          action: "CREATE",
          entity: "User",
          entityId: "user_1",
        })
      ).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith("Failed to create audit log:", error);
    });
  });

  describe("getClientInfo", () => {
    it("uses req.ip and req.get when available", () => {
      const req = {
        ip: "10.0.0.1",
        get: vi.fn().mockReturnValue("Mozilla/5.0"),
      };

      expect(getClientInfo(req)).toEqual({
        ipAddress: "10.0.0.1",
        userAgent: "Mozilla/5.0",
      });
    });

    it("falls back to connection remoteAddress and unknown user agent", () => {
      const req = {
        connection: { remoteAddress: "192.168.1.10" },
        get: vi.fn().mockReturnValue(undefined),
      };

      expect(getClientInfo(req)).toEqual({
        ipAddress: "192.168.1.10",
        userAgent: "unknown",
      });
    });
  });

  describe("getChangedFields", () => {
    it("returns only fields that changed", () => {
      const oldObj = { name: "Old", city: "London", count: 1 };
      const newObj = { name: "New", city: "London", count: 2 };

      expect(getChangedFields(oldObj, newObj)).toEqual({
        oldValues: { name: "Old", count: 1 },
        newValues: { name: "New", count: 2 },
      });
    });

    it("returns empty objects when there are no changes", () => {
      const oldObj = { name: "Same" };
      const newObj = { name: "Same" };

      expect(getChangedFields(oldObj, newObj)).toEqual({
        oldValues: {},
        newValues: {},
      });
    });
  });
});
