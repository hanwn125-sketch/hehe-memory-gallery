const STORAGE_KEY = "tianjin-food-map-shops-v1";
const TIANJIN_CENTER = [39.0851, 117.1994];
const TIANJIN_BOUNDS = [
  [38.55, 116.68],
  [40.26, 118.05],
];
const FILTERS = ["全部", "想吃", "已吃", "很推荐", "一般"];

if (new URLSearchParams(window.location.search).get("embedded") === "1") {
  document.documentElement.classList.add("embedded");
}

const sampleShops = [
  {
    id: "sample-guiyuan",
    name: "桂园餐厅",
    place: "和平区成都道",
    dishes: "八珍豆腐, 黑蒜子牛肉粒, 老爆三",
    status: "很推荐",
    rating: 5,
    note: "适合正式一点的天津菜小聚，早点去排队更舒服。",
    lat: 39.1174,
    lng: 117.1989,
    createdAt: "2026-05-29T00:00:00.000Z",
  },
  {
    id: "sample-breakfast",
    name: "西北角早点",
    place: "红桥区西北角",
    dishes: "锅巴菜, 老豆腐, 糖皮儿",
    status: "想吃",
    rating: 5,
    note: "留给某个早起成功的周末。",
    lat: 39.1469,
    lng: 117.1832,
    createdAt: "2026-05-29T00:00:00.000Z",
  },
  {
    id: "sample-river",
    name: "海河边小馆",
    place: "意式风情区附近",
    dishes: "炸虾, 面包诱惑, 酸梅汤",
    status: "已吃",
    rating: 4,
    note: "吃完可以沿海河散步，氛围比菜单更重要。",
    lat: 39.1366,
    lng: 117.2023,
    createdAt: "2026-05-29T00:00:00.000Z",
  },
];

const state = {
  shops: [],
  markers: new Map(),
  draftMarker: null,
  selectedLatLng: null,
  filter: "全部",
  query: "",
  activeShopId: null,
  tileErrors: 0,
};

const elements = {
  form: document.getElementById("shop-form"),
  id: document.getElementById("shop-id"),
  name: document.getElementById("shop-name"),
  place: document.getElementById("shop-place"),
  dishes: document.getElementById("shop-dishes"),
  status: document.getElementById("shop-status"),
  rating: document.getElementById("shop-rating"),
  note: document.getElementById("shop-note"),
  coordinate: document.getElementById("shop-coordinate"),
  formTitle: document.getElementById("form-title"),
  formHint: document.getElementById("form-hint"),
  reset: document.getElementById("reset-form"),
  delete: document.getElementById("delete-shop"),
  list: document.getElementById("shop-list"),
  filters: document.getElementById("filter-pills"),
  search: document.getElementById("search-input"),
  export: document.getElementById("export-button"),
  placeSearch: document.getElementById("place-search"),
  placeSearchButton: document.getElementById("place-search-button"),
  mapStatus: document.getElementById("map-status"),
  dialog: document.getElementById("shop-dialog"),
  dialogClose: document.getElementById("dialog-close"),
  dialogStatus: document.getElementById("dialog-status"),
  dialogName: document.getElementById("dialog-name"),
  dialogPlace: document.getElementById("dialog-place"),
  dialogDishes: document.getElementById("dialog-dishes"),
  dialogNote: document.getElementById("dialog-note"),
  dialogEdit: document.getElementById("dialog-edit"),
  dialogCenter: document.getElementById("dialog-center"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmCopy: document.getElementById("confirm-copy"),
  confirmDelete: document.getElementById("confirm-delete"),
  confirmCancel: document.getElementById("confirm-cancel"),
};

const map = L.map("food-map", {
  zoomControl: false,
  maxBounds: TIANJIN_BOUNDS,
  maxBoundsViscosity: 0.8,
}).setView(TIANJIN_CENTER, 12);

L.control.zoom({ position: "bottomright" }).addTo(map);

const baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});

const softLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
});

baseLayer.addTo(map);

baseLayer.on("tileerror", () => {
  state.tileErrors += 1;
  if (state.tileErrors === 4) {
    setMapStatus("地图图块加载不完整，正在切换备用底图。");
    map.removeLayer(baseLayer);
    softLayer.addTo(map);
  }
});

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const clean = (value, max) => String(value || "").trim().slice(0, max);

const createId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `shop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const setMapStatus = (message) => {
  elements.mapStatus.textContent = message;
};

const refreshMapSize = () => {
  map.invalidateSize({ animate: false, pan: false });
};

const saveShops = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.shops));
};

const loadShops = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    state.shops = sampleShops;
    saveShops();
    return;
  }

  try {
    const parsed = JSON.parse(stored);
    state.shops = Array.isArray(parsed) ? parsed.filter((shop) => Number.isFinite(shop.lat) && Number.isFinite(shop.lng)) : [];
  } catch {
    state.shops = sampleShops;
    saveShops();
  }
};

const formatCoordinate = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

const ratingText = (rating) => "★".repeat(rating) + "☆".repeat(5 - rating);

const getPinLabel = (status) => {
  if (status === "想吃") return "想";
  if (status === "很推荐") return "荐";
  if (status === "一般") return "记";
  return "吃";
};

const createIcon = (status) =>
  L.divIcon({
    className: "",
    html: `<div class="food-pin" data-status="${escapeHtml(status)}"><span>${getPinLabel(status)}</span></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -34],
  });

const createDraftIcon = () =>
  L.divIcon({
    className: "",
    html: `<div class="draft-pin">+</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const readableAddress = (item) => {
  const address = item.address || {};
  return [
    item.name,
    address.road,
    address.neighbourhood || address.suburb,
    address.city_district || address.district,
    address.city,
  ]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(" · ");
};

const popupHtml = (shop) => `
  <div class="popup-card">
    <span class="status-badge" data-status="${escapeHtml(shop.status)}">${escapeHtml(shop.status)} · ${ratingText(shop.rating)}</span>
    <strong>${escapeHtml(shop.name)}</strong>
    <p>${escapeHtml(shop.place || "未记录区域")}</p>
    <button type="button" data-popup-shop="${escapeHtml(shop.id)}">查看记录</button>
  </div>
`;

const renderMarkers = () => {
  state.markers.forEach((marker) => marker.remove());
  state.markers.clear();

  state.shops.forEach((shop) => {
    const marker = L.marker([shop.lat, shop.lng], { icon: createIcon(shop.status) })
      .addTo(map)
      .bindPopup(popupHtml(shop));
    marker.on("click", () => {
      state.activeShopId = shop.id;
    });
    marker.on("popupopen", () => {
      const popup = marker.getPopup()?.getElement();
      const button = popup?.querySelector("[data-popup-shop]");
      if (button) button.addEventListener("click", () => openShopDialog(shop.id));
    });
    state.markers.set(shop.id, marker);
  });
};

const shopMatches = (shop) => {
  const filterMatch = state.filter === "全部" || shop.status === state.filter;
  const query = state.query.trim().toLowerCase();
  if (!query) return filterMatch;
  const haystack = [shop.name, shop.place, shop.dishes, shop.note, shop.status].join(" ").toLowerCase();
  return filterMatch && haystack.includes(query);
};

const renderFilters = () => {
  elements.filters.innerHTML = FILTERS.map(
    (filter) => `<button class="${filter === state.filter ? "active" : ""}" type="button" data-filter="${filter}">${filter}</button>`,
  ).join("");

  elements.filters.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderFilters();
      renderList();
    });
  });
};

const renderList = () => {
  const shops = state.shops.filter(shopMatches);

  if (!shops.length) {
    elements.list.innerHTML = `<div class="empty-state">还没有匹配的店。可以点击地图新增一家，或者换个筛选条件。</div>`;
    return;
  }

  elements.list.innerHTML = shops
    .map(
      (shop) => `
        <button class="shop-card" type="button" data-shop-id="${escapeHtml(shop.id)}">
          <span class="status-badge" data-status="${escapeHtml(shop.status)}">${escapeHtml(shop.status)} · ${ratingText(shop.rating)}</span>
          <strong>${escapeHtml(shop.name)}</strong>
          <span>${escapeHtml(shop.place || "未记录区域")}</span>
          <small>${escapeHtml(shop.dishes || "还没写推荐菜")}</small>
        </button>
      `,
    )
    .join("");

  elements.list.querySelectorAll(".shop-card").forEach((card) => {
    card.addEventListener("click", () => {
      const shop = getShop(card.dataset.shopId);
      if (!shop) return;
      map.flyTo([shop.lat, shop.lng], Math.max(map.getZoom(), 15));
      state.markers.get(shop.id)?.openPopup();
      openShopDialog(shop.id);
    });
  });
};

const getShop = (id) => state.shops.find((shop) => shop.id === id);

const setSelectedCoordinate = (lat, lng) => {
  state.selectedLatLng = { lat, lng };
  elements.coordinate.value = formatCoordinate(lat, lng);

  if (!state.draftMarker) {
    state.draftMarker = L.marker([lat, lng], { icon: createDraftIcon(), zIndexOffset: 900 }).addTo(map);
  } else {
    state.draftMarker.setLatLng([lat, lng]);
  }
};

const resetForm = () => {
  elements.form.reset();
  elements.id.value = "";
  elements.rating.value = "5";
  elements.status.value = "想吃";
  elements.coordinate.value = "";
  elements.formTitle.textContent = "新增店铺";
  elements.formHint.textContent = "点击地图选择位置，再记录推荐菜。";
  elements.delete.hidden = true;
  state.selectedLatLng = null;
  state.activeShopId = null;
  if (state.draftMarker) {
    state.draftMarker.remove();
    state.draftMarker = null;
  }
};

const reverseLookup = async (lat, lng) => {
  setMapStatus("正在识别这个位置...");

  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lng),
      zoom: "18",
      addressdetails: "1",
      "accept-language": "zh-CN",
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
    if (!response.ok) throw new Error("reverse lookup failed");

    const result = await response.json();
    const address = readableAddress(result) || result.display_name || "";
    if (address && !elements.place.value.trim()) {
      elements.place.value = clean(address, 70);
    }
    setMapStatus(address ? `已选中：${address}` : `已选中坐标：${formatCoordinate(lat, lng)}`);
  } catch {
    setMapStatus(`已选中坐标：${formatCoordinate(lat, lng)}。地址识别暂时不可用，可以手动填写区域。`);
  }
};

const chooseLocation = async (lat, lng, label = "") => {
  resetForm();
  setSelectedCoordinate(lat, lng);
  elements.formHint.textContent = "位置已选好，可以填写店名和菜品。";
  if (label) {
    elements.place.value = clean(label, 70);
    setMapStatus(`已选中：${label}`);
  } else {
    await reverseLookup(lat, lng);
  }
  elements.name.focus();
};

const fillForm = (shop) => {
  elements.id.value = shop.id;
  elements.name.value = shop.name;
  elements.place.value = shop.place || "";
  elements.dishes.value = shop.dishes || "";
  elements.status.value = shop.status;
  elements.rating.value = shop.rating;
  elements.note.value = shop.note || "";
  setSelectedCoordinate(shop.lat, shop.lng);
  elements.formTitle.textContent = "编辑店铺";
  elements.formHint.textContent = "正在编辑已保存的位置。";
  elements.delete.hidden = false;
  state.activeShopId = shop.id;
  if (state.draftMarker) {
    state.draftMarker.remove();
    state.draftMarker = null;
  }
};

const upsertShop = (event) => {
  event.preventDefault();

  if (!state.selectedLatLng) {
    elements.formHint.textContent = "先点击地图选择店铺位置。";
    return;
  }

  const rating = Math.max(1, Math.min(5, Number(elements.rating.value || 5)));
  const id = elements.id.value || createId();
  const shop = {
    id,
    name: clean(elements.name.value, 40),
    place: clean(elements.place.value, 70),
    dishes: clean(elements.dishes.value, 160),
    status: elements.status.value,
    rating,
    note: clean(elements.note.value, 220),
    lat: state.selectedLatLng.lat,
    lng: state.selectedLatLng.lng,
    createdAt: getShop(id)?.createdAt || new Date().toISOString(),
  };

  if (!shop.name) return;

  const index = state.shops.findIndex((item) => item.id === id);
  if (index >= 0) {
    state.shops[index] = shop;
  } else {
    state.shops.unshift(shop);
  }

  saveShops();
  renderMarkers();
  renderList();
  fillForm(shop);
  map.flyTo([shop.lat, shop.lng], Math.max(map.getZoom(), 15));
  state.markers.get(shop.id)?.openPopup();
};

const deleteActiveShop = () => {
  const id = elements.id.value;
  if (!id) return;
  const shop = getShop(id);
  if (!shop) return;

  elements.confirmCopy.textContent = `确认删除「${shop.name}」吗？删除后，这家店铺会从地图和列表里移除。`;
  elements.confirmDialog.showModal();
};

const confirmDeleteActiveShop = () => {
  const id = elements.id.value;
  if (!id) return;

  state.shops = state.shops.filter((item) => item.id !== id);
  saveShops();
  renderMarkers();
  renderList();
  resetForm();
  if (elements.dialog.open) elements.dialog.close();
  if (elements.confirmDialog.open) elements.confirmDialog.close();
};

const openShopDialog = (id) => {
  const shop = getShop(id);
  if (!shop) return;

  state.activeShopId = id;
  elements.dialogStatus.textContent = `${shop.status} · ${ratingText(shop.rating)}`;
  elements.dialogName.textContent = shop.name;
  elements.dialogPlace.textContent = shop.place || "还没记录区域";
  elements.dialogDishes.innerHTML = (shop.dishes || "还没写推荐菜")
    .split(/[,，、]/)
    .map((dish) => dish.trim())
    .filter(Boolean)
    .map((dish) => `<span>${escapeHtml(dish)}</span>`)
    .join("");
  elements.dialogNote.textContent = shop.note || "还没写备注。";
  elements.dialog.showModal();
};

const exportRecords = () => {
  const content = JSON.stringify(state.shops, null, 2);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tianjin-food-map.json";
  link.click();
  URL.revokeObjectURL(url);
};

const searchPlace = async () => {
  const query = clean(elements.placeSearch.value, 80);
  if (!query) {
    setMapStatus("输入一个天津地点、店名或地址再搜索。");
    return;
  }

  setMapStatus("正在搜索天津范围内的位置...");

  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      q: `${query} 天津`,
      limit: "1",
      addressdetails: "1",
      bounded: "1",
      viewbox: "116.68,40.26,118.05,38.55",
      "accept-language": "zh-CN",
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!response.ok) throw new Error("search failed");

    const results = await response.json();
    if (!results.length) {
      setMapStatus("没有搜到这个位置。可以换个更具体的店名、路名或商圈。");
      return;
    }

    const result = results[0];
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    const label = readableAddress(result) || result.display_name || query;
    map.flyTo([lat, lng], 16);
    await chooseLocation(lat, lng, label);
  } catch {
    setMapStatus("搜索服务暂时不可用。你仍然可以直接在地图上点击位置。");
  }
};

const bindEvents = () => {
  map.on("click", (event) => {
    chooseLocation(event.latlng.lat, event.latlng.lng);
  });

  elements.form.addEventListener("submit", upsertShop);
  elements.reset.addEventListener("click", resetForm);
  elements.delete.addEventListener("click", deleteActiveShop);
  elements.confirmDelete.addEventListener("click", confirmDeleteActiveShop);
  elements.confirmCancel.addEventListener("click", () => elements.confirmDialog.close());
  elements.search.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderList();
  });
  elements.placeSearchButton.addEventListener("click", searchPlace);
  elements.placeSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlace();
    }
  });
  elements.export.addEventListener("click", exportRecords);
  elements.dialogClose.addEventListener("click", () => elements.dialog.close());
  elements.dialogEdit.addEventListener("click", () => {
    const shop = getShop(state.activeShopId);
    if (!shop) return;
    fillForm(shop);
    elements.dialog.close();
    document.querySelector(".side-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  elements.dialogCenter.addEventListener("click", () => {
    const shop = getShop(state.activeShopId);
    if (!shop) return;
    map.flyTo([shop.lat, shop.lng], 16);
    state.markers.get(shop.id)?.openPopup();
    elements.dialog.close();
  });
};

const init = () => {
  loadShops();
  bindEvents();
  renderFilters();
  renderMarkers();
  renderList();
  requestAnimationFrame(refreshMapSize);
  setTimeout(refreshMapSize, 150);
  setTimeout(refreshMapSize, 500);
};

init();

window.addEventListener("load", refreshMapSize);
window.addEventListener("resize", refreshMapSize);
