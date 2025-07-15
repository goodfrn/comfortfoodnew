// postcss.config.js
module.exports = {
  plugins: [
    // 1️⃣  Déroule la syntaxe imbriquée (&:hover, &.is-active, etc.)
    require('tailwindcss/nesting'),

    // 2️⃣  Gère les @import dans tes CSS
    require('postcss-import'),

    // 3️⃣  Génère toutes les classes utilitaires Tailwind
    require('tailwindcss'),

    // 4️⃣  Ajoute les préfixes CSS nécessaires (compatibilité navigateurs)
    require('autoprefixer'),

    // 5️⃣  Minifie uniquement en production
    ...(process.env.HUGO_ENVIRONMENT === 'production'
      ? [require('cssnano')({ preset: 'default' })]
      : []),
  ],
};
