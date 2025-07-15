// assets/js/contact-form.js
export function initContactForm() {
  const form   = document.getElementById('contact-form');
  const status = document.getElementById('form-status');

  if (!form || !status) return;

  // 1. validation HTML5 + message d'erreur custom
  form.noValidate = true;                               // on gère tout nous-mêmes
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    /* -----------------------------------------------------------
       1️⃣  Validation simple (HTML5) avant d’envoyer quoi que ce soit
    ----------------------------------------------------------- */
    if (!form.checkValidity()) {
      status.textContent = 'Merci de remplir tous les champs requis !';
      form.reportValidity();                            // fait clignoter les champs invalides
      return;
    }

    /* -----------------------------------------------------------
       2️⃣  UX — indiquer le chargement et désactiver le bouton
    ----------------------------------------------------------- */
    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn?.setAttribute('disabled', true);
    status.textContent = 'Envoi en cours…';

    /* -----------------------------------------------------------
       3️⃣  Envoi Fetch + gestion d’erreurs
    ----------------------------------------------------------- */
    try {
      const res = await fetch(form.action, {
        method : form.method,
        body   : new FormData(form),
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        status.textContent = 'Merci ! Ton message a bien été envoyé.';
        form.reset();
      } else {
        const { error } = await res.json().catch(() => ({}));
        status.textContent = error ?? 'Oups ! Une erreur est survenue.';
      }
    } catch (_) {
      status.textContent = 'Impossible d’envoyer le message. Vérifie ta connexion.';
    } finally {
      submitBtn?.removeAttribute('disabled');           // toujours réactiver
    }
  });
}
