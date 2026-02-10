/**
 * Polymarket Integration Tests
 * Tests hit the REAL Polymarket Gamma API to validate data quality and structure.
 * These are integration tests — they require network access.
 */

import { describe, it, expect } from "vitest";
import { fetchMarkets, fetchMarketById, fetchEvents, validateMarketFields } from "./polymarket.js";

describe("Polymarket API Integration", () => {
    describe("fetchMarkets", () => {
        it("should return at least 50 active markets", async () => {
            const markets = await fetchMarkets(100);

            console.log(`[test] Fetched ${markets.length} markets from Polymarket`);
            expect(markets.length).toBeGreaterThanOrEqual(50);
        });

        it("should return markets with all required fields", async () => {
            const markets = await fetchMarkets(50);

            for (const market of markets.slice(0, 20)) {
                const errors = validateMarketFields(market);
                if (errors.length > 0) {
                    console.error(`Market ${market.id} validation errors:`, errors);
                }
                expect(errors).toHaveLength(0);
            }
        });

        it("should have valid outcome prices (parseable JSON, values 0-1)", async () => {
            const markets = await fetchMarkets(50);

            for (const market of markets.slice(0, 20)) {
                expect(market.outcomePrices).toBeDefined();

                const prices = JSON.parse(market.outcomePrices);
                expect(Array.isArray(prices)).toBe(true);
                expect(prices.length).toBeGreaterThan(0);

                for (const p of prices) {
                    const num = parseFloat(p);
                    expect(num).toBeGreaterThanOrEqual(0);
                    expect(num).toBeLessThanOrEqual(1);
                }
            }
        });

        it("should have valid outcomes (parseable JSON array of strings)", async () => {
            const markets = await fetchMarkets(50);

            for (const market of markets.slice(0, 20)) {
                expect(market.outcomes).toBeDefined();

                const outcomes = JSON.parse(market.outcomes);
                expect(Array.isArray(outcomes)).toBe(true);
                expect(outcomes.length).toBeGreaterThan(0);

                for (const o of outcomes) {
                    expect(typeof o).toBe("string");
                    expect(o.length).toBeGreaterThan(0);
                }
            }
        });

        it("should return only active, non-closed markets", async () => {
            const markets = await fetchMarkets(100);

            for (const market of markets) {
                expect(market.active).toBe(true);
                expect(market.closed).toBe(false);
            }
        });

        it("should have positive volume and liquidity for top markets", async () => {
            const markets = await fetchMarkets(50);

            // At least the top 10 by volume should have meaningful numbers
            const topMarkets = markets.slice(0, 10);
            for (const market of topMarkets) {
                expect(market.volumeNum).toBeGreaterThan(0);
                // liquidityNum might be 0 for some markets
                expect(typeof market.liquidityNum).toBe("number");
            }
        });

        it("should have valid date fields", async () => {
            const markets = await fetchMarkets(20);

            for (const market of markets) {
                if (market.endDate) {
                    const date = new Date(market.endDate);
                    expect(date.toString()).not.toBe("Invalid Date");
                }

                if (market.startDate) {
                    const date = new Date(market.startDate);
                    expect(date.toString()).not.toBe("Invalid Date");
                }
            }
        });

        it("should have matching outcomes and prices array lengths", async () => {
            const markets = await fetchMarkets(50);

            for (const market of markets.slice(0, 20)) {
                const outcomes = JSON.parse(market.outcomes);
                const prices = JSON.parse(market.outcomePrices);
                expect(outcomes.length).toBe(prices.length);
            }
        });

        it("should have valid slug fields", async () => {
            const markets = await fetchMarkets(20);

            for (const market of markets) {
                expect(market.slug).toBeDefined();
                expect(typeof market.slug).toBe("string");
                expect(market.slug.length).toBeGreaterThan(0);
            }
        });

        it("should have string IDs", async () => {
            const markets = await fetchMarkets(20);

            for (const market of markets) {
                expect(typeof market.id).toBe("string");
                expect(market.id.length).toBeGreaterThan(0);
            }
        });

        it("should have conditionId for on-chain reference", async () => {
            const markets = await fetchMarkets(20);

            // Most markets should have conditionId
            const withCondition = markets.filter((m) => m.conditionId);
            expect(withCondition.length).toBeGreaterThan(markets.length * 0.5);
        });

        it("should return category field when available", async () => {
            const markets = await fetchMarkets(50);

            // Log category distribution (some markets may not have categories)
            const categories = new Map<string, number>();
            for (const m of markets) {
                const cat = m.category || "uncategorized";
                categories.set(cat, (categories.get(cat) || 0) + 1);
            }
            console.log("[test] Category distribution:", Object.fromEntries(categories));

            // category field should exist (even if empty string)
            for (const m of markets) {
                expect(typeof m.category === "string" || m.category === undefined || m.category === null).toBe(true);
            }
        });

        it("should return volume metrics", async () => {
            const markets = await fetchMarkets(20);

            for (const market of markets) {
                // volumeNum should always be a number
                expect(typeof market.volumeNum).toBe("number");
                expect(market.volumeNum).toBeGreaterThanOrEqual(0);

                // volume24hr may or may not exist depending on the endpoint
                if (market.volume24hr !== undefined) {
                    expect(typeof market.volume24hr).toBe("number");
                }
            }
        });

        it("should have bestBid and bestAsk for active markets", async () => {
            const markets = await fetchMarkets(20);

            // Top markets should have bid/ask data
            const top5 = markets.slice(0, 5);
            for (const market of top5) {
                expect(typeof market.bestBid).toBe("number");
                expect(typeof market.bestAsk).toBe("number");
            }
        });
    });

    describe("fetchMarketById", () => {
        it("should fetch a specific market by ID", async () => {
            // First get a real market ID from the list
            const markets = await fetchMarkets(5);
            const firstId = markets[0].id;

            const market = await fetchMarketById(firstId);

            expect(market).toBeDefined();
            expect(market.id).toBe(firstId);
            expect(market.question).toBeDefined();
            expect(market.outcomes).toBeDefined();
            expect(market.outcomePrices).toBeDefined();
        });

        it("should have complete data for single market fetch", async () => {
            const markets = await fetchMarkets(5);
            const market = await fetchMarketById(markets[0].id);

            // Single market should have all the detail fields
            expect(market.description).toBeDefined();
            expect(market.image).toBeDefined();
            expect(market.slug).toBeDefined();

            const errors = validateMarketFields(market);
            expect(errors).toHaveLength(0);
        });

        it("should throw for invalid market ID", async () => {
            await expect(fetchMarketById("totally-invalid-id-999999")).rejects.toThrow();
        });
    });

    describe("fetchEvents", () => {
        it("should return events", async () => {
            const events = await fetchEvents(50);

            console.log(`[test] Fetched ${events.length} events from Polymarket`);
            expect(events.length).toBeGreaterThan(0);
        });

        it("should have required event fields", async () => {
            const events = await fetchEvents(20);

            for (const event of events.slice(0, 10)) {
                expect(event.id).toBeDefined();
                expect(event.title).toBeDefined();
                expect(typeof event.title).toBe("string");
                expect(event.title.length).toBeGreaterThan(0);
            }
        });

        it("should include nested markets when available", async () => {
            const events = await fetchEvents(50);

            // Some events should have nested markets
            const withMarkets = events.filter((e) => e.markets && e.markets.length > 0);
            console.log(`[test] ${withMarkets.length}/${events.length} events have nested markets`);

            // At least some should have markets
            expect(withMarkets.length).toBeGreaterThan(0);

            // Verify nested market structure
            const eventWithMarkets = withMarkets[0];
            const nestedMarket = eventWithMarkets.markets![0];
            expect(nestedMarket.id).toBeDefined();
            expect(nestedMarket.question).toBeDefined();
        });

        it("should return only active events", async () => {
            const events = await fetchEvents(20);

            for (const event of events) {
                expect(event.active).toBe(true);
                expect(event.closed).toBe(false);
            }
        });
    });

    describe("Data Consistency", () => {
        it("should have consistent market data between list and detail endpoints", async () => {
            const markets = await fetchMarkets(5);
            const listMarket = markets[0];
            const detailMarket = await fetchMarketById(listMarket.id);

            // Core fields should match
            expect(detailMarket.question).toBe(listMarket.question);
            expect(detailMarket.slug).toBe(listMarket.slug);
            expect(detailMarket.category).toBe(listMarket.category);
            expect(detailMarket.active).toBe(listMarket.active);
        });

        it("should handle large batch fetches without errors", async () => {
            // Test fetching the max batch size we'll use in production
            const markets = await fetchMarkets(300);

            expect(markets.length).toBeGreaterThan(0);
            console.log(`[test] Successfully fetched ${markets.length} markets in batch`);

            // Validate a random sample
            const sampleSize = Math.min(10, markets.length);
            for (let i = 0; i < sampleSize; i++) {
                const idx = Math.floor(Math.random() * markets.length);
                const errors = validateMarketFields(markets[idx]);
                expect(errors).toHaveLength(0);
            }
        });
    });
});
