/**
 * Market API Routes
 * Express routes for cached market data and AI summaries.
 */

import { Router, type Request, type Response } from "express";
import { getMarkets, getMarketById, getCachedGeocode, type MarketRow } from "../db.js";
import { syncMarkets } from "../services/polymarket.js";
import { getOrGenerateSummary } from "../services/summary.js";
import type Database from "better-sqlite3";

export function createMarketRoutes(database: Database.Database): Router {
    const router = Router();

    // GET /api/markets — List cached markets
    router.get("/", (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 100;
            const category = req.query.category as string | undefined;
            const order = req.query.order as string | undefined;

            const markets = getMarkets(database, { limit, category, order });

            // Transform DB rows back to frontend-friendly format, with geo data
            const formatted = markets.map((row) => {
                const base = formatMarketRow(row);
                const geo = getCachedGeocode(database, row.id);
                if (geo) {
                    base.latitude = geo.latitude;
                    base.longitude = geo.longitude;
                    base.geoCity = geo.city;
                    base.geoCountry = geo.country;
                    base.geoConfidence = geo.confidence;
                }
                return base;
            });

            res.json({
                success: true,
                count: formatted.length,
                markets: formatted,
            });
        } catch (err) {
            console.error("[routes/markets] GET / error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch markets" });
        }
    });

    // GET /api/markets/:id — Get single cached market
    router.get("/:id", (req: Request, res: Response) => {
        try {
            const market = getMarketById(database, req.params.id as string);

            if (!market) {
                res.status(404).json({ success: false, error: "Market not found" });
                return;
            }

            const formatted = formatMarketRow(market);
            const geo = getCachedGeocode(database, market.id);
            if (geo) {
                formatted.latitude = geo.latitude;
                formatted.longitude = geo.longitude;
                formatted.geoCity = geo.city;
                formatted.geoCountry = geo.country;
                formatted.geoConfidence = geo.confidence;
            }

            res.json({
                success: true,
                market: formatted,
            });
        } catch (err) {
            console.error(`[routes/markets] GET /${req.params.id} error:`, err);
            res.status(500).json({ success: false, error: "Failed to fetch market" });
        }
    });

    // GET /api/markets/:id/summary — Get AI summary (cached or generated)
    router.get("/:id/summary", async (req: Request, res: Response) => {
        try {
            const result = await getOrGenerateSummary(database, req.params.id as string);

            res.json({
                success: true,
                marketId: req.params.id,
                summary: result.summary,
                cached: result.cached,
                model: result.model,
            });
        } catch (err: any) {
            console.error(`[routes/markets] GET /${req.params.id}/summary error:`, err);
            const status = err.message?.includes("not found") ? 404 : 500;
            res.status(status).json({ success: false, error: err.message || "Failed to generate summary" });
        }
    });

    // POST /api/markets/sync — Trigger manual sync
    router.post("/sync", async (_req: Request, res: Response) => {
        try {
            const result = await syncMarkets(database);
            res.json({ success: true, ...result });
        } catch (err: any) {
            console.error("[routes/markets] POST /sync error:", err);
            res.status(500).json({ success: false, error: err.message || "Sync failed" });
        }
    });

    return router;
}

// ─── Helpers ───────────────────────────────────────────────────

function formatMarketRow(row: MarketRow): any {
    return {
        id: row.id,
        question: row.question,
        conditionId: row.condition_id,
        slug: row.slug,
        description: row.description,
        image: row.image,
        icon: row.icon,
        category: row.category,
        startDate: row.start_date,
        endDate: row.end_date,
        outcomes: row.outcomes,
        outcomePrices: row.outcome_prices,
        volume: row.volume,
        volumeNum: row.volume_num,
        liquidity: row.liquidity,
        liquidityNum: row.liquidity_num,
        active: row.active === 1,
        closed: row.closed === 1,
        archived: row.archived === 1,
        featured: row.featured === 1,
        volume24hr: row.volume_24hr,
        volume1wk: row.volume_1wk,
        volume1mo: row.volume_1mo,
        bestBid: row.best_bid,
        bestAsk: row.best_ask,
        lastTradePrice: row.last_trade_price,
        events: safeJsonParse(row.events_json, []),
        categories: safeJsonParse(row.categories_json, []),
        tags: safeJsonParse(row.tags_json, []),
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
