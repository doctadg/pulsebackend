/**
 * Market Routes Tests
 * Tests Express API endpoints using supertest.
 */

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createTestDb, upsertMarket, upsertMarkets, upsertSummary } from "../db.js";
import { createMarketRoutes } from "./markets.js";
import type Database from "better-sqlite3";

function makeMockMarket(overrides: Partial<any> = {}): any {
    return {
        id: "test-123",
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
        archived: false,
        featured: false,
        volume24hr: 25000,
        volume1wk: 150000,
        volume1mo: 500000,
        bestBid: 0.74,
        bestAsk: 0.76,
        lastTradePrice: 0.75,
        events: [],
        categories: [{ id: "cat-1", label: "Testing", slug: "testing" }],
        tags: [],
        ...overrides,
    };
}

describe("Market API Routes", () => {
    let db: Database.Database;
    let app: express.Express;

    beforeEach(() => {
        db = createTestDb();
        app = express();
        app.use(express.json());
        app.use("/api/markets", createMarketRoutes(db));
    });

    describe("GET /api/markets", () => {
        it("should return empty list when no markets exist", async () => {
            const res = await request(app).get("/api/markets");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.count).toBe(0);
            expect(res.body.markets).toEqual([]);
        });

        it("should return cached markets", async () => {
            upsertMarkets(db, [
                makeMockMarket({ id: "m1", question: "Q1" }),
                makeMockMarket({ id: "m2", question: "Q2" }),
            ]);

            const res = await request(app).get("/api/markets");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.count).toBe(2);
            expect(res.body.markets).toHaveLength(2);
        });

        it("should return camelCase field names", async () => {
            upsertMarket(db, makeMockMarket());

            const res = await request(app).get("/api/markets");
            const market = res.body.markets[0];

            expect(market.conditionId).toBe("0xabc123");
            expect(market.startDate).toBe("2026-01-01T00:00:00Z");
            expect(market.endDate).toBe("2026-12-31T23:59:59Z");
            expect(market.volume24hr).toBe(25000);
            expect(market.lastTradePrice).toBe(0.75);
            expect(market.active).toBe(true);
            expect(market.closed).toBe(false);
        });

        it("should support limit parameter", async () => {
            const markets = Array.from({ length: 20 }, (_, i) =>
                makeMockMarket({ id: `m${i}`, question: `Q${i}` })
            );
            upsertMarkets(db, markets);

            const res = await request(app).get("/api/markets?limit=5");
            expect(res.body.count).toBe(5);
        });

        it("should support category filter", async () => {
            upsertMarkets(db, [
                makeMockMarket({ id: "c1", category: "Crypto" }),
                makeMockMarket({ id: "p1", category: "Politics" }),
                makeMockMarket({ id: "c2", category: "Crypto" }),
            ]);

            const res = await request(app).get("/api/markets?category=Crypto");
            expect(res.body.count).toBe(2);
        });

        it("should parse events and categories from JSON", async () => {
            upsertMarket(db, makeMockMarket());

            const res = await request(app).get("/api/markets");
            const market = res.body.markets[0];

            expect(Array.isArray(market.categories)).toBe(true);
            expect(market.categories[0].label).toBe("Testing");
        });
    });

    describe("GET /api/markets/:id", () => {
        it("should return 404 for nonexistent market", async () => {
            const res = await request(app).get("/api/markets/nonexistent");
            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        it("should return a single market by ID", async () => {
            upsertMarket(db, makeMockMarket());

            const res = await request(app).get("/api/markets/test-123");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.market.id).toBe("test-123");
            expect(res.body.market.question).toBe("Will test pass?");
        });
    });

    describe("GET /api/markets/:id/summary", () => {
        it("should return cached summary when available", async () => {
            upsertMarket(db, makeMockMarket());
            upsertSummary(db, "test-123", "Cached analysis", "test-model", 24);

            const res = await request(app).get("/api/markets/test-123/summary");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.summary).toBe("Cached analysis");
            expect(res.body.cached).toBe(true);
        });

        it("should return 404 for market not in cache", async () => {
            const res = await request(app).get("/api/markets/nonexistent/summary");
            expect(res.status).toBe(404);
        });
    });
});
