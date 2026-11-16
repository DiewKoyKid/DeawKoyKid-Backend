# Swagger / OpenAPI

Start the backend with `npm ci` and `npm start` after configuring `.env`.

- Swagger UI: http://localhost:8080/api-docs/
- OpenAPI JSON: http://localhost:8080/openapi.json

Use the configured `PORT` if it differs from 8080. On a deployed backend, append
`/api-docs/` or `/openapi.json` to that backend's URL. All Swagger assets are
served by this application; no CDN or Google Cloud service is required.

## Try an authenticated request

1. Open **Auth > POST /auth/login**, select **Try it out**, and enter a test account.
2. Execute the request on the same backend host as the documentation.
3. Execute **Users > GET /users/me**. The browser sends the login cookie.
4. Use **POST /auth/logout** when finished. If you already have a valid JWT, the
   **Authorize** dialog also accepts it using the bearerAuth scheme.

HttpOnly cookies cannot be entered manually in Swagger's Authorize dialog.
Production cookie settings require HTTPS. Try it out sends real requests and
can create or change data; use test accounts for demonstrations.

## Maintaining the contract

`src/docs/base.openapi.json` preserves the pre-existing auth, users, and complaints
contract imported from the frontend's `openapi.yaml`. `src/docs/openapi.js` adds
the remaining REST routes and sets the same-host server URL. The complete,
resolved document is served at `/openapi.json` and can be imported into Swagger
Editor or Postman. Several complex response objects intentionally allow additional
properties; they are not yet strict field-by-field response schemas.

Update the relevant contract whenever a route or request changes. Changes to the
shared auth/user/complaint contract must also be reflected in the frontend's
`openapi.yaml` before regenerating its client. Socket.IO events and operational
health endpoints are outside the `/api` REST contract.

Run `npm test -- --runTestsByPath tests/openapi.test.js` to validate OpenAPI,
check coverage against mounted REST routes, and smoke-test the UI and JSON.
These tests do not need a database and also run under the existing CI test job.
