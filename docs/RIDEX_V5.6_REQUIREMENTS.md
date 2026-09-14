# RideX v5.6 Requirements & Implementation Baseline

## 1. Product
RideX is one mobile application with Customer and Driver entry points plus a separate Admin Panel. The production architecture is internet/cloud based and must not depend on a developer laptop localhost.

## 2. Environment & release control
- TEST and LIVE are operationally separated.
- Test users/records remain in TEST.
- Super Admin alone controls TEST/LIVE release promotion.
- Project update enters TEST first.
- Super Admin tests/proves the version, fixes gaps, reruns tests, approves it, then uses GO LIVE to promote only the approved release.
- Approved tester mobile numbers are explicitly granted TEST access and their test activity is retained as test records.

## 3. Passenger
Exactly three passenger ride modes: Full Ride, Shared Ride, Connection Ride.

### Full Ride
Pickup + 0..N stops + final destination/current location + booking duration. Vehicle is dedicated to that customer.

### Shared Ride
Same configured city/service zone. Multiple compatible customers can use the same vehicle/route subject to capacity and route compatibility. Individual booking/fare/status must remain distinct.

### Connection Ride
City-to-city travel is represented as sequential legs. Default maximum connection leg is about 15 km. When a journey exceeds one leg, the next leg is created/matched automatically. City entry/exit/radius points are recorded.

## 4. Parcel
- Passenger E-Rickshaw only.
- Weight range: 1–300 kg.
- Full Parcel or Multi-Parcel.
- Multi-Parcel allows route-compatible multiple parcels and individual parcel states.
- Pickup may be at the parcel customer's location or via driver handoff.
- Customer can choose pickup, stops, final drop/current location and duration where applicable.

## 5. Goods
- Battery/Electric Pickup Truck only.
- Passenger and Parcel are not allowed on the Goods vehicle.
- Pickup, stops, destination and flexible duration.
- Fare must honor Admin pricing rules including duration/distance/time/zone/demand/special situations.

## 6. Driver
Driver UI exposes Passenger, Parcel, Both and Goods availability according to the driver's eligible registered vehicles. Vehicle eligibility is enforced server-side; invalid combinations cannot be booked.

## 7. Verification
- OTP and QR are available at ride start.
- QR is backend-generated, bound to customer/driver/booking/leg, expires, and can only be consumed once.
- Customer uses the mobile camera/scanner; Driver displays the QR.

## 8. Maps/routing/data
- Google Maps is the starting map/routing layer.
- Routing calls are need-based during active rides.
- RideX continuously stores validated route, distance, timing, stop, ETA, actual travel and deviation data.
- Over time RideX can compare its route result with Google and select the more reliable result, while Google remains fallback/verification.
- No AI.

## 9. Pricing
Admin can create/edit rules by service, ride type, vehicle, city/zone, time, demand, special situations, minimum/maximum fare, per-km, per-minute, waiting, weight and multiplier.

## 10. Payments
Cash and online payment methods are supported by the domain model. Production online payment must use the selected licensed/authorized provider's current integration, webhook and settlement requirements; card data must not be stored in RideX.

## 11. Safety & trust
Customer and Driver SOS, fraud/GPS anomaly alerts, audit logs, controlled support workflow, poor-network retry/idempotency and safe leg handover records are required.

## 12. Data governance
Original operational data must remain preserved. Admin can create a reviewable derivative merge dataset from historical/current data; the merge must not overwrite the original source records.

## 13. Admin
Super Admin gets the highest control surface for business rules, zone/radius, pricing, testing, release approval, TEST/LIVE promotion, permissions, audit and recovery. Normal Admin access is permission controlled.

## 14. India-first implementation considerations (verified September 2026)
- MoRTH's Motor Vehicle Aggregator Guidelines 2025 define aggregators, drivers, fares, apportioned fare and dynamic pricing; state-level licensing/implementation still needs to be checked for each operating jurisdiction. Source: MoRTH, Motor Vehicles Aggregator Guidelines 2025.
- MeitY lists the Digital Personal Data Protection Rules, 2025 and an enforcement timeline. Privacy notices, purpose-specific data use, consent/rights and data-security controls therefore need to be part of production readiness.
- Google Maps Platform has India-specific pricing/free monthly usage thresholds and recommends newer Routes/Places APIs; the v5.6 architecture therefore keeps routing provider configuration server-side and supports usage controls.
- Firebase App Check with Play Integrity can help restrict backend resources to recognized Android app instances when configured in the production Firebase/Google Play environment.

## 15. Explicit exclusions
No AI customer support, no AI driver assistant, no voice booking, no digital identity feature beyond required operational verification, no driver document-vault product, and no speculative non-essential “smart city” features.

## India-level reference checks (September 2026)
- Ministry of Road Transport & Highways — Motor Vehicles Aggregator Guidelines 2025: https://morth.nic.in/sites/default/files/circulars_document/MV-Aggregators-Guidelines-2025%20-%20English%20and%20Hindi.pdf
- Ministry of Electronics & Information Technology — Digital Personal Data Protection Rules 2025: https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa
- Google Maps Platform India pricing and billing: https://developers.google.com/maps/billing-and-pricing/india
- Reserve Bank of India — Restriction on Storage of Actual Card Data: https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=12345
