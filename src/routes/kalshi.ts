/**
 * Kalshi API Routes
 * Express routes for cached Kalshi data and market match results.
 */

import { Router, type Request, type Response } from "express";
import {
    getKalshiEvents,
    getKalshiMarkets,
    getMarketMatch,
    getAllMarketMatches,
    getMarketById,
    type KalshiEventRow,
    type KalshiMarketRow,
} from "../db.js";
import { syncKalshi } from "../services/kalshi.js";
import { getOrMatchMarket, autoMatchMarkets } from "../services/matching.js";
import type Database from "better-sqlite3";

export function createKalshiRoutes(database: Database.Database): Router {
    const router = Router();

    // GET /api/kalshi/events — List cached Kalshi events with nested markets
    router.get("/events", (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 200;
            const category = req.query.category as string | undefined;

            const events = getKalshiEvents(database, { limit, category });
            const formatted = events.map(formatKalshiEventRow);

            res.json({
                success: true,
                count: formatted.length,
                events: formatted,
            });
        } catch (err) {
            console.error("[routes/kalshi] GET /events error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch Kalshi events" });
        }
    });

    // GET /api/kalshi/markets — List cached Kalshi markets
    router.get("/markets", (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 200;
            const status = (req.query.status as string) || "open";

            const markets = getKalshiMarkets(database, { limit, status });

            res.json({
                success: true,
                count: markets.length,
                markets,
            });
        } catch (err) {
            console.error("[routes/kalshi] GET /markets error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch Kalshi markets" });
        }
    });

    // GET /api/kalshi/matches — List all Polymarket↔Kalshi matches
    router.get("/matches", (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 200;
            const minConfidence = parseInt(req.query.minConfidence as string) || 0;

            const matches = getAllMarketMatches(database, { limit, minConfidence });
            const formatted = matches.map((m) => ({
                ...m,
                matched_entities: m.matched_entities ? safeJsonParse(m.matched_entities, []) : [],
            }));

            res.json({
                success: true,
                count: formatted.length,
                matches: formatted,
            });
        } catch (err) {
            console.error("[routes/kalshi] GET /matches error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch matches" });
        }
    });

    // GET /api/kalshi/matches/:polymarketId — Get match for a specific Polymarket market
    router.get("/matches/:polymarketId", async (req: Request, res: Response) => {
        try {
            const polymarketId = req.params.polymarketId as string;

            // Check if we already have a cached match
            const cached = getMarketMatch(database, polymarketId);
            if (cached) {
                res.json({
                    success: true,
                    cached: true,
                    match: {
                        ...cached,
                        matched_entities: cached.matched_entities ? safeJsonParse(cached.matched_entities, []) : [],
                    },
                });
                return;
            }

            // No cache — try to match on-demand if we have the market question
            const market = getMarketById(database, polymarketId);
            if (!market) {
                res.status(404).json({
                    success: false,
                    error: "Market not found in cache. Ensure Polymarket sync has run.",
                });
                return;
            }

            const result = await getOrMatchMarket(database, polymarketId, market.question);

            res.json({
                success: true,
                cached: result.cached,
                match: {
                    polymarket_id: polymarketId,
                    polymarket_question: market.question,
                    kalshi_event_ticker: result.kalshiEventTicker,
                    kalshi_market_ticker: result.kalshiMarketTicker,
                    kalshi_event_title: result.kalshiEventTitle,
                    similarity: result.similarity,
                    confidence: result.confidence,
                    match_method: result.matchMethod,
                    matched_entities: result.matchedEntities,
                    reasoning: result.reasoning,
                },
            });
        } catch (err) {
            console.error(`[routes/kalshi] GET /matches/${req.params.polymarketId} error:`, err);
            res.status(500).json({ success: false, error: "Failed to find match" });
        }
    });

    // POST /api/kalshi/sync — Trigger manual Kalshi sync
    router.post("/sync", async (_req: Request, res: Response) => {
        try {
            const result = await syncKalshi(database);
            res.json({ success: true, ...result });
        } catch (err: any) {
            console.error("[routes/kalshi] POST /sync error:", err);
            res.status(500).json({ success: false, error: err.message || "Kalshi sync failed" });
        }
    });

    // POST /api/kalshi/match — Trigger manual matching run
    router.post("/match", async (_req: Request, res: Response) => {
        try {
            const result = await autoMatchMarkets(database);
            res.json({ success: true, ...result });
        } catch (err: any) {
            console.error("[routes/kalshi] POST /match error:", err);
            res.status(500).json({ success: false, error: err.message || "Matching failed" });
        }
    });

    return router;
}

// ─── Helpers ───────────────────────────────────────────────────

function formatKalshiEventRow(row: KalshiEventRow): any {
    return {
        event_ticker: row.event_ticker,
        series_ticker: row.series_ticker,
        title: row.title,
        subtitle: row.subtitle,
        mutually_exclusive: row.mutually_exclusive === 1,
        category: row.category,
        markets: safeJsonParse(row.markets_json, []),
        fetched_at: row.fetched_at,
        updated_at: row.updated_at,
    };
}

function safeJsonParse(json: string | null, fallback: any): any {
    if (!json) return fallback;
    try {
        return JSON.parse(json);
    } catch {
        return fallback;
    }
}
