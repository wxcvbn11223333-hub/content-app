// دالة سيرفر تخفي مفتاح API وتستدعي الذكاء الاصطناعي نيابةً عن الصفحة
const hits = new Map(); // حماية بسيطة من الإكثار (تقريبية)
const LIMIT = 40;       // طلبات لكل زائر في الساعة
const WINDOW = 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "missing key" }); return; }

  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (rec.length >= LIMIT) { res.status(429).json({ error: "rate" }); return; }
  rec.push(now); hits.set(ip, rec);

  const prompt = String((req.body && req.body.prompt) || "").slice(0, 6000);
  if (!prompt) { res.status(400).json({ error: "empty" }); return; }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.MODEL || "claude-sonnet-5-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!r.ok) { res.status(r.status === 429 ? 429 : 502).json({ error: "upstream" }); return; }
    const d = await r.json();
    const text = (d.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    res.status(200).json({ text });
  } catch (e) {
    res.status(502).json({ error: "network" });
  }
};
