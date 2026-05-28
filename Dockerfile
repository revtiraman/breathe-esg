FROM node:20-slim AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && rm -rf /var/lib/apt/lists/*

# Mirror the original repo layout so BASE_DIR.parent = /app,
# and BASE_DIR.parent/frontend/dist resolves correctly.
COPY backend/ ./backend/
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

WORKDIR /app/backend
RUN pip install --no-cache-dir -r requirements.txt
RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["sh", "-c", "python manage.py migrate && python manage.py seed_demo && gunicorn breathe.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 120"]
