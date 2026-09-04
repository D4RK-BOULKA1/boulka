// ---------------- AUTH ----------------

$("btn-google").addEventListener("click", async () => {
  clearAuthError();

  const googleBtn = $("btn-google");
  googleBtn.disabled = true;

  try {
    const provider = new GoogleAuthProvider();

    // Demande explicitement les informations de base du compte Google
    provider.addScope("profile");
    provider.addScope("email");

    await signInWithPopup(auth, provider);

    // Firebase déclenchera automatiquement onAuthStateChanged()
    // lorsque la connexion est réussie.

  } catch (e) {
    console.error("ERREUR GOOGLE FIREBASE :", e);

    const code = e?.code || "";

    const messages = {
      "auth/popup-closed-by-user":
        "La fenêtre Google a été fermée.",

      "auth/popup-blocked":
        "La fenêtre Google a été bloquée par ton navigateur. Autorise les fenêtres pop-up pour ce site.",

      "auth/cancelled-popup-request":
        "Une connexion Google est déjà en cours.",

      "auth/unauthorized-domain":
        "Ce domaine n'est pas autorisé dans Firebase. Va dans Firebase > Authentication > Settings > Authorized domains.",

      "auth/operation-not-allowed":
        "La connexion Google n'est pas activée dans Firebase. Va dans Authentication > Sign-in method > Google et active Google.",

      "auth/network-request-failed":
        "Problème de connexion Internet. Vérifie ta connexion puis réessaie.",

      "auth/invalid-api-key":
        "La clé API Firebase est incorrecte.",

      "auth/app-not-authorized":
        "Cette application n'est pas autorisée à utiliser Firebase Authentication.",

      "auth/invalid-credential":
        "Les informations de connexion Google sont invalides.",

      "auth/account-exists-with-different-credential":
        "Un compte existe déjà avec cette adresse email avec une autre méthode de connexion."
    };

    showAuthError(
      messages[code] ||
      `Erreur Firebase : ${code || "erreur inconnue"}. Regarde aussi la console du navigateur.`
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

    console.error("ERREUR AUTHENTIFICATION :", e);

    showAuthError(
      friendlyAuthError(e?.code)
    );

  } finally {
    submitBtn.disabled = false;
  }
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
      "Ce domaine n'est pas autorisé dans Firebase.",

    "auth/operation-not-allowed":
      "Cette méthode de connexion n'est pas activée dans Firebase.",

    "auth/network-request-failed":
      "Erreur réseau. Vérifie ta connexion Internet.",

    "auth/invalid-api-key":
      "La clé API Firebase est incorrecte.",

    "auth/app-not-authorized":
      "Cette application n'est pas autorisée par Firebase."

  };

  return map[code] ||
    `Une erreur est survenue : ${code || "erreur inconnue"}`;
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


$("btn-logout").addEventListener("click", () => {
  signOut(auth);
});


onAuthStateChanged(auth, (user) => {

  currentUser = user;

  $("loading-screen").style.display = "none";

  if (user) {

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
          style="
            width:100%;
            height:100%;
            border-radius:50%;
            object-fit:cover
          "
        >
      `;

    } else {

      n.textContent =
        initials(user.displayName || user.email);

    }

  });

}
