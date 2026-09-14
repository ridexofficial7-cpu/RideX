# RideX 3.5.0

RideX is a three-application ride platform consisting of Customer App, Driver App, Admin Panel and a shared Node/TypeScript backend.

## Release posture
- Test mode is explicit via environment variables; production defaults are safe.
- Customer and Driver authenticate through backend-issued bearer sessions after OTP verification.
- Admin production login uses approved Admin OTP and a bearer session; test mode retains the local Admin User ID compatibility path.
- Test payment success endpoint is disabled outside explicit test mode.
- Google Maps is a native build-time integration for the Customer app; provide `GOOGLE_MAPS_API_KEY` through EAS/local build secrets.
- Provider credentials can be configured by Super Admin through Admin > Settings; secrets are encrypted in PostgreSQL using `RIDEX_CONFIG_ENCRYPTION_KEY`.
- GitHub CI configuration is included under `.github/workflows`.

## Test setup
1. Copy `backend/.env.example` to `backend/.env` and configure PostgreSQL.
2. Keep `RIDEX_TEST_MODE=true` for local smoke testing. OTP is `1234` in test mode.
3. Run Prisma generation/migrations, then start the backend on port 4000.
4. Set each frontend API URL to the reachable backend address.

## Production setup
1. Set `NODE_ENV=production` and `RIDEX_TEST_MODE=false`.
2. Set a strong `RIDEX_CONFIG_ENCRYPTION_KEY` and restricted `CORS_ORIGIN`.
3. Configure OTP/payment/routing provider credentials through the Admin Panel or secure deployment environment.
4. Supply the Google Maps key to the Expo/EAS build environment.
5. Connect the repository to GitHub and store deployment/provider secrets in GitHub Actions or the production secret manager.

Never commit `.env` files, database passwords, provider passwords, or private API keys.


## v3.5 Test Data Lab
When `RIDEX_TEST_MODE=true`, the backend exposes admin-only `/api/v1/admin/test-data/*` controls. Use the Admin Panel → Test Data Lab to seed, inspect, edit, and delete deterministic `v35-test-*` fixtures. These endpoints are disabled outside test mode.
