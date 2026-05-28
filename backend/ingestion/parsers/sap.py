"""
SAP flat-file parser for fuel and procurement data.

Format chosen: SAP MB51 / ME2N combined CSV export — the output of a
custom ABAP report or SM36 scheduled job that merges goods-movement
(MB51) and purchase-order (ME2N) data. This is the most common real-world
extraction path for enterprise ESG data: the SAP BASIS team runs a
scheduled report and drops a file to a shared drive or SFTP.

We do NOT use IDoc because IDoc is optimized for system-to-system
messaging (EDI), not BI extraction. We do NOT use OData because the
SAP Gateway is rarely exposed to third parties. Flat CSV with a known
layout is what sustainability teams actually receive.

SAP quirks this parser handles:
  - Dates in DD.MM.YYYY format (German locale default)
  - Unit codes from SAP's T006/T006A tables: L, KG, M3, ST, GAL, LB
  - German column header variants (Werk, Menge, Buchungsdatum)
  - Plant codes (Werk) that need a lookup table for human-readable names
  - Movement types (Bewegungsart): 201=GI cost center, 261=GI production,
    101=GR from vendor — we only care about goods issues (consumption)
  - Fuel materials identified by material group (MATKL) prefix or
    material description keywords
"""
import csv
import io
import logging
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import List, Tuple

logger = logging.getLogger(__name__)

# SAP unit code → (canonical_unit, conversion_factor_to_canonical)
# Canonical: liters for liquid fuels, kWh for gas (energy-equivalent)
UNIT_MAP = {
    # Liquid fuels → liters
    "L":   ("L", Decimal("1")),
    "LTR": ("L", Decimal("1")),
    "GAL": ("L", Decimal("3.78541")),    # US gallon to liters
    "GL":  ("L", Decimal("3.78541")),
    # Natural gas → kWh (using gross calorific value 10.55 kWh/m3 for natural gas)
    "M3":  ("kWh", Decimal("10.55")),
    "KG":  ("kg", Decimal("1")),         # for LPG by weight — kept as kg
    "LB":  ("kg", Decimal("0.453592")),  # pounds to kg
    "ST":  (None, None),                 # pieces — not a fuel unit, skip
    "EA":  (None, None),                 # each — same
}

# SAP material description keywords that indicate fuel category
FUEL_KEYWORDS = {
    "diesel": "fuel_diesel",
    "gas oil": "fuel_diesel",
    "petrol": "fuel_petrol",
    "gasoline": "fuel_petrol",
    "benzin": "fuel_petrol",     # German
    "kraftstoff": "fuel_petrol", # German: fuel/propellant
    "natural gas": "fuel_natural_gas",
    "erdgas": "fuel_natural_gas", # German
    "lpg": "fuel_lpg",
    "liquefied petroleum": "fuel_lpg",
    "autogas": "fuel_lpg",
    "heating oil": "fuel_diesel",
    "heizöl": "fuel_diesel",     # German
}

# SAP movement types we care about (goods issues = actual consumption)
CONSUMPTION_MOVEMENT_TYPES = {"201", "261", "551", "601"}

# Column name aliases — SAP exports can have German or English headers
COLUMN_ALIASES = {
    "werk": "plant",
    "plant": "plant",
    "buchungsdatum": "posting_date",
    "posting date": "posting_date",
    "belegdatum": "document_date",
    "document date": "document_date",
    "menge": "quantity",
    "quantity": "quantity",
    "basismengeneinheit": "unit",
    "base unit": "unit",
    "einheit": "unit",
    "unit of measure": "unit",
    "bewegungsart": "movement_type",
    "movement type": "movement_type",
    "material": "material",
    "materialnummer": "material",
    "kurztext": "material_desc",
    "material description": "material_desc",
    "materialkurztext": "material_desc",
    "kostenstelle": "cost_center",
    "cost center": "cost_center",
    "kostenstelle (kurz)": "cost_center",
    "lieferant": "vendor",
    "vendor": "vendor",
    "vendor name": "vendor_name",
    "name 1": "vendor_name",
}


def _normalize_header(h: str) -> str:
    return h.strip().lower().replace("﻿", "")


def _parse_sap_date(date_str: str) -> datetime | None:
    """Handle DD.MM.YYYY, YYYY-MM-DD, YYYYMMDD formats."""
    date_str = date_str.strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y%m%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None


def _classify_fuel(material_desc: str, material_group: str = "") -> str:
    desc_lower = (material_desc or "").lower()
    mgroup_lower = (material_group or "").lower()
    combined = desc_lower + " " + mgroup_lower
    for keyword, category in FUEL_KEYWORDS.items():
        if keyword in combined:
            return category
    return "fuel_other"


class ParseResult:
    def __init__(self):
        self.records: List[dict] = []
        self.errors: List[dict] = []
        self.warnings: List[dict] = []


def parse(file_content: bytes, source_config: dict = None) -> ParseResult:
    """
    Parse a SAP MB51/ME2N CSV export.

    Returns ParseResult with:
      .records — list of normalized activity dicts ready for ActivityRecord creation
      .errors  — list of {row_number, code, message} for rejected rows
      .warnings — list of {row_number, code, message} for flagged rows
    """
    result = ParseResult()
    config = source_config or {}
    plant_name_map = config.get("plant_name_map", {})  # {"DE01": "Frankfurt Plant"}

    try:
        text = file_content.decode("utf-8-sig")  # handle BOM from Windows SAP exports
    except UnicodeDecodeError:
        text = file_content.decode("latin-1")    # SAP German installs often export latin-1

    reader = csv.DictReader(io.StringIO(text), delimiter=config.get("delimiter", ";"))

    # SAP often uses semicolons, but some configs use tabs or commas
    if reader.fieldnames and len(reader.fieldnames) == 1:
        # Try tab delimiter
        reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    if reader.fieldnames and len(reader.fieldnames) == 1:
        reader = csv.DictReader(io.StringIO(text), delimiter=",")

    if not reader.fieldnames:
        result.errors.append({"row_number": 0, "code": "EMPTY_FILE", "message": "File appears empty or has no headers"})
        return result

    # Build normalized column map
    col_map = {}
    for raw_col in reader.fieldnames:
        normalized = _normalize_header(raw_col)
        canonical = COLUMN_ALIASES.get(normalized)
        if canonical:
            col_map[raw_col] = canonical

    required_cols = {"quantity", "unit", "posting_date"}
    found_canonical = set(col_map.values())
    missing = required_cols - found_canonical
    if missing:
        result.errors.append({
            "row_number": 0,
            "code": "MISSING_COLUMNS",
            "message": f"Required columns not found: {missing}. Available: {list(reader.fieldnames)}"
        })
        return result

    def get(row: dict, canonical_name: str, default="") -> str:
        for raw, canonical in col_map.items():
            if canonical == canonical_name and raw in row:
                return (row[raw] or "").strip()
        return default

    seen_rows = set()

    for row_num, row in enumerate(reader, start=2):
        if not any(row.values()):
            continue  # skip blank rows SAP sometimes inserts between sections

        movement_type = get(row, "movement_type")
        if movement_type and movement_type not in CONSUMPTION_MOVEMENT_TYPES:
            # Goods receipts, reversals, etc. — not consumption
            result.warnings.append({
                "row_number": row_num,
                "code": "NON_CONSUMPTION_MOVEMENT",
                "message": f"Movement type {movement_type} is not a consumption posting. Row skipped."
            })
            continue

        qty_str = get(row, "quantity").replace(",", ".").replace(" ", "")
        try:
            raw_qty = Decimal(qty_str)
        except InvalidOperation:
            result.errors.append({
                "row_number": row_num,
                "code": "INVALID_QUANTITY",
                "message": f"Cannot parse quantity '{qty_str}'"
            })
            continue

        if raw_qty <= 0:
            result.warnings.append({
                "row_number": row_num,
                "code": "ZERO_OR_NEGATIVE_QUANTITY",
                "message": f"Quantity is {raw_qty} — possible reversal or correction posting"
            })
            continue

        raw_unit = get(row, "unit").upper()
        if raw_unit not in UNIT_MAP:
            result.errors.append({
                "row_number": row_num,
                "code": "UNKNOWN_UNIT",
                "message": f"Unit '{raw_unit}' not in known SAP unit map. Row rejected."
            })
            continue

        canonical_unit, factor = UNIT_MAP[raw_unit]
        if canonical_unit is None:
            # Non-fuel unit (pieces, each) — skip silently
            continue

        date_str = get(row, "posting_date") or get(row, "document_date")
        parsed_date = _parse_sap_date(date_str)
        if not parsed_date:
            result.errors.append({
                "row_number": row_num,
                "code": "INVALID_DATE",
                "message": f"Cannot parse date '{date_str}'"
            })
            continue

        if parsed_date.year > datetime.now().year:
            result.warnings.append({
                "row_number": row_num,
                "code": "FUTURE_DATE",
                "message": f"Posting date {parsed_date.date()} is in the future"
            })

        material_desc = get(row, "material_desc")
        material = get(row, "material")
        plant_code = get(row, "plant")
        cost_center = get(row, "cost_center")
        vendor = get(row, "vendor") or get(row, "vendor_name")

        # Duplicate detection within this batch
        dedup_key = (plant_code, material, date_str, qty_str, raw_unit)
        if dedup_key in seen_rows:
            result.warnings.append({
                "row_number": row_num,
                "code": "DUPLICATE_ROW",
                "message": f"Row appears to be a duplicate of an earlier row in this file"
            })
        seen_rows.add(dedup_key)

        category = _classify_fuel(material_desc)
        if category == "fuel_other" and not material_desc:
            result.warnings.append({
                "row_number": row_num,
                "code": "UNCLASSIFIED_MATERIAL",
                "message": f"Material '{material}' has no description; fuel type defaults to 'other'"
            })

        normalized_qty = (raw_qty * factor).quantize(Decimal("0.0001"))
        facility_name = plant_name_map.get(plant_code, "")

        result.records.append({
            "scope": 1,
            "category": category,
            "period_start": parsed_date.date(),
            "period_end": parsed_date.date(),
            "facility_code": plant_code or cost_center,
            "facility_name": facility_name,
            "country_code": plant_code[:2].upper() if plant_code and len(plant_code) >= 2 else "",
            "raw_quantity": raw_qty,
            "raw_unit": raw_unit,
            "normalized_quantity": normalized_qty,
            "normalized_unit": canonical_unit,
            "supplier_vendor": vendor,
            "description": material_desc or material,
            "extra_data": {
                "material_number": material,
                "cost_center": cost_center,
                "movement_type": movement_type,
            },
            "source_row": dict(row),
            "source_row_number": row_num,
        })

    return result
