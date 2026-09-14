import {
  PrismaClient,
  UserStatus,
  UserType,
  AdminApprovalStatus,
  PermissionAction,
} from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_NAME = process.env.ADMIN_NAME || "RideX Super Admin";
const ADMIN_MOBILE = String(process.env.ADMIN_MOBILE || "").replace(/\D/g, "").slice(-10);

const ADMIN_ROLES = [
  ["SUPER_ADMIN", "Full RideX platform administration access", true],
  ["OPERATIONS", "Operations and day-to-day platform management", false],
  ["FINANCE", "Payments, finance and settlement operations", false],
  ["SAFETY", "Safety, SOS and incident operations", false],
  ["SUPPORT", "Customer and driver support operations", false],
  ["VERIFICATION_KYC", "Driver verification and KYC operations", false],
] as const;

const PERMISSIONS: Array<[string, PermissionAction, string]> = [
  ["dashboard", PermissionAction.VIEW, "View the admin dashboard"],
  ["operations", PermissionAction.VIEW, "View operational data"],
  ["operations", PermissionAction.CONFIGURE, "Run operational configuration actions"],
  ["drivers", PermissionAction.VIEW, "View driver data"],
  ["drivers", PermissionAction.APPROVE, "Approve driver verification"],
  ["drivers", PermissionAction.SUSPEND, "Suspend or reactivate drivers"],
  ["bookings", PermissionAction.VIEW, "View bookings"],
  ["safety", PermissionAction.VIEW, "View SOS and safety data"],
  ["customers", PermissionAction.VIEW, "View customers"],
  ["admins", PermissionAction.VIEW, "View admin users, roles and permissions"],
  ["admins", PermissionAction.MANAGE_ADMINS, "Create and manage admin users"],
  ["admins", PermissionAction.MANAGE_PERMISSIONS, "Manage role permissions"],
  ["security", PermissionAction.VIEW, "View security and audit information"],
  ["payments", PermissionAction.VIEW, "View payments and settlement data"],
  ["promotions", PermissionAction.VIEW, "View promotions and coupons"],
  ["promotions", PermissionAction.CREATE, "Create promotions and coupons"],
  ["promotions", PermissionAction.EDIT, "Edit promotions and coupons"],
  ["support", PermissionAction.VIEW, "View support cases"],
  ["support", PermissionAction.EDIT, "Update support cases"],
  ["notifications", PermissionAction.CREATE, "Send operational in-app notifications"],
];

async function main() {
  console.log("RideX initial Super Admin bootstrap...");
  console.log(`Name: ${ADMIN_NAME}`);
  if (!/^\d{10}$/.test(ADMIN_MOBILE)) throw new Error("Set ADMIN_MOBILE to a valid 10-digit mobile before bootstrap-admin.");
  console.log("Admin mobile: configured");

  const roles = new Map<string, { id: string; name: string }>();

  for (const [name, description, isSystem] of ADMIN_ROLES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description, isSystem },
      create: { name, description, isSystem },
      select: { id: true, name: true },
    });
    roles.set(role.name, role);
  }

  const permissions = [];

  for (const [module, action, description] of PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: {
        module_action: { module, action },
      },
      update: { description },
      create: { module, action, description },
      select: { id: true, module: true, action: true },
    });
    permissions.push(permission);
  }

  const superAdminRole = roles.get("SUPER_ADMIN");
  if (!superAdminRole) {
    throw new Error("SUPER_ADMIN role was not created.");
  }

  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: superAdminRole.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: superAdminRole.id,
        permissionId: permission.id,
      },
    });
  }

  let user = await prisma.user.findUnique({
    where: { mobile: ADMIN_MOBILE },
  });

  if (user && user.userType !== UserType.ADMIN) {
    throw new Error(
      `Mobile ${ADMIN_MOBILE} already belongs to ${user.id} with userType=${user.userType}. Bootstrap stopped.`
    );
  }

  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        userType: UserType.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
  } else {
    user = await prisma.user.create({
      data: {
        userType: UserType.ADMIN,
        mobile: ADMIN_MOBILE,
        status: UserStatus.ACTIVE,
      },
    });
  }

  const admin = await prisma.adminUser.upsert({
    where: { userId: user.id },
    update: {
      name: ADMIN_NAME,
      roleId: superAdminRole.id,
      approvalStatus: AdminApprovalStatus.APPROVED,
      approvedByAdminId: null,
      approvedAt: new Date(),
      rejectedAt: null,
      suspendedAt: null,
    },
    create: {
      userId: user.id,
      name: ADMIN_NAME,
      roleId: superAdminRole.id,
      approvalStatus: AdminApprovalStatus.APPROVED,
      approvedAt: new Date(),
    },
    select: {
      id: true,
      userId: true,
      name: true,
      approvalStatus: true,
      role: { select: { name: true } },
      user: {
        select: {
          id: true,
          mobile: true,
          userType: true,
          status: true,
        },
      },
    },
  });

  console.log("");
  console.log("==============================================");
  console.log("RIDEX INITIAL SUPER ADMIN READY");
  console.log("==============================================");
  console.log(`Name:      ${admin.name}`);
  console.log(`Mobile:    +91 ${admin.user.mobile}`);
  console.log(`Admin ID:  ${admin.id}`);
  console.log(`User ID:   ${admin.userId}`);
  console.log(`Role:      ${admin.role.name}`);
  console.log(`Approval:  ${admin.approvalStatus}`);
  console.log("==============================================");
  console.log("Use the Admin ID above in the Admin Panel.");
}

main()
  .catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
