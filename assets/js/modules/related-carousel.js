// assets/js/modules/related-carousel.js
export function initRelatedCarousel() {
  const rails = document.querySelectorAll("[data-related-rail]");
  if (!rails.length) return null;

  const instances = [];

  rails.forEach((rail) => {
    const interval = parseInt(rail.getAttribute("data-related-interval") || "3000", 10);
    const resumeDelay = parseInt(rail.getAttribute("data-related-resume") || "4000", 10);

    let timer = null;
    let resumeTimeout = null;

    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let dragged = false;

    const stopAuto = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const startAuto = () => {
      stopAuto();
      timer = setInterval(() => {
        const maxScroll = rail.scrollWidth - rail.clientWidth - 2;

        // On avance "par écran" (donc 3 cartes => 3 nouvelles cartes)
        const step = rail.clientWidth;

        const next = rail.scrollLeft + step;

        rail.scrollTo({
          left: next >= maxScroll ? 0 : next,
          behavior: "smooth",
        });
      }, interval);
    };

    const scheduleResume = () => {
      if (resumeTimeout) clearTimeout(resumeTimeout);
      resumeTimeout = setTimeout(startAuto, resumeDelay);
    };

    // Mouse drag (prise de contrôle au clic)
    rail.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      isDown = true;
      dragged = false;
      stopAuto();

      startX = e.pageX;
      startScrollLeft = rail.scrollLeft;

      rail.classList.add("is-dragging");
      rail.style.scrollBehavior = "auto";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDown) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > 6) dragged = true;
      rail.scrollLeft = startScrollLeft - dx;
    });

    window.addEventListener("mouseup", () => {
      if (!isDown) return;
      isDown = false;
      rail.classList.remove("is-dragging");
      rail.style.scrollBehavior = "smooth";
      scheduleResume();
    });

    // Touch
    rail.addEventListener("touchstart", stopAuto, { passive: true });
    rail.addEventListener("touchend", scheduleResume, { passive: true });
    rail.addEventListener("touchcancel", scheduleResume, { passive: true });

    // Bloquer clic si drag
    rail.addEventListener(
      "click",
      (e) => {
        if (!dragged) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true
    );

    startAuto();

    instances.push({
      stop: () => {
        stopAuto();
        if (resumeTimeout) clearTimeout(resumeTimeout);
      },
    });
  });

  return instances;
}
