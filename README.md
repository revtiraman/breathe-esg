# Breathe ESG — Emissions Data Ingestion & Review Platform

A Django REST + React app that ingests emissions activity data from SAP, utility portals, and corporate travel platforms, normalizes it, and surfaces a review dashboard for analyst sign-off before audit.

## Quick start (local)

**Backend:**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo    # creates demo users + loads sample data
python manage.py runserver
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev    # proxies /api to localhost:8000
```

Open http://localhost:5173 and log in with `admin` / `demo1234`.

## Credentials

| User | Password | Role |
|------|----------|------|
| admin | demo1234 | Admin (full access) |
| analyst | demo1234 | Analyst (review + approve) |

## What's been pre-loaded

The `seed_demo` command loads Q1 2024 sample data:
- **15 SAP records** — diesel, natural gas, petrol, LPG from 3 German plants
- **12 Utility records** — 5 electricity meters across 4 sites
- **17 Travel records** — flights, hotels, taxis, rail across 10 trips

## Ingesting your own data

1. Go to **Ingest** → select a data source → upload a CSV
2. Sample files are in `/sample_data/` — try re-uploading one
3. The parser returns a batch result with accepted/rejected/warning counts

## Deployment

See `railway.toml` for Railway.app deployment. Required environment variables are in `.env.example`.

## Documentation

- [MODEL.md](MODEL.md) — data model design and decisions
- [DECISIONS.md](DECISIONS.md) — ambiguities resolved and why
- [TRADEOFFS.md](TRADEOFFS.md) — three things deliberately not built
- [SOURCES.md](SOURCES.md) — source format research and what would break in production
