import { describe, expect, it } from "vitest";
import { faviconCacheIsFresh, pageIconRequests, pageIconUrls } from "../src/favicon.js";

describe("favicon discovery", () => {
  it("discovers a synthetic same-host SVG icon declared by the page", () => {
    const html = `<html><head><link sizes="any" href="/assets/synthetic-mark.svg?v=1&amp;size=32" rel="shortcut icon"></head></html>`;
    expect(pageIconUrls(html, "https://reader.example.test/library")).toEqual([
      "https://reader.example.test/assets/synthetic-mark.svg?v=1&size=32",
    ]);
  });

  it("rejects insecure and cross-site icon declarations", () => {
    const html = `<link rel="icon" href="http://reader.example.test/icon.png"><link rel="icon" href="https://tracker.invalid/pixel.png">`;
    expect(pageIconUrls(html, "https://reader.example.test/")).toEqual([]);
  });

  it("keeps the document URL as referer for a declared icon", () => {
    const pageUrl = "https://reader.example.test/library/work";
    expect(pageIconRequests(`<link rel="icon" href="/favicon-32.png">`, pageUrl)).toEqual([
      { url: "https://reader.example.test/favicon-32.png", referer: pageUrl },
    ]);
  });

  it("retries negative cache entries sooner than successful icons", () => {
    const now = Date.parse("2026-08-10T12:00:00Z");
    expect(faviconCacheIsFresh({ fetchedAt: "2026-08-10T11:30:00Z", error: "FAVICON_NOT_FOUND" }, now)).toBe(false);
    expect(faviconCacheIsFresh({ fetchedAt: "2026-08-10T11:30:00Z", error: null }, now)).toBe(true);
  });
});
