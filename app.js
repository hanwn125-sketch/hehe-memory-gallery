const AUTH_KEY = "hehe-gallery-auth-v2";

const state = {
  data: null,
  category: "全部",
  albumId: "全部",
  query: "",
  initialized: false,
  key: null,
  objectUrls: [],
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
  const bytes = await decryptBytes(state.key, await fetchEncrypted(item.src));
  const mime = item.type === "video" ? "video/mp4" : "image/jpeg";
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  state.objectUrls.push(url);
  item.src = url;
};

const showGallery = async (password) => {
  document.getElementById("auth-error").textContent = "正在解锁相册...";
  const configResponse = await fetch("secure/config.json", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("找不到加密配置。");
  const config = await configResponse.json();
  state.key = await deriveKey(password, base64ToBytes(config.salt), config.iterations);
  state.data = await decryptJson(state.key, config.manifest);

  const items = state.data.albums.flatMap((album) => album.items);
  await Promise.all(items.map(decryptAssetUrl));

  sessionStorage.setItem(AUTH_KEY, "unlocked");
  document.body.classList.remove("locked");
  document.getElementById("auth-gate").setAttribute("aria-hidden", "true");
  document.getElementById("site-shell").setAttribute("aria-hidden", "false");

  if (!state.initialized) {
    initGallery();
  }
};

const lockGallery = () => {
  sessionStorage.removeItem(AUTH_KEY);
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
  state.data = null;
  state.key = null;
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
      error.textContent = "密码不对，或者加密文件读取失败。";
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
    album.items.map((item) => ({
      ...item,
      albumId: album.id,
      albumTitle: album.title,
      category: album.category,
      mood: album.mood,
      place: album.place,
    })),
  );

const setText = (id, text) => {
  document.getElementById(id).textContent = text;
};

const currentAlbum = () => {
  if (state.albumId === "全部" || !state.data) return null;
  return state.data.albums.find((album) => album.id === state.albumId) || null;
};

const jumpToGallery = () => {
  document.getElementById("gallery").scrollIntoView({ behavior: "smooth", block: "start" });
};

const selectAlbum = (albumId) => {
  state.albumId = albumId;
  state.category = "全部";
  renderChips(state.data);
  renderGallery();
  jumpToGallery();
};

const renderStats = (data) => {
  setText("hero-count", `${data.stats.displayItems} 份记忆`);
  setText("hero-subtitle", `${data.stats.albums} 个主题，${data.stats.photos} 张照片，${data.stats.videos} 个视频`);
  setText("stat-albums", data.stats.albums);
  setText("stat-photos", data.stats.photos);
  setText("stat-videos", data.stats.videos);
  setText("stat-skipped", data.stats.skipped);

  const heroAlbum =
    data.albums
      .filter((album) => album.cover && album.date)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ||
    data.albums.find((album) => album.cover) ||
    data.albums[0];
  if (heroAlbum) {
    const coverItem = heroAlbum.items.find((item) => item.originalPath && heroAlbum.cover.includes(item.originalPath.split("\\").pop()?.replace(/\.[^.]+$/, ""))) || heroAlbum.items.find((item) => item.type === "image");
    document.getElementById("hero").style.setProperty("--hero-image", `url("${coverItem?.src || heroAlbum.items[0]?.src}")`);
  }
};

const tag = (text) => `<span class="tag">${text}</span>`;

const renderTimeline = (albums) => {
  const timeline = document.getElementById("timeline");
  timeline.innerHTML = albums
    .slice()
    .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))
    .map(
      (album) => `
        <article class="time-card clickable-card" tabindex="0" data-album="${album.id}" role="button" aria-label="查看${album.title}">
          <span class="date">${formatDate(album.date)}</span>
          <h3>${album.title}</h3>
          <p class="album-meta">${album.place || album.mood} · ${album.count} 份素材</p>
          <div class="tag-row">
            ${tag(album.category)}
            ${tag(album.mood)}
            ${album.videos ? tag(`${album.videos} 个视频`) : ""}
          </div>
        </article>
      `,
    )
    .join("");

  timeline.querySelectorAll("[data-album]").forEach((card) => {
    card.addEventListener("click", () => selectAlbum(card.dataset.album));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectAlbum(card.dataset.album);
    });
  });
};

const renderAlbums = (albums) => {
  const grid = document.getElementById("album-grid");
  grid.innerHTML = albums
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map((album) => {
      const cover = album.items.find((item) => item.type === "image") || album.items[0];
      return `
        <article class="album-card clickable-card" tabindex="0" data-album="${album.id}" role="button" aria-label="查看${album.title}">
          <img src="${cover.src}" alt="${album.title}" loading="lazy" />
          <div class="album-body">
            <p class="eyebrow">${album.category}</p>
            <h3>${album.title}</h3>
            <p class="album-meta">${formatDate(album.date)}${album.place ? ` · ${album.place}` : ""}</p>
            <div class="tag-row">
              ${tag(`${album.photos} 张照片`)}
              ${album.videos ? tag(`${album.videos} 个视频`) : ""}
              ${tag(album.mood)}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-album]").forEach((card) => {
    card.addEventListener("click", () => selectAlbum(card.dataset.album));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") selectAlbum(card.dataset.album);
    });
  });
};

const renderChips = (data) => {
  const chips = document.getElementById("filter-chips");
  const categories = ["全部", ...data.categories.map((item) => item.name)];
  chips.innerHTML = categories
    .map((name) => `<button class="chip${name === state.category ? " active" : ""}" type="button" data-category="${name}">${name}</button>`)
    .join("");
  chips.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      state.albumId = "全部";
      renderChips(state.data);
      renderGallery();
    });
  });
};

const itemMatches = (item) => {
  const albumMatch = state.albumId === "全部" || item.albumId === state.albumId;
  const categoryMatch = state.category === "全部" || item.category === state.category;
  const query = state.query.trim().toLowerCase();
  if (!query) return albumMatch && categoryMatch;
  const haystack = [item.title, item.albumTitle, item.category, item.mood, item.place, item.date, item.originalPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return albumMatch && categoryMatch && haystack.includes(query);
};

const renderGallery = () => {
  const masonry = document.getElementById("masonry");
  const items = flattenItems(state.data.albums).filter(itemMatches);
  const album = currentAlbum();
  const activeText = album
    ? `正在浏览「${album.title}」合集 · ${items.length} 张`
    : state.category === "全部"
      ? `正在浏览全部记忆 · ${items.length} 张`
      : `正在浏览「${state.category}」 · ${items.length} 张`;
  setText("active-filter", activeText);

  masonry.innerHTML = items
    .map((item) => {
      const media =
        item.type === "video"
          ? `<video src="${item.src}" muted controls preload="metadata"></video>`
          : `<img src="${item.src}" alt="${item.title}" loading="lazy" />`;
      return `
        <figure class="photo-card" tabindex="0" data-id="${item.id}">
          ${media}
          <figcaption>
            ${item.albumTitle} · ${formatDate(item.date)}
          </figcaption>
        </figure>
      `;
    })
    .join("");

  masonry.querySelectorAll(".photo-card").forEach((card) => {
    card.addEventListener("click", () => openLightbox(card.dataset.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openLightbox(card.dataset.id);
    });
  });
};

const openLightbox = (id) => {
  const item = flattenItems(state.data.albums).find((entry) => entry.id === id);
  if (!item) return;

  const media = document.getElementById("lightbox-media");
  media.innerHTML =
    item.type === "video"
      ? `<video src="${item.src}" controls autoplay></video>`
      : `<img src="${item.src}" alt="${item.title}" />`;
  setText("lightbox-title", item.albumTitle);
  setText("lightbox-detail", `${formatDate(item.date)} · ${item.category}`);
  document.getElementById("lightbox").showModal();
};

const addLocalAlbum = (title, date, files) => {
  const albumId = `local-${Date.now()}`;
  const items = Array.from(files).map((file, index) => {
    const src = URL.createObjectURL(file);
    state.objectUrls.push(src);
    return {
      id: `${albumId}-${index + 1}`,
      type: "image",
      title: title,
      src,
      originalPath: "",
      date: date || new Date().toISOString().slice(0, 10),
      year: (date || new Date().toISOString()).slice(0, 4),
      bytes: file.size,
    };
  });

  if (!items.length) return;

  state.data.albums.unshift({
    id: albumId,
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
  });

  if (!state.data.categories.some((item) => item.name === "她的上传")) {
    state.data.categories.push({ name: "她的上传", count: items.length });
  }

  state.data.stats.albums += 1;
  state.data.stats.photos += items.length;
  state.data.stats.displayItems += items.length;
  renderStats(state.data);
  renderTimeline(state.data.albums);
  renderAlbums(state.data.albums);
  renderChips(state.data);
  selectAlbum(albumId);
};

const bindGalleryEvents = () => {
  document.getElementById("search-input").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderGallery();
  });

  document.getElementById("close-lightbox").addEventListener("click", () => {
    document.getElementById("lightbox").close();
  });

  document.getElementById("local-album-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = document.getElementById("local-album-title").value.trim();
    const date = document.getElementById("local-album-date").value;
    const files = document.getElementById("local-album-files").files;
    addLocalAlbum(title || "她的新合集", date, files);
    event.currentTarget.reset();
  });
};

const initGallery = () => {
  bindGalleryEvents();
  renderStats(state.data);
  renderTimeline(state.data.albums);
  renderAlbums(state.data.albums);
  renderChips(state.data);
  renderGallery();
  state.initialized = true;
  document.getElementById("auth-error").textContent = "";
};

const init = () => {
  bindAuth();
  document.getElementById("password-input").focus();
};

init();
