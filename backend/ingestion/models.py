import uuid
from django.db import models
from django.contrib.auth.models import User


class Organization(models.Model):
    """Tenant. Every piece of data is scoped here."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class UserProfile(models.Model):
    ROLE_ANALYST = "analyst"
    ROLE_ADMIN = "admin"
    ROLES = [(ROLE_ANALYST, "Analyst"), (ROLE_ADMIN, "Admin")]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="members")
    role = models.CharField(max_length=20, choices=ROLES, default=ROLE_ANALYST)

    def __str__(self):
        return f"{self.user.username} ({self.organization.slug})"


class DataSource(models.Model):
    """
    A configured ingestion channel within an organization.
    Separates config from data — you can have multiple SAP sources
    (e.g. SAP-EU and SAP-APAC) for the same org.
    """
    SOURCE_SAP = "SAP"
    SOURCE_UTILITY = "UTILITY"
    SOURCE_TRAVEL = "TRAVEL"
    SOURCE_TYPES = [
        (SOURCE_SAP, "SAP (Fuel & Procurement)"),
        (SOURCE_UTILITY, "Utility Portal (Electricity)"),
        (SOURCE_TRAVEL, "Corporate Travel (Concur/Navan)"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="data_sources")
    source_type = models.CharField(max_length=20, choices=SOURCE_TYPES)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # Source-specific config: plant_code_map, meter_id_map, cost_center_map, etc.
    config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.organization.slug} / {self.name}"


class IngestionBatch(models.Model):
    """
    One file upload = one batch. The atomic unit of ingestion.
    Stores enough metadata to detect duplicates and support reprocessing.
    """
    STATUS_PROCESSING = "processing"
    STATUS_COMPLETED = "completed"
    STATUS_COMPLETED_WITH_ERRORS = "completed_with_errors"
    STATUS_FAILED = "failed"
    STATUSES = [
        (STATUS_PROCESSING, "Processing"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_COMPLETED_WITH_ERRORS, "Completed with Errors"),
        (STATUS_FAILED, "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    data_source = models.ForeignKey(DataSource, on_delete=models.CASCADE, related_name="batches")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="batches")
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    original_filename = models.CharField(max_length=500)
    # SHA-256 of the raw file content — prevents re-uploading the same file silently
    file_hash = models.CharField(max_length=64, db_index=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=30, choices=STATUSES, default=STATUS_PROCESSING)
    row_count = models.IntegerField(default=0)
    accepted_count = models.IntegerField(default=0)
    rejected_count = models.IntegerField(default=0)
    warning_count = models.IntegerField(default=0)
    raw_file = models.FileField(upload_to="uploads/%Y/%m/", blank=True)
    processing_log = models.TextField(blank=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.data_source.name} / {self.original_filename} ({self.uploaded_at:%Y-%m-%d})"


class ActivityRecord(models.Model):
    """
    The normalized, canonical unit of emissions activity data.

    Scope classification follows GHG Protocol:
      Scope 1 — direct combustion of fuel on-site or in company vehicles
      Scope 2 — purchased electricity consumed at company facilities
      Scope 3 — indirect value chain emissions (business travel here)

    Units are always normalized:
      Electricity → kWh
      Fuel (liquid) → liters
      Fuel (gas) → kWh (energy equivalent, using gross calorific value)
      Distance (flights, ground) → km
      Hotel stays → nights

    CO2e calculation is intentionally deferred — emission factors change
    by year, region, and grid mix. Storing normalized activity quantities
    keeps this model auditable even when EFs are updated.
    """
    SCOPE_1 = 1
    SCOPE_2 = 2
    SCOPE_3 = 3
    SCOPES = [(1, "Scope 1"), (2, "Scope 2"), (3, "Scope 3")]

    CAT_FUEL_DIESEL = "fuel_diesel"
    CAT_FUEL_PETROL = "fuel_petrol"
    CAT_FUEL_NATURAL_GAS = "fuel_natural_gas"
    CAT_FUEL_LPG = "fuel_lpg"
    CAT_FUEL_OTHER = "fuel_other"
    CAT_ELECTRICITY = "electricity"
    CAT_FLIGHT_DOMESTIC = "flight_domestic"
    CAT_FLIGHT_SHORT_HAUL = "flight_short_haul"
    CAT_FLIGHT_LONG_HAUL = "flight_long_haul"
    CAT_HOTEL_STAY = "hotel_stay"
    CAT_GROUND_CAR = "ground_car"
    CAT_GROUND_RAIL = "ground_rail"
    CAT_GROUND_TAXI = "ground_taxi"

    CATEGORIES = [
        (CAT_FUEL_DIESEL, "Diesel"),
        (CAT_FUEL_PETROL, "Petrol / Gasoline"),
        (CAT_FUEL_NATURAL_GAS, "Natural Gas"),
        (CAT_FUEL_LPG, "LPG"),
        (CAT_FUEL_OTHER, "Other Fuel"),
        (CAT_ELECTRICITY, "Electricity"),
        (CAT_FLIGHT_DOMESTIC, "Flight (Domestic)"),
        (CAT_FLIGHT_SHORT_HAUL, "Flight (Short-Haul)"),
        (CAT_FLIGHT_LONG_HAUL, "Flight (Long-Haul)"),
        (CAT_HOTEL_STAY, "Hotel Stay"),
        (CAT_GROUND_CAR, "Ground — Car"),
        (CAT_GROUND_RAIL, "Ground — Rail"),
        (CAT_GROUND_TAXI, "Ground — Taxi/Rideshare"),
    ]

    STATUS_PENDING = "pending_review"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_FLAGGED = "flagged_suspicious"
    STATUSES = [
        (STATUS_PENDING, "Pending Review"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
        (STATUS_FLAGGED, "Flagged — Suspicious"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(IngestionBatch, on_delete=models.CASCADE, related_name="records")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="records")

    scope = models.IntegerField(choices=SCOPES)
    category = models.CharField(max_length=30, choices=CATEGORIES)

    # Billing/activity period. Utility bills and SAP posting periods rarely
    # align with calendar months, so we store exact start/end.
    period_start = models.DateField()
    period_end = models.DateField()

    facility_name = models.CharField(max_length=500, blank=True)
    # Raw code from source — e.g. SAP plant code "DE01", meter ID "MTR-A4421"
    facility_code = models.CharField(max_length=100, blank=True, db_index=True)
    country_code = models.CharField(max_length=2, blank=True)

    raw_quantity = models.DecimalField(max_digits=18, decimal_places=4)
    raw_unit = models.CharField(max_length=50)

    # Normalized quantity in normalized_unit (see class docstring for unit conventions)
    normalized_quantity = models.DecimalField(max_digits=18, decimal_places=4)
    normalized_unit = models.CharField(max_length=50)

    supplier_vendor = models.CharField(max_length=500, blank=True)
    description = models.CharField(max_length=1000, blank=True)
    extra_data = models.JSONField(default=dict, blank=True)

    status = models.CharField(max_length=20, choices=STATUSES, default=STATUS_PENDING)
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_records"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)

    # Source-of-truth provenance
    source_row = models.JSONField()
    source_row_number = models.IntegerField()

    # Approximate CO2e using DEFRA 2023 baseline emission factors.
    # Null = no factor available (unknown category or missing distance).
    # Do NOT submit to auditors without validating against client-specific EFs.
    co2e_kg = models.DecimalField(max_digits=18, decimal_places=4, null=True, blank=True)
    co2e_factor = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    co2e_factor_unit = models.CharField(max_length=50, blank=True)
    co2e_factor_source = models.CharField(max_length=500, blank=True)

    # Was this record edited after ingestion?
    is_edited = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start", "facility_code"]
        indexes = [
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["organization", "scope"]),
            models.Index(fields=["batch", "status"]),
        ]

    def __str__(self):
        return f"{self.get_category_display()} | {self.facility_name or self.facility_code} | {self.period_start}"


class ValidationIssue(models.Model):
    """
    Validation problems found during ingestion.
    ERROR = record rejected. WARNING = accepted but flagged for review.
    """
    SEV_ERROR = "error"
    SEV_WARNING = "warning"
    SEV_INFO = "info"
    SEVERITIES = [
        (SEV_ERROR, "Error"),
        (SEV_WARNING, "Warning"),
        (SEV_INFO, "Info"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(IngestionBatch, on_delete=models.CASCADE, related_name="issues")
    activity_record = models.ForeignKey(
        ActivityRecord, on_delete=models.CASCADE, related_name="issues", null=True, blank=True
    )
    severity = models.CharField(max_length=10, choices=SEVERITIES)
    code = models.CharField(max_length=50)
    message = models.TextField()
    source_row_number = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["source_row_number", "severity"]

    def __str__(self):
        return f"[{self.severity.upper()}] {self.code}: {self.message[:80]}"


class AuditLog(models.Model):
    """
    Immutable audit trail. One entry per status change or edit on an ActivityRecord.
    Never delete these rows — they are the legal trail for auditors.
    """
    ACTION_INGESTED = "ingested"
    ACTION_APPROVED = "approved"
    ACTION_REJECTED = "rejected"
    ACTION_FLAGGED = "flagged"
    ACTION_EDITED = "edited"
    ACTION_NOTE = "note_added"
    ACTIONS = [
        (ACTION_INGESTED, "Ingested"),
        (ACTION_APPROVED, "Approved"),
        (ACTION_REJECTED, "Rejected"),
        (ACTION_FLAGGED, "Flagged as Suspicious"),
        (ACTION_EDITED, "Edited"),
        (ACTION_NOTE, "Note Added"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    activity_record = models.ForeignKey(ActivityRecord, on_delete=models.CASCADE, related_name="audit_log")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE)
    action = models.CharField(max_length=20, choices=ACTIONS)
    performed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    performed_at = models.DateTimeField(auto_now_add=True)
    old_values = models.JSONField(default=dict)
    new_values = models.JSONField(default=dict)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["performed_at"]

    def __str__(self):
        return f"{self.action} on {self.activity_record_id} at {self.performed_at:%Y-%m-%d %H:%M}"
