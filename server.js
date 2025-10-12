import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

// ---- Airtable REST helpers ----
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = process.env.AIRTABLE_BASE;
const AIRTABLE_API   = "https://api.airtable.com/v0";

if (!AIRTABLE_TOKEN || !AIRTABLE_BASE) {
  console.warn("⚠️ Missing AIRTABLE_TOKEN or AIRTABLE_BASE. /test will fail until set.");
}

async function airtableList(tableName, query = {}) {
  const params = new URLSearchParams();
  for (const [k,v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
  }
  const url = `${AIRTABLE_API}/${AIRTABLE_BASE}/${encodeURIComponent(tableName)}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

// ---- Routes ----
app.get("/", (_req, res) => {
  res.send("BiSmo eBay ↔ Airtable sync online");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    env: process.env.EBAY_ENV || "unset",
    airtableBase: AIRTABLE_BASE ? "set" : "missing"
  });
});

// Quick Airtable check (reads up to 5 from Orders)
app.get("/test", async (_req, res) => {
  try {
    const data = await airtableList("Orders", { maxRecords: 5 });
    res.json((data.records || []).map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
