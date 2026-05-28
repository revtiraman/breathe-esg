from django.contrib.auth import authenticate, login, logout
from django.db.models import Count, Q
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

    scope_counts = qs.values("scope").annotate(n=Count("id"))
    scope_map = {f"scope_{row['scope']}": row["n"] for row in scope_counts}

    source_counts = qs.values("batch__data_source__source_type").annotate(n=Count("id"))
    source_map = {row["batch__data_source__source_type"]: row["n"] for row in source_counts}

    recent_batches = IngestionBatch.objects.filter(organization=org).prefetch_related("issues")[:5]

    return Response({
        "total_records": qs.count(),
        "pending_review": status_map.get("pending_review", 0),
        "approved": status_map.get("approved", 0),
        "rejected": status_map.get("rejected", 0),
        "flagged": status_map.get("flagged_suspicious", 0),
        "scope_breakdown": scope_map,
        "source_breakdown": source_map,
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
