/**
 * Market Geocoding Service
 * Uses Kimi K2.5 via OpenRouter Responses API with web search
 * to determine geographic locations for prediction markets.
 * Processes markets in batches and caches results.
 */

import {
    getUngeocodedMarketIds,
    upsertGeocode,
} from "../db.js";
import type Database from "better-sqlite3";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/responses";
const MODEL = "moonshotai/kimi-k2.5";
const GEOCODE_TTL_DAYS = 7;
const BATCH_SIZE = 10;

// ============================================================================
// PROMPT
// ============================================================================

interface GeoResult {
    index: number;
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    confidence: number;
}

function buildBatchGeocodePrompt(
    markets: { index: number; question: string; description: string; category: string }[]
): string {
    const marketBlock = markets
        .map((m) => `[${m.index}] "${m.question}" (category: ${m.category || "general"})`)
        .join("\n");

    return `You are a geographic classification specialist with web search capabilities. You determine the most relevant real-world location for prediction market questions. Use web search to verify current facts about people, events, and locations mentioned in these markets.

For each market below, determine the PRIMARY geographic location most relevant to the market's subject matter.

RULES:
- USE WEB SEARCH to look up current information about the people, events, or topics in each market to determine the most accurate location
- Pick the city/region most directly tied to the market's topic (e.g. a US politics market → Washington DC, a Ukraine war market → Kyiv, a crypto market → New York or San Francisco)
- For person-specific markets, search for the person's current role and location (e.g. a sitting US president → Washington DC, a CEO → their company's HQ city)
- For global/abstract markets (e.g. "Will AI achieve X?"), pick the city of the most relevant institution or industry hub
- Every market MUST get a location — never return null. Use your best judgment for ambiguous cases
- Confidence: 90-100 = clearly about a specific place, 60-89 = reasonable geographic association, 30-59 = loosely associated

MARKETS:
${marketBlock}

Respond with ONLY a valid JSON array, no markdown fences, no explanation:
[{"index": <number>, "latitude": <number>, "longitude": <number>, "city": "<string>", "country": "<string>", "confidence": <number>}]`;
}

// ============================================================================
// LLM CALL (OpenRouter Responses API + Web Search)
// ============================================================================

async function geocodeBatch(
    markets: { index: number; question: string; description: string; category: string }[]
): Promise<GeoResult[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.warn("[geocoding] No OPENROUTER_API_KEY configured");
        return [];
    }

    const prompt = buildBatchGeocodePrompt(markets);

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://pulseglobus.com",
                "X-Title": "PulseGlobus Geocoding",
            },
            body: JSON.stringify({
                model: MODEL,
                input: [
                    {
                        type: "message",
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: prompt,
                            },
                        ],
                    },
                ],
                plugins: [{ id: "web", max_results: 3 }],
                max_output_tokens: 5000,
            }),
        });

        if (!response.ok) {
            console.error("[geocoding] OpenRouter Responses API error:", response.status);
            return [];
        }

        const json: any = await response.json();

        // Responses API format: output[].content[].text
        const msgOutput = json.output?.find((o: any) => o.type === "message");
        const textContent = msgOutput?.content?.find((c: any) => c.type === "output_text");
        const content = textContent?.text?.trim();
        if (!content) return [];

        const cleanContent = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const results = JSON.parse(cleanContent) as GeoResult[];

        // Validate coordinates
        return results.filter(
            (r) =>
                typeof r.latitude === "number" &&
                typeof r.longitude === "number" &&
                r.latitude >= -90 &&
                r.latitude <= 90 &&
                r.longitude >= -180 &&
                r.longitude <= 180
        );
    } catch (err) {
        console.error("[geocoding] LLM call error:", err);
        return [];
    }
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

export async function autoGeocodeMarkets(
    database: Database.Database,
    maxMarkets: number = 50
): Promise<{ geocoded: number; errors: number }> {
    const ungeocoded = getUngeocodedMarketIds(database, maxMarkets);

    if (ungeocoded.length === 0) {
        console.log("[geocoding] All markets geocoded");
        return { geocoded: 0, errors: 0 };
    }

    console.log(`[geocoding] Processing ${ungeocoded.length} ungeocoded markets...`);

    let geocoded = 0;
    let errors = 0;
    const batches = Math.ceil(ungeocoded.length / BATCH_SIZE);

    for (let b = 0; b < batches; b++) {
        const batch = ungeocoded.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        const marketsForGeo = batch.map((m, i) => ({
            index: i,
            question: m.question,
            description: (m.description || "").slice(0, 200),
            category: m.category || "general",
        }));

        console.log(`[geocoding] Batch ${b + 1}/${batches} (${batch.length} markets)...`);

        try {
            const results = await geocodeBatch(marketsForGeo);

            for (const result of results) {
                const market = batch[result.index];
                if (!market) continue;

                upsertGeocode(database, {
                    marketId: market.id,
                    latitude: result.latitude,
                    longitude: result.longitude,
                    city: result.city || null,
                    country: result.country || null,
                    confidence: result.confidence || 50,
                    model: MODEL,
                    ttlDays: GEOCODE_TTL_DAYS,
                });

                geocoded++;
            }

            console.log(`[geocoding] ✓ Batch ${b + 1}: ${results.length} geocoded`);
        } catch (err) {
            errors++;
            console.error(`[geocoding] ✗ Batch ${b + 1} failed:`, err);
        }

        // Rate limit between batches
        if (b < batches - 1) {
            await new Promise((r) => setTimeout(r, 1500));
        }
    }

    console.log(`[geocoding] Complete: geocoded=${geocoded}, errors=${errors}`);
    return { geocoded, errors };
}
