from django.contrib import admin
from .models import ActivityRecord, AuditLog, DataSource, IngestionBatch, Organization, UserProfile, ValidationIssue


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "created_at"]


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "organization", "role"]


@admin.register(DataSource)
class DataSourceAdmin(admin.ModelAdmin):
    list_display = ["name", "organization", "source_type", "is_active", "created_at"]
    list_filter = ["source_type", "is_active"]


@admin.register(IngestionBatch)
class IngestionBatchAdmin(admin.ModelAdmin):
    list_display = ["original_filename", "data_source", "status", "row_count", "accepted_count", "rejected_count", "uploaded_at"]
    list_filter = ["status", "data_source__source_type"]
    readonly_fields = ["file_hash", "uploaded_at"]


@admin.register(ActivityRecord)
class ActivityRecordAdmin(admin.ModelAdmin):
    list_display = ["category", "facility_name", "period_start", "normalized_quantity", "normalized_unit", "status", "scope"]
    list_filter = ["status", "scope", "category"]
    search_fields = ["facility_name", "facility_code", "description"]
    readonly_fields = ["source_row", "created_at", "updated_at"]


@admin.register(ValidationIssue)
class ValidationIssueAdmin(admin.ModelAdmin):
    list_display = ["code", "severity", "message", "source_row_number", "batch"]
    list_filter = ["severity", "code"]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["action", "activity_record", "performed_by", "performed_at"]
    list_filter = ["action"]
    readonly_fields = ["performed_at", "old_values", "new_values"]
