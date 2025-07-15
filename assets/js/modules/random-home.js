// assets/js/random-home.js
// Version optimisée pour la redirection depuis la page d'accueil

export function initRandomHome() {
  // Vérifie si on est sur la page d'accueil avec le dataset
  const data = document.body.dataset.randomRecipes;
  if (!data) return;

  try {
    const recipes = JSON.parse(data);
    if (!recipes || recipes.length === 0) {
      console.warn('Aucune recette disponible pour la redirection aléatoire');
      return;
    }

    // Sélection aléatoire et redirection
    const randomRecipe = recipes[Math.floor(Math.random() * recipes.length)];
    
    // Utilise replace() pour éviter d'ajouter à l'historique
    window.location.replace(randomRecipe);
    
  } catch (err) {
    console.error('Erreur lors de la redirection aléatoire:', err);
    // Fallback vers la page /random/ en cas d'erreur
    window.location.href = '/random/';
  }
}

// Auto-initialisation si le DOM est déjà chargé
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRandomHome);
} else {
  initRandomHome();
}
