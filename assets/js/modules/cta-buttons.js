// assets/js/modules/cta-buttons.js - Version avec export

export function initCTAButtons() {
  console.log('JavaScript CTA chargé');

  // BOUTON PINTEREST PIN
  const pinterestPinButton = document.getElementById('pinterestPinButton');
  if (pinterestPinButton) {
    console.log('Pinterest button trouvé');
    pinterestPinButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Pinterest clicked');
      
      const url = encodeURIComponent(window.location.href);
      const description = encodeURIComponent(document.title);
      const image = document.querySelector('meta[property="og:image"]')?.content || '';
      const imageUrl = encodeURIComponent(image);
      
      const pinterestUrl = `https://pinterest.com/pin/create/button/?url=${url}&description=${description}&media=${imageUrl}`;
      window.open(pinterestUrl, '_blank', 'width=600,height=400');
    });
  } else {
    console.log('Pinterest button NOT found');
  }

  // BOUTON PARTAGER (Toggle menu)
  const shareButton = document.getElementById('shareButton');
  const shareMenu = document.getElementById('shareMenu');
  
  if (shareButton && shareMenu) {
    console.log('Share button et menu trouvés');
    
    shareButton.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('Share button clicked');
      
      shareMenu.classList.toggle('opacity-0');
      shareMenu.classList.toggle('invisible');
    });
    
    // Fermer le menu en cliquant ailleurs
    document.addEventListener('click', function(e) {
      if (!shareButton.contains(e.target) && !shareMenu.contains(e.target)) {
        shareMenu.classList.add('opacity-0');
        shareMenu.classList.add('invisible');
      }
    });
  } else {
    console.log('Share button ou menu NOT found');
  }

  // BOUTON EMAIL
  const emailButton = document.getElementById('emailButton');
  if (emailButton) {
    console.log('Email button trouvé');
    emailButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Email clicked');
      
      const subject = encodeURIComponent(document.title);
      const body = encodeURIComponent(`Découvrez cette recette : ${window.location.href}`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      
      // Fermer le menu
      if (shareMenu) {
        shareMenu.classList.add('opacity-0');
        shareMenu.classList.add('invisible');
      }
    });
  }
  
  // BOUTON WHATSAPP
  const whatsappButton = document.getElementById('whatsappButton');
  if (whatsappButton) {
    console.log('WhatsApp button trouvé');
    whatsappButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('WhatsApp clicked');
      
      const text = encodeURIComponent(`${document.title} - ${window.location.href}`);
      window.open(`https://wa.me/?text=${text}`, '_blank');
      
      // Fermer le menu
      if (shareMenu) {
        shareMenu.classList.add('opacity-0');
        shareMenu.classList.add('invisible');
      }
    });
  }
  
  // BOUTON PINTEREST (dans le menu)
  const pinterestMenuButton = document.getElementById('pinterestButton');
  if (pinterestMenuButton) {
    console.log('Pinterest menu button trouvé');
    pinterestMenuButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Pinterest menu clicked');
      
      const url = encodeURIComponent(window.location.href);
      const description = encodeURIComponent(document.title);
      const image = document.querySelector('meta[property="og:image"]')?.content || '';
      const imageUrl = encodeURIComponent(image);
      
      const pinterestUrl = `https://pinterest.com/pin/create/button/?url=${url}&description=${description}&media=${imageUrl}`;
      window.open(pinterestUrl, '_blank', 'width=600,height=400');
      
      // Fermer le menu
      if (shareMenu) {
        shareMenu.classList.add('opacity-0');
        shareMenu.classList.add('invisible');
      }
    });
  }
  
  // BOUTON INSTAGRAM
  const instagramButton = document.getElementById('instagramButton');
  if (instagramButton) {
    console.log('Instagram button trouvé');
    instagramButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Instagram clicked');
      
      // Copier le lien pour Instagram
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).then(() => {
          showToast('Lien copié pour Instagram !');
        }).catch(() => {
          fallbackCopyLink('Lien copié pour Instagram !');
        });
      } else {
        fallbackCopyLink('Lien copié pour Instagram !');
      }
      
      // Fermer le menu
      if (shareMenu) {
        shareMenu.classList.add('opacity-0');
        shareMenu.classList.add('invisible');
      }
    });
  }
  
  // BOUTON COPIER LIEN
  const copyLinkButton = document.getElementById('copyLinkButton');
  if (copyLinkButton) {
    console.log('Copy link button trouvé');
    copyLinkButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Copy link clicked');
      
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).then(() => {
          showToast('Lien copié !');
        }).catch(() => {
          fallbackCopyLink('Lien copié !');
        });
      } else {
        fallbackCopyLink('Lien copié !');
      }
      
      // Fermer le menu
      if (shareMenu) {
        shareMenu.classList.add('opacity-0');
        shareMenu.classList.add('invisible');
      }
    });
  }

  // BOUTON IMPRIMER
  const printButton = document.getElementById('printButton');
  if (printButton) {
    console.log('Print button trouvé');
    printButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('Print clicked');
      window.print();
    });
  }
}

// Fonction pour afficher les notifications toast
function showToast(message) {
  console.log('Toast:', message);
  
  // Supprimer les anciens toasts
  const existingToasts = document.querySelectorAll('.toast-notification');
  existingToasts.forEach(toast => toast.remove());
  
  const toast = document.createElement('div');
  toast.className = 'toast-notification fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 transition-all duration-300';
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(100%)';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Animation d'entrée
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  }, 10);
  
  // Suppression après 3s
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Fonction de fallback pour copier le lien
function fallbackCopyLink(message = 'Lien copié !') {
  console.log('Fallback copy');
  
  const input = document.createElement('input');
  input.value = window.location.href;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);
  input.select();
  
  try {
    document.execCommand('copy');
    showToast(message);
  } catch (err) {
    console.error('Erreur copie:', err);
    showToast('Erreur lors de la copie');
  }
  
  document.body.removeChild(input);
}
