import express from "express";
import cors from "cors";
import morgan from "morgan";

const app = express();
const PORT = process.env.PORT || 10000;

// CORS: lock down later to your app domain(s)
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","DELETE","OPTIONS"] }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Simple root + health
app.get("/", (_req, res) => res.json({ ok: true, service: "bevtrends2-backend" }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bevtrends2-backend" }));

// ---- Mock data (replace later) ----
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
