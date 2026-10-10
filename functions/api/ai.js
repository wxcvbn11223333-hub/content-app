const hits = new Map();
const LIMIT = 40;
const WINDOW = 60 * 60 * 1000;
const RETRY_CODES = [429, 500, 503, 504];
const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

function reply(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function geminiUrl(model) {
  return "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function once(key, model, prompt, withThinking) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const gc = { maxOutputTokens: 3000 };
    if (withThinking) gc.thinkingConfig = { thinkingLevel: "minimal" };
    return await fetch(geminiUrl(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: gc }),
      signal: ctl.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(key, model, prompt) {
  let status = 0;
  let thinking = true;
  for (let i = 0; i < 2; i++) {
    let r;
    try {
      r = await once(key, model, prompt, thinking);
    } catch (e) {
      status = 504;
      await sleep(800);
      continue;
    }
    if (r.ok) return { ok: true, data: await r.json() };
    status = r.status;
    if (status === 400 && thinking) { thinking = false; i--; continue; }
    if (!RETRY_CODES.includes(status)) break;
    await sleep(800);
  }
  return { ok: false, status: status };
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

  const models = env.MODEL ? [env.MODEL].concat(MODELS) : MODELS;

  let lastStatus = 0;
  for (const model of models) {
    const res = await callModel(key, model, prompt);
    if (res.ok) {
      const d = res.data;
      const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
      const text = parts.map(p => p.text || "").join("");
      if (text) return reply({ text });
      lastStatus = 502;
    } else {
      lastStatus = res.status;
    }
  }
  return reply({ error: "upstream", status: lastStatus }, lastStatus === 429 ? 429 : 503);
}
