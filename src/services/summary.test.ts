/**
 * Summary Service Tests
 * Tests cache logic and summary generation (with mocked OpenRouter).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, upsertMarket, getCachedSummary, upsertSummary } from "../db.js";
import type Database from "better-sqlite3";

function makeMockMarket(id: string = "test-123"): any {
    return {
        id,
        question: "Will test pass?",
        conditionId: "0xabc123",
        slug: "will-test-pass",
        description: "A test market",
        category: "Test",
        startDate: "2026-01-01T00:00:00Z",
        endDate: "2026-12-31T23:59:59Z",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.75","0.25"]',
        volume: "1000000",
        volumeNum: 1000000,
        liquidity: "50000",
        liquidityNum: 50000,
        active: true,
        closed: false,
        volume24hr: 25000,
        volume1wk: 150000,
        volume1mo: 500000,
        bestBid: 0.74,
        bestAsk: 0.76,
        lastTradePrice: 0.75,
    };
}

describe("Summary Service", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = createTestDb();
    });

    describe("Cache Logic", () => {
        it("should return null when no summary exists", () => {
            upsertMarket(db, makeMockMarket());
            const cached = getCachedSummary(db, "test-123");
            expect(cached).toBeNull();
        });

        it("should return cached summary when valid", () => {
            upsertMarket(db, makeMockMarket());
            upsertSummary(db, "test-123", "Cached analysis text", "test-model", 24);

            const cached = getCachedSummary(db, "test-123");
            expect(cached).toBeDefined();
            expect(cached!.summary_text).toBe("Cached analysis text");
            expect(cached!.model).toBe("test-model");
        });

        it("should set proper TTL on summaries", () => {
            upsertMarket(db, makeMockMarket());
            upsertSummary(db, "test-123", "Test summary", "model", 24);

            const cached = getCachedSummary(db, "test-123");
            expect(cached).toBeDefined();

            const expiresAt = new Date(cached!.expires_at);
            const now = new Date();
            const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

            // Should expire in roughly 24 hours (allow some tolerance)
            expect(hoursUntilExpiry).toBeGreaterThan(23);
            expect(hoursUntilExpiry).toBeLessThanOrEqual(24.1);
        });

        it("should replace old summary with new one", () => {
            upsertMarket(db, makeMockMarket());

            upsertSummary(db, "test-123", "Old summary", "model-v1", 24);
            upsertSummary(db, "test-123", "New summary", "model-v2", 24);

            const cached = getCachedSummary(db, "test-123");
            expect(cached!.summary_text).toBe("New summary");
            expect(cached!.model).toBe("model-v2");
        });

        it("should handle multiple markets independently", () => {
            upsertMarket(db, makeMockMarket("m1"));
            upsertMarket(db, makeMockMarket("m2"));

            upsertSummary(db, "m1", "Summary for m1", "model", 24);
            upsertSummary(db, "m2", "Summary for m2", "model", 24);

            const s1 = getCachedSummary(db, "m1");
            const s2 = getCachedSummary(db, "m2");

            expect(s1!.summary_text).toBe("Summary for m1");
            expect(s2!.summary_text).toBe("Summary for m2");
        });

        it("should not return expired summaries", () => {
            upsertMarket(db, makeMockMarket());

            // Insert a summary with an expires_at clearly in the past
            // Use SQLite-compatible format (datetime('now') returns 'YYYY-MM-DD HH:MM:SS')
            db.prepare(`
        INSERT INTO summaries (market_id, summary_text, model, generated_at, expires_at)
        VALUES (?, ?, ?, datetime('now'), '2020-01-01 00:00:00')
      `).run("test-123", "Expired summary", "old-model");

            const cached = getCachedSummary(db, "test-123");
            expect(cached).toBeNull();
        });
    });
});
