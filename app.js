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
    state.data.albums = [...albums, ...state.data.albums.filter((album) => !album.remote)];
    if (!state.data.categories.some((item) => item.name === "她的上传")) {
      state.data.categories.push({ name: "她的上传", count: albums.reduce((sum, album) => sum + album.count, 0) });
    }
  } catch {
    // Remote interaction is optional until Cloudflare bindings are configured.
  }
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
  mergeLocalAlbums();
  await decryptInitialCovers();

  sessionStorage.setItem(AUTH_KEY, "unlocked");
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    try {
      await showGallery(input.value);
    } catch {
      error.textContent = "密码不对";
      input.select();
    }
  });

  document.getElementById("lock-button").addEventListener("click", lockGallery);
};

const formatDate = (value) => {
  if (!value) return "日期待补充";
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

const pickCoverItem = (album) => {
  if (!album) return null;
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

const tag = (text) => `<span class="tag">${text}</span>`;

const sortAlbums = (albums) =>
  albums.slice().sort((a, b) => {
    if (!a.date && !b.date) return a.title.localeCompare(b.title, "zh-CN");
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

const renderTimeline = (albums) => {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = sortAlbums(albums)
    .map((album) => {
      const cover = pickCoverItem(album);
      return `
        <article class="timeline-item clickable-card" tabindex="0" data-album="${album.id}" role="button" aria-label="查看${album.title}">
          <div class="timeline-dot"></div>
          <div class="timeline-card">
            ${cover ? `<img src="${cover.src}" alt="${album.title}" loading="lazy" />` : ""}
            <div class="timeline-body">
              <span class="date">${formatDate(album.date)}</span>
              <h3>${album.title}</h3>
              <p class="album-meta">${album.place || album.mood} · ${album.count} 张</p>
              <div class="tag-row">
                ${tag(album.category)}
                ${tag(album.mood)}
                ${album.videos ? tag(`${album.videos} 个视频`) : ""}
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  timeline.querySelectorAll("[data-album]").forEach((card) => {
    card.addEventListener("click", () => selectAlbum(card.dataset.album));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectAlbum(card.dataset.album);
    });
  });
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
  return `<img ${loaded ? `src="${item.src}"` : ""} data-item-id="${item.id}" alt="" loading="lazy" />`;
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
    { rootMargin: "600px 0px" },
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
  const notes = loadMemoryNotes();

  masonry.innerHTML = items
    .map(
      (item) => `
        <figure class="photo-card" tabindex="0" data-id="${item.id}">
          ${mediaMarkup(item)}
          <figcaption class="note-panel${notes[item.id] ? " has-note" : ""}">
            <button class="note-toggle" type="button" data-note-toggle="${item.id}" aria-label="给这张照片留言">✎</button>
            <div class="note-editor">
              <textarea class="memory-note" data-note-id="${item.id}" rows="2" placeholder="给这张照片留一句回忆">${notes[item.id] || ""}</textarea>
            </div>
          </figcaption>
        </figure>
      `,
    )
    .join("");

  masonry.querySelectorAll(".photo-card").forEach((card) => {
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

const addLocalAlbum = async (title, date, files) => {
  const remoteAlbum = await addRemoteAlbum(title, date, files);
  if (remoteAlbum) {
    state.data.albums.unshift(remoteAlbum);
    renderStats(state.data);
    renderTimeline(state.data.albums);
    selectAlbum(remoteAlbum.id);
    return;
  }

  const albumId = `local-${Date.now()}`;
  const items = await Promise.all(
    Array.from(files).map(async (file, index) => {
      const src = await fileToDataUrl(file);
      return {
        id: `${albumId}-${index + 1}`,
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

  if (!items.length) return;

  const album = {
    id: albumId,
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
  selectAlbum(albumId);
};

const addRemoteAlbum = async (title, date, files) => {
  try {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("date", date || new Date().toISOString().slice(0, 10));
    Array.from(files).forEach((file) => formData.append("files", file));
    const response = await apiFetch("/api/albums", { method: "POST", body: formData });
    return response.json();
  } catch {
    return null;
  }
};

const bindGalleryEvents = () => {
  document.getElementById("close-lightbox").addEventListener("click", () => {
    document.getElementById("lightbox").close();
  });

  document.getElementById("local-album-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("local-album-title").value.trim();
    const date = document.getElementById("local-album-date").value;
    const files = document.getElementById("local-album-files").files;
    await addLocalAlbum(title || "她的新合集", date, files);
    event.currentTarget.reset();
  });
};

const initGallery = () => {
  bindGalleryEvents();
  renderStats(state.data);
  renderTimeline(state.data.albums);
  state.initialized = true;
  document.getElementById("auth-error").textContent = "";
};

const init = () => {
  bindAuth();
  document.getElementById("password-input").focus();
};

init();
