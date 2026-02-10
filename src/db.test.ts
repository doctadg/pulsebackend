/**
 * Database Layer Tests
 * Tests SQLite table creation, market CRUD, and summary CRUD.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
    createTestDb,
    upsertMarket,
    upsertMarkets,
    getMarkets,
    getMarketById,
    getMarketCount,
    upsertSummary,
    getCachedSummary,
    getExpiredOrMissingSummaryMarketIds,
} from "./db.js";
import type Database from "better-sqlite3";

function makeMockMarket(overrides: Partial<any> = {}): any {
    return {
        id: "test-123",
        question: "Will test pass?",
        conditionId: "0xabc123",
        slug: "will-test-pass",
        description: "A test market for unit testing",
        image: "https://example.com/img.png",
        icon: "https://example.com/icon.png",
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
        archived: false,
        featured: false,
        volume24hr: 25000,
        volume1wk: 150000,
        volume1mo: 500000,
        bestBid: 0.74,
        bestAsk: 0.76,
        lastTradePrice: 0.75,
        events: [{ id: "evt-1", title: "Test Event" }],
        categories: [{ id: "cat-1", label: "Testing", slug: "testing" }],
        tags: [{ id: "tag-1", label: "CI", slug: "ci" }],
        ...overrides,
    };
}

describe("Database Layer", () => {
    let db: Database.Database;

    beforeEach(() => {
        db = createTestDb();
    });

    describe("Table Initialization", () => {
        it("should create markets table", () => {
            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='markets'")
                .all() as any[];
            expect(tables).toHaveLength(1);
        });

        it("should create summaries table", () => {
            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='summaries'")
                .all() as any[];
            expect(tables).toHaveLength(1);
        });

        it("should create indexes", () => {
            const indexes = db
                .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
                .all() as any[];
            expect(indexes.length).toBeGreaterThanOrEqual(5);
        });
    });

    describe("Market CRUD", () => {
        it("should insert a market", () => {
            const market = makeMockMarket();
            upsertMarket(db, market);

            const row = getMarketById(db, "test-123");
            expect(row).toBeDefined();
            expect(row!.question).toBe("Will test pass?");
            expect(row!.category).toBe("Test");
            expect(row!.active).toBe(1);
            expect(row!.volume_24hr).toBe(25000);
        });

        it("should upsert (update) an existing market", () => {
            upsertMarket(db, makeMockMarket());
            upsertMarket(db, makeMockMarket({ question: "Updated question?" }));

            const row = getMarketById(db, "test-123");
            expect(row!.question).toBe("Updated question?");

            // Should still be only 1 row
            expect(getMarketCount(db)).toBe(1);
        });

        it("should bulk insert markets in a transaction", () => {
            const markets = [
                makeMockMarket({ id: "m1", question: "Q1" }),
                makeMockMarket({ id: "m2", question: "Q2" }),
                makeMockMarket({ id: "m3", question: "Q3" }),
            ];

            const count = upsertMarkets(db, markets);
            expect(count).toBe(3);
            expect(getMarketCount(db)).toBe(3);
        });

        it("should query markets with ordering", () => {
            upsertMarkets(db, [
                makeMockMarket({ id: "low", question: "Low vol", volume24hr: 100 }),
                makeMockMarket({ id: "high", question: "High vol", volume24hr: 999999 }),
                makeMockMarket({ id: "mid", question: "Mid vol", volume24hr: 5000 }),
            ]);

            const markets = getMarkets(db, { order: "volume_24hr", limit: 10 });
            expect(markets).toHaveLength(3);
            expect(markets[0].id).toBe("high");
            expect(markets[2].id).toBe("low");
        });

        it("should filter markets by category", () => {
            upsertMarkets(db, [
                makeMockMarket({ id: "crypto", category: "Crypto" }),
                makeMockMarket({ id: "politics", category: "Politics" }),
                makeMockMarket({ id: "crypto2", category: "Crypto" }),
            ]);

            const crypto = getMarkets(db, { category: "Crypto" });
            expect(crypto).toHaveLength(2);
            expect(crypto.every((m) => m.category === "Crypto")).toBe(true);
        });

        it("should handle limit parameter", () => {
            const markets = Array.from({ length: 50 }, (_, i) =>
                makeMockMarket({ id: `m${i}`, question: `Q${i}` })
            );
            upsertMarkets(db, markets);

            const limited = getMarkets(db, { limit: 10 });
            expect(limited).toHaveLength(10);
        });

        it("should preserve JSON fields correctly", () => {
            upsertMarket(db, makeMockMarket());
            const row = getMarketById(db, "test-123");

            // outcomes and outcome_prices should be stored as-is (JSON strings)
            expect(JSON.parse(row!.outcomes!)).toEqual(["Yes", "No"]);
            expect(JSON.parse(row!.outcome_prices!)).toEqual(["0.75", "0.25"]);

            // events_json should be serialized JSON
            const events = JSON.parse(row!.events_json!);
            expect(events[0].title).toBe("Test Event");
        });

        it("should store raw_json for future-proofing", () => {
            const market = makeMockMarket({ extraField: "bonus data" });
            upsertMarket(db, market);
            const row = getMarketById(db, "test-123");

            const raw = JSON.parse(row!.raw_json!);
            expect(raw.extraField).toBe("bonus data");
        });

        it("should exclude closed/inactive markets from count", () => {
            upsertMarkets(db, [
                makeMockMarket({ id: "active1" }),
                makeMockMarket({ id: "active2" }),
                makeMockMarket({ id: "closed", closed: true }),
                makeMockMarket({ id: "inactive", active: false }),
            ]);

            expect(getMarketCount(db)).toBe(2);
        });
    });

    describe("Summary CRUD", () => {
        beforeEach(() => {
            upsertMarket(db, makeMockMarket());
        });

        it("should insert a summary", () => {
            upsertSummary(db, "test-123", "This is a test summary.", "test-model", 24);

            const cached = getCachedSummary(db, "test-123");
            expect(cached).toBeDefined();
            expect(cached!.summary_text).toBe("This is a test summary.");
            expect(cached!.model).toBe("test-model");
        });

        it("should return null for missing summary", () => {
            const cached = getCachedSummary(db, "nonexistent");
            expect(cached).toBeNull();
        });

        it("should replace old summary on upsert", () => {
            upsertSummary(db, "test-123", "First summary", "model-v1", 24);
            upsertSummary(db, "test-123", "Second summary", "model-v2", 24);

            const cached = getCachedSummary(db, "test-123");
            expect(cached!.summary_text).toBe("Second summary");

            // Should only have 1 summary for this market
            const count = db.prepare("SELECT COUNT(*) as c FROM summaries WHERE market_id = 'test-123'").get() as any;
            expect(count.c).toBe(1);
        });

        it("should detect markets needing summaries", () => {
            upsertMarkets(db, [
                makeMockMarket({ id: "m1", volume24hr: 100000 }),
                makeMockMarket({ id: "m2", volume24hr: 50000 }),
                makeMockMarket({ id: "m3", volume24hr: 25000 }),
            ]);

            // Only summarize m1
            upsertSummary(db, "m1", "Summary for m1", "test", 24);

            const needingSummaries = getExpiredOrMissingSummaryMarketIds(db, 10);
            // m2, m3, and test-123 should need summaries (test-123 from beforeEach)
            expect(needingSummaries).toContain("m2");
            expect(needingSummaries).toContain("m3");
            expect(needingSummaries).not.toContain("m1");
        });
    });
});
