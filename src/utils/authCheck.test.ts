import { describe, expect, it, vi } from "vitest";
import { Response } from "express";
import { AuthenticatedRequest } from "../types";
import { requireAuth } from "./authCheck";

describe("requireAuth", () => {
  it("returns true when user is authenticated", () => {
    const mockReq = {
      user: { userId: "test-user-id", email: "test@example.com" },
    } as unknown as AuthenticatedRequest;

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const result = requireAuth(mockReq, mockRes);

    expect(result).toBe(true);
    expect(mockRes.status).not.toHaveBeenCalled();
    expect(mockRes.json).not.toHaveBeenCalled();
  });

  it("returns false and sends 401 when user is not authenticated", () => {
    const mockReq = {
      user: undefined,
    } as unknown as AuthenticatedRequest;

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const result = requireAuth(mockReq, mockRes);

    expect(result).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Not authenticated" });
  });

  it("returns false and sends 401 when user is null", () => {
    const mockReq = {
      user: null,
    } as unknown as AuthenticatedRequest;

    const mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;

    const result = requireAuth(mockReq, mockRes);

    expect(result).toBe(false);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Not authenticated" });
  });
});
