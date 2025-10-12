import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

/* =========================
   Config & Environment
   ========================= */
const EBAY_ENV = (process.env.EBAY_ENV || "sandbox").toLowerCase();
const EBAY_APP_ID = process.env.EBAY_APP_ID;   // Client ID
const EBAY_CERT_ID = process.env.EBAY_CERT_ID; // Client Secret
const EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI;
const EBAY_SCOPES = process.env.EBAY_SCOPES || "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly";

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = process.env.AIRTABLE_BASE;
const AIRTABLE_API   = "https://api.airtable.com/v0";

if (!AIRTABLE_TOKEN || !AIRTABLE_BASE) {
  console.warn("⚠️ Missing AIRTABLE_TOKEN or AIRTABLE_BASE. /test will fail until set.");
}

const AUTH_HOST = EBAY_ENV === "production"
  ? "https://auth.ebay.com/oauth2/authorize"
  : "https://auth.sandbox.ebay.com/oauth2/authorize";

const TOKEN_HOST = EBAY_ENV === "production"
  ? "https://api.ebay.com/identity/v1/oauth2/token"
  : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

function ebayApiBase() {
  return EBAY_ENV === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com";
}

/* =========================
   Airtable REST helpers
   ========================= */
async function airtableList(tableName, query = {}) {
  const params = new URLSearchParams();
  for (const [k,v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
  }
  const url = `${AIRTABLE_API}/${AIRTABLE_BASE}/${encodeURIComponent(tableName)}?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  const text = await res.text();
  const ok = res.ok;
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!ok) throw new Error(`Airtable ${res.status} ${res.statusText}: ${text}`);
  return json;
}

async function airtableCreate(tableName, records) {
  const res = await fetch(`${AIRTABLE_API}/${AIRTABLE_BASE}/${encodeURIComponent(tableName)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ records: records.map(fields => ({ fields })) })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Airtable create failed: ${res.status} ${JSON.stringify(json)}`);
  return json.records || [];
}

async function airtableFindByField(tableName, field, value) {
  const formula = `({${field}} = '${String(value).replace(/'/g, "\\'")}')`;
  const url = `${AIRTABLE_API}/${AIRTABLE_BASE}/${encodeURIComponent(tableName)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`Airtable find failed: ${res.status} ${JSON.stringify(json)}`);
  return (json.records || [])[0];
}

async function airtableUpdate(tableName, id, fields) {
  const res = await fetch(`${AIRTABLE_API}/${AIRTABLE_BASE}/${encodeURIComponent(tableName)}/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Airtable update failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/* =========================
   eBay OAuth & API helpers
   ========================= */
app.get("/auth/ebay", (req, res) => {
  if (!EBAY_APP_ID || !EBAY_REDIRECT_URI) {
    return res.status(500).send("Missing EBAY_APP_ID or EBAY_REDIRECT_URI");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: EBAY_APP_ID,
    redirect_uri: EBAY_REDIRECT_URI,
    scope: EBAY_SCOPES,
    state: "bismo-" + Math.random().toString(36).slice(2, 10)
  });
  res.redirect(`${AUTH_HOST}?${params.toString()}`);
});

app.get("/oauth/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("Missing ?code");
    if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_REDIRECT_URI) {
      return res.status(500).send("Missing EBAY_APP_ID/EBAY_CERT_ID/EBAY_REDIRECT_URI");
    }

    const basic = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: EBAY_REDIRECT_URI
    });

    const tokenRes = await fetch(TOKEN_HOST, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const json = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(500).send(`Token exchange failed: ${tokenRes.status} ${JSON.stringify(json)}`);
    }

    res.send(`
      <h2>eBay OAuth success (${EBAY_ENV})</h2>
      <p><strong>Copy your refresh token below and add it to Render as EBAY_REFRESH_TOKEN:</strong></p>
      <textarea style="width:100%;height:200px">${json.refresh_token || ""}</textarea>
      <pre>${JSON.stringify(json, null, 2)}</pre>
    `);
  } catch (e) {
    res.status(500).send(`OAuth error: ${e.message}`);
  }
});

async function ebayAccessTokenFromRefresh() {
  const refresh = process.env.EBAY_REFRESH_TOKEN;
  if (!refresh) throw new Error("Missing EBAY_REFRESH_TOKEN");
  const basic = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    scope: EBAY_SCOPES
  });
  const res = await fetch(TOKEN_HOST, {
    method: "POST",
    headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

async function ebayGetOrders(accessToken, { modifiedSinceISO }) {
  const url = new URL(`${ebayApiBase()}/sell/fulfillment/v1/order`);
  if (modifiedSinceISO) url.searchParams.set("filter", `lastmodifieddate:[${modifiedSinceISO}..]`);
  url.searchParams.set("limit", "50");
  const res = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" }
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`getOrders failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/* =========================
   Sync endpoint
   ========================= */
// Simple in-memory cursor; good enough for now
let LAST_SYNC_ISO = new Date(Date.now() - 7*24*60*60*1000).toISOString();

app.get("/sync", async (_req, res) => {
  try {
    const accessToken = await ebayAccessTokenFromRefresh();
    const data = await ebayGetOrders(accessToken, { modifiedSinceISO: LAST_SYNC_ISO });

    let imported = 0;
    for (const o of (data.orders || [])) {
      const orderId = o.orderId;

      const buyer = o.buyer || {};
      const shipTo = ((o.fulfillmentStartInstructions || [])[0]?.shippingStep?.shipTo) || {};
      const price = o.pricingSummary || {};

      const existing = await airtableFindByField("Orders", "eBay Order ID", orderId);
      const orderFields = {
        "eBay Order ID": orderId,
        "Order Date": o.creationDate,
        "Status": o.orderFulfillmentStatus,
        "Buyer Username": buyer.username || "",
        "Buyer Name": shipTo.fullName || "",
        "Email": buyer.email || "",
        "Address 1": shipTo.contactAddress?.addressLine1 || "",
        "Address 2": shipTo.contactAddress?.addressLine2 || "",
        "City": shipTo.contactAddress?.city || "",
        "Region/State": shipTo.contactAddress?.stateOrProvince || "",
        "Postal Code": shipTo.contactAddress?.postalCode || "",
        "Country": shipTo.contactAddress?.countryCode || "",
        "Subtotal (£)": price?.subtotal?.value ? Number(price.subtotal.value) : undefined,
        "Tax (£)": price?.tax?.value ? Number(price.tax.value) : 0,
        "Shipping (£)": price?.deliveryCost?.value ? Number(price.deliveryCost.value) : 0,
        "Total (£)": price?.total?.value ? Number(price.total.value) : undefined,
        "Currency": price?.total?.currency || "GBP"
      };

      let orderRecordId;
      if (existing) {
        const updated = await airtableUpdate("Orders", existing.id, orderFields);
        orderRecordId = updated.id;
      } else {
        const created = await airtableCreate("Orders", [orderFields]);
        orderRecordId = created[0].id;
      }

      const lineItems = o.lineItems || [];
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        const sku = li.sku || "";
        const orderItemId = `${orderId}-${i+1}`;
        const unitPrice = li.lineItemCost?.value ? Number(li.lineItemCost.value) : 0;
        const qty = li.quantity || 1;

        const existingItem = await airtableFindByField("Order Items", "Order Item ID", orderItemId);

        const itemFields = {
          "Order Item ID": orderItemId,
          "Order": [orderRecordId],
          "Product (SKU)": [],
          "Quantity": qty,
          "Unit Price (£)": unitPrice,
          "Line Total (£)": unitPrice * qty
        };

        if (sku) {
          const prod = await airtableFindByField("Products", "SKU", sku);
          if (prod) itemFields["Product (SKU)"] = [prod.id];
        }

        if (existingItem) {
          await airtableUpdate("Order Items", existingItem.id, itemFields);
        } else {
          await airtableCreate("Order Items", [itemFields]);
        }
      }

      imported++;
    }

    LAST_SYNC_ISO = new Date().toISOString();
    res.json({ ok: true, imported, since: LAST_SYNC_ISO });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================
   Basic routes
   ========================= */
app.get("/", (_req, res) => {
  res.send("BiSmo eBay ↔ Airtable sync online");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, env: EBAY_ENV, airtableBase: AIRTABLE_BASE ? "set" : "missing" });
});

// Quick Airtable check
app.get("/test", async (_req, res) => {
  try {
    const data = await airtableList("Orders", { maxRecords: 5 });
    res.json((data.records || []).map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port} (ENV=${EBAY_ENV})`);
});
