# Standby.y mobile (web app)

The phone web app for the shop's admins (roadmap phase 6). Static files only; no secrets. Published with GitHub Pages
from the public repo `ChocoHusky17/standbyy-mobile` at https://chocohusky17.github.io/standbyy-mobile/ .
It signs in to the shared `inbox-api` (CORS allows only that address, see `corsOriginsOf` in
`supabase/functions/inbox-api/handler.mjs` and `index.ts`).

Publish: `/usr/bin/python3 scripts/publish_mobile.py` copies this folder to the Pages repo and pushes.
