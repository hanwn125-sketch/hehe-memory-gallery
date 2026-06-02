const AUTH_KEY = "hehe-gallery-auth-v2";
const LOCAL_ALBUMS_KEY = "hehe-local-albums-v1";
const MEMORY_NOTES_KEY = "hehe-memory-notes-v1";

const state = {
  data: null,
  category: "全部",
  albumId: null,
  query: "",
  initialized: false,
  key: null,
  apiPassword: "",
  notes: {},
  foods: [],
  hiddenAlbums: new Set(),
  hiddenPhotos: new Set(),
  covers: {},
  albumDates: {},
  objectUrls: [],
  galleryObserver: null,
};

const base64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const deriveKey = async (password, salt, iterations) => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
};

const decryptBytes = async (key, encryptedBytes) => {
  const iv = encryptedBytes.slice(0, 12);
  const ciphertext = encryptedBytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(plain);
};

const fetchEncrypted = async (path) => {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`无法读取加密文件：${path}`);
  return new Uint8Array(await response.arrayBuffer());
};

const decryptJson = async (key, path) => {
  const bytes = await decryptBytes(key, await fetchEncrypted(path));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const decryptAssetUrl = async (item) => {
  if (item.decrypted || item.local) return item.src;
  if (item.decrypting) return item.decrypting;
  if (!item.encryptedSrc) item.encryptedSrc = item.src;

  item.decrypting = (async () => {
    const mime = item.type === "video" ? "video/mp4" : "image/jpeg";
    const bytes = item.remote
      ? new Uint8Array(await (await apiFetch(item.apiSrc)).arrayBuffer())
      : await decryptBytes(state.key, await fetchEncrypted(item.encryptedSrc));
    const url = URL.createObjectURL(new Blob([bytes], { type: item.mime || mime }));
    state.objectUrls.push(url);
    item.src = url;
    item.decrypted = true;
    item.decrypting = null;
    return url;
  })();

  return item.decrypting;
};

const fileToDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const normalizeTitle = (title) => String(title || "").trim().toLowerCase();

const imageToUploadFile = (file, maxSize = 1800, quality = 0.82) =>
  new Promise((resolve) => {
    if (!file.type?.startsWith("image/")) {
      resolve(file);
      return;
    }

    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      if (scale >= 1 && file.size < 1.6 * 1024 * 1024) {
        resolve(file);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const name = file.name.replace(/\.[^.]+$/, "") || "photo";
          resolve(new File([blob], `${name}.jpg`, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality,
      );
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    image.src = url;
  });

const prepareUploadFiles = async (files) => {
  const list = Array.from(files).filter((file) => file.type?.startsWith("image/"));
  const prepared = [];
  for (let index = 0; index < list.length; index += 1) {
    setUploadStatus(`整理照片 ${index + 1}/${list.length}`);
    prepared.push(await imageToUploadFile(list[index]));
  }
  return prepared;
};

const loadLocalAlbums = () => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ALBUMS_KEY) || "[]");
  } catch {
    return [];
  }
};

const saveLocalAlbums = (albums) => {
  localStorage.setItem(LOCAL_ALBUMS_KEY, JSON.stringify(albums));
};

const apiFetch = async (path, options = {}) => {
  const headers = new Headers(options.headers || {});
  if (state.apiPassword) headers.set("X-Site-Password", state.apiPassword);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response;
};

const loadMemoryNotes = () => {
  try {
    return { ...JSON.parse(localStorage.getItem(MEMORY_NOTES_KEY) || "{}"), ...state.notes };
  } catch {
    return { ...state.notes };
  }
};

const saveMemoryNote = async (id, value) => {
  const notes = JSON.parse(localStorage.getItem(MEMORY_NOTES_KEY) || "{}");
  if (value.trim()) {
    notes[id] = value;
    state.notes[id] = value;
  } else {
    delete notes[id];
    delete state.notes[id];
  }
  localStorage.setItem(MEMORY_NOTES_KEY, JSON.stringify(notes));

  try {
    await apiFetch(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: value }),
    });
  } catch {
    // GitHub Pages has no backend; local save is still useful there.
  }
};

const loadRemoteNotes = async () => {
  try {
    const response = await apiFetch("/api/notes");
    state.notes = await response.json();
  } catch {
    state.notes = {};
  }
};

const loadRemoteAlbums = async () => {
  try {
    const response = await apiFetch("/api/albums");
    const albums = await response.json();
    if (!Array.isArray(albums) || !albums.length) return;
    albums.forEach(mergeRemoteAlbum);
    if (!state.data.categories.some((item) => item.name === "她的上传")) {
      state.data.categories.push({ name: "她的上传", count: albums.reduce((sum, album) => sum + album.count, 0) });
    }
  } catch {
    // Remote interaction is optional until Cloudflare bindings are configured.
  }
};

const loadRemoteFoods = async () => {
  try {
    const response = await apiFetch("/api/foods");
    state.foods = await response.json();
  } catch {
    state.foods = [];
  }
};

const loadRemoteState = async () => {
  try {
    const response = await apiFetch("/api/state");
    const remoteState = await response.json();
    state.hiddenAlbums = new Set(remoteState.hiddenAlbums || []);
    state.hiddenPhotos = new Set(remoteState.hiddenPhotos || []);
    state.covers = remoteState.covers || {};
    state.albumDates = remoteState.dates || {};
    applyRemoteState();
  } catch {
    state.hiddenAlbums = new Set();
    state.hiddenPhotos = new Set();
    state.covers = {};
    state.albumDates = {};
  }
};

const applyRemoteState = () => {
  if (!state.data) return;
  state.data.albums = state.data.albums
    .filter((album) => !state.hiddenAlbums.has(album.id))
    .map((album) => {
      album.date = state.albumDates[album.id] || album.date;
      album.items = album.items.filter((item) => !state.hiddenPhotos.has(item.id) && !state.hiddenPhotos.has(item.storageKey));
      album.count = album.items.length;
      album.photos = album.items.filter((item) => item.type === "image").length;
      album.videos = album.items.filter((item) => item.type === "video").length;
      return album;
    })
    .filter((album) => album.items.length);
};

const mergeRemoteAlbum = (remoteAlbum) => {
  const titleKey = normalizeTitle(remoteAlbum.title);
  const existing = state.data.albums.find((album) => album.id === remoteAlbum.id || (titleKey && normalizeTitle(album.title) === titleKey));
  if (!existing) {
    remoteAlbum.sourceAlbumIds = [remoteAlbum.id];
    state.data.albums.unshift(remoteAlbum);
    return remoteAlbum;
  }

  const itemKeys = new Set(existing.items.map((item) => item.storageKey || item.id));
  const incoming = remoteAlbum.items.filter((item) => !itemKeys.has(item.storageKey || item.id));
  existing.items = [...existing.items, ...incoming];
  existing.count = existing.items.length;
  existing.photos = existing.items.filter((item) => item.type === "image").length;
  existing.videos = existing.items.filter((item) => item.type === "video").length;
  existing.remote = existing.remote || remoteAlbum.remote;
  existing.sourceAlbumIds = Array.from(new Set([...(existing.sourceAlbumIds || [existing.id]), remoteAlbum.id]));
  existing.date = existing.date || remoteAlbum.date;
  return existing;
};

const mergeAlbumsByTitle = () => {
  const merged = [];
  const byTitle = new Map();
  sortAlbums(state.data.albums).forEach((album) => {
    const titleKey = normalizeTitle(album.title);
    const groupKey = titleKey || album.id;
    if (!byTitle.has(groupKey)) {
      album.sourceAlbumIds = album.sourceAlbumIds || [album.id];
      byTitle.set(groupKey, album);
      merged.push(album);
      return;
    }

    const target = byTitle.get(groupKey);
    const itemKeys = new Set(target.items.map((item) => item.storageKey || item.id));
    album.items.forEach((item) => {
      const itemKey = item.storageKey || item.id;
      if (!itemKeys.has(itemKey)) {
        itemKeys.add(itemKey);
        target.items.push(item);
      }
    });
    target.sourceAlbumIds = Array.from(new Set([...(target.sourceAlbumIds || [target.id]), ...(album.sourceAlbumIds || [album.id])]));
    target.date = target.date || album.date;
    target.count = target.items.length;
    target.photos = target.items.filter((item) => item.type === "image").length;
    target.videos = target.items.filter((item) => item.type === "video").length;
    target.remote = target.remote || album.remote;
    target.local = target.local || album.local;
  });
  state.data.albums = merged;
};

const mergeLocalAlbums = () => {
  const localAlbums = loadLocalAlbums();
  if (!localAlbums.length) return;
  state.data.albums = [...localAlbums, ...state.data.albums.filter((album) => !album.local)];
  if (!state.data.categories.some((item) => item.name === "她的上传")) {
    state.data.categories.push({ name: "她的上传", count: localAlbums.reduce((sum, album) => sum + album.count, 0) });
  }
  state.data.stats.albums += localAlbums.length;
  state.data.stats.photos += localAlbums.reduce((sum, album) => sum + album.photos, 0);
  state.data.stats.displayItems += localAlbums.reduce((sum, album) => sum + album.count, 0);
};

const prepareEncryptedItems = () => {
  state.data.albums.forEach((album) => {
    album.items.forEach((item) => {
      if (!item.local && !item.encryptedSrc) item.encryptedSrc = item.src;
    });
  });
};

const decryptInitialCovers = async () => {
  const coverItems = state.data.albums
    .map((album) => album.items.find((item) => item.type === "image") || album.items[0])
    .filter(Boolean);
  await Promise.all(coverItems.map(decryptAssetUrl));
};

const showGallery = async (password) => {
  document.getElementById("auth-error").textContent = "";
  const configResponse = await fetch("secure/config.json", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("找不到加密配置。");
  const config = await configResponse.json();
  state.apiPassword = password;
  state.key = await deriveKey(password, base64ToBytes(config.salt), config.iterations);
  state.data = await decryptJson(state.key, config.manifest);
  prepareEncryptedItems();
  await loadRemoteNotes();
  await loadRemoteAlbums();
  await loadRemoteFoods();
  await loadRemoteState();
  mergeLocalAlbums();
  mergeAlbumsByTitle();
  await decryptInitialCovers();

  sessionStorage.setItem(AUTH_KEY, password);
  document.body.classList.remove("locked");
  document.getElementById("auth-gate").setAttribute("aria-hidden", "true");
  document.getElementById("site-shell").setAttribute("aria-hidden", "false");

  if (!state.initialized) initGallery();
};

const lockGallery = () => {
  sessionStorage.removeItem(AUTH_KEY);
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
  state.data = null;
  state.key = null;
  state.apiPassword = "";
  state.notes = {};
  state.foods = [];
  state.hiddenAlbums = new Set();
  state.hiddenPhotos = new Set();
  state.covers = {};
  state.albumDates = {};
  state.initialized = false;
  document.body.classList.add("locked");
  document.getElementById("auth-gate").setAttribute("aria-hidden", "false");
  document.getElementById("site-shell").setAttribute("aria-hidden", "true");
  document.getElementById("password-input").value = "";
  document.getElementById("password-input").focus();
};

const bindAuth = () => {
  const form = document.getElementById("auth-form");
  const input = document.getElementById("password-input");
  const error = document.getElementById("auth-error");
  const submit = form.querySelector("button[type='submit']");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    submit.textContent = "正在进入";
    try {
      await showGallery(input.value);
    } catch {
      error.textContent = "密码不对";
      input.select();
    } finally {
      submit.disabled = false;
      submit.textContent = "进入";
    }
  });

  document.getElementById("lock-button").addEventListener("click", lockGallery);
};

const formatDate = (value) => {
  if (!value) return "补日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const flattenItems = (albums) =>
  albums.flatMap((album) =>
    album.items.map((item) => {
      item.albumId = album.id;
      item.albumTitle = album.title;
      item.category = album.category;
      item.mood = album.mood;
      item.place = album.place;
      return item;
    }),
  );

const setText = (id, text) => {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
};

const escapeHtml = (value) =>
  String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const currentAlbum = () => {
  if (!state.albumId || !state.data) return null;
  return state.data.albums.find((album) => album.id === state.albumId) || null;
};

const findItemById = (id) => flattenItems(state.data.albums).find((item) => item.id === id);

const jumpToGallery = () => {
  document.getElementById("gallery").scrollIntoView({ behavior: "smooth", block: "start" });
};

const selectAlbum = (albumId) => {
  state.albumId = albumId;
  state.category = "全部";
  document.querySelectorAll(".gallery-panel").forEach((element) => {
    element.hidden = false;
  });
  renderGallery();
  jumpToGallery();
};

const refreshTimeline = () => {
  mergeAlbumsByTitle();
  renderStats(state.data);
  renderTimeline(state.data.albums);
  renderExistingAlbumOptions();
};

const quickUploadNewAlbum = () => {
  document.getElementById("quick-album-files").click();
};

const quickUploadToCurrentAlbum = () => {
  if (!currentAlbum()) return;
  document.getElementById("quick-current-files").click();
};

const pickCoverItem = (album) => {
  if (!album) return null;
  const coverId = state.covers[album.id];
  if (coverId) {
    const chosen = album.items.find((item) => item.id === coverId || item.storageKey === coverId);
    if (chosen) return chosen;
  }
  for (const id of album.sourceAlbumIds || []) {
    const chosen = state.covers[id] && album.items.find((item) => item.id === state.covers[id] || item.storageKey === state.covers[id]);
    if (chosen) return chosen;
  }
  return album.items.find((item) => item.type === "image") || album.items[0] || null;
};

const renderStats = (data) => {
  const heroAlbum =
    data.albums.find((album) => album.title.includes("甜甜")) ||
    data.albums.find((album) => album.title.includes("日常")) ||
    data.albums.find((album) => album.cover) ||
    data.albums[0];
  const coverItem = pickCoverItem(heroAlbum);
  if (coverItem?.src) {
    document.getElementById("hero").style.setProperty("--hero-image", `url("${coverItem.src}")`);
    document.getElementById("hero").style.setProperty("--hero-position", heroAlbum.title.includes("甜甜") ? "72% center" : "center");
  }
};

const sortAlbums = (albums) =>
  albums.slice().sort((a, b) => {
    if (!a.date && !b.date) return a.title.localeCompare(b.title, "zh-CN");
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

const albumYear = (album) => (album.date || "待补日期").slice(0, 4) || "待补日期";

const renderTimeline = (albums) => {
  const timeline = document.getElementById("timeline");
  const grouped = sortAlbums(albums).reduce((groups, album) => {
    const year = albumYear(album);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(album);
    return groups;
  }, new Map());

  const yearSections = Array.from(grouped.entries())
    .map(([year, yearAlbums]) => {
      const cards = yearAlbums
        .map((album) => {
          const cover = pickCoverItem(album);
          return [
            '<article class="timeline-item clickable-card" tabindex="0" data-album="' + album.id + '" role="button" aria-label="查看' + album.title + '">',
            '  <div class="timeline-dot"></div>',
            '  <button class="timeline-date" type="button" data-edit-date="' + album.id + '" aria-label="修改' + album.title + '日期">' + formatDate(album.date) + '</button>',
            '  <div class="timeline-card">',
            cover ? '    <img src="' + cover.src + '" alt="' + album.title + '" loading="lazy" decoding="async" />' : '',
            '    <div class="timeline-body">',
            '      <h3>' + album.title + '</h3>',
            '      <p class="album-meta">' + (album.place || album.mood) + ' · ' + album.count + ' 张</p>',
            '    </div>',
            '  </div>',
            '</article>',
          ].join('');
        })
        .join("");

      return [
        '<section class="timeline-year" aria-label="' + year + ' 年">',
        '  <div class="timeline-year-label">' + year + '</div>',
        '  <div class="timeline-row">',
        '    <div class="timeline-track">',
        cards,
        '    </div>',
        '  </div>',
        '</section>',
      ].join('');
    })
    .join("");

  timeline.innerHTML =
    yearSections +
    [
      '<section class="timeline-year timeline-add-year" aria-label="新增合集">',
      '  <div class="timeline-year-label">新增</div>',
      '  <div class="timeline-row">',
      '    <div class="timeline-track">',
      '    <article class="timeline-item timeline-add-item">',
      '      <button class="timeline-add-card" type="button" data-new-album-upload>',
      '        <span>＋</span>',
      '        <b>新合集</b>',
      '      </button>',
      '    </article>',
      '    </div>',
      '  </div>',
      '</section>',
    ].join('');

  timeline.querySelectorAll(".timeline-row").forEach((row) => {
    row.scrollLeft = 0;
  });

  timeline.querySelectorAll("[data-album]").forEach((card) => {
    card.addEventListener("click", () => selectAlbum(card.dataset.album));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectAlbum(card.dataset.album);
    });
  });
  timeline.querySelectorAll("[data-edit-date]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await editAlbumDate(event.currentTarget.dataset.editDate);
    });
  });
  timeline.querySelector("[data-new-album-upload]")?.addEventListener("click", quickUploadNewAlbum);
};

const renderExistingAlbumOptions = () => {
  const select = document.getElementById("existing-album");
  if (!select || !state.data) return;
  select.innerHTML = sortAlbums(state.data.albums)
    .map((album) => `<option value="${album.id}">${album.title}</option>`)
    .join("");
};

const itemMatches = (item) => {
  const albumMatch = !state.albumId || item.albumId === state.albumId;
  const categoryMatch = state.category === "全部" || item.category === state.category;
  const query = state.query.trim().toLowerCase();
  if (!query) return albumMatch && categoryMatch;
  const haystack = [item.title, item.albumTitle, item.category, item.mood, item.place, item.date, item.originalPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return albumMatch && categoryMatch && haystack.includes(query);
};

const mediaMarkup = (item) => {
  const loaded = item.local || item.decrypted || item.src?.startsWith("data:") || item.src?.startsWith("blob:");
  if (item.type === "video") {
    return loaded
      ? `<video src="${item.src}" muted controls preload="metadata"></video>`
      : `<div class="media-placeholder" data-item-id="${item.id}">轻点后加载视频</div>`;
  }
  return `<img ${loaded ? `src="${item.src}"` : ""} data-item-id="${item.id}" alt="" loading="lazy" decoding="async" />`;
};

const loadGalleryMedia = async (element) => {
  const item = findItemById(element.dataset.itemId);
  if (!item || element.dataset.loading === "true") return;
  element.dataset.loading = "true";
  try {
    const src = await decryptAssetUrl(item);
    if (element.tagName === "IMG") {
      element.src = src;
    } else {
      element.outerHTML = `<video src="${src}" muted controls preload="metadata"></video>`;
    }
  } catch {
    element.classList.add("media-error");
    element.textContent = "加载失败";
  }
};

const observeGalleryMedia = () => {
  const targets = document.querySelectorAll("#masonry [data-item-id]");
  if (state.galleryObserver) state.galleryObserver.disconnect();

  if (!("IntersectionObserver" in window)) {
    targets.forEach((element) => loadGalleryMedia(element));
    return;
  }

  state.galleryObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        state.galleryObserver.unobserve(entry.target);
        loadGalleryMedia(entry.target);
      });
    },
    { rootMargin: "300px 0px" },
  );

  targets.forEach((element) => {
    if (!element.getAttribute("src")) state.galleryObserver.observe(element);
  });
};

const renderGallery = () => {
  const masonry = document.getElementById("masonry");
  const items = flattenItems(state.data.albums).filter(itemMatches);
  const album = currentAlbum();
  const activeText = album
    ? `${items.length} 张照片`
    : state.category === "全部"
      ? ""
      : `${state.category} · ${items.length} 张照片`;
  setText("gallery-title", album?.title || "照片墙");
  setText("active-filter", activeText);
  const deleteAlbumButton = document.getElementById("delete-uploaded-album");
  const addToCurrentButton = document.getElementById("add-to-current-album");
  deleteAlbumButton.hidden = !album;
  addToCurrentButton.hidden = !album;
  const notes = loadMemoryNotes();

  const addCard = album
    ? `
      <button class="photo-card add-photo-card" type="button" id="masonry-add-photo">
        <span>＋</span>
        <b>添照片</b>
      </button>
    `
    : "";

  masonry.innerHTML = items
    .map(
      (item) => `
        <figure class="photo-card" tabindex="0" data-id="${item.id}">
          ${mediaMarkup(item)}
          <figcaption class="note-panel${notes[item.id] ? " has-note" : ""}">
            <button class="note-toggle" type="button" data-note-toggle="${item.id}" aria-label="给这张照片留言">✎</button>
            <button class="cover-photo" type="button" data-cover-photo="${item.id}" aria-label="设为封面">♡</button>
            <button class="delete-photo" type="button" data-delete-photo="${item.storageKey || item.id}" aria-label="删除这张照片">×</button>
            <div class="note-editor">
              <textarea class="memory-note" data-note-id="${item.id}" rows="2" placeholder="给这张照片留一句回忆">${notes[item.id] || ""}</textarea>
            </div>
          </figcaption>
        </figure>
      `,
    )
    .join("") + addCard;

  document.getElementById("masonry-add-photo")?.addEventListener("click", () => {
    quickUploadToCurrentAlbum();
  });
  masonry.querySelectorAll(".photo-card").forEach((card) => {
    if (!card.dataset.id) return;
    card.addEventListener("click", () => openLightbox(card.dataset.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openLightbox(card.dataset.id);
    });
  });
  masonry.querySelectorAll(".note-toggle").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = event.currentTarget.closest(".note-panel");
      panel.classList.toggle("note-open");
      if (panel.classList.contains("note-open")) {
        panel.querySelector(".memory-note").focus();
      }
    });
  });
  masonry.querySelectorAll(".delete-photo").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deletePhoto(event.currentTarget.dataset.deletePhoto);
    });
  });
  masonry.querySelectorAll(".cover-photo").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await setAlbumCover(event.currentTarget.dataset.coverPhoto);
    });
  });
  masonry.querySelectorAll(".memory-note").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => event.stopPropagation());
    input.addEventListener("input", (event) => {
      event.currentTarget.closest(".note-panel").classList.toggle("has-note", Boolean(event.currentTarget.value.trim()));
      saveMemoryNote(event.currentTarget.dataset.noteId, event.currentTarget.value);
    });
  });
  observeGalleryMedia();
};

const removePhotoLocally = (key) => {
  state.data.albums = state.data.albums
    .map((album) => {
      album.items = album.items.filter((item) => item.storageKey !== key && item.id !== key);
      album.count = album.items.length;
      album.photos = album.items.filter((item) => item.type === "image").length;
      album.videos = album.items.filter((item) => item.type === "video").length;
      return album;
    })
    .filter((album) => album.items.length || !album.remote);
};

const deletePhoto = async (key) => {
  if (!key) return;
  if (key.startsWith("photo:")) {
    await apiFetch(`/api/assets/${encodeURIComponent(key)}`, { method: "DELETE" });
  } else {
    await apiFetch(`/api/hidden/photos/${encodeURIComponent(key)}`, { method: "PUT" });
    state.hiddenPhotos.add(key);
  }
  removePhotoLocally(key);
  refreshTimeline();
  renderGallery();
};

const deleteRemoteAlbum = async () => {
  const album = currentAlbum();
  if (!album) return;
  const hasRemoteItems = album.items.some((item) => item.remote);
  const hasOriginalItems = album.items.some((item) => !item.remote && !item.local);
  const albumIds = album.sourceAlbumIds || [album.id];
  if (hasRemoteItems) {
    await Promise.all(albumIds.map((id) => apiFetch(`/api/albums/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)));
  }
  if (hasOriginalItems) {
    await Promise.all(albumIds.map((id) => apiFetch(`/api/hidden/albums/${encodeURIComponent(id)}`, { method: "PUT" }).catch(() => null)));
    albumIds.forEach((id) => state.hiddenAlbums.add(id));
  }
  if (album.local) {
    saveLocalAlbums(loadLocalAlbums().filter((entry) => entry.id !== album.id));
  }
  if (hasRemoteItems || hasOriginalItems || album.local) {
    state.data.albums = state.data.albums.filter((entry) => entry.id !== album.id);
  }
  state.albumId = null;
  document.querySelectorAll(".gallery-panel").forEach((element) => {
    element.hidden = true;
  });
  refreshTimeline();
};

const setAlbumCover = async (itemId) => {
  const album = currentAlbum();
  if (!album || !itemId) return;
  const albumIds = album.sourceAlbumIds || [album.id];
  await Promise.all(
    albumIds.map((id) =>
      apiFetch(`/api/covers/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      }).catch(() => null),
    ),
  );
  albumIds.forEach((id) => {
    state.covers[id] = itemId;
  });
  refreshTimeline();
};

const editAlbumDate = async (albumId) => {
  const album = state.data.albums.find((entry) => entry.id === albumId);
  if (!album) return;
  const value = window.prompt("输入日期，例如 2026-05-01", album.date || "");
  if (value === null) return;
  const date = value.trim();
  if (!date) return;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    window.alert("日期格式用 2026-05-01 这种。");
    return;
  }
  const albumIds = album.sourceAlbumIds || [album.id];
  await Promise.all(
    albumIds.map((id) =>
      apiFetch(`/api/dates/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      }).catch(() => null),
    ),
  );
  albumIds.forEach((id) => {
    state.albumDates[id] = date;
  });
  album.date = date;
  album.items.forEach((item) => {
    item.date = date;
    item.year = date.slice(0, 4);
  });
  refreshTimeline();
};

const openLightbox = async (id) => {
  const item = findItemById(id);
  if (!item) return;

  const src = await decryptAssetUrl(item);
  const media = document.getElementById("lightbox-media");
  media.innerHTML =
    item.type === "video"
      ? `<video src="${src}" controls autoplay></video>`
      : `<img src="${src}" alt="" />`;
  setText("lightbox-title", item.albumTitle);
  setText("lightbox-detail", `${formatDate(item.date)} · ${item.category}`);
  document.getElementById("lightbox").showModal();
};

const addLocalAlbum = async (title, date, files, albumId = "") => {
  const matchedAlbum = !albumId && title ? state.data.albums.find((album) => normalizeTitle(album.title) === normalizeTitle(title)) : null;
  const targetId = albumId || matchedAlbum?.id || "";
  const remoteAlbum = await addRemoteAlbum(title, date, files, targetId);
  if (remoteAlbum) {
    const mergedAlbum = mergeRemoteAlbum(remoteAlbum);
    refreshTimeline();
    selectAlbum(mergedAlbum.id);
    return true;
  }

  const targetAlbum = targetId ? state.data.albums.find((album) => album.id === targetId) : null;
  const localAlbumId = targetAlbum?.id || `local-${Date.now()}`;
  const items = await Promise.all(
    Array.from(files).map(async (file, index) => {
      const src = await fileToDataUrl(file);
      return {
        id: `${localAlbumId}-${Date.now()}-${index + 1}`,
        type: "image",
        title,
        src,
        local: true,
        originalPath: "",
        date: date || new Date().toISOString().slice(0, 10),
        year: (date || new Date().toISOString()).slice(0, 4),
        bytes: file.size,
      };
    }),
  );

  if (!items.length) return false;

  if (targetAlbum) {
    targetAlbum.items.push(...items);
    targetAlbum.count = targetAlbum.items.length;
    targetAlbum.photos = targetAlbum.items.filter((item) => item.type === "image").length;
    refreshTimeline();
    selectAlbum(targetAlbum.id);
    return true;
  }

  const album = {
    id: localAlbumId,
    local: true,
    sourceFolder: "local",
    title,
    date: date || new Date().toISOString().slice(0, 10),
    category: "她的上传",
    mood: "本地合集",
    place: "",
    cover: items[0].src,
    count: items.length,
    photos: items.length,
    videos: 0,
    items,
  };

  state.data.albums.unshift(album);
  saveLocalAlbums([album, ...loadLocalAlbums()]);

  if (!state.data.categories.some((item) => item.name === "她的上传")) {
    state.data.categories.push({ name: "她的上传", count: items.length });
  }

  state.data.stats.albums += 1;
  state.data.stats.photos += items.length;
  state.data.stats.displayItems += items.length;
  renderStats(state.data);
  renderTimeline(state.data.albums);
  renderExistingAlbumOptions();
  selectAlbum(localAlbumId);
  return true;
};

const addRemoteAlbum = (title, date, files, albumId = "") =>
  new Promise(async (resolve) => {
    const preparedFiles = await prepareUploadFiles(files);
    if (!preparedFiles.length) {
      resolve(null);
      return;
    }

    const chunks = [];
    for (let index = 0; index < preparedFiles.length; index += 6) {
      chunks.push(preparedFiles.slice(index, index + 6));
    }

    let targetAlbumId = albumId;
    let latestAlbum = null;
    for (let index = 0; index < chunks.length; index += 1) {
      setUploadStatus(`上传第 ${index + 1}/${chunks.length} 批`);
      const uploaded = await uploadRemoteChunk(title, date, chunks[index], targetAlbumId, index + 1, chunks.length);
      if (!uploaded) {
        resolve(latestAlbum);
        return;
      }
      latestAlbum = uploaded;
      targetAlbumId = uploaded.id;
    }
    resolve(latestAlbum);
  });

const uploadRemoteChunk = (title, date, files, albumId = "", chunkIndex = 1, chunkTotal = 1) =>
  new Promise((resolve) => {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("date", date || new Date().toISOString().slice(0, 10));
    if (albumId) formData.append("albumId", albumId);
    Array.from(files).forEach((file) => formData.append("files", file));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/albums");
    xhr.setRequestHeader("X-Site-Password", state.apiPassword);
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      setUploadStatus(`上传第 ${chunkIndex}/${chunkTotal} 批 · ${Math.round((event.loaded / event.total) * 100)}%`);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        resolve(null);
      }
    });
    xhr.addEventListener("error", () => resolve(null));
    xhr.send(formData);
  });

const setUploadStatus = (text) => {
  const status = document.getElementById("upload-status");
  if (status) status.textContent = text;
};

const saveFood = async (food) => {
  const response = await apiFetch("/api/foods", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(food),
  });
  const saved = await response.json();
  state.foods.unshift(saved);
  renderFoods();
};

const deleteFood = async (id) => {
  await apiFetch(`/api/foods/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.foods = state.foods.filter((food) => food.id !== id);
  renderFoods();
};

const renderFoods = () => {
  const list = document.getElementById("food-list");
  if (!list) return;
  if (!state.foods.length) {
    list.innerHTML = `<p class="empty-food">还没有记录。下一顿好吃的，就从这里开始。</p>`;
    return;
  }
  list.innerHTML = state.foods
    .map(
      (food) => `
        <article class="food-card">
          <div>
            <span class="food-score">${"★".repeat(Number(food.rating || 5))}</span>
            <h3>${escapeHtml(food.shop)}</h3>
            <p>${escapeHtml([food.place, food.dishes].filter(Boolean).join(" · "))}</p>
            ${food.note ? `<small>${escapeHtml(food.note)}</small>` : ""}
          </div>
          <button type="button" data-delete-food="${food.id}" aria-label="删除这条美食记录">×</button>
        </article>
      `,
    )
    .join("");
  list.querySelectorAll("[data-delete-food]").forEach((button) => {
    button.addEventListener("click", () => deleteFood(button.dataset.deleteFood));
  });
};

const bindGalleryEvents = () => {
  const uploadToggle = document.getElementById("upload-toggle");
  const uploadForm = document.getElementById("local-album-form");
  const uploadMode = document.getElementById("upload-mode");
  const existingAlbum = document.getElementById("existing-album");
  const titleInput = document.getElementById("local-album-title");
  const dateInput = document.getElementById("local-album-date");

  uploadToggle.addEventListener("click", quickUploadNewAlbum);

  uploadMode.addEventListener("change", () => {
    const useExisting = uploadMode.value === "existing";
    existingAlbum.hidden = !useExisting;
    titleInput.hidden = useExisting;
    titleInput.required = !useExisting;
    dateInput.hidden = useExisting;
  });

  document.getElementById("add-to-current-album").addEventListener("click", () => {
    const album = currentAlbum();
    if (!album) return;
    quickUploadToCurrentAlbum();
  });

  document.getElementById("close-lightbox").addEventListener("click", () => {
    document.getElementById("lightbox").close();
  });

  document.getElementById("delete-uploaded-album").addEventListener("click", deleteRemoteAlbum);

  document.getElementById("local-album-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const targetAlbum = uploadMode.value === "existing" ? state.data.albums.find((album) => album.id === existingAlbum.value) : null;
    const title = targetAlbum?.title || titleInput.value.trim();
    const date = targetAlbum?.date || dateInput.value;
    const files = document.getElementById("local-album-files").files;
    if (!files.length) return;
    setUploadStatus("准备上传...");
    const ok = await addLocalAlbum(title || "她的新合集", date, files, targetAlbum?.id || "");
    if (!ok) {
      setUploadStatus("上传没有成功，请再试一次");
      return;
    }
    setUploadStatus("上传完成");
    event.currentTarget.reset();
    uploadMode.dispatchEvent(new Event("change"));
    uploadToggle.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      uploadForm.hidden = true;
      setUploadStatus("");
    }, 800);
  });

  document.getElementById("quick-album-files").addEventListener("change", async (event) => {
    const files = event.currentTarget.files;
    if (!files.length) return;
    const title = window.prompt("这个合集叫什么？例如：威海的小路", "");
    if (title === null || !title.trim()) {
      event.currentTarget.value = "";
      return;
    }
    const date = window.prompt("日期可以先填，也可以之后点日期改。格式：2026-05-24", new Date().toISOString().slice(0, 10));
    if (date === null) {
      event.currentTarget.value = "";
      return;
    }
    const trimmedDate = date.trim();
    if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
      window.alert("日期格式用 2026-05-24 这种。");
      event.currentTarget.value = "";
      return;
    }
    setUploadStatus("准备上传...");
    const ok = await addLocalAlbum(title.trim(), trimmedDate, files, "");
    setUploadStatus(ok ? "上传完成" : "上传没有成功，请再试一次");
    event.currentTarget.value = "";
    setTimeout(() => setUploadStatus(""), 1200);
  });

  document.getElementById("quick-current-files").addEventListener("change", async (event) => {
    const album = currentAlbum();
    const files = event.currentTarget.files;
    if (!album || !files.length) return;
    setUploadStatus("准备上传...");
    const ok = await addLocalAlbum(album.title, album.date, files, album.id);
    setUploadStatus(ok ? "上传完成" : "上传没有成功，请再试一次");
    event.currentTarget.value = "";
    setTimeout(() => setUploadStatus(""), 1200);
  });

  document.getElementById("food-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const shop = document.getElementById("food-shop").value.trim();
    if (!shop) return;
    await saveFood({
      shop,
      place: document.getElementById("food-place").value.trim(),
      dishes: document.getElementById("food-dishes").value.trim(),
      rating: document.getElementById("food-rating").value,
      note: document.getElementById("food-note").value.trim(),
    });
    event.currentTarget.reset();
  });
};

const initGallery = () => {
  bindGalleryEvents();
  renderStats(state.data);
  renderTimeline(state.data.albums);
  renderExistingAlbumOptions();
  renderFoods();
  state.initialized = true;
  document.getElementById("auth-error").textContent = "";
};

const setHomeView = (view) => {
  const nextView = view === "food" ? "food" : "timeline";
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== nextView;
  });
  document.querySelectorAll("[data-view-tab]").forEach((tab) => {
    const active = tab.dataset.viewTab === nextView;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
  sessionStorage.setItem("hehe-home-view", nextView);
};

const bindHomeViewTabs = () => {
  document.querySelectorAll("[data-view-tab]").forEach((tab) => {
    tab.addEventListener("click", () => setHomeView(tab.dataset.viewTab));
  });
  setHomeView(sessionStorage.getItem("hehe-home-view") || "timeline");
};

const init = () => {
  bindAuth();
  bindHomeViewTabs();
  const savedPassword = sessionStorage.getItem(AUTH_KEY);
  if (savedPassword && savedPassword !== "unlocked") {
    showGallery(savedPassword).catch(() => {
      sessionStorage.removeItem(AUTH_KEY);
      document.getElementById("password-input").focus();
    });
    return;
  }
  document.getElementById("password-input").focus();
};

init();
