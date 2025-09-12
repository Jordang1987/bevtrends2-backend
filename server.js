import express from "express";
import cors from "cors";
import morgan from "morgan";
import Parser from "rss-parser";

const app = express();
const PORT = process.env.PORT || 10000;

// CORS: lock down later to your app domain(s)
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Simple root + health
app.get("/", (_req, res) => res.json({ ok: true, service: "bevtrends2-backend" }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bevtrends2-backend" }));

/* ==============================
   TRADES AGGREGATOR (RSS)
   ============================== */
const parser = new Parser({
  timeout: 15000,
  customFields: { item: ["media:content", "media:thumbnail", "content:encoded"] },
});

const TRADE_SOURCES = [
  { name: "VinePair", url: "https://vinepair.com/feed/" },
  { name: "The Spirits Business", url: "https://www.thespiritsbusiness.com/feed/" },
  { name: "The Drinks Business", url: "https://www.thedrinksbusiness.com/feed/" },
  { name: "SevenFifty Daily", url: "https://daily.sevenfifty.com/feed/" },
  { name: "Imbibe Magazine", url: "https://imbibemagazine.com/feed/" },
  { name: "Punch", url: "https://punchdrink.com/feed/" },
  { name: "BevNET", url: "https://www.bevnet.com/feed" }
];

let TRADES_CACHE = { items: [], ts: 0 };
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function firstImg(html = "") {
  const m = html.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : null;
}
function pickImage(it = {}) {
  const mc = Array.isArray(it["media:content"]) ? it["media:content"][0] : it["media:content"];
  const mt = Array.isArray(it["media:thumbnail"]) ? it["media:thumbnail"][0] : it["media:thumbnail"];
  return it?.enclosure?.url || mc?.url || mt?.url || firstImg(it["content:encoded"] || it.content);
}

app.get("/trades/latest", async (_req, res) => {
  try {
    if (Date.now() - TRADES_CACHE.ts < TTL_MS && TRADES_CACHE.items.length) {
      return res.json(TRADES_CACHE);
    }
    const settled = await Promise.allSettled(
      TRADE_SOURCES.map(async (s) => {
        const feed = await parser.parseURL(s.url);
        return (feed.items || []).slice(0, 12).map((it) => ({
          id: it.guid || it.link || it.title,
          title: it.title,
          link: it.link,
          source: s.name,
          pubDate: it.isoDate || it.pubDate || null,
          image: pickImage(it),
        }));
      })
    );
    const items = settled
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
      .slice(0, 100);

    TRADES_CACHE = { items, ts: Date.now() };
    res.json(TRADES_CACHE);
  } catch (err) {
    console.error("TRADES error:", err);
    res.status(500).json({ error: "Failed to load trades" });
  }
});

/* ================
   Other mock data
   ================ */
const NEAR_ME = [
  { id: "1", name: "Espresso Martini", category: "Cocktail", tags: ["vodka", "coffee"] },
  { id: "2", name: "Spicy Margarita", category: "Cocktail", tags: ["tequila", "jalapeño"] },
];

app.get("/trending/near-me", (_req, res) => res.json({ items: NEAR_ME }));

app.get("/journal/latest", (_req, res) =>
  res.json({
    items: [
      {
        id: "a",
        title: "Low-ABV keeps rising",
        source: "BevTrends Journal",
        link: "https://example.com/a",
        pubDate: new Date().toISOString(),
      },
    ],
  })
);

// 404 + error handlers
app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
