<h1 align="center">🦊 FoxDial</h1>

<p align="center">
  A simple, fast <b>speed dial</b> for Firefox — your new tab becomes a clean grid of
  your favorite sites, organized into groups.
</p>

<p align="center">
  <img src="icons/icon-96.png" width="72" height="72" alt="FoxDial icon">
</p>

---

## Features

- 🧩 **Grid of tiles** on the new-tab page — open a site with one click
- 🗂 **Groups as tabs** — organize tiles into named groups, switch with a click
- ➕ **Add / edit / delete** via right-click context menu
- ↔️ **Drag & drop** reordering within a group
- 🎯 **Smart icon picker** — pulls candidate logos from favicon services and from the
  site itself, filters out tiny/broken ones, de-duplicates visually similar icons
  (keeping the largest), and caches the chosen one locally (works offline)
- 🎨 **Customizable look** — columns, tile width/height, background color or image,
  with live preview
- 🌗 **Follow system theme** — background and palette adapt to light/dark automatically
- 💾 **Local storage** — everything lives in `browser.storage.local`; no account, no servers

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` from this folder
4. Open a new tab

> A temporary add-on is removed when Firefox restarts. For a permanent install, see
> [Build & Publishing](#build--publishing).

## Usage

| Action | How |
|--------|-----|
| Add a site | Right-click empty space → **Добавить сайт** |
| Edit / delete a tile | Right-click a tile → **Редактировать / Удалить** |
| Reorder tiles | Drag a tile onto another |
| Create a group | Right-click empty space → **Создать группу** |
| Rename / delete a group | Right-click a group tab |
| Move a tile to another group | Right-click a tile → **Переместить в группу**, or change it in the edit dialog |
| Open settings | ⚙ button (top-right) |

## Tech

Plain HTML / CSS / JavaScript — **no build step, no dependencies, no framework.**
Manifest V3. Data and settings are stored locally via the `storage` API.

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3), overrides the new-tab page |
| `newtab.html` | Markup: tabs, grid, dialogs, context menu |
| `newtab.css` | Styling and theming (CSS custom properties) |
| `newtab.js` | All logic |
| `icons/` | Extension icons |

### Permissions

- `storage`, `unlimitedStorage` — save tiles, groups, settings and cached icons locally.
- `<all_urls>` — **optional**, requested at runtime only to read icons directly from a
  site's page (the icon picker's *“Найти ещё на сайте”* button). The extension does not
  collect or transmit any data.

## Build & Publishing

Lint and package with Mozilla's [`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/):

```sh
npm i -g web-ext
web-ext lint
web-ext build   # outputs a zip in web-ext-artifacts/
```

Then submit the package at [addons.mozilla.org](https://addons.mozilla.org/developers/).
Note: `strict_min_version` is `127.0` (required for `optional_host_permissions`).

## License

[MIT](LICENSE) © egorlepa
