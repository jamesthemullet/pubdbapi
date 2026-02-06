import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import router from "./pubs";
import { prisma } from "../server";

vi.mock("../server", () => ({
  prisma: {
    pub: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

const app = express();
app.use(express.json());
app.use("/pubs", router);

const mockedFindMany = prisma.pub.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const mockedCount = prisma.pub.count as unknown as ReturnType<typeof vi.fn>;

describe("GET /pubs", () => {
  beforeEach(() => {
    mockedFindMany.mockReset();
    mockedCount.mockReset();
  });

  it("applies city and name filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "pub_1", name: "The Crown" },
    ] as any);
    mockedCount.mockResolvedValueOnce(1 as any);

    const response = await request(app).get("/pubs?city=London&name=Crown");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: "pub_1", name: "The Crown" }]);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        city: { equals: "London", mode: "insensitive" },
        name: { contains: "Crown", mode: "insensitive" },
      },
      orderBy: { name: "asc" },
    });
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        city: { equals: "London", mode: "insensitive" },
        name: { contains: "Crown", mode: "insensitive" },
      },
    });
  });

  it("applies operator, borough, postcode, area, and country filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "pub_2", name: "The Red Lion" },
    ] as any);
    mockedCount.mockResolvedValueOnce(1 as any);

    const response = await request(app).get(
      "/pubs?operator=Greene&borough=Camden&postcode=NW1%206XE&area=London&country=UK"
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: "pub_2", name: "The Red Lion" }]);
    expect(mockedFindMany).toHaveBeenCalledWith({
      where: {
        operator: { contains: "Greene", mode: "insensitive" },
        borough: { contains: "Camden", mode: "insensitive" },
        postcode: { equals: "NW1 6XE", mode: "insensitive" },
        area: { equals: "London", mode: "insensitive" },
        country: { equals: "UK", mode: "insensitive" },
      },
      orderBy: { name: "asc" },
    });
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        operator: { contains: "Greene", mode: "insensitive" },
        borough: { contains: "Camden", mode: "insensitive" },
        postcode: { equals: "NW1 6XE", mode: "insensitive" },
        area: { equals: "London", mode: "insensitive" },
        country: { equals: "UK", mode: "insensitive" },
      },
    });
  });
});
