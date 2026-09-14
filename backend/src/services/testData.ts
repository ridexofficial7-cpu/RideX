import { prisma } from "../lib/prisma";

const PREFIX = "v55-test-";
const now = new Date();
const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
const later = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

const IDS = {
  role: `${PREFIX}role-super-admin`,
  permissionView: `${PREFIX}permission-view`,
  permissionCreate: `${PREFIX}permission-create`,
  customer1: `${PREFIX}customer-1`,
  customer2: `${PREFIX}customer-2`,
  customer3: `${PREFIX}customer-3`,
  driver1: `${PREFIX}driver-passenger`,
  driver2: `${PREFIX}driver-goods`,
  driver3: `${PREFIX}driver-pickup`,
  driver4: `${PREFIX}driver-pending`,
  user1: `${PREFIX}user-customer-1`,
  user2: `${PREFIX}user-customer-2`,
  user3: `${PREFIX}user-customer-3`,
  userD1: `${PREFIX}user-driver-1`,
  userD2: `${PREFIX}user-driver-2`,
  userD3: `${PREFIX}user-driver-3`,
  userD4: `${PREFIX}user-driver-4`,
  userA: `${PREFIX}user-admin`,
  admin: `${PREFIX}admin`,
  vehicle1: `${PREFIX}vehicle-erickshaw-1`,
  vehicle2: `${PREFIX}vehicle-erickshaw-2`,
  vehicle3: `${PREFIX}vehicle-pickup-1`,
  vehicle4: `${PREFIX}vehicle-pending`,
  booking1: `${PREFIX}booking-active`,
  booking2: `${PREFIX}booking-completed`,
  booking3: `${PREFIX}booking-shared`,
  booking4: `${PREFIX}booking-connection`,
  booking5: `${PREFIX}booking-goods-erickshaw`,
  booking6: `${PREFIX}booking-goods-pickup`,
  booking7: `${PREFIX}booking-cancelled`,
  booking8: `${PREFIX}booking-scheduled`,
  leg1: `${PREFIX}leg-1`,
  leg2: `${PREFIX}leg-2`,
  leg3: `${PREFIX}leg-3`,
  leg4: `${PREFIX}leg-4`,
  leg5: `${PREFIX}leg-5`,
  leg6: `${PREFIX}leg-6`,
  leg7: `${PREFIX}leg-7`,
  leg8: `${PREFIX}leg-8`,
  trip1: `${PREFIX}trip-1`,
  trip2: `${PREFIX}trip-2`,
  trip3: `${PREFIX}trip-3`,
  payment1: `${PREFIX}payment-1`,
  payment2: `${PREFIX}payment-2`,
  payment3: `${PREFIX}payment-3`,
  attempt1: `${PREFIX}attempt-1`,
  attempt2: `${PREFIX}attempt-2`,
  tx1: `${PREFIX}tx-1`,
  tx2: `${PREFIX}tx-2`,
  refund1: `${PREFIX}refund-1`,
  earning1: `${PREFIX}earning-1`,
  earning2: `${PREFIX}earning-2`,
  settlement1: `${PREFIX}settlement-1`,
  ledger1: `${PREFIX}ledger-1`,
  ledger2: `${PREFIX}ledger-2`,
  cash1: `${PREFIX}cash-1`,
  commission1: `${PREFIX}commission-1`,
  adjustment1: `${PREFIX}adjustment-1`,
  rating1: `${PREFIX}rating-1`,
  support1: `${PREFIX}support-1`,
  supportMessage1: `${PREFIX}support-message-1`,
  sos1: `${PREFIX}sos-1`,
  incident1: `${PREFIX}incident-1`,
  incidentAction1: `${PREFIX}incident-action-1`,
  deviation1: `${PREFIX}deviation-1`,
  notification1: `${PREFIX}notification-1`,
  notification2: `${PREFIX}notification-2`,
  coupon1: `${PREFIX}coupon-welcome`,
  couponUsage1: `${PREFIX}coupon-usage-1`,
  location1: `${PREFIX}location-station`,
  location2: `${PREFIX}location-market`,
  location3: `${PREFIX}location-hospital`,
  config1: `${PREFIX}config-commission`,
  photo1: `${PREFIX}photo-1`,
  emergency1: `${PREFIX}emergency-1`,
  document1: `${PREFIX}document-1`,
  document2: `${PREFIX}document-2`,
  document3: `${PREFIX}document-3`,
  document4: `${PREFIX}document-4`,
  passenger1: `${PREFIX}passenger-1`,
  passenger2: `${PREFIX}passenger-2`,
  route1: `${PREFIX}route-1`,
  route2: `${PREFIX}route-2`,
  route3: `${PREFIX}route-3`,
  route4: `${PREFIX}route-4`,
  route5: `${PREFIX}route-5`,
  route6: `${PREFIX}route-6`,
  route7: `${PREFIX}route-7`,
  route8: `${PREFIX}route-8`,
  request1: `${PREFIX}request-1`,
  request2: `${PREFIX}request-2`,
  request3: `${PREFIX}request-3`,
  request4: `${PREFIX}request-4`,
} as const;

function guardTestMode() {
  if (process.env.RIDEX_TEST_MODE !== "true") {
    throw new Error("Test data is disabled. Set RIDEX_TEST_MODE=true.");
  }
}

export async function resetRideXTestData() {
  guardTestMode();

  await prisma.$transaction(async (tx) => {
    await tx.supportMessage.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.couponUsage.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.rating.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.routeDeviationEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.incidentAction.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.safetyIncident.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.sosEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.notification.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.financialAdjustment.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.cashCollection.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.commissionEntry.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.ledgerEntry.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.driverEarning.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.driverSettlement.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.refund.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.paymentTransaction.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.paymentAttempt.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.payment.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.route.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.tripPassenger.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.tripLocationEvent.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.rideRequest.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.bookingLeg.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.trip.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.booking.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.driverLocation.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.vehicle.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.driverDocument.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.customerGalleryPhoto.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.emergencyContact.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.supportCase.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.quickLocation.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.systemConfiguration.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.adminSession.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.auditLog.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.adminUser.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.rolePermission.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.role.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.permission.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await tx.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  });

  return { success: true, message: "RideX v3.5 test data reset" };
}

export async function seedRideXTestData() {
  guardTestMode();
  await resetRideXTestData();

  await prisma.$transaction(async (tx) => {
    const permissionView = await tx.permission.create({
      data: { id: IDS.permissionView, module: "test-data", action: "VIEW", description: "Test data viewer" },
    });
    const permissionCreate = await tx.permission.create({
      data: { id: IDS.permissionCreate, module: "test-data", action: "CREATE", description: "Test data manager" },
    });
    const role = await tx.role.create({
      data: { id: IDS.role, name: "V55_TEST_SUPER_ADMIN", description: "RideX v3.5 test super admin", isSystem: false },
    });
    await tx.rolePermission.createMany({ data: [
      { id: `${PREFIX}role-perm-1`, roleId: role.id, permissionId: permissionView.id },
      { id: `${PREFIX}role-perm-2`, roleId: role.id, permissionId: permissionCreate.id },
    ] });

    const users = [
      { id: IDS.user1, mobile: "7000000001", userType: "CUSTOMER" },
      { id: IDS.user2, mobile: "7000000002", userType: "CUSTOMER" },
      { id: IDS.user3, mobile: "7000000003", userType: "CUSTOMER" },
      { id: IDS.userD1, mobile: "7000000011", userType: "DRIVER" },
      { id: IDS.userD2, mobile: "7000000012", userType: "DRIVER" },
      { id: IDS.userD3, mobile: "7000000013", userType: "DRIVER" },
      { id: IDS.userD4, mobile: "7000000014", userType: "DRIVER" },
      { id: IDS.userA, mobile: "7000000099", userType: "ADMIN" },
    ];
    for (const user of users) {
      await tx.user.create({ data: { ...user, userType: user.userType as any, status: "ACTIVE" as any } });
    }

    await tx.adminUser.create({ data: {
      id: IDS.admin, userId: IDS.userA, name: "RideX v3.5 Test Admin", roleId: role.id,
      approvalStatus: "APPROVED" as any, approvedAt: now,
    } });

    await tx.customer.createMany({ data: [
      { id: IDS.customer1, userId: IDS.user1, fullName: "Test Passenger One", referralCode: "V35CUST1", rating: 4.9 },
      { id: IDS.customer2, userId: IDS.user2, fullName: "Test Shared Rider", referralCode: "V35CUST2", rating: 4.7 },
      { id: IDS.customer3, userId: IDS.user3, fullName: "Test Goods Customer", referralCode: "V35CUST3", rating: 4.8 },
    ] });

    await tx.driver.createMany({ data: [
      { id: IDS.driver1, userId: IDS.userD1, fullName: "Test Passenger E-Rickshaw", verificationStatus: "APPROVED" as any, driverStatus: "ONLINE" as any, dailyServiceMode: "BOTH" as any, rating: 4.9, totalRides: 128 },
      { id: IDS.driver2, userId: IDS.userD2, fullName: "Test Parcel E-Rickshaw", verificationStatus: "APPROVED" as any, driverStatus: "ONLINE" as any, dailyServiceMode: "PASSENGER" as any, rating: 4.7, totalRides: 92 },
      { id: IDS.driver3, userId: IDS.userD3, fullName: "Test Goods Pickup", verificationStatus: "APPROVED" as any, driverStatus: "ONLINE" as any, dailyServiceMode: "GOODS" as any, rating: 4.6, totalRides: 76 },
      { id: IDS.driver4, userId: IDS.userD4, fullName: "Pending KYC Driver", verificationStatus: "PENDING" as any, driverStatus: "OFFLINE" as any, dailyServiceMode: "PASSENGER" as any, rating: 5, totalRides: 0 },
    ] });

    await tx.vehicle.createMany({ data: [
      { id: IDS.vehicle1, driverId: IDS.driver1, vehicleType: "E_RICKSHAW" as any, vehicleNumber: "BR34TEST01", capacity: 4, goodsEligible: false, status: "ACTIVE" as any },
      { id: IDS.vehicle2, driverId: IDS.driver2, vehicleType: "E_RICKSHAW" as any, vehicleNumber: "BR34TEST02", capacity: 4, goodsEligible: false, status: "ACTIVE" as any },
      { id: IDS.vehicle3, driverId: IDS.driver3, vehicleType: "PICKUP_TRUCK" as any, vehicleNumber: "BR34TEST03", capacity: 1000, goodsEligible: true, status: "ACTIVE" as any },
      { id: IDS.vehicle4, driverId: IDS.driver4, vehicleType: "E_RICKSHAW" as any, vehicleNumber: "BR34TEST04", capacity: 4, goodsEligible: false, status: "PENDING" as any },
    ] });

    await tx.driverDocument.createMany({ data: [
      { id: IDS.document1, driverId: IDS.driver1, documentType: "DRIVING_LICENSE", documentNumber: "V35DL001", status: "APPROVED" as any },
      { id: IDS.document2, driverId: IDS.driver2, documentType: "DRIVING_LICENSE", documentNumber: "V35DL002", status: "APPROVED" as any },
      { id: IDS.document3, driverId: IDS.driver3, documentType: "RC", documentNumber: "V35RC003", status: "APPROVED" as any },
      { id: IDS.document4, driverId: IDS.driver4, documentType: "DRIVING_LICENSE", documentNumber: "V35DL004", status: "PENDING" as any },
    ] });

    await tx.driverLocation.createMany({ data: [
      { id: `${PREFIX}loc-driver-1`, driverId: IDS.driver1, latitude: 25.5392, longitude: 87.5717, accuracy: 8, speed: 18, isOnline: true },
      { id: `${PREFIX}loc-driver-2`, driverId: IDS.driver2, latitude: 25.5411, longitude: 87.5742, accuracy: 9, speed: 12, isOnline: true },
      { id: `${PREFIX}loc-driver-3`, driverId: IDS.driver3, latitude: 25.5452, longitude: 87.5782, accuracy: 10, speed: 15, isOnline: true },
      { id: `${PREFIX}loc-driver-4`, driverId: IDS.driver4, latitude: 25.548, longitude: 87.579, accuracy: 15, speed: 0, isOnline: false },
    ] });

    await tx.customerGalleryPhoto.create({ data: { id: IDS.photo1, customerId: IDS.customer1, uri: "test://ridex-v35/customer-photo-1.jpg", source: "UPLOAD" as any, fileName: "customer-photo-1.jpg", mimeType: "image/jpeg", uploaded: true } });
    await tx.emergencyContact.create({ data: { id: IDS.emergency1, customerId: IDS.customer1, name: "Test Emergency Contact", mobile: "7000000098", relation: "Family", isPrimary: true } });

    await tx.quickLocation.createMany({ data: [
      { id: IDS.location1, name: "Katihar Railway Station", category: "STATION", address: "Katihar Railway Station, Bihar", city: "Katihar", latitude: 25.5392, longitude: 87.5717, active: true },
      { id: IDS.location2, name: "Katihar Market", category: "MARKET", address: "Katihar Main Market, Bihar", city: "Katihar", latitude: 25.5411, longitude: 87.5742, active: true },
      { id: IDS.location3, name: "Katihar Hospital", category: "HOSPITAL", address: "Katihar, Bihar", city: "Katihar", latitude: 25.5452, longitude: 87.5782, active: true },
    ] });

    await tx.systemConfiguration.create({ data: { id: IDS.config1, key: "V55_TEST_COMMISSION_RATE", value: "0.1500", description: "Test commission rate" } });

    const bookingBase = (id: string, customerId: string, bookingType: any, rideType: any, status: any, pickupAddress: string, dropAddress: string, assignedDriverId?: string, vehicleId?: string, scheduledAt?: Date) => ({
      id, customerId, bookingType, rideType, status, pickupAddress, pickupLat: 25.5392, pickupLng: 87.5717, dropAddress, dropLat: 25.548, dropLng: 87.579, passengerCount: rideType === "SHARED_RIDE" ? 2 : rideType === "CONNECTION_RIDE" ? 2 : 1, estimatedFare: 86, finalFare: status === "COMPLETED" ? 92 : null, pricingVersion: "v3.5-test", commissionRate: 0.15, paymentPreference: "CASH" as any, assignedDriverId: assignedDriverId ?? null, vehicleId: vehicleId ?? null, isScheduled: Boolean(scheduledAt), pickupDatetime: scheduledAt ?? null, timezone: "Asia/Kolkata", specialInstructions: "RideX v3.5 test fixture", createdAt: new Date(now.getTime() - 60 * 60 * 1000), updatedAt: now,
    });

    await tx.booking.createMany({ data: [
      bookingBase(IDS.booking1, IDS.customer1, "RIDE", "FULL_RIDE", "IN_PROGRESS", "Katihar Railway Station", "Katihar Market", IDS.driver1, IDS.vehicle1),
      bookingBase(IDS.booking2, IDS.customer1, "RIDE", "FULL_RIDE", "COMPLETED", "Katihar Market", "Katihar Railway Station", IDS.driver1, IDS.vehicle1),
      bookingBase(IDS.booking3, IDS.customer2, "RIDE", "SHARED_RIDE", "DRIVER_ARRIVED", "Katihar Hospital", "Katihar Market", IDS.driver1, IDS.vehicle1),
      bookingBase(IDS.booking4, IDS.customer2, "RIDE", "CONNECTION_RIDE", "MATCHING", "Katihar Railway Station", "Katihar Hospital", IDS.driver1, IDS.vehicle1),
      { ...bookingBase(IDS.booking5, IDS.customer3, "GOODS", null, "DRIVER_ASSIGNED", "Katihar Market", "Katihar Hospital", IDS.driver2, IDS.vehicle2), goodsVehicleType: "E_RICKSHAW" as any, goodsType: "Parcel", goodsWeightKg: 30, goodsSize: "MEDIUM" as any, receiverName: "Test Receiver", receiverMobile: "7000000088" },
      { ...bookingBase(IDS.booking6, IDS.customer3, "GOODS", null, "UPCOMING", "Katihar Market", "Katihar Hospital", IDS.driver3, IDS.vehicle3), goodsVehicleType: "PICKUP_TRUCK" as any, goodsType: "Furniture", goodsWeightKg: 400, goodsSize: "LARGE" as any, receiverName: "Test Receiver 2", receiverMobile: "7000000087" },
      bookingBase(IDS.booking7, IDS.customer2, "RIDE", "FULL_RIDE", "CANCELLED", "Katihar Hospital", "Katihar Market", IDS.driver1, IDS.vehicle1),
      bookingBase(IDS.booking8, IDS.customer1, "RIDE", "FULL_RIDE", "UPCOMING", "Katihar Railway Station", "Katihar Hospital", undefined, undefined, future),
    ] as any });

    await tx.trip.createMany({ data: [
      { id: IDS.trip1, status: "IN_PROGRESS" as any, tripPin: "1234", startedAt: new Date(now.getTime() - 20 * 60 * 1000) },
      { id: IDS.trip2, status: "COMPLETED" as any, tripPin: "2234", startedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), completedAt: new Date(now.getTime() - 90 * 60 * 1000) },
      { id: IDS.trip3, status: "DRIVER_ARRIVED" as any, tripPin: "3234" },
    ] });

    await tx.bookingLeg.createMany({ data: [
      { id: IDS.leg1, bookingId: IDS.booking1, sequence: 1, status: "IN_PROGRESS" as any, pickupAddress: "Katihar Railway Station", pickupLat: 25.5392, pickupLng: 87.5717, dropAddress: "Katihar Market", dropLat: 25.548, dropLng: 87.579, driverId: IDS.driver1, vehicleId: IDS.vehicle1, estimatedFare: 86, tripId: IDS.trip1, tripPin: "1234" },
      { id: IDS.leg2, bookingId: IDS.booking2, sequence: 1, status: "COMPLETED" as any, pickupAddress: "Katihar Market", pickupLat: 25.5411, pickupLng: 87.5742, dropAddress: "Katihar Railway Station", dropLat: 25.5392, dropLng: 87.5717, driverId: IDS.driver1, vehicleId: IDS.vehicle1, estimatedFare: 86, finalFare: 92, tripId: IDS.trip2, tripPin: "2234" },
      { id: IDS.leg3, bookingId: IDS.booking3, sequence: 1, status: "DRIVER_ARRIVED" as any, pickupAddress: "Katihar Hospital", pickupLat: 25.5452, pickupLng: 87.5782, dropAddress: "Katihar Market", dropLat: 25.5411, dropLng: 87.5742, driverId: IDS.driver1, vehicleId: IDS.vehicle1, estimatedFare: 40, tripId: IDS.trip3, tripPin: "3234" },
      { id: IDS.leg4, bookingId: IDS.booking4, sequence: 1, status: "MATCHING" as any, pickupAddress: "Katihar Railway Station", pickupLat: 25.5392, pickupLng: 87.5717, dropAddress: "Katihar Hospital", dropLat: 25.5452, dropLng: 87.5782, estimatedFare: 70 },
      { id: IDS.leg5, bookingId: IDS.booking5, sequence: 1, status: "DRIVER_ASSIGNED" as any, pickupAddress: "Katihar Market", pickupLat: 25.5411, pickupLng: 87.5742, dropAddress: "Katihar Hospital", dropLat: 25.5452, dropLng: 87.5782, driverId: IDS.driver2, vehicleId: IDS.vehicle2, estimatedFare: 120 },
      { id: IDS.leg6, bookingId: IDS.booking6, sequence: 1, status: "UPCOMING" as any, pickupAddress: "Katihar Market", pickupLat: 25.5411, pickupLng: 87.5742, dropAddress: "Katihar Hospital", dropLat: 25.5452, dropLng: 87.5782, driverId: IDS.driver3, vehicleId: IDS.vehicle3, estimatedFare: 450 },
      { id: IDS.leg7, bookingId: IDS.booking7, sequence: 1, status: "CANCELLED" as any, pickupAddress: "Katihar Hospital", pickupLat: 25.5452, pickupLng: 87.5782, dropAddress: "Katihar Market", dropLat: 25.5411, dropLng: 87.5742, estimatedFare: 55 },
      { id: IDS.leg8, bookingId: IDS.booking8, sequence: 1, status: "UPCOMING" as any, pickupAddress: "Katihar Railway Station", pickupLat: 25.5392, pickupLng: 87.5717, dropAddress: "Katihar Hospital", dropLat: 25.5452, dropLng: 87.5782, estimatedFare: 90 },
    ] });

    await tx.tripLocationEvent.createMany({ data: [
      { id: `${PREFIX}triploc-1`, tripId: IDS.trip1, latitude: 25.5410, longitude: 87.5740, accuracy: 8, speed: 17 },
      { id: `${PREFIX}triploc-2`, tripId: IDS.trip1, latitude: 25.5431, longitude: 87.5761, accuracy: 8, speed: 15 },
      { id: `${PREFIX}triploc-3`, tripId: IDS.trip2, latitude: 25.5442, longitude: 87.5772, accuracy: 10, speed: 0 },
    ] });

    await tx.route.createMany({ data: [
      { id: IDS.route1, bookingId: IDS.booking1, legId: IDS.leg1, distanceKm: 1.8, durationMinutes: 7, provider: "TEST_OSRM", geometry: { type: "LineString", coordinates: [[87.5717,25.5392],[87.579,25.548]] } },
      { id: IDS.route2, bookingId: IDS.booking2, legId: IDS.leg2, distanceKm: 1.6, durationMinutes: 6, provider: "TEST_OSRM" },
      { id: IDS.route3, bookingId: IDS.booking3, legId: IDS.leg3, distanceKm: 1.4, durationMinutes: 6, provider: "TEST_OSRM" },
      { id: IDS.route4, bookingId: IDS.booking4, legId: IDS.leg4, distanceKm: 2.2, durationMinutes: 9, provider: "TEST_OSRM" },
      { id: IDS.route5, bookingId: IDS.booking5, legId: IDS.leg5, distanceKm: 1.2, durationMinutes: 5, provider: "TEST_OSRM" },
      { id: IDS.route6, bookingId: IDS.booking6, legId: IDS.leg6, distanceKm: 1.2, durationMinutes: 5, provider: "TEST_OSRM" },
      { id: IDS.route7, bookingId: IDS.booking7, legId: IDS.leg7, distanceKm: 1.4, durationMinutes: 6, provider: "TEST_OSRM" },
      { id: IDS.route8, bookingId: IDS.booking8, legId: IDS.leg8, distanceKm: 2.1, durationMinutes: 8, provider: "TEST_OSRM" },
    ] });

    await tx.rideRequest.createMany({ data: [
      { id: IDS.request1, bookingId: IDS.booking1, legId: IDS.leg1, driverId: IDS.driver1, vehicleId: IDS.vehicle1, distanceKm: 0.8, etaMinutes: 3, score: 0.98, status: "ACCEPTED" as any, respondedAt: new Date(now.getTime() - 25 * 60 * 1000) },
      { id: IDS.request2, bookingId: IDS.booking3, legId: IDS.leg3, driverId: IDS.driver1, vehicleId: IDS.vehicle1, distanceKm: 0.5, etaMinutes: 2, score: 0.92, status: "ACCEPTED" as any },
      { id: IDS.request3, bookingId: IDS.booking4, legId: IDS.leg4, driverId: IDS.driver1, vehicleId: IDS.vehicle1, distanceKm: 0.9, etaMinutes: 4, score: 0.88, status: "OFFERED" as any, expiresAt: later },
      { id: IDS.request4, bookingId: IDS.booking6, legId: IDS.leg6, driverId: IDS.driver3, vehicleId: IDS.vehicle3, distanceKm: 0.7, etaMinutes: 3, score: 0.94, status: "ACCEPTED" as any },
    ] });

    await tx.tripPassenger.createMany({ data: [
      { id: IDS.passenger1, bookingId: IDS.booking3, customerId: IDS.customer2, passengerName: "Shared Passenger", passengerMobile: "7000000002", seatCount: 1, status: "BOARDED", boardedAt: new Date(now.getTime() - 5 * 60 * 1000) },
      { id: IDS.passenger2, bookingId: IDS.booking3, customerId: IDS.customer1, passengerName: "Connection Passenger", passengerMobile: "7000000001", seatCount: 1, status: "WAITING_FOR_PICKUP" },
    ] });

    await tx.payment.createMany({ data: [
      { id: IDS.payment1, bookingId: IDS.booking2, customerId: IDS.customer1, amount: 92, method: "CASH" as any, status: "SUCCESS" as any, provider: "TEST", paidAt: new Date(now.getTime() - 90 * 60 * 1000) },
      { id: IDS.payment2, bookingId: IDS.booking1, customerId: IDS.customer1, amount: 86, method: "UPI" as any, status: "PENDING" as any, provider: "TEST" },
      { id: IDS.payment3, bookingId: IDS.booking5, customerId: IDS.customer3, amount: 120, method: "CARD" as any, status: "FAILED" as any, provider: "TEST" },
    ] });

    await tx.paymentAttempt.createMany({ data: [
      { id: IDS.attempt1, bookingId: IDS.booking2, paymentId: IDS.payment1, provider: "TEST", method: "CASH" as any, amount: 92, status: "SUCCESS" as any },
      { id: IDS.attempt2, bookingId: IDS.booking5, paymentId: IDS.payment3, provider: "TEST", method: "CARD" as any, amount: 120, status: "FAILED" as any, errorCode: "V55_TEST_FAIL", errorMessage: "Intentional test failure" },
    ] });

    await tx.paymentTransaction.createMany({ data: [
      { id: IDS.tx1, bookingId: IDS.booking2, paymentId: IDS.payment1, provider: "TEST", transactionType: "CAPTURE", providerTransactionId: "V35CAPTURE1", amount: 92, status: "SUCCESS" as any, rawReference: "test-success" },
      { id: IDS.tx2, bookingId: IDS.booking5, paymentId: IDS.payment3, provider: "TEST", transactionType: "FAILED", providerTransactionId: "V35FAIL1", amount: 120, status: "FAILED" as any, rawReference: "test-failure" },
    ] });

    await tx.refund.create({ data: { id: IDS.refund1, bookingId: IDS.booking2, paymentId: IDS.payment1, amount: 20, reason: "V35 test partial refund", status: "SUCCESS" as any, providerRefundId: "V35REFUND1", processedAt: now } });
    await tx.driverEarning.createMany({ data: [
      { id: IDS.earning1, bookingId: IDS.booking2, driverId: IDS.driver1, grossFare: 92, commission: 13.8, netEarning: 78.2, status: "AVAILABLE" as any },
      { id: IDS.earning2, bookingId: IDS.booking1, driverId: IDS.driver1, grossFare: 86, commission: 12.9, netEarning: 73.1, status: "PENDING" as any },
    ] });
    await tx.driverSettlement.create({ data: { id: IDS.settlement1, driverId: IDS.driver1, amount: 78.2, status: "PENDING" as any, reference: "V35-SETTLE-001" } });
    await tx.ledgerEntry.createMany({ data: [
      { id: IDS.ledger1, bookingId: IDS.booking2, driverId: IDS.driver1, paymentId: IDS.payment1, type: "PAYMENT" as any, direction: "CREDIT" as any, amount: 92, description: "V35 test payment" },
      { id: IDS.ledger2, bookingId: IDS.booking2, driverId: IDS.driver1, type: "COMMISSION" as any, direction: "DEBIT" as any, amount: 13.8, description: "V35 test commission" },
    ] });
    await tx.cashCollection.create({ data: { id: IDS.cash1, bookingId: IDS.booking2, driverId: IDS.driver1, amount: 92, verified: true } });
    await tx.commissionEntry.create({ data: { id: IDS.commission1, bookingId: IDS.booking2, driverId: IDS.driver1, grossFare: 92, rate: 0.15, amount: 13.8 } });
    await tx.financialAdjustment.create({ data: { id: IDS.adjustment1, bookingId: IDS.booking2, driverId: IDS.driver1, type: "TEST_ADJUSTMENT", amount: 5, reason: "V35 test adjustment", createdByAdminId: IDS.admin } });
    await tx.rating.create({ data: { id: IDS.rating1, bookingId: IDS.booking2, customerId: IDS.customer1, driverId: IDS.driver1, target: "DRIVER" as any, stars: 5, comment: "Excellent test ride" } });

    await tx.supportCase.create({ data: { id: IDS.support1, bookingId: IDS.booking1, customerId: IDS.customer1, driverId: IDS.driver1, subject: "V35 test support case", description: "Intentional support fixture for admin testing", status: "IN_PROGRESS" as any, priority: "HIGH" as any, assignedAdminId: IDS.admin } });
    await tx.supportMessage.create({ data: { id: IDS.supportMessage1, caseId: IDS.support1, senderType: "CUSTOMER", senderId: IDS.customer1, message: "This is a test support message." } });

    await tx.sosEvent.create({ data: { id: IDS.sos1, bookingId: IDS.booking1, customerId: IDS.customer1, driverId: IDS.driver1, latitude: 25.5421, longitude: 87.5751, reason: "V35 safety test", status: "ACKNOWLEDGED" as any } });
    await tx.safetyIncident.create({ data: { id: IDS.incident1, sosEventId: IDS.sos1, bookingId: IDS.booking1, customerId: IDS.customer1, driverId: IDS.driver1, type: "UNSAFE_DRIVING" as any, description: "Intentional test incident", locationLat: 25.5421, locationLng: 87.5751, status: "UNDER_REVIEW" as any } });
    await tx.incidentAction.create({ data: { id: IDS.incidentAction1, incidentId: IDS.incident1, action: "CONTACTED_DRIVER", notes: "V35 test action", adminId: IDS.admin } });
    await tx.routeDeviationEvent.create({ data: { id: IDS.deviation1, tripId: IDS.trip1, bookingId: IDS.booking1, latitude: 25.544, longitude: 87.577, deviationKm: 0.7, extraMinutes: 4, severity: "MONITORING" } });

    await tx.notification.createMany({ data: [
      { id: IDS.notification1, userId: IDS.user1, channel: "IN_APP", title: "V35 Test Ride Update", body: "Your test driver is approaching." },
      { id: IDS.notification2, userId: IDS.userD1, channel: "IN_APP", title: "V35 Test Ride Request", body: "You have a test ride request." },
    ] });

    await tx.coupon.create({ data: { id: IDS.coupon1, code: "V35WELCOME50", description: "RideX v3.5 test coupon", discountType: "FIXED" as any, discountValue: 50, maxDiscount: 50, minFare: 100, validFrom: new Date(now.getTime() - 24 * 60 * 60 * 1000), validUntil: later, totalUsageLimit: 100, perCustomerLimit: 2, rideScope: "ALL" as any, isActive: true } });
    await tx.couponUsage.create({ data: { id: IDS.couponUsage1, couponId: IDS.coupon1, customerId: IDS.customer1, bookingId: IDS.booking2, discount: 20 } });
  });

  return { success: true, message: "RideX v3.5 comprehensive test dataset seeded", ids: IDS };
}

export async function getRideXTestDataSummary() {
  guardTestMode();
  const [users, customers, drivers, vehicles, bookings, trips, payments, ratings, supportCases, sosEvents, notifications, coupons, locations] = await Promise.all([
    prisma.user.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.customer.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.driver.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.vehicle.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.booking.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.trip.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.payment.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.rating.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.supportCase.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.sosEvent.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.notification.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.coupon.count({ where: { id: { startsWith: PREFIX } } }),
    prisma.quickLocation.count({ where: { id: { startsWith: PREFIX } } }),
  ]);
  return { users, customers, drivers, vehicles, bookings, trips, payments, ratings, supportCases, sosEvents, notifications, coupons, locations };
}

export async function getRideXTestDataRecords() {
  guardTestMode();
  const [customers, drivers, vehicles, bookings, locations, coupons, supportCases, notifications] = await Promise.all([
    prisma.customer.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { id: "asc" }, select: { id: true, fullName: true, rating: true } }),
    prisma.driver.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { id: "asc" }, select: { id: true, fullName: true, verificationStatus: true, driverStatus: true, dailyServiceMode: true, rating: true } }),
    prisma.vehicle.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { id: "asc" }, select: { id: true, vehicleType: true, vehicleNumber: true, capacity: true, goodsEligible: true, status: true, driverId: true } }),
    prisma.booking.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { createdAt: "desc" }, select: { id: true, bookingType: true, rideType: true, status: true, estimatedFare: true, finalFare: true, customerId: true, assignedDriverId: true, vehicleId: true } }),
    prisma.quickLocation.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { id: "asc" } }),
    prisma.coupon.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { id: "asc" } }),
    prisma.supportCase.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { id: "asc" }, select: { id: true, subject: true, status: true, priority: true, customerId: true, driverId: true } }),
    prisma.notification.findMany({ where: { id: { startsWith: PREFIX } }, orderBy: { createdAt: "desc" }, select: { id: true, userId: true, title: true, body: true, readAt: true, channel: true } }),
  ]);
  return { customers, drivers, vehicles, bookings, locations, coupons, supportCases, notifications };
}
