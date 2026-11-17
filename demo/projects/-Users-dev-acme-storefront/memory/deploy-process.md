---
name: Deploy process
description: How to deploy the storefront to Heroku from main
metadata:
  type: project
---

Deploy the storefront with `npm run deploy:heroku` from the `main` branch.

- Staging is the `acme-storefront-staging` Heroku app; production is `acme-storefront`.
- Run `npm run db:migrate` against production after each deploy.
- Deploys need the Heroku CLI logged in as the shared ops account.
