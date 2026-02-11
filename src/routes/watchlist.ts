/**
 * Watchlist API Routes
 * REST endpoints for managing market and whale watchlists.
 */

import { Router, type Request, type Response } from "express";
import {
    getWatchedMarkets,
    getWatchedMarketIds,
    addMarketToWatchlist,
    removeMarketFromWatchlist,
    isMarketWatched,
    getWatchedWhales,
    addWhaleToWatchlist,
    removeWhaleFromWatchlist,
    isWhaleWatched,
    getFullWatchlist,
} from "../services/watchlist.js";

export function createWatchlistRoutes(): Router {
    const router = Router();

    // ─── Full Watchlist ────────────────────────────────────────

    // GET /api/watchlist — Get full watchlist (markets + whales)
    router.get("/", (_req: Request, res: Response) => {
        try {
            const watchlist = getFullWatchlist();
            res.json({
                success: true,
                ...watchlist,
                marketCount: watchlist.markets.length,
                whaleCount: watchlist.whales.length,
            });
        } catch (err) {
            console.error("[routes/watchlist] GET / error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch watchlist" });
        }
    });

    // ─── Market Watchlist ──────────────────────────────────────

    // GET /api/watchlist/markets — Get watched market IDs
    router.get("/markets", (_req: Request, res: Response) => {
        try {
            const markets = getWatchedMarkets();
            res.json({
                success: true,
                count: markets.length,
                markets,
                ids: markets.map((m) => m.id),
            });
        } catch (err) {
            console.error("[routes/watchlist] GET /markets error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch market watchlist" });
        }
    });

    // GET /api/watchlist/markets/:id — Check if market is watched
    router.get("/markets/:id", (req: Request, res: Response) => {
        try {
            const watched = isMarketWatched(req.params.id as string);
            res.json({ success: true, marketId: req.params.id, watched });
        } catch (err) {
            console.error("[routes/watchlist] GET /markets/:id error:", err);
            res.status(500).json({ success: false, error: "Failed to check market" });
        }
    });

    // POST /api/watchlist/markets — Add a market to watchlist
    router.post("/markets", (req: Request, res: Response) => {
        try {
            const { marketId, note } = req.body;
            if (!marketId) {
                res.status(400).json({ success: false, error: "marketId is required" });
                return;
            }
            const result = addMarketToWatchlist(marketId, note);
            res.json({
                success: true,
                ...result,
                count: result.watchlist.length,
            });
        } catch (err) {
            console.error("[routes/watchlist] POST /markets error:", err);
            res.status(500).json({ success: false, error: "Failed to add market to watchlist" });
        }
    });

    // DELETE /api/watchlist/markets/:id — Remove a market from watchlist
    router.delete("/markets/:id", (req: Request, res: Response) => {
        try {
            const result = removeMarketFromWatchlist(req.params.id as string);
            res.json({
                success: true,
                ...result,
                count: result.watchlist.length,
            });
        } catch (err) {
            console.error("[routes/watchlist] DELETE /markets/:id error:", err);
            res.status(500).json({ success: false, error: "Failed to remove market from watchlist" });
        }
    });

    // ─── Whale Watchlist ───────────────────────────────────────

    // GET /api/watchlist/whales — Get watched whales
    router.get("/whales", (_req: Request, res: Response) => {
        try {
            const whales = getWatchedWhales();
            res.json({
                success: true,
                count: whales.length,
                whales,
            });
        } catch (err) {
            console.error("[routes/watchlist] GET /whales error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch whale watchlist" });
        }
    });

    // GET /api/watchlist/whales/:address — Check if whale is watched
    router.get("/whales/:address", (req: Request, res: Response) => {
        try {
            const watched = isWhaleWatched(req.params.address as string);
            res.json({ success: true, address: req.params.address, watched });
        } catch (err) {
            console.error("[routes/watchlist] GET /whales/:address error:", err);
            res.status(500).json({ success: false, error: "Failed to check whale" });
        }
    });

    // POST /api/watchlist/whales — Add a whale to watchlist
    router.post("/whales", (req: Request, res: Response) => {
        try {
            const { address, username, note } = req.body;
            if (!address) {
                res.status(400).json({ success: false, error: "address is required" });
                return;
            }
            const result = addWhaleToWatchlist(address, username, note);
            res.json({
                success: true,
                ...result,
                count: result.watchlist.length,
            });
        } catch (err) {
            console.error("[routes/watchlist] POST /whales error:", err);
            res.status(500).json({ success: false, error: "Failed to add whale to watchlist" });
        }
    });

    // DELETE /api/watchlist/whales/:address — Remove a whale from watchlist
    router.delete("/whales/:address", (req: Request, res: Response) => {
        try {
            const result = removeWhaleFromWatchlist(req.params.address as string);
            res.json({
                success: true,
                ...result,
                count: result.watchlist.length,
            });
        } catch (err) {
            console.error("[routes/watchlist] DELETE /whales/:address error:", err);
            res.status(500).json({ success: false, error: "Failed to remove whale from watchlist" });
        }
    });

    return router;
}
