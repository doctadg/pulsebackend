/**
 * Watchlist Service
 * Manages a JSON-based watchlist for markets and whales.
 * Data is persisted in data/watchlist.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");

/* ─── Types ─── */

export interface WatchlistData {
    markets: WatchlistMarket[];
    whales: WatchlistWhale[];
}

export interface WatchlistMarket {
    id: string;
    addedAt: string;       // ISO timestamp
    note?: string;         // optional user note
}

export interface WatchlistWhale {
    address: string;
    username?: string;
    addedAt: string;
    note?: string;
}

/* ─── File I/O ─── */

function ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function readWatchlist(): WatchlistData {
    ensureDataDir();
    try {
        if (fs.existsSync(WATCHLIST_FILE)) {
            const raw = fs.readFileSync(WATCHLIST_FILE, "utf-8");
            const data = JSON.parse(raw);
            return {
                markets: Array.isArray(data.markets) ? data.markets : [],
                whales: Array.isArray(data.whales) ? data.whales : [],
            };
        }
    } catch (err) {
        console.error("[watchlist] Error reading watchlist file:", err);
    }
    return { markets: [], whales: [] };
}

function writeWatchlist(data: WatchlistData): void {
    ensureDataDir();
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/* ─── Market Watchlist Operations ─── */

export function getWatchedMarkets(): WatchlistMarket[] {
    return readWatchlist().markets;
}

export function getWatchedMarketIds(): string[] {
    return readWatchlist().markets.map((m) => m.id);
}

export function isMarketWatched(marketId: string): boolean {
    return readWatchlist().markets.some((m) => m.id === marketId);
}

export function addMarketToWatchlist(
    marketId: string,
    note?: string
): { added: boolean; watchlist: WatchlistMarket[] } {
    const data = readWatchlist();
    const exists = data.markets.some((m) => m.id === marketId);
    if (exists) {
        return { added: false, watchlist: data.markets };
    }
    const entry: WatchlistMarket = {
        id: marketId,
        addedAt: new Date().toISOString(),
        ...(note ? { note } : {}),
    };
    data.markets.push(entry);
    writeWatchlist(data);
    return { added: true, watchlist: data.markets };
}

export function removeMarketFromWatchlist(
    marketId: string
): { removed: boolean; watchlist: WatchlistMarket[] } {
    const data = readWatchlist();
    const before = data.markets.length;
    data.markets = data.markets.filter((m) => m.id !== marketId);
    if (data.markets.length < before) {
        writeWatchlist(data);
        return { removed: true, watchlist: data.markets };
    }
    return { removed: false, watchlist: data.markets };
}

export function clearMarketWatchlist(): void {
    const data = readWatchlist();
    data.markets = [];
    writeWatchlist(data);
}

/* ─── Whale Watchlist Operations ─── */

export function getWatchedWhales(): WatchlistWhale[] {
    return readWatchlist().whales;
}

export function isWhaleWatched(address: string): boolean {
    return readWatchlist().whales.some(
        (w) => w.address.toLowerCase() === address.toLowerCase()
    );
}

export function addWhaleToWatchlist(
    address: string,
    username?: string,
    note?: string
): { added: boolean; watchlist: WatchlistWhale[] } {
    const data = readWatchlist();
    const exists = data.whales.some(
        (w) => w.address.toLowerCase() === address.toLowerCase()
    );
    if (exists) {
        return { added: false, watchlist: data.whales };
    }
    const entry: WatchlistWhale = {
        address,
        addedAt: new Date().toISOString(),
        ...(username ? { username } : {}),
        ...(note ? { note } : {}),
    };
    data.whales.push(entry);
    writeWatchlist(data);
    return { added: true, watchlist: data.whales };
}

export function removeWhaleFromWatchlist(
    address: string
): { removed: boolean; watchlist: WatchlistWhale[] } {
    const data = readWatchlist();
    const before = data.whales.length;
    data.whales = data.whales.filter(
        (w) => w.address.toLowerCase() !== address.toLowerCase()
    );
    if (data.whales.length < before) {
        writeWatchlist(data);
        return { removed: true, watchlist: data.whales };
    }
    return { removed: false, watchlist: data.whales };
}

export function clearWhaleWatchlist(): void {
    const data = readWatchlist();
    data.whales = [];
    writeWatchlist(data);
}

/* ─── Full Watchlist ─── */

export function getFullWatchlist(): WatchlistData {
    return readWatchlist();
}
