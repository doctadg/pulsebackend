/**
 * Polymarket Data Fetching Service
 * Fetches market data from the Gamma API and syncs to local SQLite cache.
 */

import { upsertMarkets, getMarketCount } from "../db.js";
import type Database from "better-sqlite3";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const BUILDER_API_KEY = process.env.POLYMARKET_BUILDER_API_KEY || "019be474-bdb7-7d8d-9267-2d7322159eb4";

// ─── Types matching Polymarket API response ────────────────────

export interface PolymarketMarket {
    id: string;
    question: string;
    conditionId: string;
    slug: string;
    description: string;
    image: string;
    icon: string;
    category: string;
    startDate: string;
    endDate: string;
    outcomes: string;       // JSON string: '["Yes","No"]'
    outcomePrices: string;  // JSON string: '["0.85","0.15"]'
    volume: string;
    volumeNum: number;
    liquidity: string;
    liquidityNum: number;
    active: boolean;
    closed: boolean;
    archived: boolean;
    featured: boolean;
    volume24hr: number;
    volume1wk: number;
    volume1mo: number;
    bestBid: number;
    bestAsk: number;
    lastTradePrice: number;
    events: any[];
    categories: any[];
    tags: any[];
    [key: string]: any;
}

export interface PolymarketEvent {
    id: string;
    ticker: string;
    slug: string;
    title: string;
    description: string;
    startDate: string;
    endDate: string;
    image: string;
    active: boolean;
    closed: boolean;
    volume: number;
    liquidity: number;
    category: string;
    volume24hr: number;
    volume1wk: number;
    volume1mo: number;
    markets?: any[];
}

// ─── Fetch Functions ───────────────────────────────────────────

export async function fetchMarkets(
    limit: number = 300,
    active: boolean = true
): Promise<PolymarketMarket[]> {
    const url = `${GAMMA_API_BASE}/markets?limit=${limit}&active=${active}&closed=false&archived=false&order=volume&ascending=false`;

    const response = await fetch(url, {
        headers: {
            "X-Builder-Api-Key": BUILDER_API_KEY,
        },
    });

    if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<PolymarketMarket[]>;
}

export async function fetchMarketById(id: string): Promise<PolymarketMarket> {
    const url = `${GAMMA_API_BASE}/markets/${id}`;

    const response = await fetch(url, {
        headers: {
            "X-Builder-Api-Key": BUILDER_API_KEY,
        },
    });

    if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status} ${response.statusText} for market ${id}`);
    }

    return response.json() as Promise<PolymarketMarket>;
}

export async function fetchEvents(
    limit: number = 300,
    active: boolean = true
): Promise<PolymarketEvent[]> {
    const url = `${GAMMA_API_BASE}/events?active=${active}&closed=false&limit=${limit}&order=volume24hr&ascending=false`;

    const response = await fetch(url, {
        headers: {
            "X-Builder-Api-Key": BUILDER_API_KEY,
        },
    });

    if (!response.ok) {
        throw new Error(`Polymarket API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<PolymarketEvent[]>;
}

// ─── Sync to Database ──────────────────────────────────────────

export interface SyncResult {
    fetched: number;
    upserted: number;
    totalCached: number;
    durationMs: number;
}

export async function syncMarkets(database: Database.Database): Promise<SyncResult> {
    const start = Date.now();

    console.log("[polymarket] Syncing markets from Gamma API...");
    const markets = await fetchMarkets(300);

    const upserted = upsertMarkets(database, markets);
    const totalCached = getMarketCount(database);

    const durationMs = Date.now() - start;
    console.log(
        `[polymarket] Sync complete: fetched=${markets.length}, upserted=${upserted}, totalCached=${totalCached}, duration=${durationMs}ms`
    );

    return {
        fetched: markets.length,
        upserted,
        totalCached,
        durationMs,
    };
}

// ─── Validation Helpers (used in tests) ────────────────────────

export function validateMarketFields(market: any): string[] {
    const errors: string[] = [];
    const required = ["id", "question", "outcomes", "outcomePrices", "active"];

    for (const field of required) {
        if (market[field] === undefined || market[field] === null) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    // Validate outcomes is parseable JSON
    if (market.outcomes) {
        try {
            const parsed = JSON.parse(market.outcomes);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                errors.push("outcomes must be a non-empty JSON array");
            }
        } catch {
            errors.push(`outcomes is not valid JSON: ${market.outcomes}`);
        }
    }

    // Validate outcomePrices is parseable JSON with valid values
    if (market.outcomePrices) {
        try {
            const prices = JSON.parse(market.outcomePrices);
            if (!Array.isArray(prices) || prices.length === 0) {
                errors.push("outcomePrices must be a non-empty JSON array");
            } else {
                for (const p of prices) {
                    const num = parseFloat(p);
                    if (isNaN(num) || num < 0 || num > 1) {
                        errors.push(`outcomePrices value out of range [0,1]: ${p}`);
                    }
                }
            }
        } catch {
            errors.push(`outcomePrices is not valid JSON: ${market.outcomePrices}`);
        }
    }

    // Validate numeric fields
    if (typeof market.volume24hr === "number" && market.volume24hr < 0) {
        errors.push(`volume24hr is negative: ${market.volume24hr}`);
    }

    if (typeof market.volumeNum === "number" && market.volumeNum < 0) {
        errors.push(`volumeNum is negative: ${market.volumeNum}`);
    }

    return errors;
}
