import csv
import io
from django.contrib.auth import authenticate, login, logout
from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import ActivityRecord, DataSource, IngestionBatch
from .serializers import (
    ActivityRecordDetailSerializer, ActivityRecordListSerializer,
    BulkReviewSerializer, DataSourceSerializer,
    IngestionBatchSerializer, ReviewActionSerializer, UserSerializer,
)
from .services import ingest_file, update_record_status


def get_org(user):
    return user.profile.organization


@api_view(["POST"])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get("username")
    password = request.data.get("password")
    user = authenticate(request, username=username, password=password)
    if user:
        login(request, user)
        return Response(UserSerializer(user).data)
    return Response({"detail": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response({"detail": "Logged out"})


@api_view(["GET"])
def me_view(request):
    return Response(UserSerializer(request.user).data)


@api_view(["GET"])
def dashboard_stats(request):
    org = get_org(request.user)
    qs = ActivityRecord.objects.filter(organization=org)

    status_counts = qs.values("status").annotate(n=Count("id"))
    status_map = {row["status"]: row["n"] for row in status_counts}

    scope_counts = qs.values("scope").annotate(n=Count("id"), co2e=Sum("co2e_kg"))
    scope_map = {f"scope_{row['scope']}": row["n"] for row in scope_counts}
    scope_co2e = {f"scope_{row['scope']}": float(row["co2e"] or 0) for row in scope_counts}

    source_counts = qs.values("batch__data_source__source_type").annotate(n=Count("id"), co2e=Sum("co2e_kg"))
    source_map = {row["batch__data_source__source_type"]: row["n"] for row in source_counts}
    source_co2e = {row["batch__data_source__source_type"]: float(row["co2e"] or 0) for row in source_counts}

    total_co2e = qs.aggregate(t=Sum("co2e_kg"))["t"] or 0
    approved_co2e = qs.filter(status="approved").aggregate(t=Sum("co2e_kg"))["t"] or 0

    recent_batches = IngestionBatch.objects.filter(organization=org).prefetch_related("issues")[:5]

    return Response({
        "total_records": qs.count(),
        "pending_review": status_map.get("pending_review", 0),
        "approved": status_map.get("approved", 0),
        "rejected": status_map.get("rejected", 0),
        "flagged": status_map.get("flagged_suspicious", 0),
        "total_co2e_kg": float(total_co2e),
        "approved_co2e_kg": float(approved_co2e),
        "scope_breakdown": scope_map,
        "scope_co2e": scope_co2e,
        "source_breakdown": source_map,
        "source_co2e": source_co2e,
        "recent_batches": IngestionBatchSerializer(recent_batches, many=True).data,
    })


class DataSourceViewSet(viewsets.ModelViewSet):
    serializer_class = DataSourceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return DataSource.objects.filter(organization=get_org(self.request.user))

    def perform_create(self, serializer):
        serializer.save(organization=get_org(self.request.user), created_by=self.request.user)


@api_view(["POST"])
def upload_file(request):
    source_id = request.data.get("source_id")
    uploaded_file = request.FILES.get("file")
    if not source_id or not uploaded_file:
        return Response({"detail": "source_id and file are required"}, status=400)
    try:
        data_source = DataSource.objects.get(id=source_id, organization=get_org(request.user))
    except DataSource.DoesNotExist:
        return Response({"detail": "Data source not found"}, status=404)
    file_content = uploaded_file.read()
    batch = ingest_file(data_source=data_source, file_content=file_content, filename=uploaded_file.name, user=request.user)
    return Response(IngestionBatchSerializer(batch).data, status=201)


class BatchViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = IngestionBatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return IngestionBatch.objects.filter(organization=get_org(self.request.user)).prefetch_related("issues")


class ActivityRecordViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        org = get_org(self.request.user)
        qs = ActivityRecord.objects.filter(organization=org).select_related(
            "batch__data_source", "reviewed_by"
        ).prefetch_related("issues")

        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        scope_filter = self.request.query_params.get("scope")
        if scope_filter:
            qs = qs.filter(scope=scope_filter)

        source_type = self.request.query_params.get("source_type")
        if source_type:
            qs = qs.filter(batch__data_source__source_type=source_type)

        batch_id = self.request.query_params.get("batch_id")
        if batch_id:
            qs = qs.filter(batch_id=batch_id)

        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(
                Q(facility_name__icontains=search)
                | Q(facility_code__icontains=search)
                | Q(description__icontains=search)
                | Q(supplier_vendor__icontains=search)
            )

        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ActivityRecordDetailSerializer
        return ActivityRecordListSerializer

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        record = self.get_object()
        serializer = ReviewActionSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        updated = update_record_status(
            record=record,
            new_status=serializer.validated_data["status"],
            user=request.user,
            notes=serializer.validated_data.get("notes", ""),
        )
        return Response(ActivityRecordDetailSerializer(updated).data)

    @action(detail=False, methods=["post"])
    def bulk_review(self, request):
        serializer = BulkReviewSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        org = get_org(request.user)
        ids = serializer.validated_data["ids"]
        new_status = serializer.validated_data["status"]
        notes = serializer.validated_data.get("notes", "")
        records = ActivityRecord.objects.filter(id__in=ids, organization=org)
        updated_count = 0
        for record in records:
            update_record_status(record=record, new_status=new_status, user=request.user, notes=notes)
            updated_count += 1
        return Response({"updated": updated_count})

    @action(detail=False, methods=["get"])
    def export(self, request):
        """
        GET /api/records/export/?status=approved
        Returns a CSV of activity records, ready for handoff to auditors.
        """
        org = get_org(request.user)
        qs = self.get_queryset().filter(organization=org)
        status_filter = request.query_params.get("status", "approved")
        if status_filter:
            qs = qs.filter(status=status_filter)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Scope", "Category", "Period Start", "Period End",
            "Facility Name", "Facility Code", "Country",
            "Raw Quantity", "Raw Unit",
            "Normalized Quantity", "Normalized Unit",
            "CO2e (kg)", "EF Value", "EF Unit", "EF Source",
            "Status", "Reviewed By", "Reviewed At", "Review Notes",
            "Supplier/Vendor", "Description",
            "Source Type", "Source File", "Source Row #",
            "Ingested At",
        ])
        for r in qs:
            writer.writerow([
                str(r.id), r.get_scope_display(), r.get_category_display(),
                r.period_start, r.period_end,
                r.facility_name, r.facility_code, r.country_code,
                r.raw_quantity, r.raw_unit,
                r.normalized_quantity, r.normalized_unit,
                r.co2e_kg or "", r.co2e_factor or "", r.co2e_factor_unit, r.co2e_factor_source,
                r.get_status_display(),
                r.reviewed_by.username if r.reviewed_by else "",
                r.reviewed_at.isoformat() if r.reviewed_at else "",
                r.review_notes,
                r.supplier_vendor, r.description,
                r.batch.data_source.source_type, r.batch.original_filename,
                r.source_row_number, r.created_at.isoformat(),
            ])

        response = HttpResponse(output.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="breathe_esg_export_{status_filter}.csv"'
        return response
