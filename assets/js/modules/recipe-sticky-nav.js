// assets/js/modules/recipe-sticky-nav.js - Version OPTIMISÉE
export function initStickyNav() {
  const nav = document.getElementById('stickyNav');
  if (!nav) return;
  
  // Cache des éléments pour éviter les requêtes DOM répétées
  const sections = ['ingredients', 'steps', 'faq'];
  const sectionElements = sections.map(id => ({
    id,
    element: document.getElementById(id)
  })).filter(item => item.element);
  
  const navLinks = document.querySelectorAll('#stickyNav .navLink');
  
  // Throttle pour limiter les calculs
  let ticking = false;
  let currentActive = 'ingredients';
  
  function highlightNav() {
    // ✅ GROUPE TOUTES LES LECTURES d'abord
    const positions = sectionElements.map(({ id, element }) => ({
      id,
      top: element.getBoundingClientRect().top
    }));
    
    // ✅ Calcul de l'active sans toucher au DOM
    let newActive = 'ingredients';
    for (const { id, top } of positions) {
      if (top <= 120) {
        newActive = id;
      }
    }
    
    // ✅ Ne met à jour que si ça a changé (évite les écritures inutiles)
    if (newActive !== currentActive) {
      currentActive = newActive;
      
      // ✅ GROUPE TOUTES LES ÉCRITURES
      navLinks.forEach(link => {
        const isActive = link.dataset.target === currentActive;
        // Utilisation de toggle pour moins d'opérations DOM
        link.classList.toggle('text-red-500', isActive);
        link.classList.toggle('text-gray-600', !isActive);
      });
    }
    
    ticking = false;
  }
  
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(highlightNav);
      ticking = true;
    }
  }
  
  // ✅ Throttled scroll listener
  document.addEventListener('scroll', onScroll, { passive: true });
  highlightNav(); // Init
  
  // —— Pinterest Pin (inchangé) ——  
  const pinBtn = document.getElementById('navPinBtn');
  if (!pinBtn) return;
  
  function togglePin() {
    const url = encodeURIComponent(window.location.href);
    const description = encodeURIComponent(document.title);
    const image = document.querySelector('meta[property="og:image"]')?.content || '';
    const imageUrl = encodeURIComponent(image);
    
    const pinterestUrl = `https://pinterest.com/pin/create/button/?url=${url}&description=${description}&media=${imageUrl}`;
    window.open(pinterestUrl, '_blank', 'width=600,height=400');
  }
  
  pinBtn.addEventListener('click', function(e) {
    e.preventDefault();
    togglePin();
  });
  
  pinBtn.classList.add('text-red-500');
}
