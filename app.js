import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, getDocs, getDoc,
  query, orderBy, onSnapshot, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CATEGORIES = ["Vêtements", "Chaussures", "Sacs & Accessoires", "Maison & Déco", "High-tech", "Autres"];
const THUMB_COLORS = { "Vêtements": "#2F6FED", "Chaussures": "#1B3B7A", "Sacs & Accessoires": "#3D7EFF", "Maison & Déco": "#123166", "High-tech": "#0EA5C4", "Autres": "#274A8C" };

// ---------------- THEME ----------------

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("boulka-theme", theme);
}
$("theme-toggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(current);
});

let currentUser = null;
let allProducts = [];
let activeCategory = "Tout";
let searchTerm = "";
let currentProductId = null;
let unsubProducts = null;
let pendingPhoto = null;
let authMode = "signin";

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
}

function showAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  el.classList.add("show");
}
function clearAuthError() { $("auth-error").classList.remove("show"); }

// ---------------- AUTH ----------------

$("btn-google").addEventListener("click", async () => {
  clearAuthError();
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
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
  const submitBtn = $("auth-submit");
  submitBtn.disabled = true;
  try {
    if (authMode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(cred.user, { displayName: name });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (e) {
    showAuthError(friendlyAuthError(e.code));
  }
  submitBtn.disabled = false;
});

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
  $("field-name").style.display = authMode === "signup" ? "block" : "none";
  $("auth-submit").textContent = authMode === "signup" ? "Créer mon compte" : "Se connecter";
  $("auth-switch-text").textContent = authMode === "signup" ? "Déjà un compte ?" : "Pas encore de compte ?";
  $("auth-switch-btn").textContent = authMode === "signup" ? "Se connecter" : "Créer un compte";
});

$("btn-logout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  $("loading-screen").style.display = "none";
  if (user) {
    renderAvatar(user);
    showView("view-app");
    switchTab("home");
    listenProducts();
  } else {
    if (unsubProducts) unsubProducts();
    showView("view-auth");
  }
});

function renderAvatar(user) {
  const nodes = document.querySelectorAll(".js-user-avatar");
  nodes.forEach(n => {
    if (user.photoURL) {
      n.innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    } else {
      n.textContent = initials(user.displayName || user.email);
    }
  });
}

// ---------------- PRODUCTS ----------------

function listenProducts() {
  const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
  unsubProducts = onSnapshot(q, (snap) => {
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryChips();
    renderGrid();
    renderProfileListings();
    const liveCount = $("live-count");
    if (liveCount) liveCount.textContent = allProducts.length;
  }, (err) => {
    console.error(err);
    showToast("Erreur de chargement — vérifie ta config Firebase");
  });
}

function renderCategoryChips() {
  const row = $("category-row");
  row.innerHTML = "";
  ["Tout", ...CATEGORIES].forEach(cat => {
    const btn = document.createElement("button");
    btn.className = "chip" + (cat === activeCategory ? " active" : "");
    btn.textContent = cat;
    btn.addEventListener("click", () => { activeCategory = cat; renderCategoryChips(); renderGrid(); });
    row.appendChild(btn);
  });
}

$("search-input").addEventListener("input", (e) => {
  searchTerm = e.target.value.toLowerCase();
  renderGrid();
});

function renderGrid() {
  let list = allProducts;
  if (activeCategory !== "Tout") list = list.filter(p => p.category === activeCategory);
  if (searchTerm) list = list.filter(p => (p.title + " " + p.description).toLowerCase().includes(searchTerm));

  $("result-count").textContent = list.length + (list.length > 1 ? " articles" : " article");
  const grid = $("product-grid");
  const empty = $("empty-state");

  if (list.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  grid.innerHTML = list.map(productCardHtml).join("");
  grid.querySelectorAll(".product-card").forEach(card => {
    card.addEventListener("click", () => openProduct(card.dataset.id));
  });
}

function productCardHtml(p) {
  const color = THUMB_COLORS[p.category] || "#205C4B";
  const thumb = p.photo
    ? `<img src="${p.photo}" alt="">`
    : escapeHtml(p.title);
  return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-thumb" style="background:${color}">${thumb}</div>
      <div class="product-card-body">
        <div class="product-title">${escapeHtml(p.title)}</div>
        <div class="product-meta">${escapeHtml(p.category)}</div>
        <div class="product-price">${Number(p.price).toFixed(2)} €</div>
      </div>
    </div>`;
}

// ---------------- SELL MODAL ----------------

$("btn-open-sell").addEventListener("click", openSellModal);
$("btn-open-sell-2").addEventListener("click", openSellModal);
$("btn-close-sell").addEventListener("click", closeSellModal);

function openSellModal() {
  $("sell-form").reset();
  pendingPhoto = null;
  $("photo-preview-wrap").innerHTML = photoUploadHtml();
  bindPhotoInput();
  $("sell-category").innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  $("modal-sell").classList.remove("hidden-modal");
}
function closeSellModal() { $("modal-sell").classList.add("hidden-modal"); }

function photoUploadHtml(dataUrl) {
  if (dataUrl) {
    return `<img src="${dataUrl}"><input type="file" id="photo-input" accept="image/*">`;
  }
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M21 16l-4.5-4.5a2 2 0 0 0-2.8 0L5 21"/></svg>
    <span>Ajouter une photo</span>
    <input type="file" id="photo-input" accept="image/*">`;
}

function bindPhotoInput() {
  $("photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await compressImage(file);
    pendingPhoto = dataUrl;
    $("photo-preview-wrap").innerHTML = photoUploadHtml(dataUrl);
    bindPhotoInput();
  });
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
  const description = $("sell-description").value.trim();
  if (!title || !price || price <= 0) { showToast("Titre et prix requis"); return; }

  const btn = $("sell-submit");
  btn.disabled = true;
  btn.textContent = "Publication...";
  try {
    await addDoc(collection(db, "products"), {
      title, price, category, description,
      photo: pendingPhoto || null,
      sellerId: currentUser.uid,
      sellerName: currentUser.displayName || currentUser.email,
      sellerPhoto: currentUser.photoURL || null,
      createdAt: serverTimestamp()
    });
    closeSellModal();
    switchTab("home");
    showToast("Annonce publiée !");
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
  const snap = await getDoc(doc(db, "products", id));
  if (!snap.exists()) { showToast("Cette annonce n'existe plus"); return; }
  const p = { id: snap.id, ...snap.data() };
  renderProductDetail(p);
  showView("view-detail");
  listenOffers(id, p);
}

function renderProductDetail(p) {
  const color = THUMB_COLORS[p.category] || "#205C4B";
  const isOwner = currentUser && p.sellerId === currentUser.uid;
  $("detail-photo").style.background = color;
  $("detail-photo").innerHTML = p.photo ? `<img src="${p.photo}">` : escapeHtml(p.title);
  $("detail-cat").textContent = p.category;
  $("detail-title").textContent = p.title;
  $("detail-price").textContent = Number(p.price).toFixed(2) + " €";
  $("detail-desc").textContent = p.description || "Pas de description.";
  $("detail-owner-badge").style.display = isOwner ? "inline-block" : "none";

  $("detail-seller-avatar").innerHTML = p.sellerPhoto
    ? `<img src="${p.sellerPhoto}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : initials(p.sellerName);
  $("detail-seller-name").textContent = p.sellerName;
  $("detail-seller-sub").textContent = "Vendeur";

  $("detail-buy-actions").style.display = isOwner ? "none" : "flex";
  $("offer-form-wrap").style.display = isOwner ? "none" : "block";
  $("offer-amount").value = "";
}

$("btn-back-detail").addEventListener("click", () => {
  showView("view-app");
  switchTab(document.querySelector(".bottom-nav button.active")?.dataset.tab || "home");
});

$("offer-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = parseFloat($("offer-amount").value);
  if (!amount || amount <= 0) return;
  await addDoc(collection(db, "products", currentProductId, "offers"), {
    buyerId: currentUser.uid,
    buyerName: currentUser.displayName || currentUser.email,
    amount,
    status: "pending",
    createdAt: serverTimestamp()
  });
  $("offer-amount").value = "";
  showToast("Offre envoyée au vendeur");
});

$("btn-buy-now").addEventListener("click", async () => {
  const snap = await getDoc(doc(db, "products", currentProductId));
  const p = snap.data();
  await addDoc(collection(db, "products", currentProductId, "offers"), {
    buyerId: currentUser.uid,
    buyerName: currentUser.displayName || currentUser.email,
    amount: p.price,
    status: "pending",
    createdAt: serverTimestamp()
  });
  showToast("Demande d'achat envoyée au vendeur");
});

let unsubOffers = null;
function listenOffers(productId, product) {
  if (unsubOffers) unsubOffers();
  const isOwner = currentUser && product.sellerId === currentUser.uid;
  const q = query(collection(db, "products", productId, "offers"), orderBy("createdAt", "desc"));
  unsubOffers = onSnapshot(q, (snap) => {
    const offers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const wrap = $("offers-list");
    const visible = isOwner ? offers : offers.filter(o => o.buyerId === currentUser.uid);
    if (visible.length === 0) {
      wrap.innerHTML = `<p style="font-size:13px;color:var(--ink-soft)">${isOwner ? "Aucune offre pour l'instant." : "Fais une offre ou achète au prix affiché."}</p>`;
      return;
    }
    wrap.innerHTML = visible.map(o => offerCardHtml(o, isOwner, productId)).join("");
    if (isOwner) {
      wrap.querySelectorAll("[data-accept]").forEach(b => b.addEventListener("click", () => setOfferStatus(productId, b.dataset.accept, "accepted")));
      wrap.querySelectorAll("[data-decline]").forEach(b => b.addEventListener("click", () => setOfferStatus(productId, b.dataset.decline, "declined")));
    }
  });
}

function offerCardHtml(o, isOwner, productId) {
  const statusLabel = { pending: "En attente", accepted: "Acceptée ✓", declined: "Refusée" }[o.status];
  return `
    <div class="offer-card">
      <div class="offer-top">
        <span class="offer-buyer">${isOwner ? escapeHtml(o.buyerName) : "Toi"}</span>
        <span class="offer-amount">${Number(o.amount).toFixed(2)} €</span>
      </div>
      <div class="offer-status ${o.status}">${statusLabel}</div>
      ${isOwner && o.status === "pending" ? `
        <div class="offer-actions">
          <button class="btn-accept" data-accept="${o.id}">Accepter</button>
          <button class="btn-decline" data-decline="${o.id}">Refuser</button>
        </div>` : ""}
    </div>`;
}

async function setOfferStatus(productId, offerId, status) {
  await updateDoc(doc(db, "products", productId, "offers", offerId), { status });
  showToast(status === "accepted" ? "Offre acceptée" : "Offre refusée");
}

// ---------------- PROFILE ----------------

function renderProfileListings() {
  if (!currentUser) return;
  $("profile-name").textContent = currentUser.displayName || currentUser.email;
  $("profile-email").textContent = currentUser.email || "";
  const mine = allProducts.filter(p => p.sellerId === currentUser.uid);
  $("profile-count").textContent = mine.length + (mine.length > 1 ? " annonces publiées" : " annonce publiée");
  const grid = $("profile-grid");
  if (mine.length === 0) {
    grid.innerHTML = `<p style="font-size:13px;color:var(--ink-soft);padding:20px 0">Tu n'as pas encore publié d'annonce.</p>`;
    return;
  }
  grid.innerHTML = `<div class="grid">${mine.map(productCardHtml).join("")}</div>`;
  grid.querySelectorAll(".product-card").forEach(card => {
    card.addEventListener("click", () => openProduct(card.dataset.id));
  });
}

// ---------------- NAV ----------------

function switchTab(tab) {
  document.querySelectorAll(".bottom-nav button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  ["home", "profile"].forEach(t => $("tab-" + t).style.display = t === tab ? "block" : "none");
  showView("view-app");
  if (tab === "profile") renderProfileListings();
}
document.querySelectorAll(".bottom-nav button[data-tab]").forEach(b => {
  b.addEventListener("click", () => switchTab(b.dataset.tab));
});
