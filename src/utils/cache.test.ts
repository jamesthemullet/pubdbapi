import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFromCache, setInCache, clearCache, TTL_ONE_HOUR } from "./cache";

describe("cache utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCache(); // start each test with an empty store
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a missing key", () => {
    expect(getFromCache("nonexistent")).toBeNull();
  });

  it("stores and retrieves a value before TTL expires", () => {
    setInCache("key1", { name: "test" });
    expect(getFromCache("key1")).toEqual({ name: "test" });
  });

  it("returns null and removes entry after TTL expires", () => {
    setInCache("key2", "some value", 1000);
    vi.advanceTimersByTime(1001);
    expect(getFromCache("key2")).toBeNull();
  });

  it("respects a custom TTL", () => {
    setInCache("key3", "short lived", 500);
    vi.advanceTimersByTime(499);
    expect(getFromCache("key3")).toBe("short lived");
    vi.advanceTimersByTime(2);
    expect(getFromCache("key3")).toBeNull();
  });

  it("clearCache() with a key removes only that entry", () => {
    setInCache("a", 1);
    setInCache("b", 2);
    clearCache("a");
    expect(getFromCache("a")).toBeNull();
    expect(getFromCache("b")).toBe(2);
  });

  it("clearCache() with no argument removes all entries", () => {
    setInCache("x", 10);
    setInCache("y", 20);
    clearCache();
    expect(getFromCache("x")).toBeNull();
    expect(getFromCache("y")).toBeNull();
  });

  it("TTL_ONE_HOUR is 3600000ms", () => {
    expect(TTL_ONE_HOUR).toBe(3_600_000);
  });
});
