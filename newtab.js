"use strict";

const STORAGE_KEY = "dials";
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
const tileTemplate = document.getElementById("tile-template");
const contextMenu = document.getElementById("context-menu");

const dialog = document.getElementById("dialog");
const form = document.getElementById("dialog-form");
const dialogTitle = document.getElementById("dialog-title");
const fieldTitle = document.getElementById("field-title");
const fieldUrl = document.getElementById("field-url");
const iconChoices = document.getElementById("icon-choices");
const cancelBtn = document.getElementById("dialog-cancel");

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

let dials = [];
let settings = { ...DEFAULT_SETTINGS };
let editingId = null; // id редактируемой плитки или null при добавлении
let selectedIcon = ""; // выбранная иконка: "" (авто), URL или "monogram"
let dragId = null; // id перетаскиваемой плитки
let ctxTargetId = null; // id плитки под контекстным меню (или null для фона)

// --- Хранилище ---

async function loadDials() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  if (Array.isArray(stored[STORAGE_KEY])) {
    return stored[STORAGE_KEY];
  }
  await saveDials(DEFAULT_DIALS);
  return DEFAULT_DIALS;
}

async function saveDials(next) {
  dials = next;
  await browser.storage.local.set({ [STORAGE_KEY]: next });
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

function render() {
  grid.textContent = "";

  for (const dial of dials) {
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

// Переставляем перетаскиваемую плитку на позицию целевой.
async function reorder(fromId, toId) {
  const next = [...dials];
  const fromIdx = next.findIndex((d) => d.id === fromId);
  const toIdx = next.findIndex((d) => d.id === toId);
  if (fromIdx === -1 || toIdx === -1) return;

  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  await saveDials(next);
  render();
}

// --- Действия с плитками ---

function openDialog(dial) {
  editingId = dial ? dial.id : null;
  selectedIcon = dial ? (dial.icon || "") : "";
  dialogTitle.textContent = dial ? "Редактировать сайт" : "Добавить сайт";
  fieldTitle.value = dial ? dial.title : "";
  fieldUrl.value = dial ? dial.url : "";
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
  await saveDials(dials.filter((d) => d.id !== id));
  render();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = fieldTitle.value.trim();
  const url = normalizeUrl(fieldUrl.value);
  if (!title || !url) return;

  // Иконка в выборе уже проверена на скачиваемость, так что просто
  // сохраняем выбранную как data URL (фолбэк на URL — крайний случай).
  const icon = await toDataUrl(selectedIcon);
  if (editingId) {
    await saveDials(dials.map((d) => (d.id === editingId ? { ...d, title, url, icon } : d)));
  } else {
    await saveDials([...dials, { id: makeId(), title, url, icon }]);
  }
  dialog.close();
  render();
});

cancelBtn.addEventListener("click", () => dialog.close());

// --- Контекстное меню ---

function showContextMenu(x, y, tileId) {
  ctxTargetId = tileId;
  // Пункты для плитки и для фона взаимоисключающие.
  contextMenu.querySelectorAll(".ctx__tile-only").forEach((el) => {
    el.style.display = tileId ? "" : "none";
  });
  contextMenu.querySelectorAll(".ctx__bg-only").forEach((el) => {
    el.style.display = tileId ? "none" : "";
  });

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
}

document.addEventListener("contextmenu", (e) => {
  // Не перехватываем правый клик внутри диалогов и меню.
  if (e.target.closest(".dialog") || e.target.closest(".ctx")) return;
  e.preventDefault();
  const tile = e.target.closest(".tile");
  showContextMenu(e.clientX, e.clientY, tile ? tile.dataset.id : null);
});

contextMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".ctx__item");
  if (!item) return;
  const action = item.dataset.action;
  const dial = dials.find((d) => d.id === ctxTargetId);

  if (action === "add") {
    openDialog(null);
  } else if (action === "edit" && dial) {
    openDialog(dial);
  } else if (action === "remove" && dial) {
    removeDial(dial.id);
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
  [dials, settings] = await Promise.all([loadDials(), loadSettings()]);
  applySettings();
  render();
})();
