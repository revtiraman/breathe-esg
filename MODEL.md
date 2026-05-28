# Data Model

## Core design principles

**Source-of-truth is always the raw row.** Every `ActivityRecord` stores the exact parsed row from the original file in `source_row` (JSONField). Normalization steps are stored alongside — raw_quantity/raw_unit paired with normalized_quantity/normalized_unit — so any future re-normalization can be verified against what the system received.

**Scope classification is on the record, not inferred.** GHG Protocol scope is a field, not derived from category. This matters when an organization sells electricity back to the grid (Scope 1 becomes Scope 3 upstream) or has unusual activity types.

**Audit immutability.** `AuditLog` entries are never deleted or updated. The `performed_at` field uses `auto_now_add`. Analysts can edit `review_notes` but the original ingested values live in `source_row` forever.

---

## Tables

### Organization
Multi-tenancy anchor. Every query that touches activity data includes `organization=` as a filter. The `slug` field enables URL-safe routing (`/acmecorp/review`) without exposing UUIDs.

### UserProfile
Extends Django's built-in `User` with organization membership and role. Avoids replacing Django auth (session/token infrastructure) while adding multi-tenancy. Roles are `analyst` (review/approve) and `admin` (manage sources, see all data).

### DataSource
Separates **what kind of data** from the data itself. One organization can have multiple SAP sources (SAP-EU, SAP-APAC) or multiple utility accounts. The `config` JSONField stores source-specific metadata:
- SAP: `plant_name_map` (plant code → human name), `delimiter`, encoding hint
- Utility: `meter_name_map`, `country_code`, `utility_name`
- Travel: `country_code` default

Separating config from data means you can re-ingest a file with updated mappings without touching historical records.

### IngestionBatch
The atomic unit of ingestion. One uploaded file → one batch. Key fields:

- **`file_hash`** (SHA-256): Duplicate detection. If a facilities coordinator re-uploads last month's bill, the system warns instead of silently doubling the data.
- **`raw_file`** (FileField): The original upload is kept. If a parsing bug is discovered, the file can be reprocessed without asking the client to re-upload.
- **`status`**: `processing → completed | completed_with_errors | failed`. Enables UI to show partial results while processing is ongoing (though the current implementation is synchronous — see TRADEOFFS.md).
- **Counts** (`row_count`, `accepted_count`, `rejected_count`, `warning_count`): Denormalized for dashboard queries without aggregating all records.

### ActivityRecord
The normalized, canonical emissions activity unit. Design choices:

**Why separate `raw_*` and `normalized_*`?**  
Auditors need to see what the source said. If SAP reported 450 M3 of natural gas and we normalized to 4,747.5 kWh, the auditor can verify the conversion factor (10.55 kWh/m3, gross calorific value per IPCC AR5). Storing both also means re-normalization is safe — you know what you started with.

**Why store `period_start`/`period_end` instead of a calendar month?**  
Utility billing periods don't align with months. A bill for 2024-01-18 to 2024-02-14 spans two months. Forcing it into January or February introduces allocation errors that compound when the data goes to auditors. We store the exact period the source reported and leave temporal aggregation to the query layer.

**Why not store CO2e?**  
Emission factors (EFs) change. The UK DEFRA BEIS EFs are updated annually. The EU electricity grid mix EFs change quarterly. If we stored CO2e at ingestion time, every EF update would require retroactive recalculation of locked audit data. Storing normalized activity quantities (kWh, liters, km, nights) makes the model auditable indefinitely — apply any EF version at query time.

**`scope` + `category` vs. just `category`:**  
Scope is an integer (1, 2, 3) that maps cleanly to GHG Protocol reporting. Category adds the sub-detail (diesel vs. natural gas vs. long-haul flight). An API consumer can group by scope alone without parsing category strings.

**Status lifecycle:**  
`pending_review → approved | rejected | flagged_suspicious`  
Records can move between statuses (e.g. flagged → approved after investigation). Each transition writes an `AuditLog` entry.

**`extra_data` JSONField:**  
Source-specific fields that don't belong in the normalized schema — SAP material number, utility tariff code, flight class of service. These are preserved for analysts who need them but don't pollute the main schema with source-specific columns.

### ValidationIssue
Decoupled from `ActivityRecord` because some issues are batch-level (unrecognized file format, wrong delimiter) — they don't correspond to any record. `severity=error` means a row was rejected (no `ActivityRecord` created). `severity=warning` means a record was created but auto-flagged.

### AuditLog
**Never touched after creation.** Records: who did what, when, before/after state. The `old_values`/`new_values` JSONField stores a snapshot of the changed fields — not a full record snapshot, just the fields that changed. This keeps audit entries readable while remaining sufficient for compliance.

---

## Indexes

Three composite indexes on `ActivityRecord`:
1. `(organization, status)` — the review queue query
2. `(organization, scope)` — dashboard breakdown
3. `(batch, status)` — batch detail view

`file_hash` on `IngestionBatch` — duplicate detection lookup.

---

## Multi-tenancy strategy

Row-level tenancy via `organization` FK on every data table. All view querysets begin with `filter(organization=get_org(request.user))`. No row-level security in the DB itself — the application layer enforces isolation. For a production system with hundreds of tenants, schema-per-tenant or PostgreSQL RLS would be worth the operational cost. At prototype scale, row-level is defensible.

---

## What this model doesn't handle (and why)

- **Emission factors table**: Out of scope. EFs are versioned, regional, and fuel-specific. A production system would need a `EmissionFactor` table keyed by (category, year, region, source) with version history.
- **Multi-currency normalization**: Cost fields are stored as strings from the source. Currency conversion is an analytics layer concern.
- **Revision history on ActivityRecord fields**: If an analyst corrects a normalized_quantity, the change is flagged (`is_edited=True`) and logged in AuditLog, but the old value isn't stored in a separate revision table. Good enough for prototype; production would want full field-level versioning.
