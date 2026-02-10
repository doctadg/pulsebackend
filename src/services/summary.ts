/**
 * AI Summary Service
 * Generates and caches market analysis summaries using OpenRouter API.
 */

import { getCachedSummary, upsertSummary, getExpiredOrMissingSummaryMarketIds, getMarketById } from "../db.js";
import type Database from "better-sqlite3";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "x-ai/grok-4.1-fast";
const SUMMARY_TTL_HOURS = 24;

// ─── Summary Generation ────────────────────────────────────────

interface MarketSummaryInput {
    question: string;
    description?: string;
    category?: string;
    outcomes: string[];
    prices: number[];
    volume: number;
    volume24hr: number;
    volume1wk?: number;
    liquidity: number;
    endDate: string;
    active: boolean;
    bestBid?: number;
    bestAsk?: number;
    lastTradePrice?: number;
}

function formatUSD(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
}

function buildPrompt(data: MarketSummaryInput): string {
    const outcomesStr = data.outcomes
        .map((o, i) => `${o}: ${(data.prices[i] * 100).toFixed(1)}%`)
        .join(", ");

    const endDateFormatted = data.endDate
        ? new Date(data.endDate).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
        })
        : "N/A";

    return `You are writing an institutional-grade prediction market analysis brief. Produce a thorough, insightful analysis for a sophisticated trader. Do NOT simply repeat the data — synthesize context, implications, and what the odds reveal about market sentiment and real-world dynamics.

MARKET: "${data.question}"
CATEGORY: ${data.category || "General"}
DESCRIPTION: ${data.description || "N/A"}
STATUS: ${data.active ? "Active" : "Closed"}
RESOLUTION DATE: ${endDateFormatted}

OUTCOMES: ${outcomesStr}
TOTAL VOLUME: ${formatUSD(data.volume)}
24H VOLUME: ${formatUSD(data.volume24hr)}
${data.volume1wk ? `7D VOLUME: ${formatUSD(data.volume1wk)}` : ""}
LIQUIDITY: ${formatUSD(data.liquidity)}
${data.lastTradePrice ? `LAST TRADE: ${(data.lastTradePrice * 100).toFixed(1)}¢` : ""}

Structure your response EXACTLY as follows (use these exact headers):

OVERVIEW
A concise 2-3 sentence summary of the market, what it's pricing in, and the current consensus view.

BULL CASE
Present the strongest 2-3 arguments for the leading outcome. Reference real-world catalysts, trends, or data.

BEAR CASE
Present the strongest 2-3 arguments AGAINST the leading outcome. What risks or counter-narratives could flip the market?

KEY DRIVERS
Identify the 2-3 most important upcoming events or catalysts that will move this market.

RISK ASSESSMENT
One sentence rating the overall risk/reward. Comment on liquidity depth and volume trends.

Keep the tone sharp, professional, and data-driven. Use plain text with the headers above. No markdown formatting, no bullet points — flowing prose under each header.`;
}

async function callOpenRouter(prompt: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY not configured");
    }

    const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://pulseglobus.com",
            "X-Title": "PulseGlobus Backend",
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "You are a senior prediction market analyst at a top quantitative research firm. You produce institutional-grade market analysis briefs that synthesize data with real-world context. Your analyses include explicit bull and bear cases, identify key catalysts, and assess risk/reward. Your tone is sharp, professional, and confident. Use the section headers provided but write in clean flowing prose under each. Never use markdown formatting or bullet points.",
                },
                { role: "user", content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 1200,
        }),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} — ${errBody}`);
    }

    const json: any = await response.json();
    const content = json.choices?.[0]?.message?.content?.trim();

    if (!content) {
        throw new Error("Empty response from AI model");
    }

    return content;
}

// ─── Public API ────────────────────────────────────────────────

export async function getOrGenerateSummary(
    database: Database.Database,
    marketId: string
): Promise<{ summary: string; cached: boolean; model: string }> {
    // Check cache first
    const cached = getCachedSummary(database, marketId);
    if (cached) {
        return {
            summary: cached.summary_text,
            cached: true,
            model: cached.model,
        };
    }

    // Fetch market data from DB
    const market = getMarketById(database, marketId);
    if (!market) {
        throw new Error(`Market ${marketId} not found in cache. Run sync first.`);
    }

    // Build input from cached market data
    let outcomes: string[] = ["Yes", "No"];
    let prices: number[] = [0.5, 0.5];

    try {
        outcomes = JSON.parse(market.outcomes || '["Yes","No"]');
    } catch { /* use defaults */ }

    try {
        prices = JSON.parse(market.outcome_prices || '["0.5","0.5"]').map(Number);
    } catch { /* use defaults */ }

    const input: MarketSummaryInput = {
        question: market.question,
        description: market.description || undefined,
        category: market.category || undefined,
        outcomes,
        prices,
        volume: market.volume_num || 0,
        volume24hr: market.volume_24hr,
        volume1wk: market.volume_1wk || undefined,
        liquidity: market.liquidity_num || 0,
        endDate: market.end_date || "",
        active: market.active === 1,
        bestBid: market.best_bid || undefined,
        bestAsk: market.best_ask || undefined,
        lastTradePrice: market.last_trade_price || undefined,
    };

    const prompt = buildPrompt(input);
    const summaryText = await callOpenRouter(prompt);

    // Cache it
    upsertSummary(database, marketId, summaryText, MODEL, SUMMARY_TTL_HOURS);

    return {
        summary: summaryText,
        cached: false,
        model: MODEL,
    };
}

export async function autoSummarizeTopMarkets(
    database: Database.Database,
    count: number = 20
): Promise<{ generated: number; errors: number }> {
    const marketIds = getExpiredOrMissingSummaryMarketIds(database, count);

    console.log(`[summary] Auto-summarizing ${marketIds.length} markets...`);

    let generated = 0;
    let errors = 0;

    for (const marketId of marketIds) {
        try {
            await getOrGenerateSummary(database, marketId);
            generated++;
            console.log(`[summary] Generated summary for market ${marketId} (${generated}/${marketIds.length})`);

            // Rate limit: wait 2s between calls
            if (generated < marketIds.length) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } catch (err) {
            errors++;
            console.error(`[summary] Failed for market ${marketId}:`, err);
        }
    }

    console.log(`[summary] Auto-summarize complete: generated=${generated}, errors=${errors}`);
    return { generated, errors };
}
