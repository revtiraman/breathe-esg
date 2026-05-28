from rest_framework import serializers
from django.contrib.auth.models import User
from .models import (
    ActivityRecord, AuditLog, DataSource, IngestionBatch,
    Organization, UserProfile, ValidationIssue,
)


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "created_at"]


class DataSourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DataSource
        fields = ["id", "source_type", "name", "description", "is_active", "created_at"]


class ValidationIssueSerializer(serializers.ModelSerializer):
    class Meta:
        model = ValidationIssue
        fields = ["id", "severity", "code", "message", "source_row_number", "created_at"]


class IngestionBatchSerializer(serializers.ModelSerializer):
    data_source_name = serializers.CharField(source="data_source.name", read_only=True)
    source_type = serializers.CharField(source="data_source.source_type", read_only=True)
    uploaded_by_username = serializers.CharField(source="uploaded_by.username", read_only=True)
    issues = ValidationIssueSerializer(many=True, read_only=True)

    class Meta:
        model = IngestionBatch
        fields = [
            "id", "data_source", "data_source_name", "source_type",
            "uploaded_by_username", "original_filename", "uploaded_at",
            "status", "row_count", "accepted_count", "rejected_count",
            "warning_count", "processing_log", "issues",
        ]


class AuditLogSerializer(serializers.ModelSerializer):
    performed_by_username = serializers.CharField(source="performed_by.username", read_only=True)

    class Meta:
        model = AuditLog
        fields = ["id", "action", "performed_by_username", "performed_at", "old_values", "new_values", "notes"]


class ActivityRecordListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for the review table (no source_row to keep payload small)."""
    batch_filename = serializers.CharField(source="batch.original_filename", read_only=True)
    source_type = serializers.CharField(source="batch.data_source.source_type", read_only=True)
    reviewed_by_username = serializers.CharField(source="reviewed_by.username", read_only=True)
    issue_count = serializers.SerializerMethodField()
    scope_display = serializers.CharField(source="get_scope_display", read_only=True)
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ActivityRecord
        fields = [
            "id", "scope", "scope_display", "category", "category_display",
            "period_start", "period_end",
            "facility_name", "facility_code", "country_code",
            "raw_quantity", "raw_unit", "normalized_quantity", "normalized_unit",
            "status", "status_display",
            "reviewed_by_username", "reviewed_at",
            "supplier_vendor", "description",
            "batch", "batch_filename", "source_type",
            "is_edited", "created_at",
            "issue_count",
        ]

    def get_issue_count(self, obj):
        return obj.issues.count()


class ActivityRecordDetailSerializer(serializers.ModelSerializer):
    """Full serializer including source_row and audit log."""
    batch_filename = serializers.CharField(source="batch.original_filename", read_only=True)
    source_type = serializers.CharField(source="batch.data_source.source_type", read_only=True)
    reviewed_by_username = serializers.CharField(source="reviewed_by.username", read_only=True)
    issues = ValidationIssueSerializer(many=True, read_only=True)
    audit_log = AuditLogSerializer(many=True, read_only=True)
    scope_display = serializers.CharField(source="get_scope_display", read_only=True)
    category_display = serializers.CharField(source="get_category_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ActivityRecord
        fields = [
            "id", "scope", "scope_display", "category", "category_display",
            "period_start", "period_end",
            "facility_name", "facility_code", "country_code",
            "raw_quantity", "raw_unit", "normalized_quantity", "normalized_unit",
            "status", "status_display",
            "reviewed_by", "reviewed_by_username", "reviewed_at", "review_notes",
            "supplier_vendor", "description", "extra_data",
            "batch", "batch_filename", "source_type",
            "source_row", "source_row_number",
            "is_edited", "created_at", "updated_at",
            "issues", "audit_log",
        ]


class ReviewActionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        ActivityRecord.STATUS_APPROVED,
        ActivityRecord.STATUS_REJECTED,
        ActivityRecord.STATUS_FLAGGED,
        ActivityRecord.STATUS_PENDING,
    ])
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class BulkReviewSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=500)
    status = serializers.ChoiceField(choices=[
        ActivityRecord.STATUS_APPROVED,
        ActivityRecord.STATUS_REJECTED,
        ActivityRecord.STATUS_FLAGGED,
    ])
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class UserSerializer(serializers.ModelSerializer):
    organization = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "first_name", "last_name", "organization", "role"]

    def get_organization(self, obj):
        try:
            return OrganizationSerializer(obj.profile.organization).data
        except Exception:
            return None

    def get_role(self, obj):
        try:
            return obj.profile.role
        except Exception:
            return None


class DashboardStatsSerializer(serializers.Serializer):
    total_records = serializers.IntegerField()
    pending_review = serializers.IntegerField()
    approved = serializers.IntegerField()
    rejected = serializers.IntegerField()
    flagged = serializers.IntegerField()
    scope_breakdown = serializers.DictField()
    source_breakdown = serializers.DictField()
    recent_batches = IngestionBatchSerializer(many=True)
