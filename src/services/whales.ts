/**
 * Whale / Leaderboard Service
 * Fetches real Polymarket leaderboard data from the Data API
 * with in-memory caching to respect rate limits.
 */

const POLYMARKET_DATA_API = "https://data-api.polymarket.com";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface WhaleTrader {
    rank: number;
    address: string;
    username: string;
    profileImage: string;
    volume: number;
    pnl: number;
    xUsername: string;
    marketsTraded: number;
}

interface LeaderboardEntry {
    rank: number | string;
    proxyWallet?: string;
    address?: string;
    userName?: string;
    username?: string;
    displayUserName?: string;
    profileImage?: string;
    vol?: number;
    volume?: number;
    pnl?: number;
    profit?: number;
    xUserName?: string;
    xUsername?: string;
    marketsTraded?: number;
    markets_traded?: number;
}

interface CacheEntry {
    data: WhaleTrader[];
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCacheKey(timePeriod: string, limit: number): string {
    return `${timePeriod}_${limit}`;
}

export async function fetchLeaderboard(
    timePeriod: string = "ALL",
    limit: number = 10
): Promise<WhaleTrader[]> {
    const cacheKey = getCacheKey(timePeriod, limit);
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.data;
    }

    try {
        const url = `${POLYMARKET_DATA_API}/v1/leaderboard?timePeriod=${timePeriod}&orderBy=VOL&limit=${limit}`;
        console.log(`[whales] Fetching leaderboard: ${url}`);

        const res = await fetch(url, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "PulseGlobus/1.0",
            },
        });

        if (!res.ok) {
            console.error(`[whales] Leaderboard API returned ${res.status}: ${res.statusText}`);
            // Return cached even if stale
            if (cached) return cached.data;
            return [];
        }

        const rawData: any = await res.json();

        // The API may return an array directly or under a key
        const entries: LeaderboardEntry[] = Array.isArray(rawData)
            ? rawData
            : (rawData.leaderboard || rawData.data || rawData.traders || []);

        const whales: WhaleTrader[] = entries.map((entry, index) => ({
            rank: parseInt(String(entry.rank)) || index + 1,
            address: entry.proxyWallet || entry.address || "",
            username: entry.userName || entry.username || entry.displayUserName || "",
            profileImage: entry.profileImage || "",
            volume: entry.vol || entry.volume || 0,
            pnl: entry.pnl || entry.profit || 0,
            xUsername: entry.xUserName || entry.xUsername || "",
            marketsTraded: entry.marketsTraded || entry.markets_traded || 0,
        }));

        cache.set(cacheKey, { data: whales, fetchedAt: Date.now() });
        console.log(`[whales] Cached ${whales.length} whale traders for period=${timePeriod}`);

        return whales;
    } catch (err) {
        console.error("[whales] Failed to fetch leaderboard:", err);
        if (cached) return cached.data;
        return [];
    }
}

/**
 * Get the top whale profile by username or address.
 */
export async function getWhaleProfile(
    identifier: string
): Promise<WhaleTrader | null> {
    try {
        // Try by username first
        let url = `${POLYMARKET_DATA_API}/v1/leaderboard?userName=${encodeURIComponent(identifier)}&limit=1`;
        let res = await fetch(url, {
            headers: { "Accept": "application/json", "User-Agent": "PulseGlobus/1.0" },
        });

        if (res.ok) {
            const data: any = await res.json();
            const entries = Array.isArray(data) ? data : (data.leaderboard || data.data || []);
            if (entries.length > 0) {
                const e = entries[0] as LeaderboardEntry;
                return {
                    rank: parseInt(String(e.rank)) || 0,
                    address: e.proxyWallet || e.address || "",
                    username: e.userName || e.username || e.displayUserName || "",
                    profileImage: e.profileImage || "",
                    volume: e.vol || e.volume || 0,
                    pnl: e.pnl || e.profit || 0,
                    xUsername: e.xUserName || e.xUsername || "",
                    marketsTraded: e.marketsTraded || e.markets_traded || 0,
                };
            }
        }

        return null;
    } catch (err) {
        console.error("[whales] Failed to fetch profile:", err);
        return null;
    }
}
