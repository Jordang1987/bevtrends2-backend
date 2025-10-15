// routes/insights.js
import { Router } from "express";
const router = Router();

router.get("/", (req, res) => {
  res.json({
    market: (req.query.market || "TPA").toUpperCase(),
    range: (req.query.range || "7d").toLowerCase(),
    updatedAt: new Date().toISOString(),
    items: [] // temp; real data later
  });
});

router.post("/recompute", (req, res) => {
  if (!process.env.ADMIN_TOKEN || req.get("X-Admin-Token") !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.json({ ok: true, updated: ["7d", "28d"] });
});

export default router;
