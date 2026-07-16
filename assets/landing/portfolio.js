(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const hero = document.querySelector('[data-hero-video]');
  if (hero && reducedMotion.matches) hero.pause();

  const sectionVideos = [...document.querySelectorAll('[data-section-video]')];
  if (!reducedMotion.matches && sectionVideos.length) {
    const loadSectionVideo = (video) => {
      if (!video.src && video.dataset.src) {
        video.src = video.dataset.src;
        video.load();
      }
      video.play().catch(() => {});
    };
    if ('IntersectionObserver' in window) {
      const sectionVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) loadSectionVideo(entry.target);
          else entry.target.pause();
        });
      }, {rootMargin: '240px 0px', threshold: .04});
      sectionVideos.forEach((video) => sectionVideoObserver.observe(video));
    } else sectionVideos.forEach(loadSectionVideo);
  }

  const film = document.querySelector('[data-explainer]');
  if (film) {
    const loadFilm = () => {
      if (!film.src && film.dataset.src) {
        film.pause();
        film.src = film.dataset.src;
        film.load();
        film.addEventListener('loadedmetadata', () => {
          film.pause();
          film.currentTime = 0;
        }, {once: true});
      }
    };
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadFilm();
          observer.disconnect();
        }
      }, {rootMargin: '300px'});
      observer.observe(film);
    } else loadFilm();
  }

  const opticsVideo = document.querySelector('[data-instrument-video]');
  const opticsToggle = document.querySelector('[data-optics-toggle]');
  if (opticsVideo && opticsToggle) {
    const syncOpticsToggle = () => {
      const playing = !opticsVideo.paused && !opticsVideo.ended;
      opticsToggle.textContent = playing ? 'Pause' : 'Play';
      opticsToggle.setAttribute('aria-pressed', String(playing));
    };
    const loadOpticsVideo = (shouldPlay) => {
      if (!opticsVideo.src && opticsVideo.dataset.src) {
        opticsVideo.src = opticsVideo.dataset.src;
        opticsVideo.load();
      }
      if (shouldPlay) opticsVideo.play().catch(syncOpticsToggle);
    };
    opticsToggle.addEventListener('click', () => {
      if (opticsVideo.paused) loadOpticsVideo(true);
      else opticsVideo.pause();
    });
    opticsVideo.addEventListener('play', syncOpticsToggle);
    opticsVideo.addEventListener('pause', syncOpticsToggle);
    if (!reducedMotion.matches) {
      if ('IntersectionObserver' in window) {
        const opticsObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) loadOpticsVideo(true);
            else opticsVideo.pause();
          });
        }, {rootMargin: '160px 0px', threshold: .08});
        opticsObserver.observe(opticsVideo);
      } else loadOpticsVideo(true);
    }
    syncOpticsToggle();
  }

  const reveals = [...document.querySelectorAll('.reveal')];
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    reveals.forEach((element) => element.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, {threshold: .12});
    reveals.forEach((element) => observer.observe(element));
  }

  const gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    fetch('assets/landing/telescope-gallery.json')
      .then((response) => response.json())
      .then((items) => {
        const approved = items.filter((item) => item && item.src && item.alt && item.permission_reference && (item.is_owner || item.creator));
        if (!approved.length) return;
        const grid = gallery.querySelector('.gallery-grid');
        const lightbox = document.querySelector('[data-capture-lightbox]');
        const lightboxImage = lightbox && lightbox.querySelector('[data-lightbox-image]');
        const lightboxTitle = lightbox && lightbox.querySelector('[data-lightbox-title]');
        const lightboxMeta = lightbox && lightbox.querySelector('[data-lightbox-meta]');
        const lightboxCount = lightbox && lightbox.querySelector('[data-lightbox-count]');
        const closeButton = lightbox && lightbox.querySelector('[data-lightbox-close]');
        const previousButton = lightbox && lightbox.querySelector('[data-lightbox-prev]');
        const nextButton = lightbox && lightbox.querySelector('[data-lightbox-next]');
        let activeIndex = 0;
        let previousFocus = null;
        let pointerStartX = null;

        const showImage = (index) => {
          if (!lightbox || !lightboxImage || !lightboxTitle || !lightboxMeta || !lightboxCount) return;
          activeIndex = (index + approved.length) % approved.length;
          const item = approved[activeIndex];
          lightboxImage.src = item.src;
          lightboxImage.alt = item.alt;
          lightboxTitle.textContent = item.object || item.category || 'Personal telescope capture';
          lightboxMeta.textContent = [item.catalog, item.capture_details, item.distance].filter(Boolean).join(' · ');
          lightboxCount.textContent = `${activeIndex + 1} / ${approved.length}`;
        };
        const openLightbox = (index) => {
          if (!lightbox || !closeButton) return;
          previousFocus = document.activeElement;
          showImage(index);
          lightbox.hidden = false;
          document.body.classList.add('lightbox-open');
          requestAnimationFrame(() => closeButton.focus());
        };
        const closeLightbox = () => {
          if (!lightbox || lightbox.hidden) return;
          lightbox.hidden = true;
          document.body.classList.remove('lightbox-open');
          if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        };
        const moveLightbox = (step) => showImage(activeIndex + step);

        if (lightbox && closeButton && previousButton && nextButton) {
          closeButton.addEventListener('click', closeLightbox);
          previousButton.addEventListener('click', () => moveLightbox(-1));
          nextButton.addEventListener('click', () => moveLightbox(1));
          lightbox.addEventListener('click', (event) => {
            if (event.target === lightbox) closeLightbox();
          });
          lightbox.addEventListener('pointerdown', (event) => {
            if (event.pointerType !== 'mouse') pointerStartX = event.clientX;
          });
          lightbox.addEventListener('pointerup', (event) => {
            if (pointerStartX === null || event.pointerType === 'mouse') return;
            const movement = event.clientX - pointerStartX;
            pointerStartX = null;
            if (Math.abs(movement) > 50) moveLightbox(movement > 0 ? -1 : 1);
          });
          document.addEventListener('keydown', (event) => {
            if (lightbox.hidden) return;
            if (event.key === 'Escape') closeLightbox();
            else if (event.key === 'ArrowLeft') moveLightbox(-1);
            else if (event.key === 'ArrowRight') moveLightbox(1);
            else if (event.key === 'Tab') {
              const controls = [closeButton, previousButton, nextButton];
              const current = controls.indexOf(document.activeElement);
              if (event.shiftKey && current <= 0) {
                event.preventDefault();
                nextButton.focus();
              } else if (!event.shiftKey && current === controls.length - 1) {
                event.preventDefault();
                closeButton.focus();
              }
            }
          });
        }

        approved.forEach((item, index) => {
          const figure = document.createElement('figure');
          figure.className = 'telescope-capture';
          const media = document.createElement('button');
          media.className = 'capture-media';
          media.type = 'button';
          media.setAttribute('aria-haspopup', 'dialog');
          media.setAttribute('aria-label', `View ${item.object || 'telescope capture'} full screen`);
          media.addEventListener('click', () => openLightbox(index));
          const image = document.createElement('img');
          image.src = item.thumb_src || item.src;
          image.alt = item.alt;
          image.loading = 'lazy';
          image.draggable = false;
          image.width = 1280;
          image.height = 720;
          const caption = document.createElement('figcaption');
          caption.className = 'capture-caption';
          const type = document.createElement('p');
          type.className = 'capture-type';
          type.textContent = item.category || 'Personal telescope capture';
          const title = document.createElement('h3');
          title.textContent = item.object || item.category || 'Personal telescope example';
          const catalog = document.createElement('p');
          catalog.className = 'capture-catalog';
          catalog.textContent = item.catalog || (item.is_owner ? 'Owner-supplied image' : `Image: ${item.creator}`);
          const details = document.createElement('dl');
          details.className = 'capture-meta';
          [
            ['Stack', item.capture_details],
            ['Distance', item.distance],
            ['Captured', item.captured_at],
            ['Constellation', item.constellation],
          ].filter(([, value]) => value).forEach(([term, value]) => {
            const group = document.createElement('div');
            const dt = document.createElement('dt');
            const dd = document.createElement('dd');
            dt.textContent = term;
            dd.textContent = value;
            group.append(dt, dd);
            details.append(group);
          });
          caption.append(type, title, catalog, details);
          if (item.source_url) {
            const source = document.createElement('a');
            source.className = 'capture-source';
            source.href = item.source_url;
            source.target = '_blank';
            source.rel = 'noreferrer';
            source.textContent = 'NASA object reference ↗';
            caption.append(source);
          }
          media.append(image);
          figure.append(media, caption);
          grid.append(figure);
        });
        gallery.hidden = false;
      })
      .catch(() => {});
  }
})();
