"""
DEFRA/BEIS 2023 Greenhouse Gas Reporting: Conversion Factors
(https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2023)

These are APPROXIMATE baseline values intended for analyst guidance and
review prioritisation. They must be validated against client-specific
factors (local grid mix, fuel blend, vehicle fleet) before submission to auditors.

Units:
  Fuel (liquid) → kgCO2e per litre
  Fuel (gas)    → kgCO2e per kWh (energy equivalent)
  Electricity   → kgCO2e per kWh (market average; region-adjusted in production)
  Flights       → kgCO2e per km per passenger (economy class, includes radiative forcing)
  Hotel         → kgCO2e per room-night
  Ground        → kgCO2e per km

Radiative forcing (RF) multiplier of 1.891 is applied to flights per DEFRA guidance.
RF accounts for non-CO2 warming effects at altitude (contrails, NOx, water vapor).
"""
from decimal import Decimal

# (factor_kgco2e_per_unit, unit, source_note)
EMISSION_FACTORS = {
    # ── Scope 1: Fuel combustion ─────────────────────────────────────────────
    "fuel_diesel": (
        Decimal("2.5103"),
        "kgCO2e/L",
        "DEFRA 2023 Table 1 — Diesel (average biofuel blend)",
    ),
    "fuel_petrol": (
        Decimal("2.1536"),
        "kgCO2e/L",
        "DEFRA 2023 Table 1 — Petrol (average biofuel blend)",
    ),
    "fuel_natural_gas": (
        Decimal("0.18268"),
        "kgCO2e/kWh",
        "DEFRA 2023 Table 1 — Natural gas, gross CV",
    ),
    "fuel_lpg": (
        Decimal("1.5557"),
        "kgCO2e/kg",
        "DEFRA 2023 Table 1 — LPG (propane/butane mix)",
    ),
    "fuel_other": (
        Decimal("2.5103"),
        "kgCO2e/L",
        "DEFRA 2023 Table 1 — Diesel proxy (conservative estimate)",
    ),

    # ── Scope 2: Purchased electricity ──────────────────────────────────────
    # UK grid 2023: 0.20493 kgCO2e/kWh (market-based, residual mix)
    # DE grid 2022: 0.434 kgCO2e/kWh (Umweltbundesamt)
    # Using DE as default since sample data is German facilities.
    # Production: select by country_code from a regional EF table.
    "electricity": (
        Decimal("0.43400"),
        "kgCO2e/kWh",
        "UBA Germany 2022 grid average — adjust to local grid/certificate for audit",
    ),

    # ── Scope 3: Business travel ─────────────────────────────────────────────
    # Flights include radiative forcing (RF multiplier 1.891)
    # Per-passenger-km, economy class
    "flight_domestic": (
        Decimal("0.24690"),
        "kgCO2e/km",
        "DEFRA 2023 Table 7a — Domestic aviation, economy, with RF",
    ),
    "flight_short_haul": (
        Decimal("0.15302"),
        "kgCO2e/km",
        "DEFRA 2023 Table 7a — Short-haul international, economy, with RF",
    ),
    "flight_long_haul": (
        Decimal("0.19552"),
        "kgCO2e/km",
        "DEFRA 2023 Table 7a — Long-haul international, economy, with RF",
    ),

    # Hotels: DEFRA 2023 Table 9 — global average
    "hotel_stay": (
        Decimal("28.40"),
        "kgCO2e/night",
        "DEFRA 2023 Table 9 — Global average hotel, per room-night",
    ),

    # Ground transport
    "ground_car": (
        Decimal("0.16844"),
        "kgCO2e/km",
        "DEFRA 2023 Table 3 — Average car (petrol/diesel mix, UK fleet)",
    ),
    "ground_rail": (
        Decimal("0.03549"),
        "kgCO2e/km",
        "DEFRA 2023 Table 4 — National rail (UK average)",
    ),
    "ground_taxi": (
        Decimal("0.14014"),
        "kgCO2e/km",
        "DEFRA 2023 Table 3 — Taxi (average)",
    ),
}

# Business-class uplift factors (DEFRA 2023 Table 7a)
# Applied when extra_data.service_class is BUSINESS or FIRST
BUSINESS_CLASS_UPLIFT = {
    "flight_domestic": Decimal("1.26"),
    "flight_short_haul": Decimal("1.26"),
    "flight_long_haul": Decimal("2.40"),   # 2.40× economy for long-haul business
}


def compute_co2e(category: str, normalized_quantity, extra_data: dict | None = None) -> tuple:
    """
    Returns (co2e_kg: Decimal, factor: Decimal, factor_unit: str, source_note: str).
    Returns (None, None, None, None) if no factor available.
    """
    if category not in EMISSION_FACTORS:
        return None, None, None, None

    factor, unit, note = EMISSION_FACTORS[category]

    # Apply business-class uplift for flights if service class is known
    service_class = (extra_data or {}).get("service_class", "")
    if service_class and str(service_class).upper() in ("BUSINESS", "FIRST"):
        uplift = BUSINESS_CLASS_UPLIFT.get(category, Decimal("1"))
        factor = (factor * uplift).quantize(Decimal("0.00001"))
        note = f"{note} × {uplift} business-class uplift"

    try:
        qty = Decimal(str(normalized_quantity))
    except Exception:
        return None, None, None, None

    co2e = (qty * factor).quantize(Decimal("0.0001"))
    return co2e, factor, unit, note
