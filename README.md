# Lorenote

A visual board app (notes, links, to-do lists, columns, sub-boards, comments, tables, images, files, sketches and connectors on an infinite canvas) with accounts, cross-device sync, and phone/tablet/desktop support.
The code and internal storage keys still use the earlier working title "corkboard" (so existing data keeps working).

The product behaviour is based on observing an existing web app with [REA](https://github.com) reverse-engineering tools: see [`SPEC.md`](SPEC.md). Nothing from that product's code, assets, branding or copy is used; this is an original implementation built from observed behaviour.

| Path | What it is |
|---|---|
| [`app/`](app/) | The app (plain ES modules, no build step). Start here: [`app/README.md`](app/README.md) |
| [`app/supabase/schema.sql`](app/supabase/schema.sql) | Database schema + row-level security for the optional cloud backend |
| [`SPEC.md`](SPEC.md) | Behavioural specification derived from the analysis, with evidence ids and explicit unknowns |
| [`evidence/`](evidence/) | Small, value-free shape captures that back the spec (raw captures are kept out of the repo) |
| [`tools/`](tools/) | Dev tooling: no-cache dev server, icon generator, and the CDP helper / in-page shape logger used during analysis |

## Run it

```bash
python tools/serve.py 5173      # then open http://localhost:5173
```

Runs fully local by default. To turn on accounts and sync, follow "Cloud accounts" in [`app/README.md`](app/README.md) (create `app/config.local.js`, which is git-ignored).

## Status

Done: canvas + all card types, nesting, connectors, undo/redo, trash, search, a 41-template library with picker and account-bound "My templates", import/export, Supabase accounts (email, magic link, Google), live sync + offline queue, touch gestures, phone layout, installable offline PWA.
Also done: cloud file storage with offline cache and migration, server-side link previews (Edge Function).
Layout tools (align, distribute, snap guides, lock, stacking), minimap, zoom-to-fit, presentation mode, boards tree, light/dark toggle and the Lorenote brand refresh are in.
Next ideas: sharing and collaboration, real-device testing, comment mentions.
