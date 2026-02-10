/**
 * Geocoding Test Script
 * Fetches real markets from Polymarket and geocodes them via Gemini 3 Flash.
 * Run: npx tsx src/services/geocoding-test.ts
 */

import "dotenv/config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const GAMMA_API_BASE = "https://gamma-api.polymarket.com";
const BUILDER_API_KEY = process.env.POLYMARKET_BUILDER_API_KEY || "019be474-bdb7-7d8d-9267-2d7322159eb4";

interface GeoResult {
    index: number;
    latitude: number;
    longitude: number;
    city: string;
    country: string;
    confidence: number;
}

async function fetchRealMarkets(limit: number = 50): Promise<any[]> {
    const url = `${GAMMA_API_BASE}/markets?limit=${limit}&active=true&closed=false&archived=false&order=volume&ascending=false`;
    const res = await fetch(url, {
        headers: { "X-Builder-Api-Key": BUILDER_API_KEY },
    });
    if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);
    return res.json() as Promise<any[]>;
}

function buildBatchGeocodePrompt(markets: { index: number; question: string; description: string; category: string }[]): string {
    const marketBlock = markets
        .map((m) => `[${m.index}] "${m.question}" (category: ${m.category || "general"})`)
        .join("\n");

    return `You are a geolocation classifier for prediction markets. For each market below, determine the PRIMARY geographic location most relevant to the market's subject matter.

RULES:
- Pick the city/region most directly tied to the market's topic (e.g. a US politics market → Washington DC, a Ukraine war market → Kyiv, a crypto market → New York or San Francisco)
- For person-specific markets, use the city most associated with their current role (e.g. a sitting US president → Washington DC)
- For global/abstract markets (e.g. "Will AI achieve X?"), pick the city of the most relevant institution or industry hub
- Every market MUST get a location — never return null. Use your best judgment for ambiguous cases
- Confidence: 90-100 = clearly about a specific place, 60-89 = reasonable geographic association, 30-59 = loosely associated

MARKETS:
${marketBlock}

Respond with ONLY a valid JSON array, no markdown fences, no explanation:
[{"index": <number>, "latitude": <number>, "longitude": <number>, "city": "<string>", "country": "<string>", "confidence": <number>}]`;
}

async function geocodeBatch(markets: { index: number; question: string; description: string; category: string }[]): Promise<GeoResult[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

    const prompt = buildBatchGeocodePrompt(markets);

    const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": "https://pulseglobus.com",
            "X-Title": "PulseGlobus Geocoding Test",
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: "You are a geographic classification specialist. You determine the most relevant real-world location for prediction market questions. You always respond with valid JSON arrays only, no markdown.",
                },
                { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 4000,
        }),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} — ${errBody}`);
    }

    const json: any = await response.json();
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response from AI model");

    const cleanContent = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleanContent) as GeoResult[];
}

// ─── Main Test ─────────────────────────────────────────────────

async function main() {
    console.log(`\n🌍 PulseGlobus Geocoding Test`);
    console.log(`   Model: ${MODEL}`);
    console.log(`   Fetching real markets from Polymarket...\n`);

    const rawMarkets = await fetchRealMarkets(50);
    console.log(`   ✓ Fetched ${rawMarkets.length} markets\n`);

    // Prepare markets for geocoding
    const marketsForGeo = rawMarkets.map((m: any, i: number) => ({
        index: i,
        question: m.question,
        description: (m.description || "").slice(0, 200),
        category: m.category || "general",
    }));

    // Process in batches of 10
    const BATCH_SIZE = 10;
    const allResults: GeoResult[] = [];
    const batches = Math.ceil(marketsForGeo.length / BATCH_SIZE);

    for (let b = 0; b < batches; b++) {
        const batch = marketsForGeo.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
        console.log(`   📡 Geocoding batch ${b + 1}/${batches} (${batch.length} markets)...`);

        try {
            const results = await geocodeBatch(batch);
            allResults.push(...results);
            console.log(`      ✓ Got ${results.length} results`);
        } catch (err) {
            console.error(`      ✗ Batch ${b + 1} failed:`, err);
        }

        // Rate limit
        if (b < batches - 1) {
            await new Promise((r) => setTimeout(r, 1500));
        }
    }

    // ─── Results Summary ───────────────────────────────────────

    console.log(`\n${"═".repeat(100)}`);
    console.log(`GEOCODING RESULTS: ${allResults.length}/${rawMarkets.length} markets geocoded`);
    console.log(`${"═".repeat(100)}\n`);

    // Print results table
    console.log(`${"#".padEnd(4)} ${"Question".padEnd(55)} ${"City".padEnd(20)} ${"Country".padEnd(15)} ${"Lat".padEnd(10)} ${"Lng".padEnd(10)} ${"Conf".padEnd(5)}`);
    console.log("─".repeat(120));

    for (const result of allResults) {
        const market = rawMarkets[result.index];
        const question = (market?.question || "???").slice(0, 52);
        console.log(
            `${String(result.index).padEnd(4)} ${question.padEnd(55)} ${(result.city || "?").padEnd(20)} ${(result.country || "?").padEnd(15)} ${String(result.latitude?.toFixed(4)).padEnd(10)} ${String(result.longitude?.toFixed(4)).padEnd(10)} ${String(result.confidence).padEnd(5)}`
        );
    }

    // ─── Stats ─────────────────────────────────────────────────

    const confidences = allResults.map((r) => r.confidence);
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const highConf = confidences.filter((c) => c >= 70).length;
    const medConf = confidences.filter((c) => c >= 40 && c < 70).length;
    const lowConf = confidences.filter((c) => c < 40).length;

    // Check geographic spread
    const uniqueCountries = new Set(allResults.map((r) => r.country));
    const uniqueCities = new Set(allResults.map((r) => r.city));

    console.log(`\n${"═".repeat(60)}`);
    console.log(`STATISTICS`);
    console.log(`${"═".repeat(60)}`);
    console.log(`  Total geocoded:      ${allResults.length}/${rawMarkets.length}`);
    console.log(`  Success rate:        ${((allResults.length / rawMarkets.length) * 100).toFixed(1)}%`);
    console.log(`  Avg confidence:      ${avgConfidence.toFixed(1)}`);
    console.log(`  High conf (≥70):     ${highConf} (${((highConf / allResults.length) * 100).toFixed(1)}%)`);
    console.log(`  Medium conf (40-69): ${medConf} (${((medConf / allResults.length) * 100).toFixed(1)}%)`);
    console.log(`  Low conf (<40):      ${lowConf} (${((lowConf / allResults.length) * 100).toFixed(1)}%)`);
    console.log(`  Unique countries:    ${uniqueCountries.size}`);
    console.log(`  Unique cities:       ${uniqueCities.size}`);
    console.log(`  Countries:           ${[...uniqueCountries].sort().join(", ")}`);
    console.log(`${"═".repeat(60)}\n`);

    // Validate coordinates are reasonable
    let invalidCoords = 0;
    for (const r of allResults) {
        if (r.latitude < -90 || r.latitude > 90 || r.longitude < -180 || r.longitude > 180) {
            console.warn(`  ⚠ Invalid coordinates for market ${r.index}: ${r.latitude}, ${r.longitude}`);
            invalidCoords++;
        }
    }
    if (invalidCoords === 0) {
        console.log(`  ✓ All coordinates are valid (lat: -90..90, lng: -180..180)\n`);
    }
}

main().catch(console.error);
