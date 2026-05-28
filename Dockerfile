FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

RUN python manage.py collectstatic --noinput

EXPOSE 8000
CMD python manage.py migrate && \
    python manage.py seed_demo && \
    gunicorn breathe.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 120
