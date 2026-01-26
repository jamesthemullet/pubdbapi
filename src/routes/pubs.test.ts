import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import router from "./pubs";
import { prisma } from "../server";

vi.mock("../server", () => ({
  prisma: {
    pub: {
      findMany: vi.fn(),
    },
  },
}));

const app = express();
app.use(express.json());
app.use("/pubs", router);

const mockedFindMany = prisma.pub.findMany as unknown as ReturnType<
  typeof vi.fn
>;

describe("GET /pubs", () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
  });

  it("applies city and name filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "pub_1", name: "The Crown" },
    ] as any);

    const response = await request(app).get("/pubs?city=London&name=Crown");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: "pub_1", name: "The Crown" }]);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        city: { equals: "London", mode: "insensitive" },
        name: { contains: "Crown", mode: "insensitive" },
      },
    });
  });
});
