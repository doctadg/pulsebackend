/**
 * Whale / Leaderboard API Routes
 * Proxies Polymarket leaderboard data with caching.
 */

import { Router, type Request, type Response } from "express";
import { fetchLeaderboard, getWhaleProfile } from "../services/whales.js";

export function createWhaleRoutes(): Router {
    const router = Router();

    // GET /api/whales — Top whales / leaderboard
    router.get("/", async (req: Request, res: Response) => {
        try {
            const timePeriod = (req.query.period as string || "ALL").toUpperCase();
            const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

            const validPeriods = ["DAY", "WEEK", "MONTH", "ALL"];
            const safePeriod = validPeriods.includes(timePeriod) ? timePeriod : "ALL";

            const whales = await fetchLeaderboard(safePeriod, limit);

            res.json({
                success: true,
                count: whales.length,
                period: safePeriod,
                whales,
            });
        } catch (err) {
            console.error("[routes/whales] GET / error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch whales" });
        }
    });

    // GET /api/whales/profile/:identifier — Single whale profile
    router.get("/profile/:identifier", async (req: Request, res: Response) => {
        try {
            const profile = await getWhaleProfile(req.params.identifier as string);

            if (!profile) {
                res.status(404).json({ success: false, error: "Whale not found" });
                return;
            }

            res.json({
                success: true,
                whale: profile,
            });
        } catch (err) {
            console.error("[routes/whales] GET /profile error:", err);
            res.status(500).json({ success: false, error: "Failed to fetch whale profile" });
        }
    });

    return router;
}
