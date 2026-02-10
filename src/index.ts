/**
 * PulseGlobus Backend Server
 * Express server with Polymarket caching, Kalshi integration,
 * AI summary generation, and LLM-based market matching.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import { getDb } from "./db.js";
import { createMarketRoutes } from "./routes/markets.js";
import { createKalshiRoutes } from "./routes/kalshi.js";
import { syncMarkets } from "./services/polymarket.js";
import { autoSummarizeTopMarkets } from "./services/summary.js";
import { syncKalshi } from "./services/kalshi.js";
import { autoMatchMarkets } from "./services/matching.js";
import { autoGeocodeMarkets } from "./services/geocoding.js";

const PORT = parseInt(process.env.PORT || "3001");
const app = express();

// ─── Middleware ─────────────────────────────────────────────────

app.use(cors({
    origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",")
        : ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    methods: ["GET", "POST"],
}));

app.use(express.json());

// ─── Database ──────────────────────────────────────────────────

const db = getDb();

// ─── Routes ────────────────────────────────────────────────────

app.use("/api/markets", createMarketRoutes(db));
app.use("/api/kalshi", createKalshiRoutes(db));

// Health check
app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// ─── Scheduled Jobs ────────────────────────────────────────────

// Sync Polymarket markets every 5 minutes
cron.schedule("*/5 * * * *", async () => {
    try {
        await syncMarkets(db);
    } catch (err) {
        console.error("[cron] Polymarket sync failed:", err);
    }
});

// Sync Kalshi events every 5 minutes
cron.schedule("*/5 * * * *", async () => {
    try {
        await syncKalshi(db);
    } catch (err) {
        console.error("[cron] Kalshi sync failed:", err);
    }
});

// Auto-match Polymarket↔Kalshi every 10 minutes
cron.schedule("*/10 * * * *", async () => {
    try {
        await autoMatchMarkets(db, 30);
    } catch (err) {
        console.error("[cron] Auto-match failed:", err);
    }
});

// Auto-summarize top markets every 30 minutes
cron.schedule("*/30 * * * *", async () => {
    try {
        await autoSummarizeTopMarkets(db, 20);
    } catch (err) {
        console.error("[cron] Auto-summarize failed:", err);
    }
});

// Auto-geocode markets every 10 minutes
cron.schedule("*/10 * * * *", async () => {
    try {
        await autoGeocodeMarkets(db, 50);
    } catch (err) {
        console.error("[cron] Auto-geocode failed:", err);
    }
});

// ─── Startup ───────────────────────────────────────────────────

async function startup() {
    console.log(`
╔══════════════════════════════════════════╗
║   PulseGlobus Backend Server             ║
║   Port: ${PORT}                            ║
╚══════════════════════════════════════════╝
  `);

    // Initial Polymarket sync
    try {
        console.log("[startup] Running initial Polymarket sync...");
        const result = await syncMarkets(db);
        console.log(`[startup] Polymarket sync complete: ${result.fetched} markets cached in ${result.durationMs}ms`);
    } catch (err) {
        console.error("[startup] Polymarket sync failed:", err);
        console.log("[startup] Server will continue — markets will sync on next cron tick");
    }

    // Initial Kalshi sync
    try {
        console.log("[startup] Running initial Kalshi sync...");
        const result = await syncKalshi(db);
        console.log(`[startup] Kalshi sync complete: ${result.eventsFetched} events fetched, ${result.eventsUpserted} upserted in ${result.durationMs}ms`);
    } catch (err) {
        console.error("[startup] Kalshi sync failed:", err);
        console.log("[startup] Server will continue — Kalshi events will sync on next cron tick");
    }

    // Initial auto-match after both syncs complete
    try {
        console.log("[startup] Running initial auto-match...");
        const matchResult = await autoMatchMarkets(db, 30);
        console.log(`[startup] Auto-match complete: matched=${matchResult.matched}, noMatch=${matchResult.noMatch}, errors=${matchResult.errors}`);
    } catch (err) {
        console.error("[startup] Auto-match failed:", err);
    }

    // Initial geocoding
    try {
        console.log("[startup] Running initial geocoding...");
        const geoResult = await autoGeocodeMarkets(db, 50);
        console.log(`[startup] Geocoding complete: geocoded=${geoResult.geocoded}, errors=${geoResult.errors}`);
    } catch (err) {
        console.error("[startup] Geocoding failed:", err);
    }

    app.listen(PORT, () => {
        console.log(`[startup] Server listening on http://localhost:${PORT}`);
        console.log(`[startup] API: http://localhost:${PORT}/api/markets`);
        console.log(`[startup] Kalshi: http://localhost:${PORT}/api/kalshi`);
        console.log(`[startup] Health: http://localhost:${PORT}/api/health`);
    });
}

startup();

export { app };
