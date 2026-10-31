# Edward Lau — StayHub Public + API (Final)

Public static site published from `site/` with `netlify/functions/api.mjs` and PostgreSQL migrations. See `ENVIRONMENT_VARIABLES.example` and `README_DATABASE_EXPORT_中文.md` for setup and reporting instructions. Never put secrets in source control. `npm test` / `npm run check` / `npm run preflight` before deploy.


## Privacy-safe admin export endpoint

`GET /api/admin/reports/export?format=xlsx&dataset=all` or `?format=csv&dataset=customers` (also `summary`, `bookings`, `payments`, `properties`, `rooms`). Requires `Authorization: Bearer <admin-session-token>` after successful MFA; non-admin accounts are denied. Exports are non-cached, bounded to 5,000 records per dataset and never contain passwords, authentication records, full customer emails, phone numbers or special requests. Excel output uses built-in Node.js ZIP/OOXML support with no additional npm dependency. Financial data is marked **SIMULATED**, not real revenue. No schema changes.
