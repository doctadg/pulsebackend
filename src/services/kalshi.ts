/**
 * Kalshi Data Fetching Service
 * Server-side client for the Kalshi prediction market API.
 * Fetches events and markets and syncs to local SQLite cache.
 */

import { upsertKalshiEvents, getKalshiEventCount } from "../db.js";
import type Database from "better-sqlite3";

const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// ─── Types ─────────────────────────────────────────────────────

export interface KalshiMarketAPI {
    ticker: string;
    event_ticker: string;
    market_type: string;
    title: string;
    subtitle: string;
    yes_bid: number;
    yes_ask: number;
    no_bid: number;
    no_ask: number;
    last_price: number;
    previous_yes_bid: number;
    previous_yes_ask: number;
    previous_price: number;
    volume: number;
    volume_24h: number;
    liquidity: number;
    open_interest: number;
    open_time: string;
    close_time: string;
    expiration_time: string;
    status: "open" | "active" | "closed" | "settled";
    result?: "yes" | "no" | null;
    strike_type?: string;
    floor_strike?: number;
    cap_strike?: number;
    category: string;
    risk_limit_cents: number;
    rules_primary: string;
    rules_secondary: string;
}

export interface KalshiEventAPI {
    event_ticker: string;
    series_ticker: string;
    title: string;
    subtitle: string;
    mutually_exclusive: boolean;
    category: string;
    markets: KalshiMarketAPI[];
}

interface KalshiEventsResponse {
    events: KalshiEventAPI[];
    cursor: string;
}

interface KalshiMarketsResponse {
    markets: KalshiMarketAPI[];
    cursor: string;
}

// ─── Fetch Functions ───────────────────────────────────────────

export async function fetchKalshiEvents(
    limit: number = 200,
    status: string = "open"
): Promise<KalshiEventAPI[]> {
    const url = `${KALSHI_API_BASE}/events?limit=${limit}&status=${status}&with_nested_markets=true`;

    console.log(`[kalshi] Fetching events from ${url}`);

    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "PulseGlobus-Server/1.0",
        },
    });

    if (!response.ok) {
        throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as KalshiEventsResponse;
    return data.events || [];
}

export async function fetchKalshiMarkets(
    limit: number = 200,
    status: string = "open"
): Promise<KalshiMarketAPI[]> {
    const url = `${KALSHI_API_BASE}/markets?limit=${limit}&status=${status}`;

    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "User-Agent": "PulseGlobus-Server/1.0",
        },
    });

    if (!response.ok) {
        throw new Error(`Kalshi API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as KalshiMarketsResponse;
    return data.markets || [];
}

// ─── Sync to Database ──────────────────────────────────────────

export interface KalshiSyncResult {
    eventsFetched: number;
    eventsUpserted: number;
    totalCached: number;
    durationMs: number;
}

export async function syncKalshi(database: Database.Database): Promise<KalshiSyncResult> {
    const start = Date.now();

    console.log("[kalshi] Syncing events from Kalshi API...");
    const events = await fetchKalshiEvents(200);

    // Filter to meaningful categories (skip heavy sports/parlays)
    const filteredEvents = events.filter((e) => {
        const sportKeywords = ["nba", "nfl", "mlb", "nhl", "ufc", "premier league", "la liga"];
        const title = e.title?.toLowerCase() || "";
        return !sportKeywords.some((kw) => title.includes(kw));
    });

    const eventsUpserted = upsertKalshiEvents(database, filteredEvents);
    const totalCached = getKalshiEventCount(database);

    const durationMs = Date.now() - start;
    console.log(
        `[kalshi] Sync complete: fetched=${events.length}, filtered=${filteredEvents.length}, upserted=${eventsUpserted}, totalCached=${totalCached}, duration=${durationMs}ms`
    );

    return {
        eventsFetched: events.length,
        eventsUpserted,
        totalCached,
        durationMs,
    };
}
