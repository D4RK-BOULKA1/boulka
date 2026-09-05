import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, addDoc, doc, getDoc, setDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, updateDoc, deleteDoc, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CATEGORIES = ["High-tech", "Mode", "Maison", "Sport", "Loisirs", "Autres"];
const THUMB_COLORS = { "High-tech": "#2A55FF", "Mode": "#B5533C", "Maison": "#4A6C6F", "Sport": "#1B3AC4", "Loisirs": "#6B4B5C", "Autres": "#5A6B85" };
const SHIPPING_LABEL = { both: "Main propre ou envoi", hand: "Main propre uniquement", ship: "Envoi uniquement" };
const COUNTRIES = ["France", "Belgique", "Mali", "Côte d'Ivoire", "Sénégal", "Cameroun", "Suisse", "Canada", "Autre"];
const EUR_TO_XOF = 655.957;
const MAX_PHOTOS = 5;

let currentUser = null;
let currentUserProfile = null;
let allProducts = [];
let allReviews = []; // toutes les reviews (pour calcul des moyennes vendeurs)
let activeCategory = "Tout";
let searchTerm = "";
let currentProductId = null;
let currentProductPhotoIndex = 0;
let currentChatId = null;
let currentChatMeta = null;
let reviewStarValue = 0;
let unsubProducts = null;
let unsubOffers = null;
let unsubNotif = null; // threads
let unsubReviews = null;
let unsubChatMessages = null;
let unsubAllReviews = null;
let pendingPhotos = []; // dataURLs, max 5
let checkoutProduct = null;
let authMode = "signin";
let theme = "light";

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const initials = (name) => (name || "?").trim().split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $(id).classList.add("active");
  $("bottom-nav").style.display = (id === "view-app") ? "flex" : "none";
}
function showAuthError(msg) { const el = $("auth-error"); el.textContent = msg; el.classList.add("show"); }
function clearAuthError() { $("auth-error").classList.remove("show"); }

function populateCountrySelects() {
  const opts = COUNTRIES.map(c => `<option value="${c}">${c}</option>`).join("");
  $("auth-country").innerHTML = opts;
  $("settings-country").innerHTML = opts;
  $("filter-country").innerHTML = `<option value="">Tous les pays</option>` + opts;
}
populateCountrySelects();

// ---------------- CURRENCY ----------------

function prefCurrency() { return currentUserProfile?.currency || "EUR"; }
function formatPrice(priceEUR) {
  const n = Number(priceEUR) || 0;
  if (prefCurrency() === "XOF") {
    return Math.round(n * EUR_TO_XOF).toLocaleString("fr-FR") + " FCFA";
  }
  return n.toFixed(2) + " €";
}

// ---------------- THEME ----------------

$("btn-theme-toggle").addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  $("theme-icon-path").setAttribute("d", theme === "light"
    ? "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"
    : "M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z");
});

// ---------------- FILTERS ----------------

$("btn-filter-toggle").addEventListener("click", () => $("filter-panel").classList.toggle("show"));
$("filter-country").addEventListener("change", renderGrid);
$("filter-price-min").addEventListener("input", renderGrid);
$("filter-price-max").addEventListener("input", renderGrid);
$("filter-top-rated").addEventListener("change", renderGrid);
$("btn-filter-clear").addEventListener("click", () => {
  $("filter-country").value = "";
  $("filter-price-min").value = "";
  $("filter-price-max").value = "";
  $("filter-top-rated").checked = false;
  renderGrid();
});

// ---------------- AUTH ----------------

$("btn-google").addEventListener("click", async () => {
  clearAuthError();
  try {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    await ensureUserProfile(cred.user, { accountType: "particulier" });
  } catch (e) {
    showAuthError(friendlyAuthError(e.code));
  }
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAuthError();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  const accountType = $("auth-account-type").value;
  const country = $("auth-country").value;
  const companyName = $("auth-company-name").value.trim();
  const siret = $("auth-siret").value.trim();
  const submitBtn = $("auth-submit");
  submitBtn.disabled = true;
  try {
    if (authMode === "signup") {
      if (accountType === "professionnel" && (!companyName || !siret)) {
        showAuthError("Nom d'entreprise et SIRET requis pour un compte professionnel.");
        submitBtn.disabled = false;
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(cred.user, { displayName: name });
      await ensureUserProfile(cred.user, {
        accountType, country,
        companyName: accountType === "professionnel" ? companyName : null,
        siret: accountType === "professionnel" ? siret : null
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (e) {
    showAuthError(friendlyAuthError(e.code));
  }
  submitBtn.disabled = false;
});

function genUserCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "BLK-" + s;
}

async function ensureUserProfile(user, defaults) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || user.email,
      email: user.email,
      accountType: defaults.accountType || "particulier",
      companyName: defaults.companyName || null,
      siret: defaults.siret || null,
      country: defaults.country || null,
      currency: "EUR",
      whatsapp: null,
      userCode: genUserCode(),
      createdAt: serverTimestamp()
    });
  }
}

function friendlyAuthError(code) {
  const map = {
    "auth/email-already-in-use": "Un compte existe déjà avec cet email.",
    "auth/invalid-email": "Adresse email invalide.",
    "auth/weak-password": "Le mot de passe doit faire au moins 6 caractères.",
    "auth/user-not-found": "Aucun compte avec cet email.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Email ou mot de passe incorrect.",
    "auth/popup-closed-by-user": "Connexion Google annulée.",
    "auth/unauthorized-domain": "Ce domaine n'est pas autorisé dans Firebase (Authentication > Settings > Authorized domains)."
  };
  return map[code] || "Une erreur est survenue. Réessaie.";
}

$("auth-switch-btn").addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  clearAuthError();
  const isSignup = authMode === "signup";
  $("field-name").style.display = isSignup ? "block" : "none";
  $("field-name-row2").style.display = isSignup ? "flex" : "none";
  $("field-pro").style.display = isSignup && $("auth-account-type").value === "professionnel" ? "flex" : "none";
  $("auth-submit").textContent = isSignup ? "Créer mon compte" : "Se connecter";
  $("auth-switch-text").textContent = isSignup ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("auth-switch-btn").textContent = isSignup ? "Se connecter" : "Créer un compte";
});

$("auth-account-type").addEventListener("change", (e) => {
  $("field-pro").style.display = e.target.value === "professionnel" ? "flex" : "none";
});

$("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  $("loading-screen").style.display = "none";
  if (user) {
    await ensureUserProfile(user, {});
    const snap = await getDoc(doc(db, "users", user.uid));
    currentUserProfile = snap.exists() ? snap.data() : null;
    renderAvatar(user);
    showView("view-app");
    switchTab("home");
    listenProducts();
    listenThreads();
    listenAllReviews();
    fillSettingsForm();
  } else {
    if (unsubProducts) unsubProducts();
    if (unsubNotif) unsubNotif();
    if (unsubAllReviews) unsubAllReviews();
    showView("view-auth");
  }
});

function renderAvatar(user) {
  document.querySelectorAll(".js-user-avatar").forEach(n => {
    if (user.photoURL) n.innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    else n.textContent = initials(user.displayName || user.email);
  });
}

// ---------------- ACCOUNT SETTINGS ----------------

function fillSettingsForm() {
  if (!currentUserProfile) return;
  $("settings-country").value = currentUserProfile.country || "France";
  $("settings-currency").value = currentUserProfile.currency || "EUR";
  $("settings-whatsapp-2").value = currentUserProfile.whatsapp || "";
  $("whatsapp-banner").style.display = currentUserProfile.whatsapp ? "none" : "block";
  $("profile-code").textContent = currentUserProfile.userCode ? ("ID : " + currentUserProfile.userCode) : "";
}

async function saveSettings(whatsappOnly) {
  const data = {
    country: $("settings-country").value,
    currency: $("settings-currency").value,
    whatsapp: (whatsappOnly ? $("settings-whatsapp").value : $("settings-whatsapp-2").value).trim() || null
  };
  await updateDoc(doc(db, "users", currentUser.uid), data);
  currentUserProfile = { ...currentUserProfile, ...data };
  fillSettingsForm();
  renderGrid();
  renderProfileListings();
  showToast("Paramètres enregistrés");
}
$("btn-save-settings").addEventListener("click", () => saveSettings(false));
$("btn-save-whatsapp").addEventListener("click", () => saveSettings(true));

// ---------------- PRODUCTS ----------------

function listenProducts() {
  $("product-grid").innerHTML = skeletonGridHtml(6);
  const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
  unsubProducts = onSnapshot(q, (snap) => {
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryChips();
    renderGrid();
    renderProfileListings();
  }, (err) => {
    console.error(err);
    $("product-grid").innerHTML = "";
    $("empty-state").style.display = "block";
    $("empty-state").querySelector("h3").textContent = "Impossible de charger les annonces";
    $("empty-state").querySelector("p").textContent = "Vérifie ta connexion ou réessaie dans un instant.";
    showToast("Erreur de chargement — vérifie ta config Firebase");
  });
}

function renderCategoryChips() {
  const row = $("category-row");
  row.innerHTML = "";
  ["Tout", ...CATEGORIES].forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "pill" + (cat === activeCategory ? " active" : "");
    btn.textContent = cat;
    btn.addEventListener("click", () => { activeCategory = cat; renderCategoryChips(); renderGrid(); });
    row.appendChild(btn);
  });
}
document.querySelectorAll(".tile[data-cat]").forEach(t => t.addEventListener("click", () => {
  activeCategory = t.dataset.cat; renderCategoryChips(); renderGrid();
  window.scrollTo({ top: document.getElementById("product-grid").offsetTop - 100, behavior: "smooth" });
}));

$("search-input").addEventListener("input", (e) => { searchTerm = e.target.value.toLowerCase(); renderGrid(); });
$("btn-nav-search").addEventListener("click", () => { switchTab("home"); $("search-input").focus(); });

function sellerAvg(sellerId) {
  const rows = allReviews.filter(r => r.sellerId === sellerId);
  if (rows.length === 0) return null;
  const avg = rows.reduce((s, r) => s + r.rating, 0) / rows.length;
  return { avg, count: rows.length };
}

function renderGrid() {
  let list = allProducts;
  if (activeCategory !== "Tout") list = list.filter(p => p.category === activeCategory);
  if (searchTerm) list = list.filter(p => (p.title + " " + p.description).toLowerCase().includes(searchTerm));
  const country = $("filter-country").value;
  if (country) list = list.filter(p => p.sellerCountry === country);
  const min = parseFloat($("filter-price-min").value);
  const max = parseFloat($("filter-price-max").value);
  if (!isNaN(min)) list = list.filter(p => Number(p.price) >= min);
  if (!isNaN(max)) list = list.filter(p => Number(p.price) <= max);
  if ($("filter-top-rated").checked) {
    list = list.filter(p => { const r = sellerAvg(p.sellerId); return r && r.avg >= 5; });
  }
  $("result-count").textContent = list.length + (list.length > 1 ? " articles" : " article");
  const grid = $("product-grid");
  const empty = $("empty-state");
  if (list.length === 0) { grid.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  grid.innerHTML = list.map(productCardHtml).join("");
  grid.querySelectorAll(".product-card").forEach(card => card.addEventListener("click", () => openProduct(card.dataset.id)));
}

function starsHtml(avg) {
  const rounded = Math.round(avg);
  return "★".repeat(rounded) + "☆".repeat(5 - rounded);
}

function productCardHtml(p) {
  const color = THUMB_COLORS[p.category] || "#2A55FF";
  const photos = p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
  const thumb = photos[0] ? `<img src="${photos[0]}" alt="">` : escapeHtml(p.title);
  const r = sellerAvg(p.sellerId);
  return `
    <div class="product-card" data-id="${p.id}">
      ${p.condition ? `<span class="condition-badge">${escapeHtml(p.condition)}</span>` : ""}
      ${p.sellerIsPro ? `<span class="pro-badge">PRO</span>` : ""}
      <div class="product-thumb" style="background:${color}">${thumb}${photos.length > 1 ? `<span class="photo-count-badge">1/${photos.length}</span>` : ""}</div>
      <div class="product-card-body">
        <div class="product-title">${escapeHtml(p.title)}</div>
        <div class="product-meta">${escapeHtml(p.category)}${p.sellerCountry ? " · " + escapeHtml(p.sellerCountry) : ""}</div>
        <div class="product-price">${formatPrice(p.price)}</div>
        ${r ? `<div class="product-stars">${starsHtml(r.avg)} (${r.count})</div>` : ""}
      </div>
    </div>`;
}

function skeletonGridHtml(count) {
  return Array.from({ length: count }).map(() => `
    <div class="skeleton-card">
      <div class="skeleton-thumb"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </div>`).join("");
}

// ---------------- SELL ----------------

$("btn-nav-sell").addEventListener("click", openSellForm);
$("btn-open-sell-hero").addEventListener("click", openSellForm);
$("btn-open-sell-2").addEventListener("click", openSellForm);
$("btn-back-sell").addEventListener("click", () => { showView("view-app"); switchTab("home"); });

function openSellForm() {
  if (!currentUserProfile?.whatsapp) {
    showToast("Ajoute ton numéro WhatsApp dans Compte avant de publier une annonce");
    switchTab("account");
    return;
  }
  $("sell-form").reset();
  pendingPhotos = [];
  renderPhotoRow();
  $("sell-category").innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  showView("view-sell");
}

function renderPhotoRow() {
  const row = $("photo-row");
  let html = "";
  pendingPhotos.forEach((src, i) => {
    html += `<div class="photo-slot"><img src="${src}"><div class="remove-x" data-remove="${i}">✕</div></div>`;
  });
  if (pendingPhotos.length < MAX_PHOTOS) {
    html += `
      <div class="photo-slot">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="22" height="22"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M21 16l-4.5-4.5a2 2 0 0 0-2.8 0L5 21"/></svg>
        <input type="file" id="photo-input" accept="image/*">
      </div>`;
  }
  row.innerHTML = html;
  const input = $("photo-input");
  if (input) {
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await compressImage(file);
      pendingPhotos.push(dataUrl);
      renderPhotoRow();
    });
  }
  row.querySelectorAll("[data-remove]").forEach(x => x.addEventListener("click", (ev) => {
    ev.stopPropagation();
    pendingPhotos.splice(Number(x.dataset.remove), 1);
    renderPhotoRow();
  }));
}

function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = () => {
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    reader.readAsDataURL(file);
  });
}

$("sell-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("sell-title").value.trim();
  const price = parseFloat($("sell-price").value);
  const category = $("sell-category").value;
  const condition = $("sell-condition").value;
  const shipping = $("sell-shipping").value;
  const description = $("sell-description").value.trim();
  if (!title || !price || price <= 0) { showToast("Titre et prix requis"); return; }
  if (pendingPhotos.length === 0) { showToast("Ajoute au moins une photo"); return; }

  const btn = $("sell-submit");
  btn.disabled = true;
  btn.textContent = "Publication...";
  try {
    await addDoc(collection(db, "products"), {
      title, price, category, condition, shipping, description,
      photos: pendingPhotos,
      sellerId: currentUser.uid,
      sellerName: currentUser.displayName || currentUser.email,
      sellerPhoto: currentUser.photoURL || null,
      sellerIsPro: currentUserProfile?.accountType === "professionnel",
      sellerCountry: currentUserProfile?.country || null,
      sellerWhatsapp: currentUserProfile?.whatsapp || null,
      createdAt: serverTimestamp()
    });
    showView("view-app");
    switchTab("home");
    showToast("Annonce publiée ! Visible par tous les utilisateurs.");
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de la publication");
  }
  btn.disabled = false;
  btn.textContent = "Publier l'annonce";
});

// ---------------- PRODUCT DETAIL ----------------

async function openProduct(id) {
  currentProductId = id;
  currentProductPhotoIndex = 0;
  const snap = await getDoc(doc(db, "products", id));
  if (!snap.exists()) { showToast("Cette annonce n'existe plus"); return; }
  const p = { id: snap.id, ...snap.data() };
  renderProductDetail(p);
  showView("view-detail");
  listenOffers(id, p);
  listenProductReviews(p.sellerId);
}

function renderCarousel(photos, color) {
  const track = $("detail-photo-track");
  track.innerHTML = photos.length
    ? photos.map(src => `<div class="slide" style="background:${color}"><img src="${src}"></div>`).join("")
    : `<div class="slide" style="background:${color}">Pas de photo</div>`;
  track.style.transform = `translateX(-${currentProductPhotoIndex * 100}%)`;
  const dots = $("carousel-dots");
  dots.innerHTML = photos.length > 1 ? photos.map((_, i) => `<span class="${i === currentProductPhotoIndex ? "active" : ""}"></span>`).join("") : "";
  $("carousel-prev").style.display = photos.length > 1 ? "flex" : "none";
  $("carousel-next").style.display = photos.length > 1 ? "flex" : "none";
}
$("carousel-prev").addEventListener("click", () => {
  const photos = $("detail-photo-track").children.length;
  if (photos < 2) return;
  currentProductPhotoIndex = (currentProductPhotoIndex - 1 + photos) % photos;
  updateCarouselPosition();
});
$("carousel-next").addEventListener("click", () => {
  const photos = $("detail-photo-track").children.length;
  if (photos < 2) return;
  currentProductPhotoIndex = (currentProductPhotoIndex + 1) % photos;
  updateCarouselPosition();
});
function updateCarouselPosition() {
  $("detail-photo-track").style.transform = `translateX(-${currentProductPhotoIndex * 100}%)`;
  $("carousel-dots").querySelectorAll("span").forEach((d, i) => d.classList.toggle("active", i === currentProductPhotoIndex));
}
// swipe tactile
let touchStartX = null;
$("detail-photo-track").addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; });
$("detail-photo-track").addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const total = $("detail-photo-track").children.length;
  if (total > 1) {
    if (dx < -40) { currentProductPhotoIndex = (currentProductPhotoIndex + 1) % total; updateCarouselPosition(); }
    else if (dx > 40) { currentProductPhotoIndex = (currentProductPhotoIndex - 1 + total) % total; updateCarouselPosition(); }
  }
  touchStartX = null;
});

function whatsappLink(number, text) {
  const digits = (number || "").replace(/[^\d+]/g, "").replace(/^00/, "+");
  return `https://wa.me/${digits.replace("+", "")}?text=${encodeURIComponent(text)}`;
}

function renderProductDetail(p) {
  const color = THUMB_COLORS[p.category] || "#2A55FF";
  const isOwner = currentUser && p.sellerId === currentUser.uid;
  const photos = p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
  renderCarousel(photos, color);
  $("detail-cat").textContent = p.category;
  $("detail-title").textContent = p.title;
  $("detail-price").textContent = formatPrice(p.price);
  $("detail-condition").textContent = p.condition || "";
  $("detail-condition").style.display = p.condition ? "inline-block" : "none";
  $("detail-shipping").textContent = SHIPPING_LABEL[p.shipping] || "";
  $("detail-shipping").style.display = p.shipping ? "inline-block" : "none";
  $("detail-country").textContent = p.sellerCountry || "";
  $("detail-country").style.display = p.sellerCountry ? "inline-block" : "none";
  $("detail-desc").textContent = p.description || "Pas de description.";
  $("detail-owner-badge").style.display = isOwner ? "inline-block" : "none";
  $("detail-seller-avatar").innerHTML = p.sellerPhoto
    ? `<img src="${p.sellerPhoto}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : initials(p.sellerName);
  $("detail-seller-name").textContent = p.sellerName + (p.sellerIsPro ? " · Pro" : "");
  $("detail-seller-sub").textContent = "Vendeur";
  $("detail-buy-actions").style.display = isOwner ? "none" : "flex";
  $("offer-form-wrap").style.display = isOwner ? "none" : "block";
  $("review-form-wrap").style.display = isOwner ? "none" : "block";
  $("offer-amount").value = "";
  reviewStarValue = 0;
  renderStarInput();
  $("review-comment").value = "";
  $("btn-delete-product").style.display = isOwner ? "flex" : "none";

  const waBtn = $("detail-whatsapp-btn");
  if (!isOwner && p.sellerWhatsapp) {
    waBtn.style.display = "flex";
    waBtn.href = whatsappLink(p.sellerWhatsapp, `Bonjour, je suis intéressé(e) par "${p.title}" sur BOULKA.`);
  } else {
    waBtn.style.display = "none";
  }
}

$("btn-back-detail").addEventListener("click", () => {
  showView("view-app");
  switchTab(document.querySelector(".bottom-nav button.active")?.dataset.tab || "home");
});

$("btn-delete-product").addEventListener("click", async () => {
  if (!confirm("Supprimer définitivement cette annonce ?")) return;
  try {
    await deleteDoc(doc(db, "products", currentProductId));
    showToast("Annonce supprimée");
    showView("view-app");
    switchTab("account");
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de la suppression");
  }
});

$("offer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat($("offer-amount").value);
  if (!amount || amount <= 0) return;
  const psnap = await getDoc(doc(db, "products", currentProductId));
  const p = psnap.data();
  await addDoc(collection(db, "products", currentProductId, "offers"), {
    buyerId: currentUser.uid,
    buyerName: currentUser.displayName || currentUser.email,
    sellerId: p.sellerId,
    productTitle: p.title,
    amount,
    status: "pending",
    createdAt: serverTimestamp()
  });
  await postChatMessage(currentProductId, p, "offer", `Offre envoyée : ${formatPrice(amount)}`, amount);
  $("offer-amount").value = "";
  showToast("Offre envoyée au vendeur — retrouve la conversation dans Messages");
});

$("btn-buy-now").addEventListener("click", async () => {
  const snap = await getDoc(doc(db, "products", currentProductId));
  const p = { id: currentProductId, ...snap.data() };
  if (p.sellerId === currentUser.uid) { showToast("C'est ton article"); return; }
  openCheckout(p);
});

function openCheckout(p) {
  checkoutProduct = p;
  const color = THUMB_COLORS[p.category] || "#2A55FF";
  const photos = p.photos && p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
  $("checkout-product-thumb").style.background = color;
  $("checkout-product-thumb").innerHTML = photos[0] ? `<img src="${photos[0]}">` : "";
  $("checkout-product-title").textContent = p.title;
  $("checkout-product-price").textContent = formatPrice(p.price);
  $("checkout-form").reset();
  showView("view-checkout");
}

$("btn-back-checkout").addEventListener("click", () => {
  showView("view-detail");
});

$("checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!checkoutProduct) return;
  const firstName = $("checkout-firstname").value.trim();
  const lastName = $("checkout-lastname").value.trim();
  const email = $("checkout-email").value.trim();
  const whatsapp = $("checkout-whatsapp").value.trim();
  if (!firstName || !lastName || !email || !whatsapp) { showToast("Merci de remplir tous les champs"); return; }

  const btn = $("checkout-submit");
  btn.disabled = true;
  btn.textContent = "Envoi en cours...";
  try {
    const p = checkoutProduct;
    await addDoc(collection(db, "products", p.id, "offers"), {
      buyerId: currentUser.uid,
      buyerName: currentUser.displayName || currentUser.email,
      sellerId: p.sellerId,
      productTitle: p.title,
      amount: p.price,
      status: "pending",
      createdAt: serverTimestamp()
    });
    const chatId = await ensureChat(p.id, p, currentUser.uid);
    await updateDoc(doc(db, "chats", chatId), {
      buyerFullName: `${firstName} ${lastName}`,
      buyerEmail: email,
      buyerWhatsapp: whatsapp
    });
    const orderText = `Nouvelle demande d'achat au prix affiché (${formatPrice(p.price)})\nNom : ${firstName} ${lastName}\nEmail : ${email}\nWhatsApp : ${whatsapp}`;
    await addDoc(collection(db, "chats", chatId, "messages"), {
      senderId: currentUser.uid, senderName: currentUser.displayName || currentUser.email,
      text: orderText, type: "order", createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", chatId), { lastMessage: "Demande d'achat envoyée", lastMessageAt: serverTimestamp(), lastSenderId: currentUser.uid });
    showToast("Ta demande a été envoyée au vendeur");
    openChat(chatId);
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de l'envoi — réessaie");
  }
  btn.disabled = false;
  btn.textContent = "Envoyer ma demande d'achat";
});

function listenOffers(productId, product) {
  if (unsubOffers) unsubOffers();
  const isOwner = currentUser && product.sellerId === currentUser.uid;
  const q = query(collection(db, "products", productId, "offers"), orderBy("createdAt", "desc"));
  unsubOffers = onSnapshot(q, (snap) => {
    const offers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const visible = isOwner ? offers : offers.filter(o => o.buyerId === currentUser.uid);
    if (isOwner) {
      const wrap = $("offer-form-wrap");
      if (visible.length && wrap) { /* le vendeur gère les offres via le chat désormais */ }
    }
  });
}

// ---------------- CHAT (acheteur / vendeur) ----------------

function chatIdFor(productId, buyerId) { return `${productId}__${buyerId}`; }

async function ensureChat(productId, product, buyerId) {
  const chatId = chatIdFor(productId, buyerId);
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const buyerSnap = buyerId === currentUser.uid
      ? { displayName: currentUser.displayName || currentUser.email, photoURL: currentUser.photoURL || null }
      : (await getDoc(doc(db, "users", buyerId))).data();
    await setDoc(ref, {
      productId, productTitle: product.title,
      productPhoto: (product.photos && product.photos[0]) || product.photo || null,
      buyerId, buyerName: buyerSnap?.displayName || "Acheteur", buyerPhoto: buyerSnap?.photoURL || null,
      sellerId: product.sellerId, sellerName: product.sellerName, sellerPhoto: product.sellerPhoto || null,
      sellerWhatsapp: product.sellerWhatsapp || null,
      buyerWhatsapp: null, buyerEmail: null, buyerFullName: null,
      participants: [buyerId, product.sellerId],
      lastMessage: "Conversation démarrée", lastMessageAt: serverTimestamp(), lastSenderId: buyerId
    });
  }
  return chatId;
}

async function postChatMessage(productId, product, type, text, amount) {
  const buyerId = currentUser.uid === product.sellerId ? null : currentUser.uid;
  if (!buyerId) return; // le vendeur ne "négocie" pas sur sa propre annonce
  const chatId = await ensureChat(productId, product, buyerId);
  await addDoc(collection(db, "chats", chatId, "messages"), {
    senderId: currentUser.uid, senderName: currentUser.displayName || currentUser.email,
    text, type: type || "text", amount: amount || null, createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "chats", chatId), { lastMessage: text, lastMessageAt: serverTimestamp(), lastSenderId: currentUser.uid });
}

$("btn-open-chat").addEventListener("click", async () => {
  try {
    const snap = await getDoc(doc(db, "products", currentProductId));
    if (!snap.exists()) { showToast("Cette annonce n'existe plus"); return; }
    const p = { id: currentProductId, ...snap.data() };
    const buyerId = currentUser.uid === p.sellerId ? null : currentUser.uid;
    if (!buyerId) { showToast("C'est ton article, tu ne peux pas discuter avec toi-même"); return; }
    const chatId = await ensureChat(currentProductId, p, buyerId);
    await openChat(chatId);
  } catch (err) {
    console.error("Erreur à l'ouverture du chat :", err);
    showToast("Impossible d'ouvrir la conversation — vérifie tes règles Firestore (collection 'chats')");
  }
});

async function openChat(chatId) {
  currentChatId = chatId;
  const snap = await getDoc(doc(db, "chats", chatId));
  if (!snap.exists()) { showToast("Conversation introuvable"); return; }
  currentChatMeta = snap.data();
  const isBuyer = currentUser.uid === currentChatMeta.buyerId;
  const otherName = isBuyer ? currentChatMeta.sellerName : currentChatMeta.buyerName;
  const otherPhoto = isBuyer ? currentChatMeta.sellerPhoto : currentChatMeta.buyerPhoto;
  $("chat-header-name").textContent = otherName || "Utilisateur";
  $("chat-header-product").textContent = currentChatMeta.productTitle || "";
  $("chat-header-avatar").innerHTML = otherPhoto
    ? `<img src="${otherPhoto}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : initials(otherName);
  const waBtn = $("chat-whatsapp-btn");
  const targetWhatsapp = isBuyer ? currentChatMeta.sellerWhatsapp : currentChatMeta.buyerWhatsapp;
  if (targetWhatsapp) {
    waBtn.style.display = "flex";
    waBtn.href = whatsappLink(targetWhatsapp, `Bonjour, à propos de "${currentChatMeta.productTitle}" sur BOULKA.`);
  } else {
    waBtn.style.display = "none";
  }
  showView("view-chat");
  listenChatMessages(chatId);
}

function listenChatMessages(chatId) {
  if (unsubChatMessages) unsubChatMessages();
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(200));
  unsubChatMessages = onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => d.data());
    const wrap = $("chat-messages");
    wrap.innerHTML = msgs.map(m => {
      const mine = m.senderId === currentUser.uid;
      const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
      if (m.type === "offer") {
        return `<div class="msg-row system"><div class="msg-bubble">💬 ${escapeHtml(m.text)}</div></div>`;
      }
      if (m.type === "order") {
        return `<div class="msg-row system"><div class="msg-bubble order-bubble">🛒 ${escapeHtml(m.text).replace(/\n/g, "<br>")}</div></div>`;
      }
      return `<div class="msg-row ${mine ? "mine" : ""}"><div><div class="msg-bubble">${escapeHtml(m.text)}</div><div class="msg-time">${time}</div></div></div>`;
    }).join("");
    wrap.scrollTop = wrap.scrollHeight;
  }, (err) => {
    console.error("Erreur chargement du chat :", err);
    showToast("Impossible de charger la conversation");
  });
}

$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = "";
  try {
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
      senderId: currentUser.uid, senderName: currentUser.displayName || currentUser.email,
      text, type: "text", createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: text, lastMessageAt: serverTimestamp(), lastSenderId: currentUser.uid });
  } catch (err) {
    console.error("Erreur envoi message :", err);
    showToast("Message non envoyé — réessaie");
  }
});

$("btn-back-chat").addEventListener("click", () => {
  if (unsubChatMessages) unsubChatMessages();
  showView("view-app");
  switchTab("notif");
});

function listenThreads() {
  if (unsubNotif) unsubNotif();
  const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid), orderBy("lastMessageAt", "desc"));
  unsubNotif = onSnapshot(q, (snap) => {
    const threads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const wrap = $("thread-list");
    if (threads.length === 0) {
      wrap.innerHTML = `<p style="font-size:13px;color:var(--mut)">Aucun message pour l'instant. Contacte un vendeur depuis une annonce !</p>`;
      $("unread-dot").style.display = "none";
      return;
    }
    const hasUnread = threads.some(t => t.lastSenderId && t.lastSenderId !== currentUser.uid);
    $("unread-dot").style.display = hasUnread ? "block" : "none";
    wrap.innerHTML = threads.map(t => {
      const isBuyer = currentUser.uid === t.buyerId;
      const otherName = isBuyer ? t.sellerName : t.buyerName;
      const otherPhoto = isBuyer ? t.sellerPhoto : t.buyerPhoto;
      const time = t.lastMessageAt?.toDate ? t.lastMessageAt.toDate().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "";
      return `
        <div class="thread-card" data-chat="${t.id}">
          <div class="avatar">${otherPhoto ? `<img src="${otherPhoto}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : initials(otherName)}</div>
          <div class="thread-info">
            <div class="thread-product">${escapeHtml(t.productTitle || "")}</div>
            <div class="thread-top"><span class="thread-name">${escapeHtml(otherName || "Utilisateur")}</span><span class="thread-time">${time}</span></div>
            <div class="thread-preview">${escapeHtml(t.lastMessage || "")}</div>
          </div>
        </div>`;
    }).join("");
    wrap.querySelectorAll("[data-chat]").forEach(c => c.addEventListener("click", () => openChat(c.dataset.chat)));
  }, (err) => {
    console.error("Erreur chargement des messages (index Firestore manquant ?) :", err);
    $("thread-list").innerHTML = `<p style="font-size:13px;color:var(--danger)">Impossible de charger les messages. Si c'est la première fois, ouvre la console du navigateur (F12) : Firestore affiche un lien pour créer l'index manquant, clique dessus puis réessaie dans une minute.</p>`;
  });
}

// ---------------- REVIEWS ----------------

function renderStarInput() {
  $("review-star-input").querySelectorAll("span").forEach(s => s.classList.toggle("filled", Number(s.dataset.v) <= reviewStarValue));
}
$("review-star-input").querySelectorAll("span").forEach(s => s.addEventListener("click", () => {
  reviewStarValue = Number(s.dataset.v);
  renderStarInput();
}));

$("btn-submit-review").addEventListener("click", async () => {
  if (reviewStarValue < 1) { showToast("Choisis une note en étoiles"); return; }
  const snap = await getDoc(doc(db, "products", currentProductId));
  const p = snap.data();
  if (p.sellerId === currentUser.uid) { showToast("Tu ne peux pas t'auto-évaluer"); return; }
  try {
    await addDoc(collection(db, "reviews"), {
      sellerId: p.sellerId, buyerId: currentUser.uid,
      buyerName: currentUser.displayName || currentUser.email,
      productId: currentProductId, productTitle: p.title,
      rating: reviewStarValue, comment: $("review-comment").value.trim(),
      createdAt: serverTimestamp()
    });
    showToast("Avis publié, merci !");
    reviewStarValue = 0; renderStarInput(); $("review-comment").value = "";
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de la publication de l'avis");
  }
});

function listenProductReviews(sellerId) {
  if (unsubReviews) unsubReviews();
  const q = query(collection(db, "reviews"), where("sellerId", "==", sellerId), orderBy("createdAt", "desc"));
  unsubReviews = onSnapshot(q, (snap) => {
    const reviews = snap.docs.map(d => d.data());
    const list = $("reviews-list");
    if (reviews.length === 0) {
      list.innerHTML = `<p style="font-size:13px;color:var(--mut)">Aucun avis pour l'instant.</p>`;
      $("detail-seller-stars").textContent = "";
      return;
    }
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
    $("detail-seller-stars").textContent = `${starsHtml(avg)} ${avg.toFixed(1)}/5 (${reviews.length} avis)`;
    list.innerHTML = reviews.map(r => `
      <div class="review-card">
        <div class="review-top"><span class="review-author">${escapeHtml(r.buyerName)}</span><span class="review-stars">${starsHtml(r.rating)}</span></div>
        ${r.comment ? `<div class="review-comment">${escapeHtml(r.comment)}</div>` : ""}
      </div>`).join("");
  }, (err) => {
    console.error("Erreur chargement des avis (index Firestore manquant ?) :", err);
  });
}

function listenAllReviews() {
  if (unsubAllReviews) unsubAllReviews();
  unsubAllReviews = onSnapshot(collection(db, "reviews"), (snap) => {
    allReviews = snap.docs.map(d => d.data());
    renderGrid();
    renderProfileRating();
  }, (err) => {
    console.error("Erreur chargement des avis :", err);
  });
}

function renderProfileRating() {
  if (!currentUser) return;
  const r = sellerAvg(currentUser.uid);
  $("profile-rating").innerHTML = r
    ? `<span class="big-star">★</span> ${r.avg.toFixed(1)}/5 — ${r.count} avis reçu${r.count > 1 ? "s" : ""}`
    : `Aucun avis reçu pour l'instant`;
}

// ---------------- PROFILE ----------------

function renderProfileListings() {
  if (!currentUser) return;
  $("profile-name").textContent = currentUser.displayName || currentUser.email;
  $("profile-email").textContent = currentUser.email || "";
  renderProfileRating();
  const mine = allProducts.filter(p => p.sellerId === currentUser.uid);
  $("profile-count").textContent = mine.length + (mine.length > 1 ? " annonces publiées" : " annonce publiée");
  const grid = $("profile-grid");
  if (mine.length === 0) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--mut);padding:20px 0">Tu n'as pas encore publié d'annonce.</p>`;
    return;
  }
  grid.innerHTML = `<div class="grid">${mine.map(productCardHtml).join("")}</div>`;
  grid.querySelectorAll(".product-card").forEach(card => card.addEventListener("click", () => openProduct(card.dataset.id)));
}

// ---------------- NAV ----------------

function switchTab(tab) {
  document.querySelectorAll(".bottom-nav button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["home", "account", "notif"].forEach(t => $("tab-" + t).style.display = t === tab ? "block" : "none");
  showView("view-app");
  if (tab === "account") { renderProfileListings(); fillSettingsForm(); }
}
document.querySelectorAll(".bottom-nav button[data-tab]").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
