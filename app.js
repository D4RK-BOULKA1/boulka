// ---------------- AUTH ----------------

$("btn-google").addEventListener("click", async () => {
  clearAuthError();

  const googleBtn = $("btn-google");
  googleBtn.disabled = true;

  try {
    const provider = new GoogleAuthProvider();

    provider.addScope("profile");
    provider.addScope("email");

    console.log("Tentative de connexion Google...");

    const result = await signInWithPopup(auth, provider);

    console.log("Connexion Google réussie :", result.user);

  } catch (e) {
    console.error("ERREUR GOOGLE FIREBASE :", e);

    const code = e?.code || "";
    const message = e?.message || "";

    console.error("Code Firebase :", code);
    console.error("Message Firebase :", message);

    const messages = {
      "auth/popup-closed-by-user":
        "La fenêtre Google a été fermée.",

      "auth/popup-blocked":
        "La fenêtre Google a été bloquée par ton navigateur. Autorise les fenêtres pop-up.",

      "auth/cancelled-popup-request":
        "Une connexion Google est déjà en cours.",

      "auth/popup-timeout":
        "La connexion Google a pris trop de temps.",

      "auth/unauthorized-domain":
        "ERREUR : ce domaine n'est pas autorisé dans Firebase. Ajoute ton domaine dans Firebase > Authentication > Settings > Authorized domains.",

      "auth/operation-not-allowed":
        "ERREUR : Google n'est pas activé dans Firebase. Va dans Authentication > Sign-in method > Google et active-le.",

      "auth/network-request-failed":
        "Problème de connexion Internet.",

      "auth/invalid-api-key":
        "ERREUR : la clé API Firebase est incorrecte.",

      "auth/app-not-authorized":
        "ERREUR : cette application n'est pas autorisée à utiliser Firebase Authentication.",

      "auth/invalid-credential":
        "Les informations de connexion Google sont invalides.",

      "auth/account-exists-with-different-credential":
        "Un compte existe déjà avec cette adresse email avec une autre méthode de connexion.",

      "auth/internal-error":
        "Firebase a rencontré une erreur interne."
    };

    showAuthError(
      messages[code] ||
      `Erreur Firebase : ${code || "erreur inconnue"}`
    );

  } finally {
    googleBtn.disabled = false;
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

      const cred = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      if (name) {
        await updateProfile(cred.user, {
          displayName: name
        });
      }

    } else {

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    }

  } catch (e) {

    console.error("ERREUR AUTH :", e);

    showAuthError(
      friendlyAuthError(e?.code)
    );

  }

  submitBtn.disabled = false;
});


function friendlyAuthError(code) {

  const map = {

    "auth/email-already-in-use":
      "Un compte existe déjà avec cet email.",

    "auth/invalid-email":
      "Adresse email invalide.",

    "auth/weak-password":
      "Le mot de passe doit faire au moins 6 caractères.",

    "auth/user-not-found":
      "Aucun compte avec cet email.",

    "auth/wrong-password":
      "Mot de passe incorrect.",

    "auth/invalid-credential":
      "Email ou mot de passe incorrect.",

    "auth/popup-closed-by-user":
      "Connexion Google annulée.",

    "auth/popup-blocked":
      "La fenêtre Google a été bloquée par le navigateur.",

    "auth/cancelled-popup-request":
      "Une connexion Google est déjà en cours.",

    "auth/unauthorized-domain":
      "Ce domaine n'est pas autorisé dans Firebase. Vérifie Authentication > Settings > Authorized domains.",

    "auth/operation-not-allowed":
      "Cette méthode de connexion n'est pas activée dans Firebase.",

    "auth/network-request-failed":
      "Erreur réseau. Vérifie ta connexion Internet.",

    "auth/invalid-api-key":
      "La clé API Firebase est incorrecte.",

    "auth/app-not-authorized":
      "Cette application n'est pas autorisée à utiliser Firebase.",

    "auth/account-exists-with-different-credential":
      "Un compte existe déjà avec cet email avec une autre méthode de connexion."

  };

  return map[code] ||
    `Erreur Firebase : ${code || "erreur inconnue"}`;
}


$("auth-switch-btn").addEventListener("click", () => {

  authMode = authMode === "signin"
    ? "signup"
    : "signin";

  clearAuthError();

  $("field-name").style.display =
    authMode === "signup"
      ? "block"
      : "none";

  $("auth-submit").textContent =
    authMode === "signup"
      ? "Créer mon compte"
      : "Se connecter";

  $("auth-switch-text").textContent =
    authMode === "signup"
      ? "Déjà un compte ?"
      : "Pas encore de compte ?";

  $("auth-switch-btn").textContent =
    authMode === "signup"
      ? "Se connecter"
      : "Créer un compte";
});


$("btn-logout").addEventListener(
  "click",
  () => signOut(auth)
);


onAuthStateChanged(auth, (user) => {

  currentUser = user;

  $("loading-screen").style.display = "none";

  if (user) {

    console.log("Utilisateur connecté :", user);

    renderAvatar(user);

    showView("view-app");

    switchTab("home");

    listenProducts();

  } else {

    if (unsubProducts) {
      unsubProducts();
    }

    showView("view-auth");
  }

});


function renderAvatar(user) {

  const nodes =
    document.querySelectorAll(".js-user-avatar");

  nodes.forEach(n => {

    if (user.photoURL) {

      n.innerHTML = `
        <img
          src="${user.photoURL}"
          style="width:100%;height:100%;border-radius:50%;object-fit:cover"
        >
      `;

    } else {

      n.textContent =
        initials(user.displayName || user.email);

    }

  });

}
