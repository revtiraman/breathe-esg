# Decisions

Every ambiguity I resolved, what I chose, and why.

---

## SAP: Which export format?

**Ambiguity:** SAP exposes data through IDocs, OData (SAP Gateway), BAPI function calls, and flat-file/CSV report exports. All are technically possible.

**Decision:** Flat-file CSV export from a custom ABAP report or SM36 scheduled job, combining MB51 (Material Documents, goods movements) and ME2N (Purchase Orders) data.

**Why:**
- IDocs are designed for system-to-system EDI messaging, not BI extraction. Parsing an IDoc stream for ESG reporting is using the wrong tool — IDocs segment types for goods movements (E1MBLKZ, E1MBXYI) are not self-describing without the partner profile setup.
- OData via SAP Gateway is enterprise-gated. The Gateway needs to be enabled, a service catalog registered, and OAuth provisioned. Most sustainability leads don't have access to request this. Even when available, OData calls return one entity at a time — you'd need batched requests and proper pagination handling.
- BAPIs (BAPI_MATERIAL_GETLIST, etc.) require RFC/ABAP connectivity. A typical ESG data extraction doesn't get SAP RFC credentials.
- Flat-file CSV: every SAP installation has transaction MB51 (Material Document List) and ME2N (Purchase Orders by Document Number). Any analyst with display authorization can export these as CSV. The sustainability team at an enterprise client will have this — they won't have OData credentials.

**Subset of SAP reality handled:**
- Movement types 201 (goods issue to cost center), 261 (goods issue to production order), 551 (GI to scrapping), 601 (GI for delivery)
- Units: L (liters), M3 (cubic meters → kWh energy equivalent), KG (kilograms), GAL (US gallons → liters)
- German column headers (Werk, Menge, Buchungsdatum) auto-mapped to canonical names

**Ignored:**
- Reversal postings (movement types 202, 262) — subtraction logic for corrections is out of scope for prototype
- Plant maintenance work orders vs. cost center postings (both map to same emission regardless)
- Batch management (Chargenverwaltung) — batch traceability is SAP-internal

**What I'd ask the PM:**
- Which SAP transactions does the client's sustainability team have display authorization for?
- Does the BASIS team run scheduled SM36 jobs, or does someone export manually?
- Is there a mapping from plant codes to physical locations? The sample uses a static config; in production this would come from SAP's T001 table.

---

## Utility: Portal CSV, PDF, or API?

**Ambiguity:** Electricity bills arrive as PDF (common for small accounts), portal CSV downloads (most enterprise accounts), or via Green Button / ESPI API (rare, US only, requires enrollment).

**Decision:** Portal CSV download.

**Why:**
- PDFs: brittle. Layout changes per billing period, per utility, per account type. OCR introduces transcription errors on numbers. pypdf/pdfminer can extract text but tabular data requires heuristic parsing that breaks silently. Not defensible for audit data.
- Green Button API (ESPI): only available in the US, requires OAuth 2.0 app registration with each utility, and most facilities teams haven't enrolled. Even where available, the response is XML in a non-standard schema that varies by utility. Not universally useful.
- Portal CSV: PG&E, National Grid, ComEd, E.ON, RWE, Vattenfall — virtually every major utility offers a CSV download from the customer portal. The schema varies but the key fields (meter ID, billing period start/end, usage kWh) are consistent enough to parse with a small column-alias map.

**Billing period reality baked in:**
A utility billing period of 2024-01-18 to 2024-02-14 is real — utilities bill ~30 days from meter read date, not calendar months. We store exact period_start/period_end instead of forcing allocation to a calendar month. Downstream analytics can allocate proportionally when needed.

**What I'd ask the PM:**
- How many meters does this client have? If >100, the facilities team probably uses a utility data management platform (Urjanet, Bidgee, EnergyCAP) that aggregates across utilities — and that platform likely has an API.
- Are there renewable energy certificates (RECs) that offset the reported consumption? The net_usage_kwh column handles generation credits but RECs are a separate line.

---

## Travel: Concur API, Navan API, or CSV export?

**Decision:** CSV export (Navan Insights / Concur Expense Reports).

**Why:**
- Navan API exists (REST, OAuth 2.0) but requires an enterprise integration contract and app approval that takes weeks. Not available day-of-onboarding.
- Concur API (SAP Concur Connect) has the same problem — you need SAP Concur credentials and API key registration. The sustainability team doesn't have this; the travel ops team does, and they're a separate stakeholder.
- CSV export from both Navan's Insights → Trips and Concur's Reports → Export is self-service and available immediately. It's exactly what sustainability consultants receive from clients.

**Flight distance without distance field:**
The biggest issue with travel exports. Navan sometimes includes distance; Concur almost never does. I use the Haversine great-circle formula with a static IATA airport coordinates table (covering ~200 major airports). This matches the approach used by DEFRA and most commercial carbon calculators. The limitation: airports not in the table produce a warning and the row is skipped rather than silently assigned a wrong distance.

**DEFRA/BEIS flight classification by distance:**
- Domestic: < 463 km (using DEFRA's 500 km threshold, approximated to match realistic domestic routes)
- Short-haul: 463–3,700 km
- Long-haul: > 3,700 km
This matters because emission factors differ by class: business long-haul is ~2.4x economy per km (radiative forcing included).

**What I'd ask the PM:**
- Does the client use Navan or Concur? The column names differ.
- Does the export include class of service for all trips? Business-class long-haul is the biggest Scope 3 driver and the EF multiplier (2.4x economy) changes the calculation significantly.
- Are hotel stays in this export or separate (Egencia, HRS)?

---

## Ingestion mechanism: synchronous vs. async

**Decision:** Synchronous — the upload endpoint parses and persists immediately, returns the batch result.

**Why for prototype:** Async processing (Celery + Redis) adds a deployment dependency and operational complexity that isn't justified for files of < 10,000 rows. The prototype handles 44 records in < 100ms.

**Production gap acknowledged:** A real SAP export can have 50,000+ rows. At that scale, synchronous processing would time out behind a reverse proxy (typically 30s). The services.py `ingest_file()` function is structured to be called from a Celery task with no changes — just wrap the call and return a batch ID instead of the full batch.

---

## Review workflow: optimistic vs. pessimistic

**Decision:** No record locking. Last-write-wins.

**Why:** With 1–5 analysts in the prototype, concurrent edits to the same record are rare. Adding optimistic concurrency (ETags, `updated_at` version field) or pessimistic locking (Redis-based) would complicate the prototype significantly. The audit log provides full history regardless of who wrote last.

---

## Unit normalization choices

| Source | Raw unit | Normalized unit | Conversion |
|--------|----------|-----------------|------------|
| SAP diesel | L | L | 1:1 |
| SAP natural gas | M3 | kWh | 10.55 kWh/m3 gross CV |
| SAP LPG | KG | kg | 1:1 |
| SAP US gallon | GAL | L | 3.78541 |
| Utility | kWh | kWh | 1:1 |
| Utility | MWh | kWh | × 1000 |
| Flight | km | km | 1:1 |
| Flight | miles | km | × 1.60934 |
| Hotel | nights | nights | 1:1 |

Natural gas in M3 → kWh uses **gross calorific value of 10.55 kWh/m3** (IPCC value for typical natural gas composition). This is slightly higher than net calorific value (9.5 kWh/m3). I chose gross CV because SAP typically reports M3 at meter conditions and DEFRA emission factors are expressed per kWh gross CV.

---

## Multi-tenancy: row-level vs. schema-per-tenant

**Decision:** Row-level (every table has `organization` FK).

**Why:** Schema-per-tenant requires dynamic schema creation, per-tenant migrations, and more complex query routing. At prototype scale (1 org, handful of users), row-level is correct. The `organization` FK is on every data table — upgrading to schema-per-tenant later is a migration, not a redesign.
