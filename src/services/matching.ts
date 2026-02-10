/**
 * Market Matching Service
 * Combines entity-based pre-filtering with LLM-powered semantic matching
 * to find corresponding Kalshi markets for each Polymarket question.
 * 
 * Ported from frontend's aiMatchingService.ts + arbitrageService.ts
 */

import {
    getKalshiEvents,
    getUnmatchedMarketIds,
    upsertMarketMatch,
    getMarketMatch,
    type KalshiEventRow,
} from "../db.js";
import type Database from "better-sqlite3";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.0-flash-001";
const MATCH_TTL_HOURS = 24;

// ============================================================================
// ENTITY EXTRACTION (ported from frontend arbitrageService.ts)
// ============================================================================

const ENTITY_PATTERNS: { category: string; patterns: RegExp[] }[] = [
    {
        category: "people",
        patterns: [
            /\b(trump|donald\s+trump)\b/gi,
            /\b(biden|joe\s+biden)\b/gi,
            /\b(harris|kamala)\b/gi,
            /\b(musk|elon\s+musk|elon)\b/gi,
            /\b(putin|vladimir\s+putin)\b/gi,
            /\b(xi\s+jinping|xi)\b/gi,
            /\b(zelensky|zelenskyy)\b/gi,
            /\b(powell|jerome\s+powell)\b/gi,
            /\b(desantis|ron\s+desantis)\b/gi,
            /\b(newsom|gavin\s+newsom)\b/gi,
            /\b(vance|jd\s+vance)\b/gi,
            /\b(ramaswamy|vivek)\b/gi,
            /\b(haley|nikki\s+haley)\b/gi,
            /\b(stephen\s+miran|miran)\b/gi,
            /\b(judy\s+shelton|shelton)\b/gi,
            /\b(kevin\s+warsh|warsh)\b/gi,
            /\b(kevin\s+hassett|hassett)\b/gi,
            /\b(christopher\s+waller|waller)\b/gi,
            /\b(michelle\s+bowman|bowman)\b/gi,
            /\b(rick\s+rieder|rieder)\b/gi,
        ],
    },
    {
        category: "orgs",
        patterns: [
            /\b(fed|federal\s+reserve|fomc)\b/gi,
            /\b(openai)\b/gi,
            /\b(spacex)\b/gi,
            /\b(tesla)\b/gi,
            /\b(nvidia)\b/gi,
            /\b(nato)\b/gi,
            /\bun\s|united\s+nations\b/gi,
            /\b(doge|department\s+of\s+government\s+efficiency)\b/gi,
        ],
    },
    {
        category: "places",
        patterns: [
            /\b(ukraine|ukrainian)\b/gi,
            /\b(russia|russian)\b/gi,
            /\b(china|chinese|beijing)\b/gi,
            /\b(iran|iranian|tehran)\b/gi,
            /\b(gaza|palestinian|hamas)\b/gi,
            /\b(israel|israeli)\b/gi,
            /\b(taiwan|taiwanese)\b/gi,
            /\b(north\s+korea|dprk|pyongyang)\b/gi,
            /\b(mexico|mexican)\b/gi,
            /\b(mars)\b/gi,
            /\b(u\.?k\.?|united\s+kingdom|britain)\b/gi,
        ],
    },
    {
        category: "topics",
        patterns: [
            /\b(shutdown|government\s+shutdown)\b/gi,
            /\b(interest\s+rate|rate\s+cut|rate\s+hike)\b/gi,
            /\b(inflation)\b/gi,
            /\b(recession)\b/gi,
            /\b(tariff|tariffs)\b/gi,
            /\b(impeach|impeachment)\b/gi,
            /\b(bitcoin|btc)\b/gi,
            /\b(ethereum|eth)\b/gi,
            /\b(ipo)\b/gi,
            /\b(ai\s+|artificial\s+intelligence)\b/gi,
            /\b(ceasefire)\b/gi,
            /\b(executive\s+order)\b/gi,
            /\b(nominate|nomination)\b/gi,
            /\b(leader|supreme\s+leader)\b/gi,
            /\b(successor)\b/gi,
        ],
    },
];

interface ExtractedEntity {
    value: string;
    category: string;
    normalized: string;
}

function extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    for (const group of ENTITY_PATTERNS) {
        for (const pattern of group.patterns) {
            const regex = new RegExp(pattern.source, pattern.flags);
            let match;
            while ((match = regex.exec(text)) !== null) {
                const value = match[1] || match[0];
                const normalized = normalizeEntity(value);
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    entities.push({ value, category: group.category, normalized });
                }
            }
        }
    }

    return entities;
}

function normalizeEntity(entity: string): string {
    const lower = entity.toLowerCase().trim();
    const mappings: Record<string, string> = {
        "donald trump": "trump", "donald j trump": "trump", "donald j. trump": "trump",
        "joe biden": "biden", "joseph biden": "biden",
        "kamala harris": "harris", "kamala": "harris",
        "elon musk": "musk", "elon": "musk",
        "vladimir putin": "putin",
        "xi jinping": "xi",
        "jerome powell": "powell",
        "ron desantis": "desantis",
        "gavin newsom": "newsom",
        "jd vance": "vance",
        "nikki haley": "haley",
        "vivek ramaswamy": "ramaswamy", "vivek": "ramaswamy",
        "stephen miran": "miran",
        "judy shelton": "shelton",
        "kevin warsh": "warsh",
        "kevin hassett": "hassett",
        "christopher waller": "waller",
        "michelle bowman": "bowman",
        "rick rieder": "rieder",
        "federal reserve": "fed", "fomc": "fed",
        "united nations": "un",
        "department of government efficiency": "doge",
        "north korea": "dprk", "pyongyang": "dprk",
        "united kingdom": "uk", "britain": "uk", "u.k.": "uk",
        "palestinian": "gaza", "hamas": "gaza",
        "israeli": "israel",
        "btc": "bitcoin",
        "eth": "ethereum",
        "artificial intelligence": "ai",
        "government shutdown": "shutdown",
        "rate cut": "interest rate", "rate hike": "interest rate",
    };
    return mappings[lower] || lower;
}

// ============================================================================
// SEMANTIC CONTEXT (ported from frontend)
// ============================================================================

type SemanticContext = "leadership" | "action" | "price" | "timing" | "outcome" | "comparison" | "unknown";

const CONTEXT_KEYWORDS: Record<SemanticContext, string[]> = {
    leadership: ["nominate", "nomination", "successor", "prime minister", "chief", "chair", "chairman", "president", "elect", "win", "governor", "senator", "mayor", "appointee"],
    action: ["strike", "attack", "ban", "sanction", "deport", "pardon", "invade", "war", "ceasefire", "shutdown", "impeach", "veto"],
    price: ["cost", "above", "below", "reach", "hit", "price", "rate", "gdp", "inflation", "cpi"],
    timing: ["before", "after", "by", "date", "deadline", "end of", "year", "month"],
    outcome: ["happen", "occur", "will", "resolve"],
    comparison: ["more", "less", "higher", "lower", "beat", "vs"],
    unknown: [],
};

function extractSemanticContext(text: string): SemanticContext {
    const lower = text.toLowerCase();
    let best: SemanticContext = "unknown";
    let bestCount = 0;

    for (const [ctx, keywords] of Object.entries(CONTEXT_KEYWORDS) as [SemanticContext, string[]][]) {
        if (ctx === "unknown") continue;
        const count = keywords.filter((kw) => lower.includes(kw)).length;
        if (count > bestCount) {
            bestCount = count;
            best = ctx;
        }
    }
    return best;
}

function areContextsCompatible(ctx1: SemanticContext, ctx2: SemanticContext): boolean {
    if (ctx1 === "unknown" || ctx2 === "unknown") return true;
    if (ctx1 === ctx2) return true;
    const compatible: Record<string, string[]> = {
        leadership: ["outcome", "timing"],
        action: ["outcome", "timing"],
        price: ["timing", "comparison"],
        timing: ["leadership", "action", "price", "outcome"],
        outcome: ["leadership", "action", "timing"],
        comparison: ["price"],
    };
    return compatible[ctx1]?.includes(ctx2) || compatible[ctx2]?.includes(ctx1) || false;
}

// ============================================================================
// ENTITY-BASED PRE-FILTER
// ============================================================================

interface PreFilterResult {
    eventTicker: string;
    eventTitle: string;
    subtitle: string;
    entityScore: number;
    matchedEntities: string[];
    contextCompatible: boolean;
}

function preFilterEvents(
    question: string,
    events: { event_ticker: string; title: string; subtitle: string | null; markets_json: string | null }[]
): PreFilterResult[] {
    const questionEntities = extractEntities(question);
    const questionContext = extractSemanticContext(question);

    if (questionEntities.length === 0) return [];

    const questionNormalized = new Set(questionEntities.map((e) => e.normalized));

    const results: PreFilterResult[] = [];

    for (const event of events) {
        const eventText = `${event.title} ${event.subtitle || ""}`;
        const eventEntities = extractEntities(eventText);
        if (eventEntities.length === 0) continue;

        const eventNormalized = new Set(eventEntities.map((e) => e.normalized));
        const matchedEntities: string[] = [];

        for (const ne of questionNormalized) {
            if (eventNormalized.has(ne)) {
                matchedEntities.push(ne);
            }
        }

        if (matchedEntities.length === 0) continue;

        const entityScore = (matchedEntities.length * 2) / (questionNormalized.size + eventNormalized.size);
        const eventContext = extractSemanticContext(eventText);
        const contextCompatible = areContextsCompatible(questionContext, eventContext);

        // Reject if only 1 entity matches and contexts are incompatible
        if (matchedEntities.length === 1 && !contextCompatible) continue;

        results.push({
            eventTicker: event.event_ticker,
            eventTitle: event.title,
            subtitle: event.subtitle || "",
            entityScore,
            matchedEntities,
            contextCompatible,
        });
    }

    // Sort by entity score descending
    results.sort((a, b) => b.entityScore - a.entityScore);
    return results;
}

// ============================================================================
// LLM MATCHING
// ============================================================================

interface AIMatchResponse {
    eventIndex: number;
    confidence: number;
    reasoning: string;
    matchedConcepts: string[];
}

function buildMatchingPrompt(
    question: string,
    eventList: { idx: number; title: string; subtitle: string }[]
): string {
    const eventBlock = eventList
        .map((e) => `[${e.idx}] "${e.title}"${e.subtitle ? ` — ${e.subtitle}` : ""}`)
        .join("\n");

    return `You are a prediction-market matching engine. Your job is to determine which Kalshi event (if any) is asking about the SAME real-world outcome as the given Polymarket question.

POLYMARKET QUESTION:
"${question}"

KALSHI EVENTS (indexed):
${eventBlock}

RULES:
1. A match means both markets would resolve the same way given the same real-world outcome. Surface keyword overlap is NOT enough — the resolution criteria must align.
2. If no event is a genuine semantic match, return eventIndex -1.
3. Confidence scale: 0 = no match, 1-30 = weak/tangential, 31-60 = related but different resolution, 61-85 = strong match with minor differences, 86-100 = near-identical resolution criteria.

Respond with ONLY valid JSON, no markdown fences:
{"eventIndex": <number>, "confidence": <number>, "reasoning": "<one sentence>", "matchedConcepts": ["concept1", "concept2"]}`;
}

async function callLLMForMatch(
    question: string,
    candidateEvents: { idx: number; title: string; subtitle: string }[]
): Promise<AIMatchResponse | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.warn("[matching] No OPENROUTER_API_KEY configured");
        return null;
    }

    const prompt = buildMatchingPrompt(question, candidateEvents);

    try {
        const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://pulseglobus.com",
                "X-Title": "PulseGlobus Matching Engine",
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content: "You are a specialist prediction-market analyst. You compare market resolution criteria across platforms to determine if two markets are asking about the same outcome. You respond ONLY in valid JSON.",
                    },
                    { role: "user", content: prompt },
                ],
                temperature: 0.1,
                max_tokens: 200,
            }),
        });

        if (!response.ok) {
            console.error("[matching] OpenRouter API error:", response.status);
            return null;
        }

        const json: any = await response.json();
        const content = json.choices?.[0]?.message?.content?.trim();
        if (!content) return null;

        const cleanContent = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        return JSON.parse(cleanContent) as AIMatchResponse;
    } catch (err) {
        console.error("[matching] LLM call error:", err);
        return null;
    }
}

// ============================================================================
// MAIN MATCHING PIPELINE
// ============================================================================

interface MatchResult {
    kalshiEventTicker: string | null;
    kalshiMarketTicker: string | null;
    kalshiEventTitle: string | null;
    similarity: number;
    confidence: number;
    matchMethod: "entity" | "ai" | "none";
    matchedEntities: string[];
    reasoning: string | null;
}

async function matchSingleMarket(
    question: string,
    kalshiEvents: KalshiEventRow[]
): Promise<MatchResult> {
    // Step 1: Entity-based pre-filter
    const candidates = preFilterEvents(
        question,
        kalshiEvents.map((e) => ({
            event_ticker: e.event_ticker,
            title: e.title,
            subtitle: e.subtitle,
            markets_json: e.markets_json,
        }))
    );

    // If no entity matches at all, return no match
    if (candidates.length === 0) {
        return {
            kalshiEventTicker: null, kalshiMarketTicker: null, kalshiEventTitle: null,
            similarity: 0, confidence: 0, matchMethod: "none", matchedEntities: [], reasoning: "No entity overlap found",
        };
    }

    // Step 2: If we have a very strong entity match (≥3 shared entities), use it directly
    const topCandidate = candidates[0];
    if (topCandidate.matchedEntities.length >= 3 && topCandidate.contextCompatible) {
        const eventRow = kalshiEvents.find((e) => e.event_ticker === topCandidate.eventTicker);
        const markets = eventRow?.markets_json ? JSON.parse(eventRow.markets_json) : [];
        const bestMarket = markets.find((m: any) => m.status === "open" || m.status === "active") || markets[0];

        return {
            kalshiEventTicker: topCandidate.eventTicker,
            kalshiMarketTicker: bestMarket?.ticker || null,
            kalshiEventTitle: topCandidate.eventTitle,
            similarity: Math.min(topCandidate.entityScore * 1.5, 0.95),
            confidence: Math.round(Math.min(topCandidate.entityScore * 150, 95)),
            matchMethod: "entity",
            matchedEntities: topCandidate.matchedEntities,
            reasoning: `Strong entity match: ${topCandidate.matchedEntities.join(", ")}`,
        };
    }

    // Step 3: Send top candidates to LLM for semantic matching
    const topN = candidates.slice(0, 30); // Limit to 30 for token budget
    const eventList = topN.map((c, idx) => ({
        idx,
        title: c.eventTitle,
        subtitle: c.subtitle,
    }));

    const aiResult = await callLLMForMatch(question, eventList);

    if (!aiResult || aiResult.eventIndex < 0 || aiResult.confidence < 25) {
        // Fall back to best entity match if AI fails
        if (topCandidate.entityScore >= 0.4 && topCandidate.contextCompatible) {
            const eventRow = kalshiEvents.find((e) => e.event_ticker === topCandidate.eventTicker);
            const markets = eventRow?.markets_json ? JSON.parse(eventRow.markets_json) : [];
            const bestMarket = markets.find((m: any) => m.status === "open" || m.status === "active") || markets[0];

            return {
                kalshiEventTicker: topCandidate.eventTicker,
                kalshiMarketTicker: bestMarket?.ticker || null,
                kalshiEventTitle: topCandidate.eventTitle,
                similarity: topCandidate.entityScore,
                confidence: Math.round(topCandidate.entityScore * 100),
                matchMethod: "entity",
                matchedEntities: topCandidate.matchedEntities,
                reasoning: "Entity-based fallback (AI unavailable or low confidence)",
            };
        }

        return {
            kalshiEventTicker: null, kalshiMarketTicker: null, kalshiEventTitle: null,
            similarity: 0, confidence: 0, matchMethod: "none", matchedEntities: [],
            reasoning: aiResult?.reasoning || "No confident match found",
        };
    }

    // Map AI result back to candidate
    const matchedCandidate = topN[aiResult.eventIndex];
    if (!matchedCandidate) {
        return {
            kalshiEventTicker: null, kalshiMarketTicker: null, kalshiEventTitle: null,
            similarity: 0, confidence: 0, matchMethod: "none", matchedEntities: [],
            reasoning: "AI returned out-of-bounds index",
        };
    }

    const eventRow = kalshiEvents.find((e) => e.event_ticker === matchedCandidate.eventTicker);
    const markets = eventRow?.markets_json ? JSON.parse(eventRow.markets_json) : [];
    const bestMarket = markets.find((m: any) => m.status === "open" || m.status === "active") || markets[0];

    return {
        kalshiEventTicker: matchedCandidate.eventTicker,
        kalshiMarketTicker: bestMarket?.ticker || null,
        kalshiEventTitle: matchedCandidate.eventTitle,
        similarity: aiResult.confidence / 100,
        confidence: aiResult.confidence,
        matchMethod: "ai",
        matchedEntities: aiResult.matchedConcepts || matchedCandidate.matchedEntities,
        reasoning: aiResult.reasoning,
    };
}

// ============================================================================
// AUTO-MATCHING CRON JOB
// ============================================================================

export async function autoMatchMarkets(
    database: Database.Database,
    batchSize: number = 30
): Promise<{ matched: number; noMatch: number; errors: number }> {
    const unmatched = getUnmatchedMarketIds(database, batchSize);

    if (unmatched.length === 0) {
        console.log("[matching] No unmatched markets to process");
        return { matched: 0, noMatch: 0, errors: 0 };
    }

    console.log(`[matching] Processing ${unmatched.length} unmatched markets...`);

    // Load all Kalshi events once for the batch
    const kalshiEvents = getKalshiEvents(database, { limit: 500 });

    if (kalshiEvents.length === 0) {
        console.warn("[matching] No Kalshi events cached — run Kalshi sync first");
        return { matched: 0, noMatch: 0, errors: 0 };
    }

    let matched = 0;
    let noMatch = 0;
    let errors = 0;

    for (const { id, question } of unmatched) {
        try {
            const result = await matchSingleMarket(question, kalshiEvents);

            upsertMarketMatch(database, {
                polymarketId: id,
                polymarketQuestion: question,
                kalshiEventTicker: result.kalshiEventTicker,
                kalshiMarketTicker: result.kalshiMarketTicker,
                kalshiEventTitle: result.kalshiEventTitle,
                similarity: result.similarity,
                confidence: result.confidence,
                matchMethod: result.matchMethod,
                matchedEntities: result.matchedEntities,
                reasoning: result.reasoning,
                ttlHours: MATCH_TTL_HOURS,
            });

            if (result.kalshiEventTicker) {
                matched++;
                console.log(
                    `[matching] ✓ "${question.slice(0, 50)}..." → "${result.kalshiEventTitle}" (${result.confidence}%) [${result.matchMethod}]`
                );
            } else {
                noMatch++;
                console.log(`[matching] ✗ "${question.slice(0, 50)}..." — no match`);
            }

            // Rate limit: 1.5s between LLM calls
            if (result.matchMethod === "ai") {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        } catch (err) {
            errors++;
            console.error(`[matching] Error matching market ${id}:`, err);
        }
    }

    console.log(`[matching] Batch complete: matched=${matched}, noMatch=${noMatch}, errors=${errors}`);
    return { matched, noMatch, errors };
}

// ============================================================================
// ON-DEMAND SINGLE MARKET MATCH (for API)
// ============================================================================

export async function getOrMatchMarket(
    database: Database.Database,
    polymarketId: string,
    question: string
): Promise<MatchResult & { cached: boolean }> {
    // Check cache first
    const cached = getMarketMatch(database, polymarketId);
    if (cached) {
        return {
            kalshiEventTicker: cached.kalshi_event_ticker,
            kalshiMarketTicker: cached.kalshi_market_ticker,
            kalshiEventTitle: cached.kalshi_event_title,
            similarity: cached.similarity,
            confidence: cached.confidence,
            matchMethod: cached.match_method as any,
            matchedEntities: cached.matched_entities ? JSON.parse(cached.matched_entities) : [],
            reasoning: cached.reasoning,
            cached: true,
        };
    }

    // No cache — run matching now
    const kalshiEvents = getKalshiEvents(database, { limit: 500 });
    const result = await matchSingleMarket(question, kalshiEvents);

    // Cache it
    upsertMarketMatch(database, {
        polymarketId,
        polymarketQuestion: question,
        kalshiEventTicker: result.kalshiEventTicker,
        kalshiMarketTicker: result.kalshiMarketTicker,
        kalshiEventTitle: result.kalshiEventTitle,
        similarity: result.similarity,
        confidence: result.confidence,
        matchMethod: result.matchMethod,
        matchedEntities: result.matchedEntities,
        reasoning: result.reasoning,
        ttlHours: MATCH_TTL_HOURS,
    });

    return { ...result, cached: false };
}
