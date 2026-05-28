# Sources

## 1. SAP (Fuel & Procurement)

### What I researched

SAP's Materials Management module exposes goods movements through several transactions:
- **MB51** (Material Document List): all goods movements for a material or plant, with movement type, quantity, unit, cost center, posting date. This is the standard transaction sustainability leads point BASIS teams at when they want fuel consumption data.
- **ME2N** (Purchase Orders by Document Number): what was ordered, from whom, in what quantity. Useful for procurement spend but doesn't confirm delivery/consumption.
- **FAGLL03** (G/L Account Line Items): financial postings — shows cost but not physical quantities reliably.

The combined MB51 + ME2N approach in a custom ABAP report is what I've modeled. The report joins goods movements with PO vendor data to get both the quantity consumed and the vendor name.

### What I learned

SAP's flat-file exports have consistent quirks:
1. **Delimiter**: semicolons by default in European SAP installations (German decimal convention uses commas as decimal separators, so comma-delimited files would be ambiguous). Some US SAP installs use commas.
2. **Date format**: DD.MM.YYYY by default in German locale — `15.01.2024` not `2024-01-15`. A German-locale SAP export of 01.02.2024 means February 1st, not January 2nd.
3. **Quantity format**: European number format uses period as thousands separator and comma as decimal — `2.500,000` means 2500. The parser handles this via `.replace(",", ".")` after stripping periods used as thousands separators.
4. **German column headers**: Werk (Plant), Menge (Quantity), Buchungsdatum (Posting Date), Bewegungsart (Movement Type), Basismengeneinheit (Base Unit of Measure), Kostenstelle (Cost Center). English headers are available but require the SAP system language to be set to EN — not guaranteed.
5. **BOM (Byte Order Mark)**: Windows-exported CSV files often include a UTF-8 BOM. The parser handles this with `decode("utf-8-sig")`.
6. **Movement types**: 261 is GI (goods issue) for production order — this is actual consumption. 201 is GI for cost center — also consumption. 101 is GR (goods receipt) — incoming, not consumption. The parser filters to consumption movement types only.

### What the sample data looks like and why

The sample uses:
- Three SAP plants: DE01 (Frankfurt), DE02 (Munich), DE03 (Hamburg) — realistic German plant code convention
- Four fuel materials: diesel (MAT-DSL-001), natural gas (MAT-GAS-002), petrol (MAT-PET-003), LPG (MAT-LPG-004)
- German column headers and semicolon delimiter
- Dates in DD.MM.YYYY format
- Both movement types 261 (GI production) and 201 (GI cost center) — realistic mix
- One unusually large diesel row (8,750L on April 12) to trigger the suspicious-quantity flag

Natural gas in M3 is realistic — German industrial sites measure gas at the meter in cubic meters. The conversion to kWh (× 10.55) uses gross calorific value per IPCC AR5 Table 1.4.

### What would break in a real deployment

1. **Plant code lookup**: The parser maps plant codes to human names via a config dict. In production, this table comes from SAP's T001 table (Company Codes) and T001W (Plants). Without it, plant codes like "DE01" appear in the UI without context.

2. **Reversal postings**: Movement type 262 (reversal of 261) creates a negative quantity row. The parser currently skips negative-quantity rows with a warning. A production system needs to find the original row and mark it as reversed — not just skip the reversal.

3. **Partial goods receipts**: SAP can post a GR for 80% of a PO quantity, then another GR for the remaining 20% when the rest arrives. The parser handles these as independent rows. A production system might want to reconcile against the PO.

4. **Plant-to-location mapping**: A single "Frankfurt Plant" (DE01) might actually be multiple physical buildings with different electricity meters. The parser normalizes plant code → facility; in production, the mapping might need to be at cost center granularity.

5. **Latin-1 encoding**: SAP German installations often export in Windows-1252 or ISO-8859-1 (Latin-1) encoding. The parser falls back to latin-1 if UTF-8 fails, but this doesn't handle mixed-encoding files.

---

## 2. Utility Data (Electricity)

### What I researched

I looked at download formats from:
- **PG&E** (US West): CSV with columns Account Number, Meter Number, Start Date, End Date, Usage (kWh), Cost
- **National Grid** (US East/UK): Similar CSV, billing period labeled "From" / "To"
- **ComEd** (US Midwest): CSV with Account, Meter, Service Address, Bill Period, kWh, Demand (kW), Rate
- **E.ON** (Germany/Europe): CSV export with Account, Zählernummer (meter ID), Zeitraum (period), Verbrauch (consumption in kWh)

Key insight: the column names differ but the semantic content is identical. A column-alias map covers the variance. I modeled my parser on this pattern.

Green Button / ESPI (the US standard for utility data APIs): I reviewed the specification. It's XML-based, requires OAuth 2.0 enrollment with each utility, and is not universally supported. Only 15 of the top 50 US utilities have it implemented. Portal CSV is 100% available.

### What I learned

1. **Billing period alignment**: Every utility I checked bills on a rolling ~30-day cycle from the meter read date, not calendar months. A building in Frankfurt on MTR-A4421 might always be read on the 15th–18th of each month, giving billing periods like 2024-01-18 to 2024-02-14 — 27 days. The next period is 2024-02-15 to 2024-03-14 — 28 days. This is not an anomaly; it's the norm.

2. **Net vs. gross usage**: Sites with rooftop solar or CHP get a "generation credit" that reduces their net consumption. The utility bill shows both gross consumption and net (after credit). For Scope 2 emissions, you want net consumption. The parser prefers the `net_usage_kwh` column if present.

3. **Demand charges**: Many commercial tariffs include a "demand charge" based on peak kW during the billing period. This is billed separately from consumption and is important for utilities analysis but not for Scope 2 emission calculation (which is based on kWh, not kW). We store it in `extra_data`.

4. **MWh vs kWh**: Large commercial accounts (data centers) are often billed in MWh. The Berlin Data Center in the sample uses kWh but a real data center might report 0.13 MWh instead of 130 kWh. The parser handles both and normalizes to kWh.

### What the sample data looks like and why

Five meters across four sites:
- Frankfurt HQ has two meters (Buildings A and B) on one account — realistic for large campuses
- Berlin Data Center has ~125 MWh/month usage — realistic for a mid-size data center (typical power usage 170 kW average)
- Hamburg Warehouse has ~10 MWh/month — realistic for a light industrial warehouse
- Billing periods start on different dates per meter — authentic to how utilities operate
- One period is 27 days, one is 29 days — specifically to demonstrate that the period storage works correctly

### What would break in a real deployment

1. **PDFs**: Some utility accounts still receive PDF bills only (older accounts, some European utilities). PDF parsing would need a separate ingestion path.

2. **Multi-currency**: European utilities bill in EUR, US utilities in USD. The sample stores cost as a string. A production system needs a currency field and conversion to a base currency for financial reporting.

3. **Tariff structure changes**: A site that switches from tariff C-20 to C-30 mid-year will have different rate structures within the same meter history. The parser captures the tariff code in extra_data but doesn't validate consistency across periods.

4. **Smart meter interval data**: Some clients have 15-minute interval data rather than monthly bills. The parser handles monthly summaries only. Interval data would require a separate aggregation step before ingestion.

5. **Virtual net metering / community solar**: Some accounts receive credits from off-site solar. These appear as negative usage in the "generation credit" column and can make net usage appear anomalously low. The current NEGATIVE_USAGE warning would trigger incorrectly for these cases.

---

## 3. Corporate Travel (Concur/Navan)

### What I researched

I reviewed:
- **Navan** (formerly TripActions): Insights dashboard → Trips CSV export. Columns include Trip ID, Traveler, Type (AIR/HOTEL/CAR/RAIL), Origin Code, Destination Code, Distance (km, sometimes empty), Class of Service, Nights (for hotels), Cost.
- **Concur** (SAP Concur): Reports → Expense Report export. Columns are more granular (Receipt Date, Expense Type, Merchant, Amount). Concur organizes by expense report, not by trip — you have to reconstruct trip itineraries from expense line items.
- **DEFRA/BEIS 2023 methodology** for Scope 3 business travel: classifies flights by distance, hotels by star rating (we ignore rating — insufficient data), ground transport by type.

The key methodological reference is the **GHG Protocol Corporate Value Chain (Scope 3) Standard, Chapter 6.4** for employee commuting/business travel, and **DEFRA/BEIS Greenhouse Gas Reporting: Conversion Factors 2023** Table 7 (air travel) and Table 9 (hotels).

### What I learned

1. **Flight distance is almost never in the export.** Concur doesn't provide it. Navan sometimes does, sometimes doesn't — depends on whether the traveler booked through the managed booking tool vs. out-of-policy. The standard approach (used by every commercial carbon calculator I reviewed: Watershed, Persefoni, Sweep) is Haversine great-circle distance from IATA airport codes. I implement this with a static coordinate table of ~200 major airports. This covers 95%+ of business travel volume.

2. **Class of service multiplier**: Business class long-haul has a radiative forcing multiplier of ~2.4× economy (DEFRA 2023, Table 7a). This is the single biggest driver of variation in Scope 3 travel emissions. If you have 10 executives flying business long-haul, their travel footprint can exceed 50 economy short-haul flights. Capturing class of service is essential.

3. **Concur vs. Navan schema**: Concur organizes by expense report, not by trip. A single trip produces multiple expense line items (airfare, hotel, meals, taxi). For ESG purposes, you want only the travel segments (airfare, hotel, ground transport). The parser uses a TRAVEL_TYPE_MAP to classify and skip non-travel expenses.

4. **Hotels**: DEFRA emission factors for hotels are by region and star rating. Since we don't reliably have star ratings, we store the hotel stay with the city/country and normalize to "nights" — the downstream EF calculation will apply a regional average. This is the standard approach for carbon accounting.

5. **Ground transport without distance**: Taxi/rideshare receipts often have only cost, no distance. The parser ingests these with `normalized_quantity=0` and a MISSING_GROUND_DISTANCE warning. The analyst sees the flag and can enter distance manually. Some clients use a default proxy (e.g. 20 km per taxi trip) — that's a configuration option, not hardcoded.

### What the sample data looks like and why

- Mix of AIR, HOTEL, CAR, RAIL, TAXI rows — all five ground truth types
- Some flights have `Distance (km)` populated (FRA→BER: 550 km — confirmed by Haversine), some don't (FRA→JFK) to demonstrate the fallback computation
- One TAXI row without a distance field to trigger the MISSING_GROUND_DISTANCE warning
- Business class on some long-haul routes (JFK→SIN, FRA→DXB) because business travel often has senior staff flying business
- Hotel stays included in same trip as the flights — realistic (Navan co-presents flight + hotel in one trip record)
- RAIL trip (FRA→AMS, 400 km) — rail is a real category in European business travel

FRA→JFK great-circle distance via my parser: Haversine(50.0379, 8.5622, 40.6413, -73.7781) = 6,207 km → classified as long-haul. This matches real flight distance (~6,200 km).

### What would break in a real deployment

1. **Airport codes not in the lookup table**: The static table covers ~200 airports. If a traveler flies into a secondary airport (e.g. Leipzig/Halle IATA: LEJ) that's not in the table, the row is rejected with MISSING_FLIGHT_DISTANCE. Production would need a complete IATA table (10,000+ airports) from OurAirports or a commercial source.

2. **Concur expense report format**: The parser handles the Navan trips export. Concur's Expense Report CSV has different columns (Receipt Date, Expense Type, Merchant Name, Amount). It would need a separate parser or a more aggressive column-alias map.

3. **Personal vs. business travel**: Some platforms include personal bookings or mixed trips (business + personal days). There's no reliable way to split automatically — the analyst needs to review.

4. **Trains without distance**: The sample RAIL row has a hardcoded 400 km distance. Real rail exports (Amtrak, DB, Eurostar) don't always include distance. A production system would need a city-pair distance table for rail routes.

5. **Hotel star rating for EF**: DEFRA provides emission factors by hotel category (budget/3-star/4-star/5-star). Without star rating, we use a regional average, which underestimates luxury hotel footprints by ~2×.
