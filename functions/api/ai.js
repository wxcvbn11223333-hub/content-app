const hits = new Map();
const LIMIT = 40;
const WINDOW = 60 * 60 * 1000;

function reply(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function geminiUrl(model) {
  return "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
}

export async function onRequestGet(context) {
  const { env } = context;
  const key = env.GEMINI_API_KEY;
  const model = env.MODEL || "gemini-2.5-flash";
  const out = {
    hasKey: !!key,
    keyLength: key ? key.length : 0,
    keyStart: key ? key.slice(0, 3) : null,
    model: model
  };
  if (!key) return reply(out);
  try {
    const r = await fetch(geminiUrl(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: "قل مرحبا بكلمة واحدة" }] }] })
    });
    out.upstreamStatus = r.status;
    out.upstreamBody = (await r.text()).slice(0, 400);
  } catch (e) {
    out.fetchError = String(e);
  }
  return reply(out);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const key = env.GEMINI_API_KEY;
  if (!key) return reply({ error: "missing key" }, 500);

  const ip = request.headers.get("cf-connecting-ip") || "x";
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (rec.length >= LIMIT) return reply({ error: "rate" }, 429);
  rec.push(now); hits.set(ip, rec);

  let body = {};
  try { body = await request.json(); } catch (e) { return reply({ error: "bad request" }, 400); }
  const prompt = String((body && body.prompt) || "").slice(0, 6000);
  if (!prompt) return reply({ error: "empty" }, 400);

  const model = env.MODEL || "gemini-2.5-flash";

  try {
    const r = await fetch(geminiUrl(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4000 }
      })
    });
    if (!r.ok) return reply({ error: "upstream" }, r.status === 429 ? 429 : 502);
    const d = await r.json();
    const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
    const text = parts.map(p => p.text || "").join("");
    if (!text) return reply({ error: "empty reply" }, 502);
    return reply({ text });
  } catch (e) {
    return reply({ error: "network" }, 502);
  }
}
