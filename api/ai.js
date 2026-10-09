const hits = new Map();
const LIMIT = 40;
const WINDOW = 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }

  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.status(500).json({ error: "missing key" }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (rec.length >= LIMIT) { res.status(429).json({ error: "rate" }); return; }
  rec.push(now); hits.set(ip, rec);

  const prompt = String((req.body && req.body.prompt) || "").slice(0, 6000);
  if (!prompt) { res.status(400).json({ error: "empty" }); return; }

  const model = process.env.MODEL || "gemini-2.5-flash";

  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000 }
        })
      }
    );
    if (!r.ok) { res.status(r.status === 429 ? 429 : 502).json({ error: "upstream" }); return; }
    const d = await r.json();
    const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
    const text = parts.map(p => p.text || "").join("");
    if (!text) { res.status(502).json({ error: "empty reply" }); return; }
    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({ error: "network" });
  }
};
