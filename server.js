import express from "express";
import Airtable from "airtable";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

// Airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_TOKEN }).base(process.env.AIRTABLE_BASE);
const table = base("Orders");

// Simple health check
app.get("/", (req, res) => res.send("BiSmo eBay ↔ Airtable sync online"));

// Example: pull test data
app.get("/test", async (req, res) => {
  try {
    const records = await table.select({ maxRecords: 5 }).firstPage();
    res.json(records.map(r => r.fields));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
