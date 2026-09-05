import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, collectionGroup, addDoc, doc, getDoc, setDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CATEGORIES = ["High-tech", "Mode", "Maison", "Sport", "Loisirs", "Autres"];
const THUMB_COLORS = { "High-tech": "#2A55FF", "Mode": "#B5533C", "Maison": "#4A6C6F", "Sport": "#1B3AC4", "Loisirs": "#6B4B5C", "Autres": "#5A6B85" };
const SHIPPING_LABEL = { both: "Main propre ou envoi", hand: "Main propre uniquement", ship: "Envoi uniquement" };

let currentUser = null;
let currentUserProfile = null;
let allProducts = [];
let activeCategory = "Tout";
let searchTerm = "";
let currentProductId = null;
let unsubProducts = null;
let unsubOffers = null;
let unsubNotif = null;
let pendingPhoto = null;
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
}
function showAuthError(msg) { const el = $("auth-error"); el.textContent = msg; el.classList.add("show"); }
function clearAuthError() { $("auth-error").classList.remove("show"); }

// ---------------- THEME ----------------

$("btn-theme-toggle").addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  $("theme-icon-path").setAttribute("d", theme === "light"
    ? "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"
    : "M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z");
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
      await ensureUserProfile(cred.user, { accountType, companyName: accountType === "professionnel" ? companyName : null, siret: accountType === "professionnel" ? siret : null });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (e) {
    showAuthError(friendlyAuthError(e.code));
  }
  submitBtn.disabled = false;
});

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
  $("field-account-type").style.display = isSignup ? "block" : "none";
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
    listenNotifications();
  } else {
    if (unsubProducts) unsubProducts();
    if (unsubNotif) unsubNotif();
    showView("view-auth");
  }
});

function renderAvatar(user) {
  document.querySelectorAll(".js-user-avatar").forEach(n => {
    if (user.photoURL) n.innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    else n.textContent = initials(user.displayName || user.email);
  });
}

// ---------------- PRODUCTS ----------------

function listenProducts() {
  $("product-grid").innerHTML = skeletonGridHtml(6);
  const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
  unsubProducts = onSnapshot(q, (snap) => {
    allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryChips();
    renderGrid();
    renderProfileListings();
  }, (err) => { console.error(err); showToast("Erreur de chargement — vérifie ta config Firebase"); });
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

function renderGrid() {
  let list = allProducts;
  if (activeCategory !== "Tout") list = list.filter(p => p.category === activeCategory);
  if (searchTerm) list = list.filter(p => (p.title + " " + p.description).toLowerCase().includes(searchTerm));
  $("result-count").textContent = list.length + (list.length > 1 ? " articles" : " article");
  const grid = $("product-grid");
  const empty = $("empty-state");
  if (list.length === 0) { grid.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";
  grid.innerHTML = list.map(productCardHtml).join("");
  grid.querySelectorAll(".product-card").forEach(card => card.addEventListener("click", () => openProduct(card.dataset.id)));
}

function productCardHtml(p) {
  const color = THUMB_COLORS[p.category] || "#2A55FF";
  const thumb = p.photo ? `<img src="${p.photo}" alt="">` : escapeHtml(p.title);
  return `
    <div class="product-card" data-id="${p.id}">
      ${p.condition ? `<span class="condition-badge">${escapeHtml(p.condition)}</span>` : ""}
      ${p.sellerIsPro ? `<span class="pro-badge">PRO</span>` : ""}
      <div class="product-thumb" style="background:${color}">${thumb}</div>
      <div class="product-card-body">
        <div class="product-title">${escapeHtml(p.title)}</div>
        <div class="product-meta">${escapeHtml(p.category)}</div>
        <div class="product-price">${Number(p.price).toFixed(2)} €</div>
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
  $("sell-form").reset();
  pendingPhoto = null;
  $("photo-preview-wrap").innerHTML = photoUploadHtml();
  bindPhotoInput();
  $("sell-category").innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
  showView("view-sell");
}

function photoUploadHtml(dataUrl) {
  if (dataUrl) return `<img src="${dataUrl}"><input type="file" id="photo-input" accept="image/*">`;
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
  const condition = $("sell-condition").value;
  const shipping = $("sell-shipping").value;
  const description = $("sell-description").value.trim();
  if (!title || !price || price <= 0) { showToast("Titre et prix requis"); return; }

  const btn = $("sell-submit");
  btn.disabled = true;
  btn.textContent = "Publication...";
  try {
    await addDoc(collection(db, "products"), {
      title, price, category, condition, shipping, description,
      photo: pendingPhoto || null,
      sellerId: currentUser.uid,
      sellerName: currentUser.displayName || currentUser.email,
      sellerPhoto: currentUser.photoURL || null,
      sellerIsPro: currentUserProfile?.accountType === "professionnel",
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
  const snap = await getDoc(doc(db, "products", id));
  if (!snap.exists()) { showToast("Cette annonce n'existe plus"); return; }
  const p = { id: snap.id, ...snap.data() };
  renderProductDetail(p);
  showView("view-detail");
  listenOffers(id, p);
}

function renderProductDetail(p) {
  const color = THUMB_COLORS[p.category] || "#2A55FF";
  const isOwner = currentUser && p.sellerId === currentUser.uid;
  $("detail-photo").style.background = color;
  $("detail-photo").innerHTML = p.photo ? `<img src="${p.photo}">` : escapeHtml(p.title);
  $("detail-cat").textContent = p.category;
  $("detail-title").textContent = p.title;
  $("detail-price").textContent = Number(p.price).toFixed(2) + " €";
  $("detail-condition").textContent = p.condition || "";
  $("detail-condition").style.display = p.condition ? "inline-block" : "none";
  $("detail-shipping").textContent = SHIPPING_LABEL[p.shipping] || "";
  $("detail-shipping").style.display = p.shipping ? "inline-block" : "none";
  $("detail-desc").textContent = p.description || "Pas de description.";
  $("detail-owner-badge").style.display = isOwner ? "inline-block" : "none";
  $("detail-seller-avatar").innerHTML = p.sellerPhoto
    ? `<img src="${p.sellerPhoto}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : initials(p.sellerName);
  $("detail-seller-name").textContent = p.sellerName + (p.sellerIsPro ? " · Pro" : "");
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
  const psnap = await getDoc(doc(db, "products", currentProductId));
  await addDoc(collection(db, "products", currentProductId, "offers"), {
    buyerId: currentUser.uid,
    buyerName: currentUser.displayName || currentUser.email,
    sellerId: psnap.data().sellerId,
    productTitle: psnap.data().title,
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
    sellerId: p.sellerId,
    productTitle: p.title,
    amount: p.price,
    status: "pending",
    createdAt: serverTimestamp()
  });
  showToast("Demande d'achat envoyée au vendeur");
});

function listenOffers(productId, product) {
  if (unsubOffers) unsubOffers();
  const isOwner = currentUser && product.sellerId === currentUser.uid;
  const q = query(collection(db, "products", productId, "offers"), orderBy("createdAt", "desc"));
  unsubOffers = onSnapshot(q, (snap) => {
    const offers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const wrap = $("offers-list");
    const visible = isOwner ? offers : offers.filter(o => o.buyerId === currentUser.uid);
    if (visible.length === 0) {
      wrap.innerHTML = `<p style="font-size:13px;color:var(--mut)">${isOwner ? "Aucune offre pour l'instant." : "Fais une offre ou achète au prix affiché."}</p>`;
      return;
    }
    wrap.innerHTML = visible.map(o => offerCardHtml(o, isOwner)).join("");
    if (isOwner) {
      wrap.querySelectorAll("[data-accept]").forEach(b => b.addEventListener("click", () => setOfferStatus(productId, b.dataset.accept, "accepted")));
      wrap.querySelectorAll("[data-decline]").forEach(b => b.addEventListener("click", () => setOfferStatus(productId, b.dataset.decline, "declined")));
    }
  });
}

function offerCardHtml(o, isOwner) {
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

// ---------------- NOTIFICATIONS ----------------

function listenNotifications() {
  if (unsubNotif) unsubNotif();
  const q = query(collectionGroup(db, "offers"), where("sellerId", "==", currentUser.uid), orderBy("createdAt", "desc"));
  unsubNotif = onSnapshot(q, (snap) => {
    const rows = snap.docs.map(d => d.data());
    const wrap = $("notif-list");
    if (rows.length === 0) { wrap.innerHTML = `<p style="font-size:13px;color:var(--mut)">Aucune notification.</p>`; return; }
    wrap.innerHTML = rows.map(o => `
      <div class="notif-row">
        <span>${escapeHtml(o.buyerName)} sur <strong>${escapeHtml(o.productTitle || "ton article")}</strong></span>
        <span class="amt">${Number(o.amount).toFixed(2)} €</span>
      </div>`).join("");
  }, (err) => {
    console.error(err);
    // Firestore peut demander la création d'un index composite au premier lancement — le lien apparaît dans la console.
  });
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
  if (tab === "account") renderProfileListings();
}
document.querySelectorAll(".bottom-nav button[data-tab]").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
