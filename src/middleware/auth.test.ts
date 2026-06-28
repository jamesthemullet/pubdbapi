import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockJwtVerify, mockUserFindUnique } = vi.hoisted(() => ({
	mockJwtVerify: vi.fn(),
	mockUserFindUnique: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
	default: {
		verify: mockJwtVerify,
	},
}));

vi.mock("../server", () => ({
	prisma: {
		user: {
			findUnique: mockUserFindUnique,
		},
	},
}));

import { adminMiddleware, authMiddleware } from "./auth";

type MockResponse = {
	status: ReturnType<typeof vi.fn>;
	json: ReturnType<typeof vi.fn>;
};

type MockRequest = {
	headers?: Record<string, string>;
	user?: { userId: string; email?: string };
};

function createResponse(): MockResponse {
	const res = {} as MockResponse;
	res.status = vi.fn().mockReturnValue(res);
	res.json = vi.fn().mockReturnValue(res);
	return res;
}

describe("auth middleware", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("authMiddleware", () => {
		it("returns 401 when authorization header is missing", () => {
			const req: MockRequest = { headers: {} };
			const res = createResponse();
			const next = vi.fn();

			authMiddleware(
				req as Parameters<typeof authMiddleware>[0],
				res as unknown as Parameters<typeof authMiddleware>[1],
				next,
			);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({ error: "Missing token" });
			expect(next).not.toHaveBeenCalled();
		});

		it("returns 401 when token verification fails", () => {
			mockJwtVerify.mockImplementationOnce(() => {
				throw new Error("bad token");
			});

			const req: MockRequest = { headers: { authorization: "Bearer invalid" } };
			const res = createResponse();
			const next = vi.fn();

			authMiddleware(
				req as Parameters<typeof authMiddleware>[0],
				res as unknown as Parameters<typeof authMiddleware>[1],
				next,
			);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({ error: "Invalid token" });
			expect(next).not.toHaveBeenCalled();
		});

		it("returns 401 when token payload shape is invalid", () => {
			mockJwtVerify.mockReturnValueOnce({ sub: "u1" });

			const req: MockRequest = { headers: { authorization: "Bearer token" } };
			const res = createResponse();
			const next = vi.fn();

			authMiddleware(
				req as Parameters<typeof authMiddleware>[0],
				res as unknown as Parameters<typeof authMiddleware>[1],
				next,
			);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({ error: "Invalid token payload" });
			expect(next).not.toHaveBeenCalled();
		});

		it("sets req.user and calls next for valid token payload", () => {
			mockJwtVerify.mockReturnValueOnce({
				userId: "user_1",
				email: "test@example.com",
			});

			const req: MockRequest = { headers: { authorization: "Bearer token" } };
			const res = createResponse();
			const next = vi.fn();

			authMiddleware(
				req as Parameters<typeof authMiddleware>[0],
				res as unknown as Parameters<typeof authMiddleware>[1],
				next,
			);

			expect((req as { user?: unknown }).user).toEqual({
				userId: "user_1",
				email: "test@example.com",
			});
			expect(next).toHaveBeenCalledTimes(1);
			expect(res.status).not.toHaveBeenCalled();
		});
	});

	describe("adminMiddleware", () => {
		it("returns 401 when user is not authenticated", async () => {
			const req: MockRequest = {};
			const res = createResponse();
			const next = vi.fn();

			await adminMiddleware(
				req as Parameters<typeof adminMiddleware>[0],
				res as unknown as Parameters<typeof adminMiddleware>[1],
				next,
			);

			expect(res.status).toHaveBeenCalledWith(401);
			expect(res.json).toHaveBeenCalledWith({ error: "Not authenticated" });
			expect(next).not.toHaveBeenCalled();
		});

		it("returns 403 when user cannot be found", async () => {
			mockUserFindUnique.mockResolvedValueOnce(null);

			const req: MockRequest = { user: { userId: "user_1" } };
			const res = createResponse();
			const next = vi.fn();

			await adminMiddleware(
				req as Parameters<typeof adminMiddleware>[0],
				res as unknown as Parameters<typeof adminMiddleware>[1],
				next,
			);

			expect(mockUserFindUnique).toHaveBeenCalledWith({
				where: { id: "user_1" },
				select: { admin: true },
			});
			expect(res.status).toHaveBeenCalledWith(403);
			expect(res.json).toHaveBeenCalledWith({ error: "Admin access required" });
			expect(next).not.toHaveBeenCalled();
		});

		it("returns 403 when user is not an admin", async () => {
			mockUserFindUnique.mockResolvedValueOnce({ admin: false });

			const req: MockRequest = { user: { userId: "user_2" } };
			const res = createResponse();
			const next = vi.fn();

			await adminMiddleware(
				req as Parameters<typeof adminMiddleware>[0],
				res as unknown as Parameters<typeof adminMiddleware>[1],
				next,
			);

			expect(res.status).toHaveBeenCalledWith(403);
			expect(res.json).toHaveBeenCalledWith({ error: "Admin access required" });
			expect(next).not.toHaveBeenCalled();
		});

		it("calls next when user is an admin", async () => {
			mockUserFindUnique.mockResolvedValueOnce({ admin: true });

			const req: MockRequest = { user: { userId: "admin_1" } };
			const res = createResponse();
			const next = vi.fn();

			await adminMiddleware(
				req as Parameters<typeof adminMiddleware>[0],
				res as unknown as Parameters<typeof adminMiddleware>[1],
				next,
			);

			expect(next).toHaveBeenCalledTimes(1);
			expect(res.status).not.toHaveBeenCalled();
		});
	});
});
