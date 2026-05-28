"""
Ingestion orchestration. Ties parsers to models.
One entry point: ingest_file(data_source, file_content, filename, user)
"""
import hashlib
import logging
from django.utils import timezone
from .models import ActivityRecord, AuditLog, DataSource, IngestionBatch, ValidationIssue
from .parsers import sap, utility, travel
from .emission_factors import compute_co2e

logger = logging.getLogger(__name__)

PARSER_MAP = {
    DataSource.SOURCE_SAP: sap.parse,
    DataSource.SOURCE_UTILITY: utility.parse,
    DataSource.SOURCE_TRAVEL: travel.parse,
}

# Suspicious threshold: if a single record's normalized quantity exceeds
# these values we flag it for analyst review.
SUSPICIOUS_THRESHOLDS = {
    "electricity": 1_000_000,   # kWh — 1 GWh per billing period is very large
    "fuel_diesel": 100_000,     # liters
    "fuel_petrol": 100_000,
    "fuel_natural_gas": 500_000, # kWh energy equivalent
    "flight_long_haul": 50_000, # km — circumference of Earth is ~40,000 km
}


def _hash_file(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def ingest_file(data_source: DataSource, file_content: bytes, filename: str, user=None) -> IngestionBatch:
    """
    Parse a file upload and persist all resulting ActivityRecords.
    Returns the completed IngestionBatch.
    """
    file_hash = _hash_file(file_content)

    # Duplicate file detection
    existing = IngestionBatch.objects.filter(
        organization=data_source.organization,
        file_hash=file_hash,
    ).first()
    if existing:
        logger.warning("Duplicate file upload detected: %s matches batch %s", filename, existing.id)

    batch = IngestionBatch.objects.create(
        data_source=data_source,
        organization=data_source.organization,
        uploaded_by=user,
        original_filename=filename,
        file_hash=file_hash,
        status=IngestionBatch.STATUS_PROCESSING,
    )

    parse_fn = PARSER_MAP.get(data_source.source_type)
    if not parse_fn:
        batch.status = IngestionBatch.STATUS_FAILED
        batch.processing_log = f"No parser for source type: {data_source.source_type}"
        batch.save()
        return batch

    try:
        parse_result = parse_fn(file_content, source_config=data_source.config)
    except Exception as exc:
        logger.exception("Parser crashed for batch %s", batch.id)
        batch.status = IngestionBatch.STATUS_FAILED
        batch.processing_log = f"Parser exception: {exc}"
        batch.save()
        ValidationIssue.objects.create(
            batch=batch,
            severity=ValidationIssue.SEV_ERROR,
            code="PARSER_EXCEPTION",
            message=str(exc),
        )
        return batch

    # Persist errors (no ActivityRecord created)
    for err in parse_result.errors:
        ValidationIssue.objects.create(
            batch=batch,
            severity=ValidationIssue.SEV_ERROR,
            code=err["code"],
            message=err["message"],
            source_row_number=err.get("row_number"),
        )

    # Persist warnings (may or may not be linked to a record yet — linked below)
    warning_by_row = {}
    for warn in parse_result.warnings:
        w = ValidationIssue.objects.create(
            batch=batch,
            severity=ValidationIssue.SEV_WARNING,
            code=warn["code"],
            message=warn["message"],
            source_row_number=warn.get("row_number"),
        )
        rn = warn.get("row_number")
        if rn:
            warning_by_row.setdefault(rn, []).append(w)

    # Persist accepted records
    records_created = 0
    for rec_data in parse_result.records:
        initial_status = ActivityRecord.STATUS_PENDING

        # Auto-flag suspicious quantities
        threshold = SUSPICIOUS_THRESHOLDS.get(rec_data.get("category", ""))
        if threshold and float(rec_data.get("normalized_quantity", 0)) > threshold:
            initial_status = ActivityRecord.STATUS_FLAGGED
            ValidationIssue.objects.create(
                batch=batch,
                severity=ValidationIssue.SEV_WARNING,
                code="SUSPICIOUS_QUANTITY",
                message=(
                    f"Quantity {rec_data['normalized_quantity']} {rec_data['normalized_unit']} "
                    f"exceeds auto-flag threshold for {rec_data['category']}"
                ),
                source_row_number=rec_data.get("source_row_number"),
            )

        # Compute approximate CO2e using DEFRA 2023 baseline factors
        co2e_kg, co2e_factor, co2e_factor_unit, co2e_source = compute_co2e(
            rec_data.get("category", ""),
            rec_data.get("normalized_quantity", 0),
            rec_data.get("extra_data", {}),
        )

        record = ActivityRecord.objects.create(
            batch=batch,
            organization=data_source.organization,
            status=initial_status,
            co2e_kg=co2e_kg,
            co2e_factor=co2e_factor,
            co2e_factor_unit=co2e_factor_unit or "",
            co2e_factor_source=co2e_source or "",
            **{k: v for k, v in rec_data.items() if k not in ("source_row", "source_row_number")},
            source_row=rec_data.get("source_row", {}),
            source_row_number=rec_data.get("source_row_number", 0),
        )

        # Link any row-level warnings to this record
        for w in warning_by_row.get(rec_data.get("source_row_number"), []):
            w.activity_record = record
            w.save(update_fields=["activity_record"])

        AuditLog.objects.create(
            activity_record=record,
            organization=data_source.organization,
            action=AuditLog.ACTION_INGESTED,
            performed_by=user,
            new_values={"status": initial_status, "batch_id": str(batch.id)},
        )

        records_created += 1

    batch.row_count = records_created + len(parse_result.errors)
    batch.accepted_count = records_created
    batch.rejected_count = len(parse_result.errors)
    batch.warning_count = len(parse_result.warnings)
    batch.status = (
        IngestionBatch.STATUS_COMPLETED
        if not parse_result.errors
        else IngestionBatch.STATUS_COMPLETED_WITH_ERRORS
    )
    batch.save()
    return batch


def update_record_status(record: ActivityRecord, new_status: str, user, notes: str = "") -> ActivityRecord:
    """Apply a status transition and write an audit log entry."""
    old_status = record.status
    action_map = {
        ActivityRecord.STATUS_APPROVED: AuditLog.ACTION_APPROVED,
        ActivityRecord.STATUS_REJECTED: AuditLog.ACTION_REJECTED,
        ActivityRecord.STATUS_FLAGGED: AuditLog.ACTION_FLAGGED,
        ActivityRecord.STATUS_PENDING: AuditLog.ACTION_NOTE,
    }

    record.status = new_status
    record.reviewed_by = user
    record.reviewed_at = timezone.now()
    if notes:
        record.review_notes = notes
    record.save()

    AuditLog.objects.create(
        activity_record=record,
        organization=record.organization,
        action=action_map.get(new_status, AuditLog.ACTION_NOTE),
        performed_by=user,
        old_values={"status": old_status},
        new_values={"status": new_status},
        notes=notes,
    )
    return record
