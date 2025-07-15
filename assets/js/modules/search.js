/* assets/js/modules/search.js - Version LAZY optimisée */

// Variables globales pour le lazy loading
let searchIndex = null;
let searchReady = false;
let isLoading = false;

export function initSearch() {
  // Vérifier que Fuse est disponible
  if (typeof window.Fuse === 'undefined') {
    console.warn('⚠️ Fuse.js non disponible');
    return;
  }

  // ✅ PAS de chargement immédiat - seulement setup
  setupSearchUI();
  console.log('✅ Recherche initialisée (lazy mode)');
}

// Setup de l'interface sans charger l'index
function setupSearchUI() {
  // Gérer desktop et mobile
  const searchers = [
    {
      input: document.getElementById('search-input'),
      results: document.getElementById('search-results-input'),
      type: 'desktop'
    },
    {
      input: document.getElementById('search-mobile-input'),
      results: document.getElementById('search-results-mobile-input'),
      type: 'mobile'
    }
  ];

  // Configurer chaque searcher avec lazy loading
  searchers.forEach(({ input, results, type }) => {
    if (!input || !results) {
      console.warn(`⚠️ Éléments manquants pour ${type}`);
      return;
    }

    setupSearcherWithLazy(input, results, type);
  });
}

// Configuration d'un searcher avec chargement lazy
function setupSearcherWithLazy(input, results, type) {
  let debounceTimer = null;
  let selectedIndex = -1;

  // 🚀 LAZY LOADING : Charger l'index au premier focus
  input.addEventListener('focus', async () => {
    await ensureSearchReady();
  });

  // 🚀 LAZY LOADING : Aussi au premier input significatif
  input.addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    
    if (query.length >= 2) {
      await ensureSearchReady();
    }
    
    if (searchReady) {
      performSearch(query);
    } else if (query) {
      showLoadingState(results);
    }
  });

  // Fonction pour s'assurer que la recherche est prête
  async function ensureSearchReady() {
    if (searchReady || isLoading) return;
    
    isLoading = true;
    console.log('🔄 Chargement de l\'index de recherche...');
    
    try {
      const recipes = await loadSearchIndex();
      if (recipes.length > 0) {
        setupSearch(recipes);
        searchReady = true;
        console.log(`✅ Index chargé: ${recipes.length} recettes`);
      }
    } catch (error) {
      console.error('❌ Erreur chargement lazy:', error);
    } finally {
      isLoading = false;
    }
  }

  // Handler Enter optimisé
  function handleEnterKey(e) {
    if (e.key !== 'Enter') return;
    
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    if (type === 'mobile') {
      e.target.blur();
      return false;
    }
    
    if (!input.value.trim()) return false;
    
    const items = results.querySelectorAll('.search__result');
    if (selectedIndex >= 0 && items[selectedIndex]) {
      const link = items[selectedIndex].querySelector('a');
      if (link) {
        window.location.href = link.href;
        return false;
      }
    }
    
    if (items.length > 0) {
      const firstLink = items[0].querySelector('a');
      if (firstLink) {
        window.location.href = firstLink.href;
        return false;
      }
    }
    
    return false;
  }

  input.addEventListener('keydown', handleEnterKey, true);
  input.addEventListener('keypress', handleEnterKey, true);

  // Fonction de recherche optimisée
  function performSearch(query) {
    clearTimeout(debounceTimer);
    
    if (!query.trim()) {
      renderResults([]);
      return;
    }
    
    if (!searchReady) {
      showLoadingState(results);
      return;
    }
    
    debounceTimer = setTimeout(() => {
      const searchResults = searchIndex.search(query);
      renderResults(searchResults);
    }, 200); // Plus rapide
  }

  // État de chargement
  function showLoadingState(resultsEl) {
    resultsEl.innerHTML = `
      <div class="search__result">
        <div class="search__loading" style="padding: 1rem; text-align: center; color: var(--gray-500);">
          ⏳ Chargement de la recherche...
        </div>
      </div>
    `;
    resultsEl.classList.remove('hidden');
  }

  // ✅ Fonction de rendu - CLASSES ALIGNÉES SUR TON CSS
  function renderResults(searchResults) {
    results.innerHTML = '';
    const hasResults = searchResults.length > 0;
    
    results.classList.toggle('hidden', !hasResults);
    input.setAttribute('aria-expanded', hasResults);
    
    if (!hasResults) {
      selectedIndex = -1;
      return;
    }

    searchResults.forEach((result, index) => {
      const resultItem = document.createElement('div');
      resultItem.className = 'search__result';
      resultItem.setAttribute('role', 'option');
      resultItem.setAttribute('aria-selected', index === selectedIndex);
      
      const title = result.item.title;
      resultItem.innerHTML = `
        <a href="${result.item.url}" class="search__result-link">
          <div class="search__result-title">${title}</div>
          ${result.item.categories && result.item.categories.length > 0 ? `
            <div class="search__result-category">
              ${Array.isArray(result.item.categories) ? result.item.categories.join(', ') : result.item.categories}
            </div>
          ` : ''}
        </a>
      `;
      
      results.appendChild(resultItem);
    });
  }

  // Navigation clavier (flèches, escape)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') return;
    
    const items = results.querySelectorAll('.search__result');
    if (!items.length) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        updateSelection(items);
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = selectedIndex <= 0 ? items.length - 1 : selectedIndex - 1;
        updateSelection(items);
        break;
        
      case 'Escape':
        e.preventDefault();
        input.value = '';
        renderResults([]);
        input.blur();
        break;
    }
  });

  // Mettre à jour la sélection visuelle
  function updateSelection(items) {
    items.forEach((item, index) => {
      const isSelected = index === selectedIndex;
      item.setAttribute('aria-selected', isSelected);
      
      if (isSelected) {
        item.style.backgroundColor = 'var(--color-bg-alt)';
        item.style.borderLeft = '3px solid var(--primary)';
        item.style.paddingLeft = 'calc(var(--space-5) - 3px)';
      } else {
        item.style.backgroundColor = '';
        item.style.borderLeft = '';
        item.style.paddingLeft = '';
      }
    });
    
    if (items[selectedIndex]) {
      items[selectedIndex].scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }

  // Focus/blur pour afficher/cacher les résultats
  input.addEventListener('focus', () => {
    if (results.children.length > 0) {
      results.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      results.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
      selectedIndex = -1;
    }, 200);
  });
}

// Charger l'index JSON (inchangé mais appelé en lazy)
async function loadSearchIndex() {
  try {
    const response = await fetch('/index.json');
    if (!response.ok) throw new Error('Index non trouvé');
    return await response.json();
  } catch (error) {
    console.error('Erreur fetch:', error);
    return [];
  }
}

// Configurer la recherche (appelé après chargement lazy)
function setupSearch(recipes) {
  // Configuration Fuse optimisée
  const fuseOptions = {
    keys: ['title'],
    threshold: 0.3,             // Un peu plus permissif
    includeMatches: false,
    minMatchCharLength: 2,      // 2 caractères minimum
    ignoreLocation: true,
    useExtendedSearch: false,
    shouldSort: false           // Plus rapide
  };

  searchIndex = new window.Fuse(recipes, fuseOptions);
  console.log(`🔍 Fuse configuré avec ${recipes.length} recettes`);
}
