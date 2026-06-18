"use strict";

const STORAGE_KEY = "dials"; // старый ключ (для миграции)
const GROUPS_KEY = "groups";
const ACTIVE_KEY = "activeGroup";
const SETTINGS_KEY = "settings";
const MIN_ICON_SIZE = 64; // мельче — не показываем в выборе

// Дефолтный набор плиток при первом запуске.
const DEFAULT_DIALS = [
  { id: "d1", title: "Mozilla", url: "https://www.mozilla.org" },
  { id: "d2", title: "GitHub", url: "https://github.com" },
  { id: "d3", title: "Wikipedia", url: "https://wikipedia.org" }
];

const DEFAULT_SETTINGS = {
  columns: 5,
  tileWidth: 140, // ширина плитки в px
  tileHeight: 120, // высота плитки в px
  followTheme: false, // фон следует системной светлой/тёмной теме
  bgColor: "#1b1d2a",
  bgImage: ""
};

// Размеры старых версий (строковые пресеты) -> высота в px.
const LEGACY_SIZE = { small: 96, medium: 120, large: 150 };

// Размер фавикона выводим из меньшей стороны плитки.
function faviconSize(width, height) {
  const base = Math.min(Number(width) || 0, Number(height) || 0);
  return `${Math.round(base * 0.36)}px`;
}

const grid = document.getElementById("grid");
const tabs = document.getElementById("tabs");
const tileTemplate = document.getElementById("tile-template");
const contextMenu = document.getElementById("context-menu");
const ctxMoveSub = document.getElementById("ctx-move-sub");

const dialog = document.getElementById("dialog");
const form = document.getElementById("dialog-form");
const dialogTitle = document.getElementById("dialog-title");
const fieldTitle = document.getElementById("field-title");
const fieldUrl = document.getElementById("field-url");
const fieldGroup = document.getElementById("field-group");
const iconChoices = document.getElementById("icon-choices");
const cancelBtn = document.getElementById("dialog-cancel");

const groupDialog = document.getElementById("group-dialog");
const groupForm = document.getElementById("group-form");
const groupDialogTitle = document.getElementById("group-dialog-title");
const groupNameInput = document.getElementById("group-name");
const groupCancel = document.getElementById("group-cancel");

const settingsBtn = document.getElementById("settings-btn");
const settingsDialog = document.getElementById("settings-dialog");
const settingsForm = document.getElementById("settings-form");
const setColumns = document.getElementById("set-columns");
const colsOutput = document.getElementById("cols-output");
const setWidth = document.getElementById("set-width");
const widthOutput = document.getElementById("width-output");
const setHeight = document.getElementById("set-height");
const heightOutput = document.getElementById("height-output");
const setFollowTheme = document.getElementById("set-follow-theme");
const setBgColor = document.getElementById("set-bg-color");
const setBgImage = document.getElementById("set-bg-image");
const settingsReset = document.getElementById("settings-reset");

let groups = []; // [{ id, name, dials: [...] }]
let activeGroupId = null;
let settings = { ...DEFAULT_SETTINGS };
let editingId = null; // id редактируемой плитки или null при добавлении
let editingGroupId = null; // группа редактируемой плитки
let selectedIcon = ""; // выбранная иконка: "" (авто), URL или "monogram"
let dragId = null; // id перетаскиваемой плитки
let ctxTargetId = null; // id плитки под контекстным меню (или null для фона)
let ctxTargetGroupId = null; // id группы под контекстным меню (правый клик по вкладке)
let groupEditId = null; // id группы в диалоге группы (null = создание)

// --- Хранилище ---

async function loadGroups() {
  const stored = await browser.storage.local.get([GROUPS_KEY, STORAGE_KEY]);
  if (Array.isArray(stored[GROUPS_KEY]) && stored[GROUPS_KEY].length) {
    return stored[GROUPS_KEY];
  }
  // Миграция со старого плоского списка плиток.
  const oldDials = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : DEFAULT_DIALS;
  const migrated = [{ id: makeId(), name: "Основное", dials: oldDials }];
  await browser.storage.local.set({ [GROUPS_KEY]: migrated });
  return migrated;
}

async function saveGroups() {
  await browser.storage.local.set({ [GROUPS_KEY]: groups });
}

async function loadActive() {
  const stored = await browser.storage.local.get(ACTIVE_KEY);
  return stored[ACTIVE_KEY];
}

async function setActiveGroup(id) {
  activeGroupId = id;
  await browser.storage.local.set({ [ACTIVE_KEY]: id });
}

// --- Доступ к группам/плиткам ---

function activeGroup() {
  return groups.find((g) => g.id === activeGroupId) || groups[0];
}

// Найти плитку и её группу по id плитки.
function findDial(id) {
  for (const group of groups) {
    const dial = group.dials.find((d) => d.id === id);
    if (dial) return { group, dial };
  }
  return null;
}

async function loadSettings() {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const merged = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  // Миграция размера из старых версий (строка или единое число size).
  if (merged.size !== undefined) {
    const h = typeof merged.size === "string"
      ? (LEGACY_SIZE[merged.size] || DEFAULT_SETTINGS.tileHeight)
      : Number(merged.size);
    if (stored[SETTINGS_KEY] && stored[SETTINGS_KEY].tileHeight === undefined) {
      merged.tileHeight = h;
      merged.tileWidth = Math.round(h * 1.15);
    }
    delete merged.size;
  }
  return merged;
}

async function saveSettings(next) {
  settings = next;
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
}

// --- Утилиты ---

function makeId() {
  return "d" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// Нормализуем URL: добавляем https:// если протокол не указан.
function normalizeUrl(raw) {
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  return "https://" + value;
}

// Favicon берём у Google по домену — без дополнительных разрешений.
function faviconUrl(url) {
  const host = hostOf(url);
  return host ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}` : "";
}

function hostOf(url) {
  try {
    return new URL(normalizeUrl(url)).hostname;
  } catch {
    return "";
  }
}

function originOf(url) {
  try {
    return new URL(normalizeUrl(url)).origin;
  } catch {
    return "";
  }
}

// Стабильный цвет для монограммы по домену.
function monogramColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 55%, 45%)`;
}

function monogramLetter(title, url) {
  const src = (title || hostOf(url) || "?").trim();
  return src.charAt(0) || "?";
}

// Источники-кандидаты иконок для домена (без API-ключей и без CORS —
// всё грузится как <img>). Типовые пути иконок пробуем напрямую.
function iconCandidates(url) {
  const host = hostOf(url);
  if (!host) return [];
  const origin = originOf(url);
  return [
    { src: `https://logo.clearbit.com/${host}` },
    { src: `https://icons.duckduckgo.com/ip3/${host}.ico` },
    { src: `${origin}/apple-touch-icon.png` },
    { src: `${origin}/apple-touch-icon-precomposed.png` },
    { src: `${origin}/favicon.svg` },
    { src: `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}` },
    { src: `${origin}/favicon.ico` },
    { mono: true }
  ];
}

// Абсолютный URL из возможно-относительного href.
function absUrl(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// Вытянуть иконки прямо со страницы сайта: apple-touch-icon, link[icon],
// иконки web-манифеста, og:image. Требует host_permissions.
async function fetchSiteIcons(url) {
  const target = normalizeUrl(url);
  const res = await fetch(target, { credentials: "omit", redirect: "follow" });
  if (!res.ok) return [];
  const base = res.url || target;
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");

  const high = []; // приоритетные (apple-touch, манифест)
  const low = []; // обычные favicon / og:image
  const push = (arr, href) => {
    const abs = href && absUrl(href, base);
    if (abs && !arr.includes(abs)) arr.push(abs);
  };

  doc.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="apple-touch-icon-precomposed"], link[rel~="mask-icon"]')
    .forEach((l) => push(high, l.getAttribute("href")));
  doc.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]')
    .forEach((l) => push(low, l.getAttribute("href")));
  doc.querySelectorAll('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]')
    .forEach((m) => push(low, m.getAttribute("content")));

  // Иконки из web app manifest (часто самые крупные).
  const manifestLink = doc.querySelector('link[rel="manifest"]');
  if (manifestLink) {
    const manifestUrl = absUrl(manifestLink.getAttribute("href"), base);
    if (manifestUrl) {
      try {
        const m = await (await fetch(manifestUrl, { credentials: "omit" })).json();
        for (const icon of m.icons || []) push(high, absUrl(icon.src, manifestUrl));
      } catch {
        /* манифест недоступен/битый — пропускаем */
      }
    }
  }

  return [...high, ...low];
}

// Скачать картинку и вернуть data URL для локального хранения.
// При неудаче (CORS/сеть) возвращаем исходный src как фолбэк.
async function toDataUrl(src) {
  if (!src || src === "monogram" || src.startsWith("data:")) return src;
  try {
    const res = await fetch(src, { credentials: "omit" });
    if (!res.ok) return src;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0) return src;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

// Эффективная иконка плитки: явно выбранная или дефолтный favicon.
function tileIcon(dial) {
  if (dial.icon === "monogram") return { mono: true };
  if (dial.icon) return { src: dial.icon };
  const fav = faviconUrl(dial.url);
  return fav ? { src: fav } : { mono: true };
}

// --- Применение настроек вида ---

function applySettings() {
  const root = document.documentElement.style;
  root.setProperty("--columns", String(settings.columns));

  root.setProperty("--tile-min", `${settings.tileWidth}px`);
  root.setProperty("--tile-height", `${settings.tileHeight}px`);
  root.setProperty("--favicon-size", faviconSize(settings.tileWidth, settings.tileHeight));

  // Ограничиваем сетку числом колонок из настроек (gap = 20px).
  const GAP = 20;
  const gridMax = settings.columns * settings.tileWidth + (settings.columns - 1) * GAP;
  root.setProperty("--grid-max", `${gridMax}px`);

  if (settings.followTheme) {
    // Палитра задаётся через [data-theme] в CSS — снимаем ручной --bg.
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    root.removeProperty("--bg");
  } else {
    delete document.documentElement.dataset.theme;
    root.setProperty("--bg", settings.bgColor);
  }

  if (settings.bgImage) {
    document.body.style.backgroundImage = `url("${settings.bgImage}")`;
    document.body.classList.add("has-bg-image");
  } else {
    document.body.style.backgroundImage = "";
    document.body.classList.remove("has-bg-image");
  }
}

// Отрисовать иконку в элементе .tile__favicon (картинка или монограмма).
function paintFavicon(el, icon, dial) {
  if (icon.mono) {
    el.classList.add("tile__favicon--mono");
    el.style.backgroundImage = "";
    el.style.backgroundColor = monogramColor(hostOf(dial.url) || dial.title);
    el.textContent = monogramLetter(dial.title, dial.url);
  } else {
    el.classList.remove("tile__favicon--mono");
    el.textContent = "";
    el.style.backgroundColor = "";
    el.style.backgroundImage = `url("${icon.src}")`;
  }
}

// --- Рендер ---

function renderTabs() {
  tabs.textContent = "";
  for (const group of groups) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab" + (group.id === activeGroupId ? " tab--active" : "");
    tab.dataset.groupId = group.id;
    tab.textContent = group.name;
    tab.addEventListener("click", async () => {
      await setActiveGroup(group.id);
      renderTabs();
      render();
    });
    tabs.appendChild(tab);
  }
}

function render() {
  grid.textContent = "";

  for (const dial of activeGroup().dials) {
    const node = tileTemplate.content.firstElementChild.cloneNode(true);
    const link = node.querySelector(".tile__link");
    const favicon = node.querySelector(".tile__favicon");
    const title = node.querySelector(".tile__title");

    node.dataset.id = dial.id;
    link.href = dial.url;
    title.textContent = dial.title;
    paintFavicon(favicon, tileIcon(dial), dial);

    attachDnD(node);
    grid.appendChild(node);
  }
}

// --- Drag & drop сортировка ---

function attachDnD(node) {
  node.addEventListener("dragstart", (e) => {
    dragId = node.dataset.id;
    node.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  node.addEventListener("dragend", () => {
    dragId = null;
    node.classList.remove("dragging");
    document.querySelectorAll(".tile.drag-over").forEach((t) => t.classList.remove("drag-over"));
  });

  node.addEventListener("dragover", (e) => {
    if (dragId === null || node.dataset.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    node.classList.add("drag-over");
  });

  node.addEventListener("dragleave", () => {
    node.classList.remove("drag-over");
  });

  node.addEventListener("drop", async (e) => {
    e.preventDefault();
    const targetId = node.dataset.id;
    node.classList.remove("drag-over");
    if (dragId === null || dragId === targetId) return;
    await reorder(dragId, targetId);
  });
}

// Переставляем перетаскиваемую плитку на позицию целевой (в активной группе).
async function reorder(fromId, toId) {
  const list = activeGroup().dials;
  const fromIdx = list.findIndex((d) => d.id === fromId);
  const toIdx = list.findIndex((d) => d.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
  await saveGroups();
  render();
}

// --- Действия с плитками ---

function openDialog(dial) {
  editingId = dial ? dial.id : null;
  editingGroupId = dial ? (findDial(dial.id)?.group.id ?? activeGroupId) : activeGroupId;
  selectedIcon = dial ? (dial.icon || "") : "";
  dialogTitle.textContent = dial ? "Редактировать сайт" : "Добавить сайт";
  fieldTitle.value = dial ? dial.title : "";
  fieldUrl.value = dial ? dial.url : "";

  // Список групп в селекторе.
  fieldGroup.textContent = "";
  for (const group of groups) {
    const opt = document.createElement("option");
    opt.value = group.id;
    opt.textContent = group.name;
    fieldGroup.appendChild(opt);
  }
  fieldGroup.value = editingGroupId;

  renderIconChoices();
  dialog.showModal();
  fieldTitle.focus();
}

let iconReqSeq = 0; // токен последнего запроса иконок
let urlDebounce = null; // дебаунс ввода URL
let shownIcons = []; // уникальные иконки текущего диалога: {src, size, phash}
let probedSrcs = new Set(); // уже проверенные URL — чтобы не качать дважды
const PHASH_THRESHOLD = 10; // макс. расстояние Хэмминга, чтобы считать «той же»

// Загрузить картинку из blob и за один проход получить её размер и
// перцептивный хеш (aHash 16×16 в ч/б). Прозрачность заливаем белым,
// чтобы одинаковый логотип на прозрачном/белом фоне совпадал.
function imageInfo(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const min = Math.min(img.naturalWidth, img.naturalHeight);
      let phash = null;
      try {
        const N = 16;
        const canvas = document.createElement("canvas");
        canvas.width = N;
        canvas.height = N;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, N, N);
        ctx.drawImage(img, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        const gray = new Float64Array(N * N);
        let sum = 0;
        for (let i = 0; i < N * N; i++) {
          gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
          sum += gray[i];
        }
        const avg = sum / (N * N);
        phash = "";
        for (let i = 0; i < N * N; i++) phash += gray[i] > avg ? "1" : "0";
      } catch {
        /* canvas недоступен — обойдёмся без перцептивного хеша */
      }
      URL.revokeObjectURL(url);
      resolve({ min, phash });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Расстояние Хэмминга между двумя бинарными строками одинаковой длины.
function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// Проверяем, что иконку реально можно СКАЧАТЬ (а не только показать как
// <img>): тянем через fetch, убеждаемся что это изображение нужного
// размера. Возвращаем размер и перцептивный хеш для дедупликации.
async function probeIcon(src) {
  try {
    const res = await fetch(src, { credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0) return null;
    const isSvg = blob.type.includes("svg");
    const info = await imageInfo(blob);
    if (!info && !isSvg) return null;
    const size = isSvg ? 100000 : info.min; // SVG считаем крупным
    if (!isSvg && size < MIN_ICON_SIZE) return null;
    return { src, size, phash: info ? info.phash : null };
  } catch {
    return null;
  }
}

// Кнопка-вариант с уже проверенной картинкой (грузится из кеша мгновенно).
function makeImageChoice(src, size) {
  const choice = document.createElement("button");
  choice.type = "button";
  choice.className = "icon-choice";
  choice.dataset.value = src;
  choice.dataset.size = String(size);
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  choice.appendChild(img);
  if (src === selectedIcon) choice.classList.add("selected");
  choice.addEventListener("click", () => selectIcon(src, choice));
  return choice;
}

// Кнопка-монограмма.
function makeMonoChoice(url) {
  const choice = document.createElement("button");
  choice.type = "button";
  choice.className = "icon-choice";
  choice.dataset.value = "monogram";
  choice.dataset.size = "-1";
  const mono = document.createElement("span");
  mono.className = "icon-choice__mono";
  mono.style.backgroundColor = monogramColor(hostOf(url) || fieldTitle.value);
  mono.textContent = monogramLetter(fieldTitle.value, url);
  choice.appendChild(mono);
  if (selectedIcon === "monogram") choice.classList.add("selected");
  choice.addEventListener("click", () => selectIcon("monogram", choice));
  return choice;
}

function selectIcon(value, choice) {
  selectedIcon = value;
  iconChoices.querySelectorAll(".icon-choice").forEach((c) => c.classList.remove("selected"));
  choice.classList.add("selected");
}

// Главная сборка вариантов под текущий URL.
function renderIconChoices() {
  const reqId = ++iconReqSeq;
  iconChoices.textContent = "";
  shownIcons = [];
  probedSrcs = new Set();
  const url = fieldUrl.value.trim();

  if (!hostOf(url)) {
    const hint = document.createElement("span");
    hint.className = "icon-choices__empty";
    hint.textContent = "Введите адрес — появятся варианты иконки";
    iconChoices.appendChild(hint);
    return;
  }

  // Монограмма видна сразу — гарантированный вариант без ожидания сети.
  iconChoices.appendChild(makeMonoChoice(url));

  // Сервисные источники + сохранённая кастомная иконка.
  const srcs = iconCandidates(url).filter((c) => !c.mono).map((c) => c.src);
  if (selectedIcon && selectedIcon !== "monogram") srcs.unshift(selectedIcon);

  loadIconBatch(srcs, reqId);
  maybeScrape(url, reqId);
}

// Проверить пачку URL в фоне и влить валидные в модель с дедупом.
async function loadIconBatch(srcs, reqId) {
  const fresh = [...new Set(srcs)].filter((s) => s && !probedSrcs.has(s));
  fresh.forEach((s) => probedSrcs.add(s));
  const results = (await Promise.all(fresh.map(probeIcon))).filter(Boolean);
  if (reqId !== iconReqSeq || !dialog.open) return; // устарело / диалог закрыт

  // Визуальный дедуп; из похожих оставляем версию с бóльшим размером.
  for (const r of results) {
    const i = shownIcons.findIndex(
      (s) => r.phash && s.phash && hamming(s.phash, r.phash) <= PHASH_THRESHOLD
    );
    if (i === -1) shownIcons.push(r);
    else if (r.size > shownIcons[i].size) shownIcons[i] = r;
  }
  renderImageChoices();
}

// Перерисовать варианты-картинки из модели: по убыванию размера,
// перед монограммой; кнопка «Найти ещё» — в самом низу.
function renderImageChoices() {
  iconChoices
    .querySelectorAll('.icon-choice:not([data-value="monogram"])')
    .forEach((el) => el.remove());
  const mono = iconChoices.querySelector('.icon-choice[data-value="monogram"]');
  const moreBtn = iconChoices.querySelector(".icon-more-btn");
  for (const ic of [...shownIcons].sort((a, b) => b.size - a.size)) {
    iconChoices.insertBefore(makeImageChoice(ic.src, ic.size), mono);
  }
  if (moreBtn) iconChoices.appendChild(moreBtn);
}

// Скрейпинг иконок со страницы: если доступ есть — сразу, иначе кнопка-запрос.
async function maybeScrape(url, reqId) {
  let granted = false;
  try {
    granted = await browser.permissions.contains({ origins: ["<all_urls>"] });
  } catch {
    /* API недоступно — пропускаем */
  }
  if (reqId !== iconReqSeq || !dialog.open) return;

  if (granted) {
    appendSiteIcons(url, reqId);
    return;
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-more-btn";
  btn.textContent = "Найти ещё на сайте";
  btn.addEventListener("click", async () => {
    let ok = false;
    try {
      ok = await browser.permissions.request({ origins: ["<all_urls>"] });
    } catch {
      /* отклонено */
    }
    // После выдачи доступа пере-собираем варианты: теперь подтянутся и
    // иконки с домена сайта, и со страницы (скрейпинг).
    if (ok) renderIconChoices();
  });
  iconChoices.appendChild(btn);
}

// Дотянуть иконки со страницы и добавить валидные в выбор.
async function appendSiteIcons(url, reqId) {
  const found = await fetchSiteIcons(url).catch(() => []);
  if (reqId !== iconReqSeq || !dialog.open) return;
  loadIconBatch(found, reqId);
}

// Ввод URL — с дебаунсом; название — только обновляем превью монограммы.
fieldUrl.addEventListener("input", () => {
  clearTimeout(urlDebounce);
  urlDebounce = setTimeout(renderIconChoices, 350);
});
fieldTitle.addEventListener("input", () => {
  const mono = iconChoices.querySelector('.icon-choice[data-value="monogram"] .icon-choice__mono');
  if (!mono) return;
  const url = fieldUrl.value.trim();
  mono.style.backgroundColor = monogramColor(hostOf(url) || fieldTitle.value);
  mono.textContent = monogramLetter(fieldTitle.value, url);
});

async function removeDial(id) {
  const found = findDial(id);
  if (!found) return;
  found.group.dials = found.group.dials.filter((d) => d.id !== id);
  await saveGroups();
  render();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = fieldTitle.value.trim();
  const url = normalizeUrl(fieldUrl.value);
  if (!title || !url) return;

  const targetGroup = groups.find((g) => g.id === fieldGroup.value) || activeGroup();

  // Иконка в выборе уже проверена на скачиваемость, так что просто
  // сохраняем выбранную как data URL (фолбэк на URL — крайний случай).
  const icon = await toDataUrl(selectedIcon);

  if (editingId) {
    const found = findDial(editingId);
    const updated = { ...found.dial, title, url, icon };
    if (found.group.id === targetGroup.id) {
      found.group.dials = found.group.dials.map((d) => (d.id === editingId ? updated : d));
    } else {
      // Перемещение в другую группу.
      found.group.dials = found.group.dials.filter((d) => d.id !== editingId);
      targetGroup.dials.push(updated);
    }
  } else {
    targetGroup.dials.push({ id: makeId(), title, url, icon });
  }

  await saveGroups();
  dialog.close();
  renderTabs();
  render();
});

cancelBtn.addEventListener("click", () => dialog.close());

// --- Контекстное меню ---

function showContextMenu(x, y, { tileId = null, groupId = null } = {}) {
  ctxTargetId = tileId;
  ctxTargetGroupId = groupId;
  const mode = groupId ? "tab" : tileId ? "tile" : "bg";
  contextMenu.querySelectorAll(".ctx__bg-only").forEach((el) => {
    el.style.display = mode === "bg" ? "" : "none";
  });
  contextMenu.querySelectorAll(".ctx__tile-only").forEach((el) => {
    el.style.display = mode === "tile" ? "" : "none";
  });
  contextMenu.querySelectorAll(".ctx__tab-only").forEach((el) => {
    el.style.display = mode === "tab" ? "" : "none";
  });
  // Последнюю группу удалять нельзя — прячем пункт.
  if (mode === "tab" && groups.length <= 1) {
    contextMenu.querySelector('[data-action="delete-group"]').style.display = "none";
  }
  if (mode === "tile") populateMoveSubmenu(tileId);

  contextMenu.hidden = false;
  // Не даём меню вылезти за пределы окна.
  const rect = contextMenu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  contextMenu.style.left = `${Math.max(8, px)}px`;
  contextMenu.style.top = `${Math.max(8, py)}px`;
}

function hideContextMenu() {
  contextMenu.hidden = true;
  ctxTargetId = null;
  ctxTargetGroupId = null;
}

// Заполнить подменю «Переместить в группу» списком других групп.
function populateMoveSubmenu(tileId) {
  ctxMoveSub.textContent = "";
  const found = findDial(tileId);
  const others = groups.filter((g) => g.id !== (found ? found.group.id : null));
  if (!others.length) {
    const empty = document.createElement("span");
    empty.className = "ctx__submenu-empty";
    empty.textContent = "Нет других групп";
    ctxMoveSub.appendChild(empty);
    return;
  }
  for (const group of others) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ctx__subitem";
    btn.textContent = group.name;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      moveDialToGroup(tileId, group.id);
      hideContextMenu();
    });
    ctxMoveSub.appendChild(btn);
  }
}

async function moveDialToGroup(dialId, groupId) {
  const found = findDial(dialId);
  const target = groups.find((g) => g.id === groupId);
  if (!found || !target || found.group.id === groupId) return;
  found.group.dials = found.group.dials.filter((d) => d.id !== dialId);
  target.dials.push(found.dial);
  await saveGroups();
  render();
}

document.addEventListener("contextmenu", (e) => {
  // Не перехватываем правый клик внутри диалогов и меню.
  if (e.target.closest(".dialog") || e.target.closest(".ctx")) return;
  e.preventDefault();

  const tab = e.target.closest(".tab:not(.tab--add)");
  if (tab) {
    showContextMenu(e.clientX, e.clientY, { groupId: tab.dataset.groupId });
    return;
  }
  const tile = e.target.closest(".tile");
  showContextMenu(e.clientX, e.clientY, { tileId: tile ? tile.dataset.id : null });
});

contextMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".ctx__item");
  if (!item) return;
  const action = item.dataset.action;
  const dial = ctxTargetId ? findDial(ctxTargetId)?.dial : null;

  if (action === "add") {
    openDialog(null);
  } else if (action === "create-group") {
    openGroupDialog(null);
  } else if (action === "edit" && dial) {
    openDialog(dial);
  } else if (action === "remove" && dial) {
    removeDial(dial.id);
  } else if (action === "rename-group" && ctxTargetGroupId) {
    openGroupDialog(ctxTargetGroupId);
  } else if (action === "delete-group" && ctxTargetGroupId) {
    deleteGroup(ctxTargetGroupId);
  }
  hideContextMenu();
});

// Закрытие меню по клику вне, прокрутке, Esc.
document.addEventListener("click", (e) => {
  if (!contextMenu.hidden && !e.target.closest(".ctx")) hideContextMenu();
});
window.addEventListener("scroll", hideContextMenu, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideContextMenu();
});

// --- Группы ---

function openGroupDialog(id) {
  groupEditId = id;
  const group = id ? groups.find((g) => g.id === id) : null;
  groupDialogTitle.textContent = id ? "Переименовать группу" : "Новая группа";
  groupNameInput.value = group ? group.name : "";
  groupDialog.showModal();
  groupNameInput.focus();
}

groupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = groupNameInput.value.trim();
  if (!name) return;

  if (groupEditId) {
    const group = groups.find((g) => g.id === groupEditId);
    if (group) group.name = name;
  } else {
    const group = { id: makeId(), name, dials: [] };
    groups.push(group);
    await setActiveGroup(group.id);
  }
  await saveGroups();
  groupDialog.close();
  renderTabs();
  render();
});

groupCancel.addEventListener("click", () => groupDialog.close());

async function deleteGroup(id) {
  if (groups.length <= 1) return; // последнюю группу не удаляем
  const group = groups.find((g) => g.id === id);
  if (group && group.dials.length &&
      !confirm(`Удалить группу «${group.name}» со всеми плитками (${group.dials.length})?`)) {
    return;
  }
  groups = groups.filter((g) => g.id !== id);
  if (activeGroupId === id) await setActiveGroup(groups[0].id);
  await saveGroups();
  renderTabs();
  render();
}

// --- Настройки вида ---

let settingsSnapshot = null; // сохранённые настройки до открытия диалога
let settingsCommitted = false; // нажали ли «Готово»

// Заполнить поля диалога из объекта настроек.
function fillSettingsForm(s) {
  setColumns.value = s.columns;
  colsOutput.textContent = s.columns;
  setWidth.value = s.tileWidth;
  widthOutput.textContent = `${s.tileWidth}px`;
  setHeight.value = s.tileHeight;
  heightOutput.textContent = `${s.tileHeight}px`;
  setFollowTheme.checked = s.followTheme;
  setBgColor.value = s.bgColor;
  setBgColor.disabled = s.followTheme; // под темой ручной цвет не нужен
  setBgImage.value = s.bgImage;
}

// Считать текущие значения полей в объект настроек.
function readSettingsForm() {
  return {
    columns: Number(setColumns.value),
    tileWidth: Number(setWidth.value),
    tileHeight: Number(setHeight.value),
    followTheme: setFollowTheme.checked,
    bgColor: setBgColor.value,
    bgImage: setBgImage.value.trim()
  };
}

// Живое превью: применить значения формы, не сохраняя в хранилище.
function previewSettings() {
  settings = readSettingsForm();
  applySettings();
}

function openSettings() {
  settingsSnapshot = { ...settings };
  settingsCommitted = false;
  fillSettingsForm(settings);
  settingsDialog.showModal();
}

settingsBtn.addEventListener("click", openSettings);

setColumns.addEventListener("input", () => {
  colsOutput.textContent = setColumns.value;
  previewSettings();
});

setWidth.addEventListener("input", () => {
  widthOutput.textContent = `${setWidth.value}px`;
  previewSettings();
});

setHeight.addEventListener("input", () => {
  heightOutput.textContent = `${setHeight.value}px`;
  previewSettings();
});

setFollowTheme.addEventListener("change", () => {
  setBgColor.disabled = setFollowTheme.checked;
  previewSettings();
});
setBgColor.addEventListener("input", previewSettings);
setBgImage.addEventListener("input", previewSettings);

// Реакция на смену системной темы, когда включено «подстраивать под тему».
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings.followTheme) applySettings();
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  settingsCommitted = true;
  await saveSettings(readSettingsForm());
  applySettings();
  settingsDialog.close();
});

settingsReset.addEventListener("click", () => {
  fillSettingsForm({ ...DEFAULT_SETTINGS });
  previewSettings();
});

// При закрытии без сохранения (Esc, клик по фону) — откатить превью.
settingsDialog.addEventListener("close", () => {
  if (!settingsCommitted && settingsSnapshot) {
    settings = settingsSnapshot;
    applySettings();
  }
  settingsSnapshot = null;
});

// --- Старт ---

(async function init() {
  const [loadedGroups, active, loadedSettings] = await Promise.all([
    loadGroups(),
    loadActive(),
    loadSettings()
  ]);
  groups = loadedGroups;
  settings = loadedSettings;
  activeGroupId = groups.some((g) => g.id === active) ? active : groups[0].id;
  applySettings();
  renderTabs();
  render();
})();
