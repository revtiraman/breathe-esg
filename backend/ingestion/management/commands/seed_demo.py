"""
Seed the database with a demo organization, users, and sample data
from all three source types.
"""
import os
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from ingestion.models import DataSource, Organization, UserProfile
from ingestion.services import ingest_file


SAP_CSV = """\
Bewegungsart;Werk;Kostenstelle;Material;Materialkurztext;Buchungsdatum;Menge;Basismengeneinheit;Lieferant;Name 1
261;DE01;CC-MAINT;MAT-DSL-001;Diesel Kraftstoff;15.01.2024;2500.000;L;PETROPLUS;Petroplus GmbH
261;DE01;CC-FLEET;MAT-DSL-001;Diesel Kraftstoff;22.01.2024;1800.000;L;PETROPLUS;Petroplus GmbH
261;DE02;CC-OPS;MAT-GAS-002;Erdgas Heizung;31.01.2024;450.000;M3;ENERGIE-AG;Energie AG
201;DE01;CC-MAINT;MAT-DSL-001;Diesel Kraftstoff;05.02.2024;3200.000;L;PETROPLUS;Petroplus GmbH
261;DE02;CC-FLEET;MAT-PET-003;Benzin Super;12.02.2024;620.000;L;ARAL;Aral AG
261;DE01;CC-OPS;MAT-LPG-004;LPG Autogas;20.02.2024;180.000;KG;PROPAN-GMBH;Propan GmbH
261;DE03;CC-MAINT;MAT-DSL-001;Diesel Kraftstoff;28.02.2024;4100.000;L;SHELL;Shell Deutschland
261;DE01;CC-FLEET;MAT-DSL-001;Diesel Kraftstoff;08.03.2024;2750.000;L;PETROPLUS;Petroplus GmbH
261;DE02;CC-OPS;MAT-GAS-002;Erdgas Heizung;15.03.2024;520.000;M3;ENERGIE-AG;Energie AG
261;DE03;CC-MAINT;MAT-PET-003;Benzin Super;22.03.2024;940.000;L;ARAL;Aral AG
261;DE01;CC-FLEET;MAT-DSL-001;Diesel Kraftstoff;31.03.2024;1950.000;L;SHELL;Shell Deutschland
261;DE02;CC-MAINT;MAT-LPG-004;LPG Autogas;05.04.2024;210.000;KG;PROPAN-GMBH;Propan GmbH
261;DE01;CC-OPS;MAT-DSL-001;Diesel Kraftstoff;12.04.2024;8750.000;L;PETROPLUS;Petroplus GmbH
201;DE03;CC-FLEET;MAT-GAS-002;Erdgas Heizung;20.04.2024;380.000;M3;ENERGIE-AG;Energie AG
261;DE01;CC-MAINT;MAT-DSL-001;Diesel Kraftstoff;30.04.2024;2100.000;L;SHELL;Shell Deutschland
""".strip()

UTILITY_CSV = """\
Account Number,Meter Number,Service Address,Billing Period Start,Billing Period End,Usage (kWh),Demand (kW),Rate Schedule,Total Charges
ACC-10021,MTR-A4421,Frankfurt HQ - Building A,2024-01-18,2024-02-14,48200,220,B-10 Large Commercial,9640.00
ACC-10021,MTR-A4422,Frankfurt HQ - Building B,2024-01-18,2024-02-14,31500,145,B-10 Large Commercial,6300.00
ACC-10022,MTR-B1130,Munich Office,2024-01-22,2024-02-19,18750,88,C-20 Commercial,3562.50
ACC-10023,MTR-C5501,Berlin Data Center,2024-01-15,2024-02-12,124800,580,D-30 High Demand,31200.00
ACC-10021,MTR-A4421,Frankfurt HQ - Building A,2024-02-15,2024-03-14,52100,235,B-10 Large Commercial,10420.00
ACC-10021,MTR-A4422,Frankfurt HQ - Building B,2024-02-15,2024-03-14,33200,152,B-10 Large Commercial,6640.00
ACC-10022,MTR-B1130,Munich Office,2024-02-20,2024-03-19,17400,82,C-20 Commercial,3306.00
ACC-10023,MTR-C5501,Berlin Data Center,2024-02-13,2024-03-12,131200,595,D-30 High Demand,32800.00
ACC-10024,MTR-D0012,Hamburg Warehouse,2024-01-25,2024-02-23,9800,45,A-5 Small Commercial,1960.00
ACC-10024,MTR-D0012,Hamburg Warehouse,2024-02-24,2024-03-24,10200,48,A-5 Small Commercial,2040.00
ACC-10023,MTR-C5501,Berlin Data Center,2024-03-13,2024-04-11,128600,588,D-30 High Demand,32150.00
ACC-10021,MTR-A4421,Frankfurt HQ - Building A,2024-03-15,2024-04-14,49800,228,B-10 Large Commercial,9960.00
""".strip()

TRAVEL_CSV = """\
Trip ID,Traveler Name,Traveler Email,Booking Date,Travel Date,Return Date,Type,Origin,Destination,Origin Code,Destination Code,Distance (km),Class of Service,Hotel Name,City,Nights,Cost,Cost Center,Purpose
TRP-2024-001,Sarah Mueller,s.mueller@acmecorp.com,2024-01-10,2024-01-15,2024-01-18,AIR,Frankfurt,New York,FRA,JFK,,ECONOMY,,,0,1240.00,CC-SALES,Client Meeting
TRP-2024-001,Sarah Mueller,s.mueller@acmecorp.com,2024-01-10,2024-01-15,2024-01-18,HOTEL,,,,,,,The Westin New York,New York,3,720.00,CC-SALES,Client Meeting
TRP-2024-002,James Thornton,j.thornton@acmecorp.com,2024-01-12,2024-01-20,2024-01-21,AIR,London,Munich,LHR,MUC,,BUSINESS,,,0,890.00,CC-MGMT,Board Meeting
TRP-2024-003,Priya Sharma,p.sharma@acmecorp.com,2024-01-18,2024-01-25,2024-01-26,AIR,Frankfurt,Berlin,FRA,BER,550,ECONOMY,,,0,180.00,CC-ENG,Tech Conference
TRP-2024-003,Priya Sharma,p.sharma@acmecorp.com,2024-01-18,2024-01-25,2024-01-26,HOTEL,,,,,,,Hotel Adlon,Berlin,1,280.00,CC-ENG,Tech Conference
TRP-2024-004,Marcus Cole,m.cole@acmecorp.com,2024-01-22,2024-02-01,2024-02-05,AIR,New York,Singapore,JFK,SIN,,BUSINESS,,,0,4800.00,CC-SALES,APAC Sales Tour
TRP-2024-004,Marcus Cole,m.cole@acmecorp.com,2024-01-22,2024-02-01,2024-02-05,HOTEL,,,,,,,Marriott Singapore,Singapore,4,1200.00,CC-SALES,APAC Sales Tour
TRP-2024-004,Marcus Cole,m.cole@acmecorp.com,2024-01-22,2024-02-05,2024-02-08,AIR,Singapore,Tokyo,SIN,HND,,ECONOMY,,,0,620.00,CC-SALES,APAC Sales Tour
TRP-2024-005,Elena Brandt,e.brandt@acmecorp.com,2024-02-05,2024-02-12,2024-02-12,TAXI,Frankfurt Airport,Frankfurt Office,,,,,,,,45.00,CC-MKTG,Trade Show
TRP-2024-006,David Park,d.park@acmecorp.com,2024-02-08,2024-02-14,2024-02-15,AIR,Chicago,Los Angeles,ORD,LAX,,ECONOMY,,,0,340.00,CC-ENG,Sprint Planning
TRP-2024-007,Sarah Mueller,s.mueller@acmecorp.com,2024-02-15,2024-02-20,2024-02-22,AIR,Frankfurt,Dubai,FRA,DXB,,BUSINESS,,,0,2100.00,CC-SALES,Middle East Expansion
TRP-2024-007,Sarah Mueller,s.mueller@acmecorp.com,2024-02-15,2024-02-20,2024-02-22,HOTEL,,,,,,,Atlantis Dubai,Dubai,2,980.00,CC-SALES,Middle East Expansion
TRP-2024-008,Thomas Klein,t.klein@acmecorp.com,2024-03-01,2024-03-05,2024-03-05,RAIL,Frankfurt,Amsterdam,,,400,,,,0,185.00,CC-MGMT,Partner Meeting
TRP-2024-009,Aisha Johnson,a.johnson@acmecorp.com,2024-03-10,2024-03-15,2024-03-18,AIR,New York,London,JFK,LHR,,ECONOMY,,,0,780.00,CC-HR,Leadership Summit
TRP-2024-009,Aisha Johnson,a.johnson@acmecorp.com,2024-03-10,2024-03-15,2024-03-18,HOTEL,,,,,,,Hilton London,London,3,890.00,CC-HR,Leadership Summit
TRP-2024-010,Marcus Cole,m.cole@acmecorp.com,2024-03-20,2024-03-25,2024-03-28,AIR,Tokyo,Sydney,HND,SYD,,ECONOMY,,,0,1200.00,CC-SALES,APAC Follow-up
TRP-2024-010,Marcus Cole,m.cole@acmecorp.com,2024-03-20,2024-03-25,2024-03-28,HOTEL,,,,,,,Four Seasons Sydney,Sydney,3,1400.00,CC-SALES,APAC Follow-up
""".strip()


class Command(BaseCommand):
    help = "Seed database with demo org, users, and sample ingestion data"

    def handle(self, *args, **options):
        # Create organization
        org, _ = Organization.objects.get_or_create(
            slug="acmecorp",
            defaults={"name": "Acme Corp"},
        )
        self.stdout.write(f"Organization: {org.name}")

        # Create admin user
        admin_user, created = User.objects.get_or_create(
            username="admin",
            defaults={"email": "admin@acmecorp.com", "is_staff": True, "is_superuser": True},
        )
        if created:
            admin_user.set_password("demo1234")
            admin_user.save()
        UserProfile.objects.get_or_create(user=admin_user, defaults={"organization": org, "role": "admin"})
        self.stdout.write(f"Admin user: admin / demo1234")

        # Create analyst user
        analyst, created = User.objects.get_or_create(
            username="analyst",
            defaults={"email": "analyst@acmecorp.com"},
        )
        if created:
            analyst.set_password("demo1234")
            analyst.save()
        UserProfile.objects.get_or_create(user=analyst, defaults={"organization": org, "role": "analyst"})
        self.stdout.write(f"Analyst user: analyst / demo1234")

        # Create data sources
        sap_source, _ = DataSource.objects.get_or_create(
            organization=org,
            source_type=DataSource.SOURCE_SAP,
            name="SAP Production Export",
            defaults={
                "description": "MB51/ME2N combined flat-file from SAP ECC 6.0, scheduled weekly via SM36",
                "config": {
                    "delimiter": ";",
                    "plant_name_map": {
                        "DE01": "Frankfurt Plant",
                        "DE02": "Munich Facility",
                        "DE03": "Hamburg Warehouse",
                    },
                },
            },
        )

        utility_source, _ = DataSource.objects.get_or_create(
            organization=org,
            source_type=DataSource.SOURCE_UTILITY,
            name="German Utility Portal",
            defaults={
                "description": "Monthly CSV export from E.ON/RWE customer portal",
                "config": {
                    "country_code": "DE",
                    "utility_name": "E.ON",
                    "meter_name_map": {
                        "MTR-A4421": "Frankfurt HQ Bldg A",
                        "MTR-A4422": "Frankfurt HQ Bldg B",
                        "MTR-B1130": "Munich Office",
                        "MTR-C5501": "Berlin Data Center",
                        "MTR-D0012": "Hamburg Warehouse",
                    },
                },
            },
        )

        travel_source, _ = DataSource.objects.get_or_create(
            organization=org,
            source_type=DataSource.SOURCE_TRAVEL,
            name="Navan Travel Export",
            defaults={
                "description": "Monthly trip export from Navan (formerly TripActions) via Insights > Trips CSV",
                "config": {"country_code": "DE"},
            },
        )

        # Ingest sample data
        self.stdout.write("Ingesting SAP data...")
        batch = ingest_file(sap_source, SAP_CSV.encode(), "sap_mb51_q1_2024.csv", admin_user)
        self.stdout.write(f"  -> {batch.accepted_count} records, {batch.rejected_count} errors")

        self.stdout.write("Ingesting utility data...")
        batch = ingest_file(utility_source, UTILITY_CSV.encode(), "utility_portal_q1_2024.csv", admin_user)
        self.stdout.write(f"  -> {batch.accepted_count} records, {batch.rejected_count} errors")

        self.stdout.write("Ingesting travel data...")
        batch = ingest_file(travel_source, TRAVEL_CSV.encode(), "navan_trips_q1_2024.csv", admin_user)
        self.stdout.write(f"  -> {batch.accepted_count} records, {batch.rejected_count} errors")

        self.stdout.write(self.style.SUCCESS("\nDemo data loaded. Login: admin / demo1234"))
