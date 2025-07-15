// assets/js/modules/recipe-sticky-nav.js - Version avec export
export function initStickyNav() {
  console.log('Sticky Nav JavaScript chargé');
  const nav = document.getElementById('stickyNav');
  if (!nav) {
    console.log('Sticky nav NOT found');
    return;
  }
  console.log('Sticky nav trouvé');
  
  // —— Highlight au scroll ——
  const sections = ['ingredients', 'steps', 'faq'];
  
  function highlightNav() {
    let active = 'ingredients';
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= 120) {
        active = id;
      }
    }
    
    // Mettre à jour les liens actifs
    document.querySelectorAll('#stickyNav .navLink').forEach(a => {
      const isActive = a.dataset.target === active;
      if (isActive) {
        a.classList.add('text-red-500');
        a.classList.remove('text-gray-600');
      } else {
        a.classList.add('text-gray-600');
        a.classList.remove('text-red-500');
      }
    });
  }
  
  document.addEventListener('scroll', () => requestAnimationFrame(highlightNav));
  highlightNav(); // Init
  
  // —— Toggle Pin ——  
  const pinBtn = document.getElementById('navPinBtn');
  const pinIcon = document.getElementById('navPinIcon');
  
  if (!pinBtn) {
    console.log('Pin button NOT found');
    return;
  }
  console.log('Pin button trouvé');
  
  function togglePin() {
    // OUVRIR PINTEREST POUR ÉPINGLER SUR LE COMPTE DU VISITEUR
    console.log('Opening Pinterest to pin to user account');
    
    const url = encodeURIComponent(window.location.href);
    const description = encodeURIComponent(document.title);
    const image = document.querySelector('meta[property="og:image"]')?.content || '';
    const imageUrl = encodeURIComponent(image);
    
    const pinterestUrl = `https://pinterest.com/pin/create/button/?url=${url}&description=${description}&media=${imageUrl}`;
    window.open(pinterestUrl, '_blank', 'width=600,height=400');
  }
  
  pinBtn.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('Pin button clicked - opening Pinterest');
    togglePin();
  });
  
  // Couleur par défaut pour le bouton Pinterest
  pinBtn.classList.add('text-red-500');
}
