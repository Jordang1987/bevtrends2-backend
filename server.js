import express from "express";
import cors from "cors";
import morgan from "morgan";
import Parser from "rss-parser";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Root + health
app.get("/", (_req, res) => res.json({ ok: true, service: "bevtrends2-backend" }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bevtrends2-backend" }));

/* ==============================
   TRADES AGGREGATOR (RSS)
   - /trades/latest?sources=VinePair,Imbibe%20Magazine&q=tequila&limit=150&perSource=20&nocache=1&hires=1
   ============================== */
const parser = new Parser({
  timeout: 15000,
  customFields: { item: ["media:content", "media:thumbnail", "content:encoded"] },
});

const TRADE_SOURCES = [
  // Industry-wide
  { name: "BevNET", url: "https://www.bevnet.com/feed" },
  { name: "Brewbound", url: "https://www.brewbound.com/feed" },
  { name: "VinePair", url: "https://vinepair.com/feed/" },
  { name: "SevenFifty Daily", url: "https://daily.sevenfifty.com/feed/" },
  { name: "Imbibe Magazine", url: "https://imbibemagazine.com/feed/" },
  { name: "Punch", url: "https://punchdrink.com/feed/" },

  // Wine
  { name: "Wine Enthusiast", url: "https://www.winemag.com/feed/" },
  { name: "Decanter", url: "https://www.decanter.com/feed/" },

  // Spirits
  { name: "The Spirits Business", url: "https://www.thespiritsbusiness.com/feed/" },
  { name: "Drinks International", url: "https://drinksint.com/rss" },

  // Beer
  { name: "The Drinks Business", url: "https://www.thedrinksbusiness.com/feed/" },
  { name: "Good Beer Hunting", url: "https://www.goodbeerhunting.com/blog?format=rss" },
  { name: "Brewers Association", url: "https://www.brewersassociation.org/feed/" },

  // On-prem / hospitality
  { name: "Bar & Restaurant", url: "https://www.barandrestaurant.com/rss.xml" },
  { name: "Nation's Restaurant News", url: "https://www.nrn.com/rss.xml" },

  // Global / market
  { name: "BeverageDaily", url: "https://www.beveragedaily.com/Info/Latest-headlines/(format)/rss" },
  { name: "just-drinks", url: "https://www.just-drinks.com/feed/" },
];

let TRADES_CACHE = { items: [], ts: 0 };
const TTL_MS = 10 * 60 * 1000; // 10 minutes

// -------- image helpers --------
function firstImg(html = "") {
  const m = html?.match?.(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}
function parseSrcsetLargest(srcset = "") {
  const cand = srcset
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      const m = s.match(/(\S+)\s+(\d+)w/);
      return m ? { url: m[1], w: parseInt(m[2], 10) } : { url: s.split(" ")[0], w: 0 };
    })
    .filter((x) => x.url);
  cand.sort((a, b) => b.w - a.w);
  return cand[0]?.url || null;
}
function biggest(arr) {
  if (!arr) return null;
  const list = Array.isArray(arr) ? arr : [arr];
  const best = list
    .map((o) => ({
      url: o?.url,
      w: parseInt(o?.width || o?.$?.width || 0, 10),
      h: parseInt(o?.height || o?.$?.height || 0, 10),
    }))
    .filter((x) => x.url)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  return best?.url || null;
}
function pickImage(it = {}) {
  const mc = biggest(it["media:content"]);
  const mt = biggest(it["media:thumbnail"]);
  const srcset = (it["content:encoded"] || it.content || "").match(/srcset=["']([^"']+)["']/i)?.[1];
  const fromSet = srcset ? parseSrcsetLargest(srcset) : null;
  return it?.enclosure?.url || mc || mt || fromSet || firstImg(it["content:encoded"] || it.content);
}
const OG_CACHE = new Map(); // link -> {url,ts}
const DAY = 24 * 60 * 60 * 1000;
async function getOgImage(link) {
  if (!link) return null;
  const cached = OG_CACHE.get(link);
  if (cached && Date.now() - cached.ts < DAY) return cached.url;
  try {
    const res = await fetch(link, {
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": "BevTrendsBot/1.0 (+render.com)" },
    });
    const html = await res.text();
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const tw = html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const set = html.match(/<img[^>]+srcset=["']([^"']+)["'][^>]*>/i)?.[1];
    let url = og || tw || (set && parseSrcsetLargest(set)) || null;
    if (url && url.startsWith("//")) url = "https:" + url;
    if (url) OG_CACHE.set(link, { url, ts: Date.now() });
    return url;
  } catch {
    return null;
  }
}
const looksSmall = (u = "") =>
  /thumb|icon|avatar|\/\d{1,3}x\d{1,3}\b|[?&](w|width)=\d{1,3}\b/i.test(u);

// -------- endpoint --------
app.get("/trades/latest", async (req, res) => {
  try {
    const { sources, q, limit = "100", perSource = "12", nocache, hires } = req.query;

    if (!nocache && !hires && Date.now() - TRADES_CACHE.ts < TTL_MS && TRADES_CACHE.items.length && !sources && !q) {
      return res.json(TRADES_CACHE);
    }

    const selected = sources
      ? TRADE_SOURCES.filter((s) =>
          sources
            .split(",")
            .map((x) => x.trim().toLowerCase())
            .includes(s.name.toLowerCase())
        )
      : TRADE_SOURCES;

    const per = Math.max(1, Math.min(50, parseInt(perSource, 10) || 12));
    const max = Math.max(1, Math.min(200, parseInt(limit, 10) || 100));
    const query = (q || "").trim().toLowerCase();

    const settled = await Promise.allSettled(
      selected.map(async (s) => {
        const feed = await parser.parseURL(s.url);
        return (feed.items || []).slice(0, per).map((it) => ({
          id: it.guid || it.link || it.title,
          title: it.title,
          link: it.link,
          source: s.name,
          pubDate: it.isoDate || it.pubDate || null,
          image: pickImage(it),
        }));
      })
    );

    let items = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    if (query) {
      items = items.filter(
        (it) =>
          (it.title || "").toLowerCase().includes(query) ||
          (it.source || "").toLowerCase().includes(query)
      );
    }

    // Optional hi-res pass (upgrade small images via OG)
    if (hires) {
      const N = Math.min(items.length, 40);
      const slice = items.slice(0, N);
      const upgraded = await Promise.all(
        slice.map(async (it) => {
          if (!it.link) return it;
          if (it.image && !looksSmall(it.image)) return it;
          const og = await getOgImage(it.link);
          return og ? { ...it, image: og } : it;
        })
      );
      items = upgraded.concat(items.slice(N));
    }

    // de-dupe + sort + cap
    const seen = new Set();
    items = items
      .filter((it) => {
        const key = it.link || it.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
      .slice(0, max);

    if (!sources && !q && !nocache && !hires) TRADES_CACHE = { items, ts: Date.now() };

    res.json({ items });
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
