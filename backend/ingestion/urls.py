from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("sources", views.DataSourceViewSet, basename="datasource")
router.register("batches", views.BatchViewSet, basename="batch")
router.register("records", views.ActivityRecordViewSet, basename="record")

urlpatterns = [
    path("", include(router.urls)),
    path("auth/login/", views.login_view),
    path("auth/logout/", views.logout_view),
    path("auth/me/", views.me_view),
    path("upload/", views.upload_file),
    path("dashboard/", views.dashboard_stats),
]
