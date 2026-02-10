/**
 * SQLite Database Layer
 * Manages market and summary caching with better-sqlite3.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database;

export function getDb(dbPath?: string): Database.Database {
    if (db) return db;

    const resolvedPath = dbPath || path.join(__dirname, "..", "data", "pulseglobus.db");

    // Ensure data directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(resolvedPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    initTables(db);
    return db;
}

export function createTestDb(): Database.Database {
    const testDb = new Database(":memory:");
    testDb.pragma("foreign_keys = ON");
    initTables(testDb);
    return testDb;
}

function initTables(database: Database.Database): void {
    database.exec(`
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      condition_id TEXT,
      slug TEXT,
      description TEXT,
      image TEXT,
      icon TEXT,
      category TEXT,
      start_date TEXT,
      end_date TEXT,
      outcomes TEXT,         -- JSON string
      outcome_prices TEXT,   -- JSON string
      volume TEXT,
      volume_num REAL,
      liquidity TEXT,
      liquidity_num REAL,
      active INTEGER DEFAULT 1,
      closed INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      featured INTEGER DEFAULT 0,
      volume_24hr REAL DEFAULT 0,
      volume_1wk REAL DEFAULT 0,
      volume_1mo REAL DEFAULT 0,
      best_bid REAL DEFAULT 0,
      best_ask REAL DEFAULT 0,
      last_trade_price REAL DEFAULT 0,
      events_json TEXT,      -- JSON string of events array
      categories_json TEXT,  -- JSON string of categories
      tags_json TEXT,        -- JSON string of tags
      raw_json TEXT,         -- Full raw API response
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      model TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kalshi_events (
      event_ticker TEXT PRIMARY KEY,
      series_ticker TEXT,
      title TEXT NOT NULL,
      subtitle TEXT,
      mutually_exclusive INTEGER DEFAULT 0,
      category TEXT,
      markets_json TEXT,       -- JSON array of nested markets
      raw_json TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kalshi_markets (
      ticker TEXT PRIMARY KEY,
      event_ticker TEXT,
      market_type TEXT,
      title TEXT NOT NULL,
      subtitle TEXT,
      yes_bid INTEGER DEFAULT 0,
      yes_ask INTEGER DEFAULT 0,
      no_bid INTEGER DEFAULT 0,
      no_ask INTEGER DEFAULT 0,
      last_price INTEGER DEFAULT 0,
      volume INTEGER DEFAULT 0,
      volume_24h INTEGER DEFAULT 0,
      open_interest INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      category TEXT,
      close_time TEXT,
      rules_primary TEXT,
      rules_secondary TEXT,
      raw_json TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_ticker) REFERENCES kalshi_events(event_ticker) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS market_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      polymarket_id TEXT NOT NULL,
      polymarket_question TEXT NOT NULL,
      kalshi_event_ticker TEXT,
      kalshi_market_ticker TEXT,
      kalshi_event_title TEXT,
      similarity REAL DEFAULT 0,
      confidence INTEGER DEFAULT 0,
      match_method TEXT DEFAULT 'entity',
      matched_entities TEXT,   -- JSON array of matched entity strings
      reasoning TEXT,
      matched_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (polymarket_id) REFERENCES markets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS market_geocodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL UNIQUE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      city TEXT,
      country TEXT,
      confidence INTEGER DEFAULT 0,
      model TEXT NOT NULL,
      geocoded_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_markets_active ON markets(active, closed);
    CREATE INDEX IF NOT EXISTS idx_markets_volume ON markets(volume_24hr DESC);
    CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
    CREATE INDEX IF NOT EXISTS idx_summaries_market ON summaries(market_id);
    CREATE INDEX IF NOT EXISTS idx_summaries_expires ON summaries(expires_at);
    CREATE INDEX IF NOT EXISTS idx_kalshi_events_category ON kalshi_events(category);
    CREATE INDEX IF NOT EXISTS idx_kalshi_markets_event ON kalshi_markets(event_ticker);
    CREATE INDEX IF NOT EXISTS idx_kalshi_markets_status ON kalshi_markets(status);
    CREATE INDEX IF NOT EXISTS idx_market_matches_poly ON market_matches(polymarket_id);
    CREATE INDEX IF NOT EXISTS idx_market_matches_kalshi ON market_matches(kalshi_event_ticker);
    CREATE INDEX IF NOT EXISTS idx_market_matches_expires ON market_matches(expires_at);
    CREATE INDEX IF NOT EXISTS idx_geocodes_market ON market_geocodes(market_id);
    CREATE INDEX IF NOT EXISTS idx_geocodes_expires ON market_geocodes(expires_at);
  `);
}

// ─── Market CRUD ───────────────────────────────────────────────

export interface MarketRow {
    id: string;
    question: string;
    condition_id: string | null;
    slug: string | null;
    description: string | null;
    image: string | null;
    icon: string | null;
    category: string | null;
    start_date: string | null;
    end_date: string | null;
    outcomes: string | null;
    outcome_prices: string | null;
    volume: string | null;
    volume_num: number | null;
    liquidity: string | null;
    liquidity_num: number | null;
    active: number;
    closed: number;
    archived: number;
    featured: number;
    volume_24hr: number;
    volume_1wk: number;
    volume_1mo: number;
    best_bid: number;
    best_ask: number;
    last_trade_price: number;
    events_json: string | null;
    categories_json: string | null;
    tags_json: string | null;
    raw_json: string | null;
    fetched_at: string;
    updated_at: string;
}

export interface SummaryRow {
    id: number;
    market_id: string;
    summary_text: string;
    model: string;
    generated_at: string;
    expires_at: string;
}

export function upsertMarket(database: Database.Database, market: any): void {
    const stmt = database.prepare(`
    INSERT INTO markets (
      id, question, condition_id, slug, description, image, icon, category,
      start_date, end_date, outcomes, outcome_prices, volume, volume_num,
      liquidity, liquidity_num, active, closed, archived, featured,
      volume_24hr, volume_1wk, volume_1mo, best_bid, best_ask,
      last_trade_price, events_json, categories_json, tags_json, raw_json,
      fetched_at, updated_at
    ) VALUES (
      @id, @question, @condition_id, @slug, @description, @image, @icon, @category,
      @start_date, @end_date, @outcomes, @outcome_prices, @volume, @volume_num,
      @liquidity, @liquidity_num, @active, @closed, @archived, @featured,
      @volume_24hr, @volume_1wk, @volume_1mo, @best_bid, @best_ask,
      @last_trade_price, @events_json, @categories_json, @tags_json, @raw_json,
      datetime('now'), datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      question = excluded.question,
      condition_id = excluded.condition_id,
      slug = excluded.slug,
      description = excluded.description,
      image = excluded.image,
      icon = excluded.icon,
      category = excluded.category,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      outcomes = excluded.outcomes,
      outcome_prices = excluded.outcome_prices,
      volume = excluded.volume,
      volume_num = excluded.volume_num,
      liquidity = excluded.liquidity,
      liquidity_num = excluded.liquidity_num,
      active = excluded.active,
      closed = excluded.closed,
      archived = excluded.archived,
      featured = excluded.featured,
      volume_24hr = excluded.volume_24hr,
      volume_1wk = excluded.volume_1wk,
      volume_1mo = excluded.volume_1mo,
      best_bid = excluded.best_bid,
      best_ask = excluded.best_ask,
      last_trade_price = excluded.last_trade_price,
      events_json = excluded.events_json,
      categories_json = excluded.categories_json,
      tags_json = excluded.tags_json,
      raw_json = excluded.raw_json,
      updated_at = datetime('now')
  `);

    stmt.run({
        id: market.id,
        question: market.question || "",
        condition_id: market.conditionId || null,
        slug: market.slug || null,
        description: market.description || null,
        image: market.image || null,
        icon: market.icon || null,
        category: market.category || null,
        start_date: market.startDate || null,
        end_date: market.endDate || null,
        outcomes: market.outcomes || null,
        outcome_prices: market.outcomePrices || null,
        volume: market.volume || null,
        volume_num: market.volumeNum || 0,
        liquidity: market.liquidity || null,
        liquidity_num: market.liquidityNum || 0,
        active: market.active ? 1 : 0,
        closed: market.closed ? 1 : 0,
        archived: market.archived ? 1 : 0,
        featured: market.featured ? 1 : 0,
        volume_24hr: market.volume24hr || 0,
        volume_1wk: market.volume1wk || 0,
        volume_1mo: market.volume1mo || 0,
        best_bid: market.bestBid || 0,
        best_ask: market.bestAsk || 0,
        last_trade_price: market.lastTradePrice || 0,
        events_json: market.events ? JSON.stringify(market.events) : null,
        categories_json: market.categories ? JSON.stringify(market.categories) : null,
        tags_json: market.tags ? JSON.stringify(market.tags) : null,
        raw_json: JSON.stringify(market),
    });
}

export function upsertMarkets(database: Database.Database, markets: any[]): number {
    const transaction = database.transaction((items: any[]) => {
        for (const market of items) {
            upsertMarket(database, market);
        }
        return items.length;
    });
    return transaction(markets);
}

export function getMarkets(
    database: Database.Database,
    options: { limit?: number; category?: string; order?: string } = {}
): MarketRow[] {
    const { limit = 100, category, order = "volume_24hr" } = options;
    const allowedOrders = ["volume_24hr", "volume_1wk", "volume_num", "liquidity_num", "last_trade_price"];
    const safeOrder = allowedOrders.includes(order) ? order : "volume_24hr";

    let sql = `SELECT * FROM markets WHERE active = 1 AND closed = 0`;
    const params: any[] = [];

    if (category) {
        sql += ` AND category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY ${safeOrder} DESC LIMIT ?`;
    params.push(limit);

    return database.prepare(sql).all(...params) as MarketRow[];
}

export function getMarketById(database: Database.Database, id: string): MarketRow | undefined {
    return database.prepare("SELECT * FROM markets WHERE id = ?").get(id) as MarketRow | undefined;
}

export function getMarketCount(database: Database.Database): number {
    const row = database.prepare("SELECT COUNT(*) as count FROM markets WHERE active = 1 AND closed = 0").get() as { count: number };
    return row.count;
}

// ─── Summary CRUD ──────────────────────────────────────────────

export function upsertSummary(
    database: Database.Database,
    marketId: string,
    summaryText: string,
    model: string,
    ttlHours: number = 24
): void {
    // Delete old summaries for this market
    database.prepare("DELETE FROM summaries WHERE market_id = ?").run(marketId);

    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    database.prepare(`
    INSERT INTO summaries (market_id, summary_text, model, generated_at, expires_at)
    VALUES (?, ?, ?, datetime('now'), ?)
  `).run(marketId, summaryText, model, expiresAt);
}

export function getCachedSummary(database: Database.Database, marketId: string): SummaryRow | null {
    const row = database.prepare(`
    SELECT * FROM summaries
    WHERE market_id = ? AND expires_at > datetime('now')
    ORDER BY generated_at DESC LIMIT 1
  `).get(marketId) as SummaryRow | undefined;

    return row || null;
}

export function getExpiredOrMissingSummaryMarketIds(
    database: Database.Database,
    limit: number = 20
): string[] {
    const rows = database.prepare(`
    SELECT m.id FROM markets m
    LEFT JOIN summaries s ON m.id = s.market_id AND s.expires_at > datetime('now')
    WHERE m.active = 1 AND m.closed = 0 AND s.id IS NULL
    ORDER BY m.volume_24hr DESC
    LIMIT ?
  `).all(limit) as { id: string }[];

    return rows.map(r => r.id);
}

// ─── Kalshi Event/Market CRUD ──────────────────────────────────

export interface KalshiEventRow {
    event_ticker: string;
    series_ticker: string | null;
    title: string;
    subtitle: string | null;
    mutually_exclusive: number;
    category: string | null;
    markets_json: string | null;
    raw_json: string | null;
    fetched_at: string;
    updated_at: string;
}

export interface KalshiMarketRow {
    ticker: string;
    event_ticker: string | null;
    market_type: string | null;
    title: string;
    subtitle: string | null;
    yes_bid: number;
    yes_ask: number;
    no_bid: number;
    no_ask: number;
    last_price: number;
    volume: number;
    volume_24h: number;
    open_interest: number;
    status: string;
    category: string | null;
    close_time: string | null;
    rules_primary: string | null;
    rules_secondary: string | null;
    raw_json: string | null;
    fetched_at: string;
    updated_at: string;
}

export interface MarketMatchRow {
    id: number;
    polymarket_id: string;
    polymarket_question: string;
    kalshi_event_ticker: string | null;
    kalshi_market_ticker: string | null;
    kalshi_event_title: string | null;
    similarity: number;
    confidence: number;
    match_method: string;
    matched_entities: string | null;
    reasoning: string | null;
    matched_at: string;
    expires_at: string;
}

export function upsertKalshiEvent(database: Database.Database, event: any): void {
    database.prepare(`
    INSERT INTO kalshi_events (
      event_ticker, series_ticker, title, subtitle, mutually_exclusive,
      category, markets_json, raw_json, fetched_at, updated_at
    ) VALUES (
      @event_ticker, @series_ticker, @title, @subtitle, @mutually_exclusive,
      @category, @markets_json, @raw_json, datetime('now'), datetime('now')
    )
    ON CONFLICT(event_ticker) DO UPDATE SET
      series_ticker = excluded.series_ticker,
      title = excluded.title,
      subtitle = excluded.subtitle,
      mutually_exclusive = excluded.mutually_exclusive,
      category = excluded.category,
      markets_json = excluded.markets_json,
      raw_json = excluded.raw_json,
      updated_at = datetime('now')
  `).run({
        event_ticker: event.event_ticker,
        series_ticker: event.series_ticker || null,
        title: event.title || "",
        subtitle: event.subtitle || null,
        mutually_exclusive: event.mutually_exclusive ? 1 : 0,
        category: event.category || null,
        markets_json: event.markets ? JSON.stringify(event.markets) : null,
        raw_json: JSON.stringify(event),
    });
}

export function upsertKalshiMarket(database: Database.Database, market: any): void {
    database.prepare(`
    INSERT INTO kalshi_markets (
      ticker, event_ticker, market_type, title, subtitle,
      yes_bid, yes_ask, no_bid, no_ask, last_price,
      volume, volume_24h, open_interest, status, category,
      close_time, rules_primary, rules_secondary, raw_json,
      fetched_at, updated_at
    ) VALUES (
      @ticker, @event_ticker, @market_type, @title, @subtitle,
      @yes_bid, @yes_ask, @no_bid, @no_ask, @last_price,
      @volume, @volume_24h, @open_interest, @status, @category,
      @close_time, @rules_primary, @rules_secondary, @raw_json,
      datetime('now'), datetime('now')
    )
    ON CONFLICT(ticker) DO UPDATE SET
      event_ticker = excluded.event_ticker,
      market_type = excluded.market_type,
      title = excluded.title,
      subtitle = excluded.subtitle,
      yes_bid = excluded.yes_bid,
      yes_ask = excluded.yes_ask,
      no_bid = excluded.no_bid,
      no_ask = excluded.no_ask,
      last_price = excluded.last_price,
      volume = excluded.volume,
      volume_24h = excluded.volume_24h,
      open_interest = excluded.open_interest,
      status = excluded.status,
      category = excluded.category,
      close_time = excluded.close_time,
      rules_primary = excluded.rules_primary,
      rules_secondary = excluded.rules_secondary,
      raw_json = excluded.raw_json,
      updated_at = datetime('now')
  `).run({
        ticker: market.ticker,
        event_ticker: market.event_ticker || null,
        market_type: market.market_type || null,
        title: market.title || "",
        subtitle: market.subtitle || null,
        yes_bid: market.yes_bid || 0,
        yes_ask: market.yes_ask || 0,
        no_bid: market.no_bid || 0,
        no_ask: market.no_ask || 0,
        last_price: market.last_price || 0,
        volume: market.volume || 0,
        volume_24h: market.volume_24h || 0,
        open_interest: market.open_interest || 0,
        status: market.status || "open",
        category: market.category || null,
        close_time: market.close_time || null,
        rules_primary: market.rules_primary || null,
        rules_secondary: market.rules_secondary || null,
        raw_json: JSON.stringify(market),
    });
}

export function upsertKalshiEvents(database: Database.Database, events: any[]): number {
    const transaction = database.transaction((items: any[]) => {
        let marketCount = 0;
        for (const event of items) {
            upsertKalshiEvent(database, event);
            // Also upsert nested markets
            if (event.markets && Array.isArray(event.markets)) {
                for (const market of event.markets) {
                    upsertKalshiMarket(database, market);
                    marketCount++;
                }
            }
        }
        return marketCount;
    });
    transaction(events);
    return events.length;
}

export function getKalshiEvents(
    database: Database.Database,
    options: { limit?: number; category?: string } = {}
): KalshiEventRow[] {
    const { limit = 200, category } = options;
    let sql = `SELECT * FROM kalshi_events`;
    const params: any[] = [];

    if (category) {
        sql += ` WHERE category = ?`;
        params.push(category);
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    return database.prepare(sql).all(...params) as KalshiEventRow[];
}

export function getKalshiMarkets(
    database: Database.Database,
    options: { limit?: number; status?: string } = {}
): KalshiMarketRow[] {
    const { limit = 200, status = "open" } = options;
    return database.prepare(
        `SELECT * FROM kalshi_markets WHERE status = ? ORDER BY volume_24h DESC LIMIT ?`
    ).all(status, limit) as KalshiMarketRow[];
}

export function getKalshiEventCount(database: Database.Database): number {
    const row = database.prepare("SELECT COUNT(*) as count FROM kalshi_events").get() as { count: number };
    return row.count;
}

// ─── Market Match CRUD ─────────────────────────────────────────

export function upsertMarketMatch(
    database: Database.Database,
    match: {
        polymarketId: string;
        polymarketQuestion: string;
        kalshiEventTicker: string | null;
        kalshiMarketTicker: string | null;
        kalshiEventTitle: string | null;
        similarity: number;
        confidence: number;
        matchMethod: string;
        matchedEntities: string[];
        reasoning: string | null;
        ttlHours?: number;
    }
): void {
    // Delete old matches for this polymarket
    database.prepare("DELETE FROM market_matches WHERE polymarket_id = ?").run(match.polymarketId);

    const expiresAt = new Date(Date.now() + (match.ttlHours || 24) * 60 * 60 * 1000).toISOString();

    database.prepare(`
    INSERT INTO market_matches (
      polymarket_id, polymarket_question, kalshi_event_ticker, kalshi_market_ticker,
      kalshi_event_title, similarity, confidence, match_method,
      matched_entities, reasoning, matched_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
        match.polymarketId,
        match.polymarketQuestion,
        match.kalshiEventTicker,
        match.kalshiMarketTicker,
        match.kalshiEventTitle,
        match.similarity,
        match.confidence,
        match.matchMethod,
        JSON.stringify(match.matchedEntities),
        match.reasoning,
        expiresAt,
    );
}

export function getMarketMatch(database: Database.Database, polymarketId: string): MarketMatchRow | null {
    const row = database.prepare(`
    SELECT * FROM market_matches
    WHERE polymarket_id = ? AND expires_at > datetime('now')
    ORDER BY matched_at DESC LIMIT 1
  `).get(polymarketId) as MarketMatchRow | undefined;

    return row || null;
}

export function getAllMarketMatches(
    database: Database.Database,
    options: { limit?: number; minConfidence?: number } = {}
): MarketMatchRow[] {
    const { limit = 200, minConfidence = 0 } = options;
    return database.prepare(`
    SELECT * FROM market_matches
    WHERE expires_at > datetime('now') AND confidence >= ?
    ORDER BY confidence DESC LIMIT ?
  `).all(minConfidence, limit) as MarketMatchRow[];
}

export function getUnmatchedMarketIds(
    database: Database.Database,
    limit: number = 30
): { id: string; question: string }[] {
    return database.prepare(`
    SELECT m.id, m.question FROM markets m
    LEFT JOIN market_matches mm ON m.id = mm.polymarket_id AND mm.expires_at > datetime('now')
    WHERE m.active = 1 AND m.closed = 0 AND mm.id IS NULL
    ORDER BY m.volume_24hr DESC
    LIMIT ?
  `).all(limit) as { id: string; question: string }[];
}

// ─── Geocode CRUD ──────────────────────────────────────────────

export interface GeoRow {
    id: number;
    market_id: string;
    latitude: number;
    longitude: number;
    city: string | null;
    country: string | null;
    confidence: number;
    model: string;
    geocoded_at: string;
    expires_at: string;
}

export function upsertGeocode(
    database: Database.Database,
    geo: {
        marketId: string;
        latitude: number;
        longitude: number;
        city: string | null;
        country: string | null;
        confidence: number;
        model: string;
        ttlDays?: number;
    }
): void {
    const ttlDays = geo.ttlDays || 7;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

    database.prepare(`
    INSERT INTO market_geocodes (market_id, latitude, longitude, city, country, confidence, model, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_id) DO UPDATE SET
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      city = excluded.city,
      country = excluded.country,
      confidence = excluded.confidence,
      model = excluded.model,
      geocoded_at = datetime('now'),
      expires_at = excluded.expires_at
  `).run(
        geo.marketId,
        geo.latitude,
        geo.longitude,
        geo.city,
        geo.country,
        geo.confidence,
        geo.model,
        expiresAt,
    );
}

export function getCachedGeocode(database: Database.Database, marketId: string): GeoRow | null {
    const row = database.prepare(`
    SELECT * FROM market_geocodes
    WHERE market_id = ? AND expires_at > datetime('now')
    LIMIT 1
  `).get(marketId) as GeoRow | undefined;

    return row || null;
}

export function getUngeocodedMarketIds(
    database: Database.Database,
    limit: number = 50
): { id: string; question: string; description: string | null; category: string | null }[] {
    return database.prepare(`
    SELECT m.id, m.question, m.description, m.category FROM markets m
    LEFT JOIN market_geocodes g ON m.id = g.market_id AND g.expires_at > datetime('now')
    WHERE m.active = 1 AND m.closed = 0 AND g.id IS NULL
    ORDER BY m.volume_24hr DESC
    LIMIT ?
  `).all(limit) as { id: string; question: string; description: string | null; category: string | null }[];
}

export function getAllGeocodes(
    database: Database.Database,
    options: { limit?: number } = {}
): GeoRow[] {
    const { limit = 500 } = options;
    return database.prepare(`
    SELECT * FROM market_geocodes
    WHERE expires_at > datetime('now')
    ORDER BY geocoded_at DESC LIMIT ?
  `).all(limit) as GeoRow[];
}
