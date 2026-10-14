# Milanote-style board app: behavioural specification

Clean-room spec derived from **observed behaviour and wire shapes** of app.milanote.com (free plan, one test board).
No Milanote code, assets, branding or copy text is reproduced. Names of protocol fields are listed because they are
facts about an interface, not expressive content; the implementation in `app/` defines its own names and is not wire-compatible.

## 0. Method and provenance

> **About the evidence in this repository.** The raw captures (full bundle analysis, page inspections, screenshots of a signed-in account) are intentionally **not** committed: they embed third-party source text and account identifiers. Evidence ids below refer to those local records. Only the value-free shape files under `evidence/captures/` are included.

| Tag | Meaning |
|---|---|
| **[REA]** | Observed through an REA MCP tool; evidence id given. |
| **[HOOK]** | Observed by a value-free in-page logger (`tools/shape-hook.js`) driven by `tools/cdp.mjs`. Logs only event names, key names and value *types/lengths*. Not an REA tool. |
| **[SHOT]** | Seen in a screenshot under `screenshots/`. |
| **[UNKNOWN]** | Not observed. Do not assume. |

REA evidence ids:

- `ev_17c54a7f7c5b…` / `ev_a70e90d97ef5…` / `ev_0bfe750b220e…` list_browser_targets (Edge :9222, Brave :9223)
- `ev_bdac160006a89b833b8cc3d0ac7c0e66ae2a9aba536fd2686de5f012d71ec048` analyze_web_bundle, 29 scripts from `static.milanote.com`, 73 route candidates (`evidence/session-bundle-1.json`)
- `ev_918822b667a1…` inspect_web_page with storage key names (`evidence/page-inspect-2.json`)
- `ev_cedd895e1d44…` / `ev_286ed05522675…` inspect_web_page during board create / rename: REST shapes + WebSocket frame sizes (`evidence/captures/cap-0*.json`)
- In-page shape captures: `evidence/captures/hook-01-load.json`, `board-persisted-shape.json`, `user-me-shape.json`
- Screenshots: `screenshots/00..19`

Limitations found while working (affect confidence):

1. REA attaches after page load; reloading during capture invalidates the target (`target_changed`). Load-time traffic therefore came from the in-page hook, not REA.
2. `capture_browser_scenario` failed with `cleanup_incomplete` on both browsers, so scripted scenarios were driven by `tools/cdp.mjs` (CDP over loopback) while REA observed.
3. REA reports Socket.IO text frames as sizes only; event names and payload shapes in section 3 are **[HOOK]**.
4. Source maps covered ~150 modules (icons, search, tables, onboarding); the board core (main/vendor/workspace) was not mapped.
5. **Process note:** some original source text embedded in source maps was displayed in the analyst's context once by mistake. It was not used; everything below comes from runtime shapes and screenshots. Analyst and implementer are the same agent, so this is not a strict clean-room separation.

## 1. Delivery architecture [REA]

- Shell HTML on `app.milanote.com`; scripts and CSS on `static.milanote.com` (content-hashed, `-modern` / `-legacy` builds, route-split chunks such as `workspace`, `tables`, `annotation-editor`, `onboarding-content`, locale chunks `locales-en`, `locales-pt`).
- Client stack inferred from bundle: React, Redux (state slices below), Immutable collections, a rich-text editor producing a ProseMirror-style JSON doc (see 4.3), engine.io/Socket.IO client, service-worker/workbox caches (`static-js`, `static-css`, `static-fonts`, `user-images`).
- An AWS-WAF-style challenge script and token refresh run on load (`/awswaf/.../inputs`, `.../mp_verify` returning a token) [HOOK]. Third-party: consent manager, analytics, error monitoring, chat widget (not relevant to the clone).
- Client routes [REA bundle]: `/:boardId(/:slug)`, `/e/:elementId`, `/login`, `/register`, `/forgotten-password`, `/account/(settings|plan|notifications|interface|preferences|localization|toolbar|privacy|…)`, `/shortcuts`, `/compose`, `/report-content/:boardId`, `/checkout`, `/onboarding`, `/preview`, `/admin/*` (admin not touched).
- Client state slices [REA bundle]: `elements`, `comments`, `users`, `acl`, `currentBoardId`, `routing`, `undoStack`, `redoStack`, `mostRecentTransactionId`, `liveCursor`, `liveDrawing`, `elementMeasurements`, `attachModeHoveredStack`, `permissionsUpdatingUsers`, `experiments`.
- Browser storage **key names** [REA ev_918822b6…]: localStorage `milanote.theme`, `milanote.gridSize`, `milanote.returnState`, `milanote.lastNavigation.elementId`, `milanote.lastRefreshTime`, `milanote.auth.appLocale`, `betterAuthSessionUser`; IndexedDB `keyval-store`; Cache API `user-images`. Values not read.

## 2. REST API (same origin, `/api/…`, JSON) [HOOK unless noted]

| Method + path | Response shape (types only) |
|---|---|
| `GET /api/ping` | `{success:bool}` |
| `GET /api/version/status?version&appType=web` | `{currentVersion, isBlocked, safe, upToDate}` |
| `GET /api/users/me` | `{user:{_id, name{given,family,display}, role:"USER", status:"ACTIVE", settings{…}, contentLimit{…}, rootBoardId, quickNotesRootId, lastViewedBoard, flags, experiments[], …}}` |
| `GET /api/users?ids=` | `{users:{<id>:{_id,name,role,status,flags}}}` |
| `GET /api/users/activity?ids=` | `{users:{<id>:{timestamp,onlineStatus,connectionTime,selectedElementIds,currentBoardId,selectedElementsSessionId}}}` (presence) |
| `GET /api/users/me/app-init?timezone=` | `{elements, elementsCreated, elementCount{BOARD}, remoteUserIds, boardHierarchies, initialised{…}, cache{…}}` |
| `GET /api/users/me/notification-preferences` | `{boardNotificationPreferences:[]}` |
| `GET /api/users/me/custom-templates-init` | `{elements:{}}` |
| `GET /api/boards?excludeSelf&loadAncestors&ids=` | **board payload** (4.1) |
| `GET /api/boards/modified?ids=` | `{modifiedTimes:[{id,modifiedTime}]}` (polled; cheap freshness check) |
| `GET /api//icons?search=&queryType=board_create&count=` | `{icons:[…]}` suggested board icons from the title |
| `GET /api/cms/releases?platform=Web` | list `{id,title,version,date}` |
| notifications feed `GET /api/<id>?after=0` | `{notifications:[], hasMore}` |

Writes are **not** REST: all edits go through the socket (section 3). **[UNKNOWN]**: auth endpoints (`/login`, session cookie vs token, `betterAuthSessionUser`), file/image upload endpoints, export, sharing/invite endpoints, template-instantiation endpoint, link-preview endpoint (the link card's title/description appeared server-resolved).

## 3. Real-time channel [REA ev_286ed055…, HOOK]

- Socket.IO v4 (`EIO=4`), WebSocket-only transport: `wss://<host>/socket.io/?userId=<uid>&EIO=4&transport=websocket`. Engine ping interval/timeout in the open packet; client reconnects with a fresh `sid` after network loss. Auth mechanism on connect: **[UNKNOWN]** (cookie assumed; not read).
- Client → server events:
  - `action` : one **action object** per event; server **acks** each with `{status:int}`.
  - `update-channels` : `{joined:[channelId…], left:[…], bufferFlush?, replay?}`. Channels are board ids (`joined` after navigating into a board) and per-user channels.
- Every action carries bookkeeping: `user{_id, clientId(6 chars), clientTick:int}`, `deviceId`, `sessionId`, `timestamp`, `sync:bool`, `channels:[…]` (which rooms should receive it), optional `tokens:[]`, `activity{track, boardId, elementTypes{<id>:type}}`.
- Server → client broadcasts of other users' actions: **[UNKNOWN]** (single-user test; no second client).
- Offline: `bufferFlush` / `replay` flags suggest queued actions are re-sent after reconnect. **[UNKNOWN]** details.

### 3.1 Action catalogue (observed)

| `type` | Key fields | Meaning |
|---|---|---|
| `ELEMENT_CREATE` | `id, elementType, location{parentId,section,position}, content{…}, meta{creator,createdTime,platform,versionId,…}, creationSource("TOOLBAR"…)` | Client generates the element id and full initial record. |
| `ELEMENT_UPDATE` | `updates:[{id, changes{…}, meta{versionId, modifiedVersionId}}], recalculateChannels` | Partial change; optimistic versioning via `versionId`→`modifiedVersionId`. Batchable. |
| `ELEMENT_MOVE_MULTI` | `moves:[{id, location{…}, from{…}}], moveOperation, monitoring{operation:"DROP"}` | Move one or many; carries previous location (`from`). Also used for nesting into a column / board. |
| `ELEMENT_MOVE_AND_UPDATE` | `id, location, from, changes{…}` | Move plus content change in one step; used for resize of lines, connector attach, and **undo/redo**. |
| `ELEMENT_SET_TYPE` | `id, elementType:"LINK", changes{link,provider,caption,…}` | Placeholder card promoted to a typed card (link). |
| `ELEMENTS_SELECTED` / `ELEMENTS_DESELECT_ALL` | `ids[]` | Selection is broadcast (presence). |
| `USER_NAVIGATE` | `newBoardId, previousBoardId, permission` | Board enter/leave. |
| `COMMENTS_ADD` | `_id, threadId, elementId, userId, text{doc}, createdAt` | Add a comment to a thread. |
| `COMMENTS_TYPING_PING` / `_STOP` | `threadId, elementId` | Ephemeral typing indicator. |
| `USER_UPDATE` | `userId, changes{…}, personal:bool` | e.g. tutorial/education counters. |

Delete/trash, duplicate, label, reaction, drawing and share actions: **[UNKNOWN]** (not exercised: delete is out of scope for a read-only account).

## 4. Data model [HOOK board-persisted-shape.json]

### 4.1 Board payload (`GET /api/boards?ids=`)
`{elements:{<id>:Element}, comments:{<id>:Comment}, labels:{}, errors:{}, childrenReturned:{<id>:bool}, canvasOrder:{}, boardIds:[…], elementCount, commentCount, errorCount, fetchedTime}`

### 4.2 Element (common)
```
Element { _id, id, __v:int, elementType,
  location { parentId, section: "CANVAS" | "INBOX", position },
  content  { …per type… },
  meta     { creator, modifiedBy, createdTime, modifiedTime, significantModified,
             locationSectionModifiedTime, platform, versionId },
  acl?     { <userId>: permissionInt }          // on boards
}
```
- `section:"CANVAS"` → free placement, `position {x:int, y:int, score:int}` (`score` = z/stack order).
- `section:"INBOX"` → ordered child list, `position {index:int, score:int}`. Used for children of columns, task lists, and for the board's "unsorted" tray (UI label shows an "unsorted" counter).
- Containers: board, column, task list. A card's `parentId` is its container. Cards can be dragged between containers (a single `ELEMENT_MOVE_MULTI`).

### 4.3 Element types and content
| elementType | content | Notes |
|---|---|---|
| `BOARD` | `title, icon{type:"mn-svg"|…, id, name, svg, png}|null, color, secondaryColor, defaultColorPalette[7 colours], rootType` | Sub-boards are board elements placed on a parent board (card shows icon, title, "N cards"). `rootType` values seen: `QUICK_NOTES`, home root. `acl` maps user id → permission int. Title auto-suggests an icon via `/api//icons`. |
| `CARD` (note) | `textContent`: rich-text doc | Doc = `{type:"doc", content:[{type:"paragraph", attrs{key,textAlign}, content:[{type:"text", text}]}]}`. Format toolbar: bold, italic, strikethrough, underline, bullet list, numbered list, heading/align, code, link, add comment. Resizable width. |
| `TASK_LIST` | `title|null, showTitle` | Container of `TASK`. After creation a prompt asks whether to add a title (yes / no). |
| `TASK` | `textContent` doc\|null | Child of task list (`INBOX`). A checkbox; checked state field **[UNKNOWN]**. Enter creates the next task. |
| `COLUMN` | `title|null` | Container; shows "N cards"; empty column shows a drop zone; header title in serif display font. |
| `TABLE` | `width, tableContent{data:[rows][cells{textStyle[], background, value, tiptapContent doc}], colWidthsGU[], version}` | Default 3 columns × 4 rows, header row shaded. Column letters / row numbers shown on select. Resize rewrites `data` + `colWidthsGU` + `width` (an `ELEMENT_UPDATE`). |
| `LINE` | `start{x,y}, end{x,y,elementId?,snapped?}, startStyle("NONE"), endStyle("ARROW"), lineStyle("SOLID"), lineWeight` | Connector: an endpoint can bind to a card via `end.elementId` + `snapped:true`. Context toolbar: colour, minimize. Binding recorded on the endpoint, not as a separate edge object. |
| `COMMENT_THREAD` | `threadId` | Placed on canvas; comment bodies live in `comments`. |
| `LINK` | `url, mediaType("NO_MEDIA"…), link{url,title}, provider{url,name,display}, caption doc, showCaption, image{}` | Created as a placeholder with a URL field, then `ELEMENT_SET_TYPE`. Title/description are resolved (by the server, **[UNKNOWN]** how). |
| `IMAGE`, `FILE`, `SKETCH/DRAWING`, `COLOR`, `LINE` variants, `SUBBOARD` | **[UNKNOWN]** | Toolbar has Image, Upload (file), Drawing; not exercised. Drawing drag from the toolbar did not create an element in the test. |

Comment: `{_id:"cm_…", threadId, userId, text:doc, createdAt, updatedAt, __v}`.

## 5. UI behaviour

### 5.1 Layout [SHOT]
- Top bar: workspace home label, breadcrumb to the current board, undo/redo buttons (disabled when nothing to undo), search, notifications, help, settings. Board title centred in a serif display face, with Share / Export / View menus beneath.
- Left vertical toolbar of tools: Note, Link, To-do, Line, Board, Column, Comment, Table, "…" overflow, then Image, Upload, Drawing, and Trash at the bottom. Tool tiles are **dragged onto the canvas** (a drag from the toolbar creates the card at the drop point).
- Left toolbar is **contextual**: selecting a card swaps it for that type's actions (note → format tools; board → Colour/Icon/Rename; table → Labels/Reactions/Comment/Title/Caption; line → Colour/Minimize).
- Canvas: light grey with a dot grid (setting `showGrid`, `gridSize`), infinite scroll both axes.
- Empty new board offers a **template picker** (Empty board, Project plan, Inspiration board, Creative brief, Character profile, Weekly plan, "More templates…") with Continue and a "keep sample content" checkbox.
- First-use contextual tooltips per tool (education counters stored with `USER_UPDATE`).

### 5.2 Interactions (all observed on real data)
| Interaction | Behaviour |
|---|---|
| Create card | Drag tool from toolbar; element appears at drop point already selected; text cards enter edit mode on double-click (single click only selects). |
| Edit text | Double-click; changes committed on blur (one `ELEMENT_UPDATE` per edit session, not per keystroke). |
| Select | Click selects; click empty canvas deselects (selection state is synced as actions). |
| Move | Drag a card; one `ELEMENT_MOVE_MULTI` on drop (not during drag). |
| Nest | Drop a card onto a column / list / board; location changes to `INBOX` with `index`; container counter updates ("1 card"). |
| Resize | Corner handle on a selected note / table / link; width persisted in content; table re-flows column widths. |
| Connector | Line is a card with two endpoints; dragging an endpoint onto a card binds it (`end.elementId`, `snapped`). |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z or buttons. Implemented **client-side**: the inverse change is sent as a new normal action; the server has no undo log. Undo/redo stacks reset on reload. |
| Rename board | Title enters edit mode on creation; Enter commits; icon is auto-suggested from the title. |
| Enter a board | Double-click opens it, URL becomes `/<boardId>/<slug-of-title>`; `USER_NAVIGATE` is emitted and `update-channels` joins its room. |
| Comments | Comment card shows author, relative time, text, Reply; typing indicator is broadcast. |
| Autosave | "Saved" status indicator in the header while actions are in flight. |
| Presence | Selected element ids and current board are shared per user. |

## 6. Client-side features vs server-enforced limits

**Purely client-side (build all, unlocked):** canvas/dot grid, drag-create, selection, move/nest/resize, connectors, rich-text editing, tables, to-do lists, undo/redo, board templates picker UI, search UI, theme (light/dark/system), grid size, keyboard shortcuts, board navigation/breadcrumbs, export/view menus (UI).

**Server-enforced / account (observed):**
- Free plan **content limit** `contentLimit{default:100, current:100, exceeded:bool, referralBonus, giftBonus, maxReferralBonus:100}` — i.e. 100 cards on this account, extendable via referral. `exceeded` is computed server-side. The client UI prompts upgrade; whether the **server rejects** creates past the limit was **not tested** (would need creating >100 cards; out of scope).
- ACL / permissions per board (`acl` user → int), sharing/invites, team plans, checkout `/checkout`, admin routes.
- Anything that is purely a counter in the client (card-limit banner) is *not* a security boundary in the clone; in the clone all limits are removed.

## 7. Unknowns (explicit)
Auth/login flow and session tokens; socket handshake auth; server→client broadcast format and conflict resolution; permission integers; image/file upload and storage; drawing (sketch) data format; export formats; labels and reactions data; board templates storage and instantiation; delete/trash semantics and restore; duplicate; sharing links and roles; real-time cursors (`liveCursor`) payload; offline replay semantics; search API; rate limits. Not tested: second-client sync, premium-only features (not available on this plan).
