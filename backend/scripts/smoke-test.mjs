const base = (process.env.RIDEX_SMOKE_API_URL || "http://localhost:4000/api/v1").replace(/\/+$/, "");
const mobile = process.env.RIDEX_SMOKE_MOBILE || "9999999999";
const driverMobile = process.env.RIDEX_SMOKE_DRIVER_MOBILE || "8888888888";
const otp = process.env.RIDEX_TEST_MODE === "true" ? "1234" : process.env.RIDEX_SMOKE_OTP;

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const health = await request("/health");
if (!health.success || health.status !== "ok") throw new Error("Health check failed");
const ready = await request("/meta/ready");
if (!ready.success || ready.status !== "ready") throw new Error("Readiness check failed");

const send = await request("/auth/send-otp", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mobile, userType: "CUSTOMER" }),
});
const code = otp || send.testOtp;
if (!code) throw new Error("No OTP available for smoke test");

const verified = await request("/auth/verify-otp", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mobile, otp: code, userType: "CUSTOMER" }),
});
if (!verified.success || !verified.data?.token || !verified.data?.customerId) throw new Error("Customer session was not created");

const token = verified.data.token;
await request("/notifications", {
  headers: { Authorization: `Bearer ${token}` },
});

console.log("RideX smoke test passed: health -> readiness -> durable OTP -> customer session -> authenticated notifications read");
console.log(`Driver test mobile reserved for later end-to-end acceptance: ${driverMobile}`);
