# GitHub Actions deployment

`ci.yml` runs migrations against an isolated PostgreSQL service, the Jest suite, a high-severity npm audit, and both Docker builds on every branch push and pull request. Only a successful push to `main` starts deployment. Deployment is serialized so a migration is not cancelled by a newer push.

The deployment job authenticates to Google Cloud with GitHub OIDC. The provider is restricted to `sunvat-creator/DeawKoyKid-Backend` on `refs/heads/main`. It builds runtime and migration targets, pushes SHA-tagged images to Artifact Registry, runs the migration job with `DIRECT_URL` from Secret Manager, deploys the runtime image by digest, then checks `/health` and `/ready`.

Cloud resources created for this workflow:

- Workload Identity Pool `github`, provider `sunvat-backend` in project number `881996648465`.
- Service accounts `github-deployer` and `migration-runner` in project `project-fd26c589-9a13-42d1-868`.
- Secret Manager secret `togethr-direct-url`, version `1`.

Before enabling deployment, an administrator must grant the GitHub principal `roles/iam.workloadIdentityUser` on `github-deployer`. The deployer requires Artifact Registry writer on repository `togethr-backend`, Cloud Run deploy/job-management permissions, and `roles/iam.serviceAccountUser` on the runtime and migration service accounts. The migration service account needs `roles/secretmanager.secretAccessor` on `togethr-direct-url`. These IAM grants have **not** been applied. Review and grant them with the narrowest permissions your organization supports.

The current Cloud Run service already has its runtime settings and secrets. `gcloud run deploy --image` preserves them. Keep `DIRECT_URL` out of the HTTP service. Run the first workflow from a pull request and review its test results before merging into `main`.
