# RideX v7.2 — Single Mobile App

This release contains one Expo mobile launcher: `ridex-app`. Customer and Driver are role-based flows inside the same app.

Default flow: Customer Login → **Be a Rider** → Driver Login. Successful authentication routes to the matching Customer Home or Driver Home.

See `../V7_2_FINAL_VALIDATION.md` for the release validation record.

# RideX — Single Mobile App

This is the **only mobile app entry point** for RideX.

## Login flow
1. App opens directly on **Customer Login**.
2. Customer login shows **Be a Driver** directly below the customer Send OTP action.
3. Tapping **Be a Driver** opens the **Driver Login** screen in the same app.
4. Driver Login back button returns to Customer Login.

## Run locally
```bash
npm install
npm start
```

Use the `ridex-app` directory for mobile testing. The top-level `customer-app` and `driver-app` standalone projects are intentionally not part of the mobile release package; their legacy copies are kept under `archive/legacy-apps`.
