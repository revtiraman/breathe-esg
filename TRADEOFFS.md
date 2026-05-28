# Tradeoffs — Three Things I Deliberately Did Not Build

## 1. CO2e calculation engine

**What it would be:** An `EmissionFactor` table keyed by (category, year, region, source) holding values from DEFRA/BEIS, EPA, IPCC AR5/AR6, and the IEA electricity grid mix database. An `ActivityRecord` would have a computed `co2e_kg` field populated at approval time.

**Why I didn't build it:** Emission factors are the most contentious part of any ESG report. The UK DEFRA BEIS EFs are updated every June. EU grid electricity EFs change quarterly and vary by bidding zone. Different auditors accept different factor versions — some require IPCC AR5, some AR6. Some clients have contractual renewable electricity certificates that zero out their Scope 2. Building an EF engine that handles all of these cases correctly, and that produces an audit-defensible calculation, is easily a two-week project on its own.

The model is built for this: storing normalized activity quantities (kWh, liters, km, nights) is explicitly the right intermediate representation. You can apply any EF version at query time without touching stored data. Adding the EF engine later is additive, not a redesign.

**What a production implementation needs:** EF table with version history (factor_value, year, region, source, effective_from, effective_to), a `co2e_kg` field on `ActivityRecord`, recalculation on EF update with a new audit log entry, and clear UI showing which EF version was applied.

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
