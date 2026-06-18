# FoxDial — guidance for Claude Code

Firefox (Manifest V3) new-tab speed dial extension. Vanilla JS/HTML/CSS, **no build step,
no dependencies**. Loaded as a temporary add-on during development.

## Run / debug

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `manifest.json`
3. Open a new tab. After editing `newtab.*`, reload the tab; after editing `manifest.json`,
   reload the add-on.

There is no test suite. Sanity-check JS with `node --check newtab.js` and the manifest with
a JSON parse before considering a change done.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest; overrides `newtab`; perms `storage`, `unlimitedStorage`, optional `<all_urls>` |
| `newtab.html` | New-tab markup: tabs bar, grid, `<template>` for a tile, context menu, dialogs (tile / group / settings) |
| `newtab.css` | All styling; theming via CSS custom properties on `:root` (+ `[data-theme="light"]`) |
| `newtab.js` | All logic (single file) |
| `icons/` | Extension icons (placeholder) |

## Data model (browser.storage.local)

- `groups` — `[{ id, name, dials: [{ id, title, url, icon }] }]`. `icon` is `""` (auto favicon),
  a data-URL (cached), or `"monogram"`.
- `activeGroup` — id of the selected group tab.
- `settings` — `{ columns, tileWidth, tileHeight, followTheme, bgColor, bgImage }`.
- `dials` — legacy flat list; migrated into a single "Основное" group on load.

Migrations live in `loadGroups()` / `loadSettings()` — keep them when changing shapes.

## Key behaviors

- **Tabs/groups**: created via background context menu, renamed/deleted via tab context menu
  (last group can't be deleted — its delete item is hidden). Tiles move between groups via the
  tile context submenu or the edit dialog's group selector.
- **Tiles**: add/edit/delete via right-click context menu; drag & drop reorders within a group.
- **Icon picker** (`renderIconChoices` and friends): candidates come from favicon services
  (Clearbit/DuckDuckGo/Google), common on-site paths, and — with `<all_urls>` granted — page
  scraping (`fetchSiteIcons`). Each candidate is fetched (`probeIcon`) to confirm it can be
  downloaded, sized, and perceptually hashed (`imageInfo` → aHash) so near-duplicates dedupe
  (keeping the largest). Chosen icon is cached as a data-URL via `toDataUrl`.
- **`<all_urls>`** is optional and requested at runtime (the icon picker's "Найти ещё на сайте"
  button). It's only needed to read same-origin site icons / scrape pages; service icons work
  without it. Some sites (anti-bot) refuse `fetch` even with permission — those icons are
  filtered out of the picker rather than silently substituted.

## Conventions

- UI strings are in English (`lang="en"`). Some inline code comments are still in Russian —
  fine to translate as you touch them; no need for a dedicated pass.
- No frameworks. Prefer the existing helpers; don't add a build step or dependencies.
- Bump `version` in `manifest.json` for releases. `strict_min_version` is 127 (needed for
  `optional_host_permissions`).
