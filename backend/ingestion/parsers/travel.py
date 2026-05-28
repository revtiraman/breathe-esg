"""
Corporate travel CSV export parser (Concur/Navan format).

Format chosen: CSV expense/trip export from Navan (formerly TripActions)
or Concur — the two dominant enterprise travel management platforms.

Why CSV, not API:
  - Navan API exists but requires an enterprise integration contract and
    OAuth app registration that takes weeks to provision. CSV export is
    self-serve from day one.
  - Concur API (SAP Concur) is similarly enterprise-gated. The CSV
    download from the Insights > Expense Reports export is what
    sustainability teams actually use.

Key realities this parser handles:
  - Flight distances are NOT always provided. When absent, we compute
    great-circle distance from IATA airport codes using the Haversine
    formula and a static lookup table of major airport coordinates.
  - The DEFRA/BEIS methodology classifies flights by distance:
      domestic   < 463 km
      short-haul 463–3700 km
      long-haul  > 3700 km
  - One trip may have multiple legs — each row is one segment
  - Hotel stays: quantity is nights, not km
  - Ground transport: may have distance or just cost (we keep it but flag
    if no distance is available for emission factor calculation)
  - Class of service matters for emission factors (business class ~2x
    economy per km) — we capture it in extra_data
"""
import csv
import io
import logging
import math
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# Partial IATA airport coordinates table (lat, lon)
# Covers top ~200 airports by passenger volume — sufficient for business travel
AIRPORT_COORDS = {
    "ATL": (33.6407, -84.4277), "LAX": (33.9425, -118.4081), "ORD": (41.9742, -87.9073),
    "DFW": (32.8998, -97.0403), "DEN": (39.8561, -104.6737), "JFK": (40.6413, -73.7781),
    "SFO": (37.6213, -122.3790), "SEA": (47.4502, -122.3088), "LAS": (36.0840, -115.1537),
    "MCO": (28.4312, -81.3081), "EWR": (40.6895, -74.1745), "MIA": (25.7959, -80.2870),
    "PHX": (33.4373, -112.0078), "IAH": (29.9902, -95.3368), "BOS": (42.3656, -71.0096),
    "MSP": (44.8820, -93.2218), "DTW": (42.2162, -83.3554), "LGA": (40.7772, -73.8726),
    "FLL": (26.0726, -80.1527), "BWI": (39.1754, -76.6682), "SLC": (40.7884, -111.9778),
    "DCA": (38.8512, -77.0402), "SAN": (32.7338, -117.1933), "MDW": (41.7868, -87.7522),
    "BNA": (36.1245, -86.6782), "AUS": (30.1975, -97.6664), "IAD": (38.9531, -77.4565),
    "PDX": (45.5898, -122.5951), "HNL": (21.3187, -157.9224), "STL": (38.7487, -90.3700),
    # European
    "LHR": (51.4775, -0.4614), "CDG": (49.0097, 2.5478), "FRA": (50.0379, 8.5622),
    "AMS": (52.3086, 4.7639), "MAD": (40.4719, -3.5626), "BCN": (41.2971, 2.0785),
    "FCO": (41.8003, 12.2389), "MUC": (48.3538, 11.7861), "ZRH": (47.4582, 8.5555),
    "VIE": (48.1103, 16.5697), "CPH": (55.6180, 12.6508), "ARN": (59.6498, 17.9238),
    "OSL": (60.1976, 11.1004), "HEL": (60.3172, 24.9633), "LIS": (38.7813, -9.1359),
    "BRU": (50.9014, 4.4844), "DUB": (53.4213, -6.2700), "MAN": (53.3537, -2.2750),
    "GVA": (46.2381, 6.1089), "PRG": (50.1008, 14.2600), "WAW": (52.1657, 20.9671),
    "BUD": (47.4298, 19.2611), "ATH": (37.9364, 23.9445), "IST": (40.9769, 28.8146),
    # Asia-Pacific
    "HND": (35.5494, 139.7798), "NRT": (35.7720, 140.3929), "PEK": (40.0799, 116.5846),
    "PVG": (31.1443, 121.8083), "HKG": (22.3080, 113.9185), "SIN": (1.3644, 103.9915),
    "BKK": (13.6900, 100.7501), "KUL": (2.7456, 101.7072), "SYD": (-33.9399, 151.1753),
    "MEL": (-37.6690, 144.8410), "ICN": (37.4691, 126.4510), "DEL": (28.5562, 77.1000),
    "BOM": (19.0896, 72.8656), "DXB": (25.2528, 55.3644), "DOH": (25.2731, 51.6081),
    # Americas
    "YYZ": (43.6777, -79.6248), "YVR": (49.1939, -123.1844), "GRU": (-23.4356, -46.4731),
    "EZE": (-34.8222, -58.5358), "MEX": (19.4363, -99.0721), "BOG": (4.7016, -74.1469),
    "SCL": (-33.3930, -70.7858), "LIM": (-12.0219, -77.1143),
}


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in km."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _flight_distance_km(origin: str, destination: str) -> Optional[float]:
    origin = origin.strip().upper()
    dest = destination.strip().upper()
    if origin in AIRPORT_COORDS and dest in AIRPORT_COORDS:
        return _haversine_km(*AIRPORT_COORDS[origin], *AIRPORT_COORDS[dest])
    return None


def _classify_flight(distance_km: float) -> str:
    """DEFRA/BEIS flight classification by distance."""
    if distance_km < 463:
        return "flight_domestic"
    elif distance_km <= 3700:
        return "flight_short_haul"
    else:
        return "flight_long_haul"


def _normalize_header(h: str) -> str:
    return h.strip().lower().replace("﻿", "").replace("_", " ")


def _parse_date(s: str) -> Optional[datetime]:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            continue
    return None


def _parse_decimal(s: str) -> Optional[Decimal]:
    s = (s or "").strip().replace(",", "").replace("$", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


COLUMN_ALIASES = {
    "trip id": "trip_id",
    "booking reference": "trip_id",
    "traveler name": "traveler_name",
    "employee name": "traveler_name",
    "traveler email": "traveler_email",
    "booking date": "booking_date",
    "travel date": "travel_date",
    "departure date": "travel_date",
    "return date": "return_date",
    "check in": "travel_date",
    "check out": "return_date",
    "type": "travel_type",
    "segment type": "travel_type",
    "trip type": "travel_type",
    "category": "travel_type",
    "origin": "origin",
    "from": "origin",
    "departure": "origin",
    "destination": "destination",
    "to": "destination",
    "arrival": "destination",
    "origin code": "origin_code",
    "origin airport": "origin_code",
    "iata origin": "origin_code",
    "destination code": "destination_code",
    "destination airport": "destination_code",
    "iata destination": "destination_code",
    "distance (km)": "distance_km",
    "distance km": "distance_km",
    "distance": "distance_km",
    "miles": "distance_miles",
    "class": "service_class",
    "class of service": "service_class",
    "cabin class": "service_class",
    "hotel name": "hotel_name",
    "property": "hotel_name",
    "city": "city",
    "nights": "nights",
    "number of nights": "nights",
    "cost": "cost",
    "total cost": "cost",
    "amount": "cost",
    "fare": "cost",
    "cost center": "cost_center",
    "department": "cost_center",
    "purpose": "purpose",
    "trip purpose": "purpose",
}

TRAVEL_TYPE_MAP = {
    "air": "flight",
    "flight": "flight",
    "plane": "flight",
    "hotel": "hotel",
    "accommodation": "hotel",
    "lodging": "hotel",
    "car": "car",
    "rental car": "car",
    "car rental": "car",
    "taxi": "taxi",
    "rideshare": "taxi",
    "uber": "taxi",
    "lyft": "taxi",
    "rail": "rail",
    "train": "rail",
    "amtrak": "rail",
    "eurostar": "rail",
}


class ParseResult:
    def __init__(self):
        self.records: List[dict] = []
        self.errors: List[dict] = []
        self.warnings: List[dict] = []


def parse(file_content: bytes, source_config: dict = None) -> ParseResult:
    """Parse a Concur/Navan corporate travel CSV export."""
    result = ParseResult()
    config = source_config or {}

    try:
        text = file_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = file_content.decode("latin-1")

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

    for row_num, row in enumerate(reader, start=2):
        if not any(v.strip() for v in row.values() if v):
            continue

        raw_type = get(row, "travel_type").lower()
        canonical_type = None
        for key, val in TRAVEL_TYPE_MAP.items():
            if key in raw_type:
                canonical_type = val
                break

        if not canonical_type:
            result.warnings.append({
                "row_number": row_num,
                "code": "UNKNOWN_TRAVEL_TYPE",
                "message": f"Cannot classify travel type '{raw_type}'. Row skipped."
            })
            continue

        travel_date_str = get(row, "travel_date")
        travel_date = _parse_date(travel_date_str)
        if not travel_date:
            result.errors.append({
                "row_number": row_num,
                "code": "INVALID_DATE",
                "message": f"Cannot parse travel date '{travel_date_str}'"
            })
            continue

        return_date_str = get(row, "return_date")
        return_date = _parse_date(return_date_str) if return_date_str else None

        if canonical_type == "flight":
            origin_code = get(row, "origin_code").upper()
            dest_code = get(row, "destination_code").upper()
            origin_name = get(row, "origin") or origin_code
            dest_name = get(row, "destination") or dest_code

            # Try provided distance first, fall back to haversine
            dist_str = get(row, "distance_km")
            miles_str = get(row, "distance_miles")
            if dist_str:
                distance_km = _parse_decimal(dist_str)
                distance_computed = False
            elif miles_str:
                m = _parse_decimal(miles_str)
                distance_km = m * Decimal("1.60934") if m else None
                distance_computed = False
            else:
                d = _flight_distance_km(origin_code, dest_code)
                distance_km = Decimal(str(round(d, 1))) if d else None
                distance_computed = True

            if distance_km is None:
                result.warnings.append({
                    "row_number": row_num,
                    "code": "MISSING_FLIGHT_DISTANCE",
                    "message": f"No distance for {origin_code}→{dest_code} and airport codes not in lookup table"
                })
                continue

            category = _classify_flight(float(distance_km))

            result.records.append({
                "scope": 3,
                "category": category,
                "period_start": travel_date.date(),
                "period_end": (return_date or travel_date).date(),
                "facility_code": f"{origin_code}-{dest_code}",
                "facility_name": f"{origin_name} → {dest_name}",
                "country_code": config.get("country_code", ""),
                "raw_quantity": distance_km,
                "raw_unit": "km",
                "normalized_quantity": distance_km,
                "normalized_unit": "km",
                "supplier_vendor": get(row, "trip_id"),
                "description": f"Flight {origin_code}→{dest_code}" + (" (distance computed)" if distance_computed else ""),
                "extra_data": {
                    "origin_code": origin_code,
                    "destination_code": dest_code,
                    "service_class": get(row, "service_class"),
                    "traveler": get(row, "traveler_name"),
                    "cost_center": get(row, "cost_center"),
                    "purpose": get(row, "purpose"),
                    "distance_computed": distance_computed,
                    "cost": get(row, "cost"),
                },
                "source_row": dict(row),
                "source_row_number": row_num,
            })

        elif canonical_type == "hotel":
            nights_str = get(row, "nights")
            nights = _parse_decimal(nights_str)
            if nights is None or nights <= 0:
                # Fall back to computing from check-in/check-out
                if travel_date and return_date and return_date > travel_date:
                    nights = Decimal((return_date - travel_date).days)
                else:
                    result.warnings.append({
                        "row_number": row_num,
                        "code": "MISSING_HOTEL_NIGHTS",
                        "message": "Cannot determine number of nights for hotel stay"
                    })
                    continue

            hotel_name = get(row, "hotel_name") or get(row, "destination")
            city = get(row, "city") or get(row, "destination")

            result.records.append({
                "scope": 3,
                "category": "hotel_stay",
                "period_start": travel_date.date(),
                "period_end": (return_date or travel_date).date(),
                "facility_code": city[:50] if city else "",
                "facility_name": hotel_name or city or "",
                "country_code": "",
                "raw_quantity": nights,
                "raw_unit": "nights",
                "normalized_quantity": nights,
                "normalized_unit": "nights",
                "supplier_vendor": hotel_name,
                "description": f"Hotel: {hotel_name or city}",
                "extra_data": {
                    "hotel_name": hotel_name,
                    "city": city,
                    "traveler": get(row, "traveler_name"),
                    "cost_center": get(row, "cost_center"),
                    "cost": get(row, "cost"),
                },
                "source_row": dict(row),
                "source_row_number": row_num,
            })

        elif canonical_type in ("car", "taxi", "rail"):
            category_map = {"car": "ground_car", "taxi": "ground_taxi", "rail": "ground_rail"}
            category = category_map[canonical_type]

            dist_str = get(row, "distance_km") or get(row, "distance_miles")
            dist = _parse_decimal(dist_str)
            if get(row, "distance_miles") and not get(row, "distance_km"):
                dist = dist * Decimal("1.60934") if dist else None
                raw_unit = "miles"
            else:
                raw_unit = "km"

            if dist is None:
                result.warnings.append({
                    "row_number": row_num,
                    "code": "MISSING_GROUND_DISTANCE",
                    "message": f"No distance for {canonical_type} trip — emission calculation will be impossible"
                })
                # Still ingest the record but flag it; analyst can verify/correct
                dist = Decimal("0")

            origin = get(row, "origin") or get(row, "origin_code")
            dest = get(row, "destination") or get(row, "destination_code")
            end_date = return_date or travel_date

            result.records.append({
                "scope": 3,
                "category": category,
                "period_start": travel_date.date(),
                "period_end": end_date.date(),
                "facility_code": "",
                "facility_name": f"{origin} → {dest}" if origin and dest else "",
                "country_code": config.get("country_code", ""),
                "raw_quantity": dist,
                "raw_unit": raw_unit,
                "normalized_quantity": dist if raw_unit == "km" else dist * Decimal("1.60934"),
                "normalized_unit": "km",
                "supplier_vendor": "",
                "description": f"{canonical_type.title()} transport",
                "extra_data": {
                    "traveler": get(row, "traveler_name"),
                    "cost_center": get(row, "cost_center"),
                    "cost": get(row, "cost"),
                },
                "source_row": dict(row),
                "source_row_number": row_num,
            })

    return result
