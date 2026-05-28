# Tradeoffs — Three Things I Deliberately Built Differently

## 1. CO2e estimation (basic vs. production-grade EF engine)

**What was built:** `emission_factors.py` contains static DEFRA 2023 / UBA Germany emission factors for all supported categories. At ingest time, `compute_co2e()` calculates `co2e_kg` and stores the factor value, unit, and full citation string on each `ActivityRecord`. The UI surfaces these as indicative estimates with a warning label.

**What a production implementation adds:** An `EmissionFactor` table keyed by `(category, year, region, source)` holding versioned values from DEFRA/BEIS, EPA, IPCC AR5/AR6, and the IEA grid electricity database. Key differences:

- **Versioning:** DEFRA BEIS EFs update every June. EU grid EFs vary by bidding zone and change quarterly. Clients may require a specific version (IPCC AR5 vs AR6 vs DEFRA 2023) written into their audit scope. The current static table hardcodes 2023 values.
- **Recalculation:** When a new EF table ships, all approved records would need recalculation with a new `AuditLog` entry showing the before/after CO2e — not a re-ingestion.
- **Contractual renewables:** Clients with PPAs or REGOs need their Scope 2 market-based figure zeroed out, which requires a per-facility override layer.

**Why the static table is still correct:** Storing the emission factor and its source string on each record (rather than a FK to an EF table) ensures the calculation is always reproducible from the record alone, even after EF tables are updated. The gap is that you can't systematically recompute when a new factor vintage ships — you'd need to re-ingest or add a batch recalculation job.

---

## 2. Async ingestion with Celery

**What it would be:** A Celery worker consuming from a Redis queue. The upload endpoint returns immediately with a batch ID and status `processing`. The frontend polls `GET /api/batches/{id}/` until status changes to `completed`.

**Why I didn't build it:** Async processing requires Redis (a second stateful service), Celery workers (a third process), and deployment configuration for both. Railway can provision Redis and run workers, but the Railway configuration, worker startup, and health checks add operational surface that's disproportionate to what the prototype needs. The synchronous implementation processes 44 demo records in < 100ms.

The code is structured to make this upgrade safe. `ingest_file()` in services.py is a pure function — it takes content and returns a batch object. Wrapping it in a Celery task requires about 15 lines:

```python
@celery_app.task
def ingest_file_async(source_id, file_content, filename, user_id):
    source = DataSource.objects.get(id=source_id)
    user = User.objects.get(id=user_id)
    return str(ingest_file(source, file_content, filename, user).id)
```

**At what scale it matters:** If a single SAP export has > 5,000 rows, synchronous processing risks hitting proxy timeouts (typically 30s for Render/Railway). 5,000 SAP rows is a typical quarterly goods-movement export for a medium enterprise.

---

## 3. Full field-level edit history on ActivityRecord

**What it would be:** When an analyst corrects a `normalized_quantity` (e.g., the SAP export had a unit error they caught manually), the system creates a new `AuditLog` entry with `old_values={"normalized_quantity": "2500.0000"}` and `new_values={"normalized_quantity": "25000.0000"}` — and separately stores the full previous state of the record in a `RecordRevision` table for rollback.

**Why I didn't build it:** The current model captures the `is_edited` boolean and the review notes in the audit log, but doesn't store old field values for edited `ActivityRecord` fields. I chose this because:

1. The source row (`source_row` JSONField) is always the ground truth for what the file said. The audit log captures when status changes happened and who made them. This is sufficient for the audit use case — auditors want to know whether a record was approved and by whom, not a full diff history of every field.

2. Full field-level versioning adds significant complexity: either a shadow `RecordRevision` table with full-row snapshots, or a JSONField diff log that needs to handle Decimal serialization, null coercion, and partial updates safely.

**What's still auditable without it:** Every status transition is logged with before/after state. The original source row is immutable. If an analyst edited `normalized_quantity`, the `is_edited` flag is set and a `review_notes` entry captures why. For most audit scenarios, this is adequate. The gap is rollback capability — you can't undo an edit without knowing the old value.
