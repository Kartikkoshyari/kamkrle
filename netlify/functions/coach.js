// Kamkrle — AI Habit Coach backend.
//
// This is the ONLY place the Gemini API key is used. It lives in Netlify's
// environment variables (Site settings -> Environment variables) and is never
// sent to, or reachable from, the browser.
//
// Required Netlify environment variables:
//   GEMINI_API_KEY            - server-side Gemini API key
//   GEMINI_MODEL               (optional) - defaults to 'gemini-2.0-flash'
//   SUPABASE_URL                - same project as the frontend uses
//   SUPABASE_SERVICE_ROLE_KEY  - Supabase *service role* key (server-side only,
//                                 never the publishable key). Used only to verify
//                                 a caller's access token; never used to bypass
//                                 row-level security or touch app data.
//
// The frontend (ai.js) is the only expected caller. Session-only chat: no
// conversation is persisted here or in Supabase — each request carries
// whatever history the browser still has in memory.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const SYSTEM_PROMPT = `You are the "AI Habit Coach" inside Kamkrle, a daily habit/routine tracker.
You give brief, encouraging, practical coaching based on the user's actual habit data below.
Keep replies short (2-5 sentences unless asked for more detail), concrete, and specific to their
data rather than generic advice. Never invent numbers that weren't given to you. If the data shows
no activity yet, gently encourage them to start rather than commenting on "failure".`;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const { message, history, habitContext } = payload;

    if (!message || typeof message !== 'string' || !message.trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Message is required' }) };
    }
    if (message.length > 2000) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Message too long' }) };
    }

    // ---------- Optional caller verification ----------
    // Guests (no Supabase account) are still allowed to use the coach, but a
    // signed-in caller's token is verified so we know it's a real Supabase
    // user and not just anyone hammering this endpoint directly.
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const verified = await verifySupabaseToken(token);
        if (!verified) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
        }
    }

    if (!process.env.GEMINI_API_KEY) {
        console.error('GEMINI_API_KEY is not configured');
        return { statusCode: 500, body: JSON.stringify({ error: 'Coach is not configured yet.' }) };
    }

    try {
        const reply = await callGemini(message, Array.isArray(history) ? history : [], habitContext);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reply }),
        };
    } catch (err) {
        console.error('Coach request failed:', err);
        return { statusCode: 502, body: JSON.stringify({ error: 'Could not reach the AI coach. Please try again.' }) };
    }
};

// Verifies a Supabase access token belongs to a real user. Returns the user
// object on success, or null if the token is missing/invalid/expired.
async function verifySupabaseToken(token) {
    if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    try {
        const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            },
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    }
}

// Builds the Gemini request and returns the reply text.
async function callGemini(message, history, habitContext) {
    const contextBlock = habitContext
        ? `Here is the user's current habit data (JSON):\n${JSON.stringify(habitContext)}`
        : `No habit data was provided.`;

    // Gemini's REST API takes a flat list of turns; we translate our simple
    // { role: 'user' | 'coach', text }[] history into that shape and append
    // the new message last.
    const turns = history
        .filter(h => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'coach'))
        .slice(-10) // keep the request small; session-only memory anyway
        .map(h => ({
            role: h.role === 'coach' ? 'model' : 'user',
            parts: [{ text: h.text }],
        }));

    turns.push({ role: 'user', parts: [{ text: message }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${contextBlock}` }] },
            contents: turns,
            generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
        }),
    });

    if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Gemini API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
        && data.candidates[0].content.parts[0].text;

    if (!text) throw new Error('Gemini returned no reply text');
    return text.trim();
}
