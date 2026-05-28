"""
Utility (electricity) CSV portal export parser.

Format chosen: CSV portal export from a utility provider's customer
portal (modeled on PG&E/National Grid/ComEd download formats).

Why CSV portal export, not PDF or API:
  - PDF: brittle, layout changes per billing period, OCR errors on numbers
  - Utility API (Green Button / ESPI): not universally available; requires
    OAuth enrollment that most facilities teams haven't done
  - CSV portal export: available from virtually every major US/EU utility,
    consistent enough across providers to parse with one schema, and is
    exactly what a facilities coordinator actually downloads

Key realities this parser handles:
  - Billing periods DO NOT align with calendar months. A period of
    2024-03-18 to 2024-04-15 is normal. We store exact start/end.
  - Units vary: kWh, MWh, kVAh. We normalize to kWh.
  - Net usage = total consumption - any on-site generation credits
  - Demand (kW) is stored separately — it's peak demand, not energy
  - Some meters report in 15-minute intervals; portal exports are usually
    monthly billing summaries (we handle monthly summaries only)
  - Multi-meter accounts: one account can have multiple meter IDs
"""
import csv
import io
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import List

logger = logging.getLogger(__name__)

# Utility unit → (canonical_unit, factor_to_kWh)
UNIT_MAP = {
    "KWH": ("kWh", Decimal("1")),
    "MWH": ("kWh", Decimal("1000")),
    "GWH": ("kWh", Decimal("1000000")),
    "KVAH": ("kWh", Decimal("1")),     # kVAh ≈ kWh for most purposes; flag as warning
    "THERM": ("kWh", Decimal("29.3")), # therms to kWh
}

COLUMN_ALIASES = {
    "account number": "account_number",
    "account no": "account_number",
    "account #": "account_number",
    "meter number": "meter_id",
    "meter id": "meter_id",
    "meter no": "meter_id",
    "service address": "address",
    "service location": "address",
    "address": "address",
    "statement date": "statement_date",
    "billing period start": "period_start",
    "start date": "period_start",
    "period start": "period_start",
    "from": "period_start",
    "billing period end": "period_end",
    "end date": "period_end",
    "period end": "period_end",
    "to": "period_end",
    "usage (kwh)": "usage_kwh",
    "usage kwh": "usage_kwh",
    "kwh used": "usage_kwh",
    "consumption (kwh)": "usage_kwh",
    "net usage (kwh)": "net_usage_kwh",
    "net kwh": "net_usage_kwh",
    "usage (mwh)": "usage_mwh",
    "demand (kw)": "peak_demand_kw",
    "peak demand": "peak_demand_kw",
    "rate schedule": "tariff",
    "rate code": "tariff",
    "tariff": "tariff",
    "rate": "tariff",
    "total charges": "cost_usd",
    "amount due": "cost_usd",
    "total amount": "cost_usd",
    "charges": "cost_usd",
}


def _normalize_header(h: str) -> str:
    return h.strip().lower().replace("﻿", "").replace("_", " ")


def _parse_date(s: str) -> datetime | None:
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _parse_decimal(s: str) -> Decimal | None:
    s = s.strip().replace(",", "").replace("$", "").replace(" ", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


class ParseResult:
    def __init__(self):
        self.records: List[dict] = []
        self.errors: List[dict] = []
        self.warnings: List[dict] = []


def parse(file_content: bytes, source_config: dict = None) -> ParseResult:
    """Parse a utility portal CSV export."""
    result = ParseResult()
    config = source_config or {}
    meter_name_map = config.get("meter_name_map", {})  # {"MTR-001": "Building A"}

    try:
        text = file_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = file_content.decode("latin-1")

    # Try to auto-detect delimiter
    sample = text[:2000]
    delimiter = "," if sample.count(",") > sample.count(";") else ";"

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    if not reader.fieldnames:
        result.errors.append({"row_number": 0, "code": "EMPTY_FILE", "message": "File is empty or has no headers"})
        return result

    col_map = {}
    for raw_col in reader.fieldnames:
        normalized = _normalize_header(raw_col)
        canonical = COLUMN_ALIASES.get(normalized)
        if canonical:
            col_map[raw_col] = canonical

    def get(row, name, default=""):
        for raw, can in col_map.items():
            if can == name and raw in row:
                return (row[raw] or "").strip()
        return default

    seen = set()

    for row_num, row in enumerate(reader, start=2):
        if not any(v.strip() for v in row.values() if v):
            continue

        period_start_str = get(row, "period_start")
        period_end_str = get(row, "period_end")
        period_start = _parse_date(period_start_str)
        period_end = _parse_date(period_end_str)

        if not period_start or not period_end:
            result.errors.append({
                "row_number": row_num,
                "code": "INVALID_DATE",
                "message": f"Could not parse billing period: start='{period_start_str}' end='{period_end_str}'"
            })
            continue

        if period_end < period_start:
            result.errors.append({
                "row_number": row_num,
                "code": "INVALID_PERIOD",
                "message": f"Billing period end {period_end.date()} is before start {period_start.date()}"
            })
            continue

        # Accept net_usage if available (generation-credited), else raw usage
        usage_str = get(row, "net_usage_kwh") or get(row, "usage_kwh") or get(row, "usage_mwh")
        raw_unit_key = "kWh"
        if get(row, "usage_mwh") and not get(row, "usage_kwh") and not get(row, "net_usage_kwh"):
            raw_unit_key = "MWh"

        usage = _parse_decimal(usage_str)
        if usage is None:
            result.errors.append({
                "row_number": row_num,
                "code": "MISSING_USAGE",
                "message": "No usage quantity found in row"
            })
            continue

        if usage < 0:
            result.warnings.append({
                "row_number": row_num,
                "code": "NEGATIVE_USAGE",
                "message": f"Negative usage {usage} kWh — likely a credit or correction. Review."
            })

        if raw_unit_key == "MWh":
            normalized_qty = usage * Decimal("1000")
            normalized_unit = "kWh"
        else:
            normalized_qty = usage
            normalized_unit = "kWh"

        meter_id = get(row, "meter_id")
        account = get(row, "account_number")
        address = get(row, "address")
        tariff = get(row, "tariff")

        # Flag unusually high monthly usage (> 500,000 kWh per meter = large industrial)
        if normalized_qty > Decimal("500000"):
            result.warnings.append({
                "row_number": row_num,
                "code": "HIGH_USAGE",
                "message": f"Usage {normalized_qty:,.0f} kWh exceeds 500,000 kWh threshold — verify meter read"
            })

        dedup_key = (meter_id, str(period_start.date()), str(period_end.date()))
        if dedup_key in seen:
            result.warnings.append({
                "row_number": row_num,
                "code": "DUPLICATE_ROW",
                "message": f"Meter {meter_id} already has a row for this billing period"
            })
        seen.add(dedup_key)

        facility_name = meter_name_map.get(meter_id, "") or address[:100] if address else ""

        peak_demand_str = get(row, "peak_demand_kw")
        cost_str = get(row, "cost_usd")

        result.records.append({
            "scope": 2,
            "category": "electricity",
            "period_start": period_start.date(),
            "period_end": period_end.date(),
            "facility_code": meter_id or account,
            "facility_name": facility_name,
            "country_code": config.get("country_code", "US"),
            "raw_quantity": usage,
            "raw_unit": raw_unit_key,
            "normalized_quantity": normalized_qty,
            "normalized_unit": normalized_unit,
            "supplier_vendor": config.get("utility_name", ""),
            "description": f"Electricity — {tariff}" if tariff else "Electricity",
            "extra_data": {
                "account_number": account,
                "meter_id": meter_id,
                "tariff": tariff,
                "peak_demand_kw": peak_demand_str,
                "cost_usd": cost_str,
                "address": address,
            },
            "source_row": dict(row),
            "source_row_number": row_num,
        })

    return result
