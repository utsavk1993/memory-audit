---
name: Release checklist
description: Steps before tagging a storefront release
metadata:
  type: project
---

1. Bump the version in `package.json` and update CHANGELOG.md.
2. Load the release secrets from `~/.config/acme/release.env`.
3. Tag `vX.Y.Z` on main and push the tag; CI builds the release.
4. Post the changelog in #storefront.
