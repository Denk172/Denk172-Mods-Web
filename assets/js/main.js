(() => {
      const root = document.documentElement;
      const button = document.querySelector('.theme-toggle');
      const themeColor = document.querySelector('meta[name="theme-color"]');
      const description = document.querySelector('meta[name="description"]');
      const czechDescription = description.content;
      const languageSwitch = document.querySelector('.language-switch');
      const languageButtons = [...document.querySelectorAll('[data-language]')];
      const textTranslations = [...document.querySelectorAll('[data-en]')].map(element => ({
        element, cs: element.textContent, en: element.dataset.en,
      }));
      const attributeTranslations = [
        ...[...document.querySelectorAll('[data-alt-en]')].map(element => ({
          element, attribute: 'alt', cs: element.alt, en: element.dataset.altEn,
        })),
        ...[...document.querySelectorAll('[data-label-en]')].map(element => ({
          element, attribute: 'aria-label', cs: element.getAttribute('aria-label'), en: element.dataset.labelEn,
        })),
      ];
      const home = document.querySelector('.home-view');
      const panels = [...document.querySelectorAll('.game-panel')];
      const gameLinks = [...document.querySelectorAll('.game-card')];
      const viewer = document.querySelector('.image-viewer');
      const viewerImage = viewer.querySelector('.viewer-image');
      const viewerStage = viewer.querySelector('.viewer-stage');
      const viewerCaption = viewer.querySelector('.viewer-caption');
      const viewerCounter = viewer.querySelector('.viewer-counter');
      const zoomButton = viewer.querySelector('.viewer-zoom');
      const previousButton = viewer.querySelector('.viewer-previous');
      const nextButton = viewer.querySelector('.viewer-next');
      let viewerItems = [];
      let viewerIndex = 0;
      let viewerOpener = null;
      let language = 'en';
      try {
        const savedLanguage = localStorage.getItem('mods-language');
        if (savedLanguage === 'cs' || savedLanguage === 'en') language = savedLanguage;
      } catch {}

      function syncTheme() {
        const dark = root.dataset.theme === 'dark';
        button.setAttribute('aria-pressed', String(dark));
        button.setAttribute('aria-label', language === 'en' ? 'Dark mode' : 'Tmavý vzhled');
        button.title = language === 'en'
          ? (dark ? 'Switch to light mode' : 'Switch to dark mode')
          : (dark ? 'Přepnout na světlý vzhled' : 'Přepnout na tmavý vzhled');
        themeColor.content = dark ? '#1c1d1b' : '#f8f7f4';
      }

      function updateTitle() {
        const selected = panels.find(panel => panel.id === location.hash.slice(1));
        document.title = selected
          ? selected.querySelector('h1').textContent.replace(/\.$/, '') + ' — Denk172 Mods'
          : 'Denk172 Mods';
      }

      function applyLanguage() {
        root.lang = language;
        textTranslations.forEach(item => { item.element.textContent = item[language]; });
        attributeTranslations.forEach(item => { item.element.setAttribute(item.attribute, item[language]); });
        languageButtons.forEach(option => {
          option.setAttribute('aria-pressed', String(option.dataset.language === language));
        });
        description.content = language === 'en'
          ? 'Game mods by Denk172 for Derail Valley, Transport Fever 3, Farming Simulator 25 and Euro Truck Simulator 2.'
          : czechDescription;
        syncTheme();
        updateTitle();
        if (viewer.open) refreshViewerCaption();
      }

      function refreshViewerCaption() {
        const source = viewerItems[viewerIndex].querySelector('img');
        viewerCaption.textContent = source.alt;
        viewerImage.alt = source.alt;
      }

      function showImage(index) {
        viewerIndex = (index + viewerItems.length) % viewerItems.length;
        const source = viewerItems[viewerIndex].querySelector('img');
        viewerImage.src = source.currentSrc || source.src;
        refreshViewerCaption();
        viewerCounter.textContent = (viewerIndex + 1) + ' / ' + viewerItems.length;
        previousButton.hidden = nextButton.hidden = viewerItems.length < 2;
        viewer.classList.remove('is-zoomed');
        zoomButton.setAttribute('aria-pressed', 'false');
        zoomButton.textContent = '＋';
        viewerStage.scrollTo(0, 0);
      }

      document.querySelectorAll('[data-view-image]').forEach(imageButton => {
        imageButton.addEventListener('click', () => {
          viewerItems = [...imageButton.closest('.mod-gallery').querySelectorAll('[data-view-image]')];
          viewerOpener = imageButton;
          showImage(viewerItems.indexOf(imageButton));
          viewer.showModal();
        });
      });
      viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
      previousButton.addEventListener('click', () => showImage(viewerIndex - 1));
      nextButton.addEventListener('click', () => showImage(viewerIndex + 1));
      zoomButton.addEventListener('click', () => {
        const zoomed = viewer.classList.toggle('is-zoomed');
        zoomButton.setAttribute('aria-pressed', String(zoomed));
        zoomButton.textContent = zoomed ? '−' : '＋';
        viewerStage.scrollTo(0, 0);
      });
      viewer.addEventListener('keydown', event => {
        if (!viewer.classList.contains('is-zoomed') && viewerItems.length > 1) {
          if (event.key === 'ArrowLeft') { event.preventDefault(); showImage(viewerIndex - 1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); showImage(viewerIndex + 1); }
        }
      });
      viewer.addEventListener('click', event => {
        if (event.target !== viewer) return;
        const bounds = viewer.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) viewer.close();
      });
      viewer.addEventListener('close', () => {
        viewerImage.removeAttribute('src');
        viewer.classList.remove('is-zoomed');
        if (viewerOpener?.isConnected && !viewerOpener.closest('[hidden]')) viewerOpener.focus({preventScroll: true});
      });

      // Hry mají vlastní adresy za #; funguje i tlačítko Zpět v prohlížeči.
      function showPage(moveFocus) {
        if (viewer.open) viewer.close();
        const id = location.hash.slice(1);
        const selected = panels.find(panel => panel.id === id);
        if (!selected && id && id !== 'hry') return;
        home.hidden = Boolean(selected);
        panels.forEach(panel => { panel.hidden = panel !== selected; });
        gameLinks.forEach(link => {
          if (selected && link.hash === '#' + selected.id) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        });
        updateTitle();
        if (moveFocus) {
          (selected || home).querySelector('h1').focus({preventScroll: true});
          window.scrollTo({top: 0, left: 0, behavior: 'instant'});
        }
      }
      applyLanguage();
      showPage(false);
      button.hidden = false;
      languageSwitch.hidden = false;
      button.addEventListener('click', () => {
        root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('mods-theme', root.dataset.theme); } catch {}
        syncTheme();
      });
      languageButtons.forEach(option => {
        option.addEventListener('click', () => {
          language = option.dataset.language;
          try { localStorage.setItem('mods-language', language); } catch {}
          applyLanguage();
        });
      });
      window.addEventListener('hashchange', () => showPage(true));
    })();
