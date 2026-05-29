from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
from django.http import HttpResponse
import os

def index_view(request, **kwargs):
    """Serve React app for all non-API routes."""
    dist_index = os.path.join(settings.BASE_DIR.parent, "frontend", "dist", "index.html")
    if os.path.exists(dist_index):
        with open(dist_index) as f:
            return HttpResponse(f.read(), content_type="text/html")
    return HttpResponse("<h1>Breathe ESG API</h1><p>Frontend not built. Run <code>npm run build</code> in /frontend.</p>")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("ingestion.urls")),
    path("api-auth/", include("rest_framework.urls")),
    # Catch-all: serve React SPA
    path("", index_view),
    path("<path:path>", index_view),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
