/* assets/js/main.js - Point d'entrée JavaScript principal */

// Import des modules
import { initSearch } from './modules/search.js';
import { initContactForm } from './modules/contact-form.js';
import { initRandomHome } from './modules/random-home.js';
import { initStickyNav } from './modules/recipe-sticky-nav.js';
import { initCTAButtons } from './modules/cta-buttons.js';

// Gestionnaire principal de l'application
class App {
  constructor() {
    this.modules = new Map();
    this.initialized = false;
  }

  // Initialisation avec gestion d'erreurs
  async init() {
    if (this.initialized) return;
    
    try {
      // Attendre que le DOM soit prêt
      await this.domReady();
      
      // Initialiser les modules de base
      this.initCoreModules();
      
      // Initialiser les modules spécifiques aux pages
      this.initPageModules();
      
      // Modules globaux
      this.initGlobalFeatures();
      
      this.initialized = true;
      console.log('✅ Application initialisée');
      
    } catch (error) {
      console.error('❌ Erreur d\'initialisation:', error);
      this.handleError(error);
    }
  }

  // Attendre que le DOM soit prêt
  domReady() {
    return new Promise(resolve => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve);
      } else {
        resolve();
      }
    });
  }

  // Modules de base (header, navigation)
  initCoreModules() {
    // Header mobile
    this.initMobileMenu();
    
    // Recherche
    this.initSearchModule();
    
    // Smooth scrolling
    this.initSmoothScroll();
  }

  // Modules spécifiques aux pages
  initPageModules() {
    const { pathname } = window.location;
    
    // Page d'accueil avec redirection aléatoire
    if (document.body.dataset.randomRecipes) {
      this.modules.set('randomHome', initRandomHome());
    }
    
    // Pages de recettes
    if (pathname.includes('/recipes/') && document.getElementById('stickyNav')) {
      this.modules.set('stickyNav', initStickyNav());
    }
    
    // Page de contact
    if (document.getElementById('contact-form')) {
      this.modules.set('contactForm', initContactForm());
    }
    
    // Boutons CTA sur les recettes
    if (document.querySelector('.cta-buttons-container')) {
      this.modules.set('ctaButtons', initCTAButtons());
    }
  }

  // Fonctionnalités globales
  initGlobalFeatures() {
    // Lazy loading des images
    this.initLazyLoading();
    
    // Service Worker pour le cache
    this.initServiceWorker();
    

    
    // ===== NOUVEAUX AJOUTS =====
    // Scroll to top button
    this.initScrollToTop();
    
    // Filter reset button  
    this.initFilterReset();
  }

  // Menu mobile amélioré
  initMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const menu = document.getElementById('mobile-menu');
    const searchToggle = document.getElementById('mobile-search-toggle');
    const searchMenu = document.getElementById('mobile-search');
    const menuIcon = document.getElementById('menu-icon');
    const closeIcon = document.getElementById('close-icon');
    
    if (!toggle || !menu) return;
    
    // État du menu
    let menuOpen = false;
    let searchOpen = false;
    
    // 🔧 FIX : Fonction pour fermer tous les menus
    const closeAllMenus = () => {
      if (menuOpen) {
        menuOpen = false;
        this.toggleMenu(menu, false);
        if (menuIcon && closeIcon) {
          menuIcon.classList.remove('hidden');
          closeIcon.classList.add('hidden');
        }
        toggle.setAttribute('aria-expanded', false);
      }
      
      if (searchOpen && searchMenu) {
        searchOpen = false;
        this.toggleMenu(searchMenu, false);
      }
    };

    // 🎯 FIX : Écouter la navigation (bouton précédent)
    window.addEventListener('pageshow', (event) => {
      // Se déclenche quand on revient sur la page (bouton précédent)
      if (event.persisted || (performance.navigation && performance.navigation.type === performance.navigation.TYPE_BACK_FORWARD)) {
        closeAllMenus();
      }
    });

    // 🎯 FIX : Écouter popstate (navigation dans l'historique)
    window.addEventListener('popstate', () => {
      closeAllMenus();
    });

    // 🎯 FIX : Fermer les menus avant de naviguer (clic sur lien menu)
    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        // Un lien dans le menu a été cliqué
        closeAllMenus();
      }
    });

    // 🎯 FIX : Fermer la recherche mobile avant de naviguer
    if (searchMenu) {
      searchMenu.addEventListener('click', (e) => {
        // Si on clique sur un lien de recherche (résultat)
        if (e.target.tagName === 'A' || e.target.closest('a')) {
          closeAllMenus();
        }
      });
    }
    
    // Toggle menu
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menuOpen = !menuOpen;
      this.toggleMenu(menu, menuOpen);
      
      // Icônes
      if (menuIcon && closeIcon) {
        menuIcon.classList.toggle('hidden', menuOpen);
        closeIcon.classList.toggle('hidden', !menuOpen);
      }
      
      // Aria
      toggle.setAttribute('aria-expanded', menuOpen);
      
      // Fermer la recherche si ouverte
      if (searchOpen && searchMenu) {
        searchOpen = false;
        this.toggleMenu(searchMenu, false);
      }
    });
    
    // Toggle recherche
    if (searchToggle && searchMenu) {
      searchToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        searchOpen = !searchOpen;
        this.toggleMenu(searchMenu, searchOpen);
        
        // Fermer le menu si ouvert
        if (menuOpen) {
          menuOpen = false;
          this.toggleMenu(menu, false);
          if (menuIcon && closeIcon) {
            menuIcon.classList.remove('hidden');
            closeIcon.classList.add('hidden');
          }
          toggle.setAttribute('aria-expanded', false);
        }
        
        // Focus sur l'input de recherche
        if (searchOpen) {
          const input = searchMenu.querySelector('input');
          if (input) setTimeout(() => input.focus(), 100);
        }
      });
    }
    
    // Fermer en cliquant ailleurs
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target) && !toggle.contains(event.target)) {
        if (menuOpen) {
          menuOpen = false;
          this.toggleMenu(menu, false);
          if (menuIcon && closeIcon) {
            menuIcon.classList.remove('hidden');
            closeIcon.classList.add('hidden');
          }
          toggle.setAttribute('aria-expanded', false);
        }
      }
      
      if (searchMenu && !searchMenu.contains(event.target) && !searchToggle.contains(event.target)) {
        if (searchOpen) {
          searchOpen = false;
          this.toggleMenu(searchMenu, false);
        }
      }
    });
    
    // Fermer avec Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (menuOpen) {
          menuOpen = false;
          this.toggleMenu(menu, false);
          if (menuIcon && closeIcon) {
            menuIcon.classList.remove('hidden');
            closeIcon.classList.add('hidden');
          }
          toggle.setAttribute('aria-expanded', false);
          toggle.focus();
        }
        if (searchOpen && searchMenu) {
          searchOpen = false;
          this.toggleMenu(searchMenu, false);
          if (searchToggle) searchToggle.focus();
        }
      }
    });
  }

  // Méthode pour toggle les menus
  toggleMenu(element, show) {
    if (show) {
      element.classList.remove('hidden');
      // Animation d'entrée
      requestAnimationFrame(() => {
        element.classList.add('animate-slide-in-down');
      });
    } else {
      element.classList.add('hidden');
      element.classList.remove('animate-slide-in-down');
    }
  }

  // Module de recherche
  initSearchModule() {
    // Attendre que Fuse soit chargé
    if (typeof window.Fuse === 'undefined') {
      // Réessayer après un délai
      setTimeout(() => this.initSearchModule(), 500);
      return;
    }
    
    initSearch();
  }

  // Smooth scrolling pour les ancres
  initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        const targetId = anchor.getAttribute('href');
        if (targetId === '#') return;
        
        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
          
          // Mettre à jour l'URL sans scroll
          history.pushState(null, null, targetId);
        }
      });
    });
  }

  // Lazy loading des images
  initLazyLoading() {
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src || img.src;
            img.classList.add('fade-in');
            observer.unobserve(img);
          }
        });
      });
      
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        imageObserver.observe(img);
      });
    }
  }

  // Service Worker
  initServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('✅ Service Worker enregistré:', registration.scope);
        })
        .catch(error => {
          console.error('❌ Erreur Service Worker:', error);
        });
    }
  }

 

  // ===== NOUVELLES MÉTHODES =====
  
  // Scroll to top functionality
  initScrollToTop() {
    const scrollTopBtn = document.getElementById('scrollToTop');
    if (!scrollTopBtn) return;
    
    // Click handler
    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
    
    // Show/hide based on scroll position
    const toggleVisibility = () => {
      if (window.pageYOffset > 300) {
        scrollTopBtn.style.opacity = '1';
        scrollTopBtn.style.visibility = 'visible';
      } else {
        scrollTopBtn.style.opacity = '0';
        scrollTopBtn.style.visibility = 'hidden';
      }
    };
    
    // Initial state
    scrollTopBtn.style.opacity = '0';
    scrollTopBtn.style.visibility = 'hidden';
    scrollTopBtn.style.transition = 'opacity 0.3s ease, visibility 0.3s ease';
    
    // Listen to scroll
    window.addEventListener('scroll', toggleVisibility);
  }

  // Filter reset functionality
  initFilterReset() {
    const filterResetBtn = document.getElementById('filter-reset');
    if (!filterResetBtn) return;
    
    filterResetBtn.addEventListener('click', () => {
      // Reset all filter elements
      const categoryFilter = document.getElementById('filter-category');
      const tagFilter = document.getElementById('filter-tag');
      const timeFilter = document.getElementById('filter-time');
      const searchInput = document.querySelector('.search-input');
      
      // Reset values
      if (categoryFilter) categoryFilter.selectedIndex = 0;
      if (tagFilter) tagFilter.selectedIndex = 0; 
      if (timeFilter) timeFilter.value = '';
      if (searchInput) searchInput.value = '';
      
      // Trigger filter update if function exists
      if (typeof window.filterRecipes === 'function') {
        window.filterRecipes();
      }
      
      // Dispatch custom event for other modules
      document.dispatchEvent(new CustomEvent('filtersReset'));
    });
  }

  // Gestion des erreurs
  handleError(error) {
    // Logger l'erreur
    console.error('Erreur application:', error);
    
    // Notification utilisateur (si critique)
    if (error.critical) {
      this.showNotification('Une erreur est survenue. Veuillez rafraîchir la page.', 'error');
    }
  }

  // Notification
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Styles
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '12px 20px',
      borderRadius: '6px',
      backgroundColor: type === 'error' ? '#ef4444' : '#10b981',
      color: 'white',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      zIndex: '9999',
      transform: 'translateX(400px)',
      transition: 'transform 0.3s ease'
    });
    
    document.body.appendChild(notification);
    
    // Animation d'entrée
    requestAnimationFrame(() => {
      notification.style.transform = 'translateX(0)';
    });
    
    // Suppression après 3 secondes
    setTimeout(() => {
      notification.style.transform = 'translateX(400px)';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Créer et initialiser l'application
const app = new App();

// Initialiser selon l'état du DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// Exporter pour les tests
export default app;
