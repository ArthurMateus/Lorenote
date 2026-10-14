# Corkboard

An original board app (notes, links, to-do lists, columns, sub-boards, comments, tables, images, files, sketches and connector lines on an infinite canvas), built from the behaviour documented in [`../SPEC.md`](../SPEC.md). Everything is unlocked: no card limits, no paywall, no account.

## Run

No build step and no dependencies. Serve this folder over HTTP (ES modules need it):

```bash
python -m http.server 5173 --directory app
```

then open <http://localhost:5173>.

## Cloud accounts (optional, Supabase)

Without configuration the app runs local-only. To turn on accounts and cross-device sync:

1. Create a project at <https://supabase.com> (the free tier is enough).
2. **SQL editor** → paste and run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables with row-level security, a signup trigger, realtime, and a private `files` bucket.
3. **Project settings → API**: copy the *Project URL* and the *anon public* key into [`config.js`](config.js). Never use the `service_role` key.
4. **Authentication → URL configuration**: set *Site URL* to where the app is served (e.g. `http://localhost:5173`) and add it to the redirect list. For quick testing, you can turn off *Confirm email* under Authentication → Providers → Email.
5. Optional: enable Google/GitHub under Authentication → Providers, then list them in `oauthProviders` in `config.js`. For Google: create a *Web application* OAuth client in Google Cloud (authorized origin = where the app is served, redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`) and paste its Client ID and Secret into Supabase.

Behaviour: sign in or create an account on the landing page ("Try it without an account" still works). Edits are saved to the device first, then pushed in batches; newest `modified` wins per card; changes from your other devices arrive live. Offline edits queue and retry. Deletes are stored as tombstones (purged after 30 days) so every device sees them. If you sign in on a device that has boards from before you had an account, the menu offers *Import … items from this device*. On a brand-new account the app offers to upload the boards you made without an account.

## Phones, tablets and installing it

- **Touch:** one finger drags cards or pans the empty canvas; two fingers pinch-zoom and pan; double-tap makes a note (or opens a board / edits text); tapping a tool drops that card in the middle of the screen; resize handles, connector ends, checkboxes and buttons grow to finger size on touch screens. A pen works like a mouse (including in the sketch tool).
- **Layouts:** desktop and tablets use the side tool rail; phones (≤760px) get a bottom tool bar, a compact header (Trash and Templates move into the ⋯ menu) and a context bar docked above the tools. Safe-area insets (notches, home indicator) are respected.
- **Installable (PWA):** `manifest.webmanifest`, icons (`icons/`, regenerate with `python tools/make_icons.py`) and a service worker (`sw.js`). Chrome/Edge/Android show *Install app* in the ⋯ menu; on iPhone/iPad use Share → Add to Home Screen. Once installed it opens full-screen, works offline (the app files and the Supabase library are cached; edits queue and sync later) and shows an update notice when a new version is deployed.
- **Share target and shortcut:** on Android/Chrome the installed app appears in the system share sheet; shared links become link cards and shared text becomes a note on the Home board. Long-pressing the icon offers *New note* (`/?new=note`).
- **Dev server:** `python tools/serve.py 5173` serves `app/` with caching disabled (the service worker is network-first, so edits show up on reload).

## What is implemented

| Area | Notes |
|---|---|
| Cards | note (rich text), link, to-do list + tasks, column, sub-board, comment thread, table, image, file, sketch, line/connector |
| Layout | infinite canvas, pan (wheel / Space-drag), zoom (Ctrl+wheel / buttons), dot grid, optional snap-to-grid |
| Editing | drag from the tool rail to create (anywhere, into a column/list/board), double-click canvas for a note, resize handle, marquee + shift multi-select, arrow-key nudge, duplicate |
| Nesting | drop onto columns, to-do lists (tasks only) and board tiles; sub-boards with breadcrumbs and `#/<boardId>` URLs |
| Connectors | drag a line end onto any card to bind it; lines follow their cards |
| History | undo/redo (Ctrl+Z / Ctrl+Shift+Z), computed client-side from patches; trash with restore |
| Persistence | IndexedDB (localStorage fallback), debounced; JSON export/import from the menu |
| Sync (optional extra) | live multi-tab sync through `BroadcastChannel` (last-writer-wins by `modified`; remote edits never enter the local undo stack). A server relay is **not** included, see below. |
| Extras | starter templates, search across all boards (Ctrl+K), light/dark/system theme, paste a link/text/image, drop files from the OS |

## Layout of the code

- `src/store.js` flat element map, patch commits (`{id, before, after}`), undo/redo, persistence, tab sync
- `src/model.js` element factories, HTML sanitiser, templates
- `src/view.js` incremental DOM rendering, connector lines, selection, context toolbar
- `src/interact.js` pointer/keyboard interaction, drag-and-nest, resize, sketching, paste/drop
- `src/main.js` header, breadcrumbs, trash, search, menus, routing

## Data model (own schema, not wire-compatible with any other product)

```
{ id, type, parentId, section: 'canvas' | 'stack', x, y, z | order, w, color, content, created, modified, trashed? }
```
`canvas` children are free-positioned; `stack` children are ordered inside a column / to-do list. Lines keep `content.{a,b,aId,bId,arrow,dashed,weight}`.

## Known gaps / ideas

- Real-time sync across machines needs a small server (e.g. a WebSocket relay broadcasting the same `{id, after}` patches). The patch format is already the unit of sync.
- Link cards do not fetch page titles or previews (browsers block cross-origin fetches); the title defaults to the host and is editable.
- No sharing, comments from other users, or permissions (single-user local app).
- Sketch tool is pen-only (colour + width); no eraser besides "Undo stroke" / "Clear".
