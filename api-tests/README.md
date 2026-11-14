# Backend Postman checks

Import `togethr-backend.postman_collection.json` into Postman. It contains all 50 HTTP routes currently defined in `src/routes`, plus `/health` and `/ready`. Set `baseUrl` to the Cloud Run URL if it changes.

1. Run the two Deployment checks first. Both must return HTTP 200. `/ready` also checks the Supabase database.
2. Run public GET requests (`categories`, `services/search`, and service/profile details after setting `id`).
3. Register disposable customer and provider accounts or use existing demo accounts. In `auth/login`, replace the example email and password. Postman must retain the returned `token` cookie for subsequent requests. Never save real credentials in the collection or export a populated cookie jar.
4. Fill the collection variables `id`, `messageId`, and `attachmentId` from resources belonging to the disposable accounts. Replace `{}` request bodies with valid data for each operation. File requests use multipart form data; choose a local JPG/PNG/PDF as allowed by the endpoint.
5. Exercise booking, chat, review, complaint, notification, provider, and account mutation requests on disposable data. Test admin complaint endpoints with an admin account only. The account deletion route deletes the signed-in account and should be run last.

The collection is an inventory and manual test harness, not proof that every workflow has passed. The live smoke check on 2026-11-14 verified `/health`, `/ready`, categories and service search return 200; protected routes return 401 without login; invalid registration returns 400. Full authenticated and write-path verification requires disposable accounts, representative records, file fixtures, and checking effects after each request.
