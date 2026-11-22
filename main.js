(() => {
  'use strict';
  const format = globalThis.ModsCatalog;
  const root = document.documentElement;
  const home = document.querySelector('#hry');
  const gameView = document.querySelector('#game-view');
  const content = document.querySelector('#content');
  const notice = document.querySelector('#wip-notice');
  const themeButton = document.querySelector('.theme-toggle');
  const languageSwitch = document.querySelector('.language-switch');
  const languageButtons = [...languageSwitch.querySelectorAll('[data-language]')];
  const staticText = [...document.querySelectorAll('[data-en]')].map(el => [el, el.textContent, el.dataset.en]);
  const staticLabels = [...document.querySelectorAll('[data-label-en]')].map(el => [el, el.getAttribute('aria-label'), el.dataset.labelEn]);
  const viewer = document.querySelector('.image-viewer');
  const viewerImage = viewer.querySelector('.viewer-image');
  const viewerStage = viewer.querySelector('.viewer-stage');
  const viewerCaption = viewer.querySelector('.viewer-caption');
  const viewerCounter = viewer.querySelector('.viewer-counter');
  const zoomButton = viewer.querySelector('.viewer-zoom');
  const previousButton = viewer.querySelector('.viewer-previous');
  const nextButton = viewer.querySelector('.viewer-next');
  const categoryFilters = new Map();
  let language = 'en';
  let data = null;
  let serializedData = '';
  let dismissedNotice = '';
  let gallery = null;
  let refreshing = false;

  try {
    if (localStorage.getItem('mods-language') === 'cs') language = 'cs';
    dismissedNotice = sessionStorage.getItem('mods-wip-dismissed') || '';
  } catch {}

  const t = (cs, en) => language === 'cs' ? cs : en;
  const local = pair => pair[language];

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function button(className, text, action) {
    const el = node('button', className, text);
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
  }

  function externalLink(className, text, url) {
    const el = node('a', className, text);
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    return el;
  }

  function heading(text) {
    const el = node('h1', null, text);
    el.tabIndex = -1;
    el.append(node('span', 'period', '.'));
    return el;
  }

  function noticeKey() {
    return JSON.stringify([data.settings.wip.title, data.settings.wip.message]);
  }

  function renderNotice() {
    const { wip } = data.settings;
    notice.hidden = !wip.visible || dismissedNotice === noticeKey();
    document.querySelector('#wip-title').textContent = local(wip.title);
    document.querySelector('#wip-message').textContent = local(wip.message);
  }

  notice.querySelector('button').addEventListener('click', () => {
    dismissedNotice = noticeKey();
    try { sessionStorage.setItem('mods-wip-dismissed', dismissedNotice); } catch {}
    notice.hidden = true;
    document.querySelector('.wordmark').focus({ preventScroll: true });
  });

  function renderAnnouncements(container, gameId) {
    container.replaceChildren();
    const visible = data.announcements.filter(item => item.visible && item.gameId === gameId);
    if (!visible.length) return;
    const section = node('section', 'announcements');
    const title = node('h2', null, t('Oznámení', 'Announcements'));
    section.append(title);
    for (const item of visible) {
      const article = node('article', 'announcement');
      article.append(node('h3', null, local(item.title)), node('p', null, local(item.message)));
      if (item.url) article.append(externalLink('source', t('Více informací', 'Read more'), format.webUrl(item.url)));
      section.append(article);
    }
    container.append(section);
  }

  function imagePaths(image) {
    const src = format.imageSource(image.src);
    if (data.publication && location.protocol !== 'file:' && src.startsWith('assets/images/uploads/')) {
      return [format.rawUrl(data.publication, src).href, src];
    }
    return [src];
  }

  function setImage(el, image) {
    const [src, fallback] = imagePaths(image);
    el.alt = local(image.caption);
    el.referrerPolicy = 'no-referrer';
    el.onerror = fallback ? () => {
      el.onerror = null;
      el.src = fallback;
    } : null;
    el.src = src;
  }

  function renderGameCards(games) {
    const cards = document.querySelector('#games');
    cards.replaceChildren();
    for (const game of games) {
      const card = node('a', 'game-card');
      card.href = '#' + game.id;
      if (game.cover) {
        const image = node('img', 'game-art');
        if (game.cover.fit === 'contain') image.classList.add('art-contain');
        image.width = 460;
        image.height = 215;
        image.decoding = 'async';
        setImage(image, game.cover);
        card.append(image);
      }
      const info = node('span', 'game-info');
      const details = node('span');
      const count = data.mods.filter(mod => mod.visible && mod.gameId === game.id).length;
      const countLabel = t(count + (count === 1 ? ' mód' : count >= 2 && count <= 4 ? ' mody' : ' modů'), count + (count === 1 ? ' mod' : ' mods'));
      const caption = local(game.caption);
      details.append(node('span', 'game-name', local(game.name)), node('span', 'game-count', caption ? countLabel + ' · ' + caption : countLabel));
      info.append(details);
      card.append(info);
      cards.append(card);
    }
    if (!games.length) cards.append(node('p', 'empty-copy', t('Zatím tu nejsou žádné hry.', 'No games yet.')));
  }

  function renderGallery(mod) {
    const wrapper = node('div', 'mod-gallery');
    const thumbs = node('div', 'gallery-thumbs');
    mod.images.forEach((image, index) => {
      const photo = button(index ? 'media-thumb' : 'media-cover', '', event => openGallery(mod.images, index, event.currentTarget));
      if (image.fit === 'contain') photo.classList.add('media-contain');
      photo.setAttribute('aria-label', t('Zvětšit: ', 'Enlarge: ') + local(image.caption));
      const img = node('img');
      if (image.width && image.height) {
        img.width = image.width;
        img.height = image.height;
      }
      img.loading = 'lazy';
      img.decoding = 'async';
      setImage(img, image);
      photo.append(img);
      if (index === 0) {
        const plus = node('span', 'image-enlarge', '+');
        plus.setAttribute('aria-hidden', 'true');
        photo.append(plus);
        wrapper.append(photo);
      } else {
        thumbs.append(photo);
      }
    });
    if (thumbs.childElementCount) wrapper.append(thumbs);
    return wrapper;
  }

  function renderMod(mod, categories) {
    const row = node('li');
    const entry = mod.url ? externalLink('mod-entry', undefined, format.webUrl(mod.url)) : node('article', 'mod-entry');
    const details = node('div', 'mod-details');
    details.append(node('h2', null, local(mod.title)), node('p', 'mod-description', local(mod.description)));
    if (local(mod.note)) details.append(node('p', 'mod-note', local(mod.note)));
    const meta = node('div', 'mod-meta');
    if (mod.url) {
      const label = mod.platform || t('Otevřít mód', 'Open mod');
      meta.append(node('span', 'source mod-source', label));
    }
    if (mod.status !== 'released' || !mod.url) meta.append(node('span', 'badge', local(format.STATUS[mod.status])));
    if (mod.version) meta.append(node('span', null, t('Verze ', 'Version ') + mod.version));
    for (const category of categories) {
      if (mod.categoryIds.includes(category.id)) meta.append(node('span', 'category-label', local(category.name)));
    }
    if (meta.childElementCount) details.append(meta);
    entry.append(details);
    if (mod.images.length) {
      const layout = node('div', 'mod-layout');
      layout.append(renderGallery(mod), entry);
      row.append(layout);
    } else {
      row.append(entry);
    }
    return row;
  }

  function renderGame(game) {
    const panel = node('section', 'game-panel');
    const back = node('a', 'back-link', t('Všechny hry', 'All games'));
    back.href = '#hry';
    const introduction = node('div', 'game-intro');
    const title = heading(local(game.name));
    title.id = 'game-title';
    panel.setAttribute('aria-labelledby', title.id);
    introduction.append(title);
    if (local(game.description)) introduction.append(node('p', 'intro-text', local(game.description)));
    panel.append(back, introduction);
    const announcements = node('div');
    renderAnnouncements(announcements, game.id);
    if (announcements.childElementCount) panel.append(announcements);
    const mods = data.mods.filter(mod => mod.visible && mod.gameId === game.id);
    const categories = data.categories.filter(category => category.visible && mods.some(mod => mod.categoryIds.includes(category.id)));
    const list = node('ul', 'mods');
    list.id = 'game-mods';
    list.setAttribute('role', 'list');
    const empty = node('p', 'empty-copy', t('Zatím tu nejsou žádné mody.', 'No mods here yet.'));
    function showMods(categoryId) {
      const filtered = categoryId ? mods.filter(mod => mod.categoryIds.includes(categoryId)) : mods;
      list.replaceChildren(...filtered.map(mod => renderMod(mod, categories)));
      list.hidden = !filtered.length;
      empty.hidden = Boolean(filtered.length);
    }
    const activeCategory = categoryFilters.get(game.id);
    let selected = categories.some(item => item.id === activeCategory) ? activeCategory : '';
    if (categories.length) {
      const filters = node('div', 'category-filter');
      const label = node('label', null, t('Kategorie', 'Category'));
      label.htmlFor = 'mod-category';
      const select = node('select');
      select.id = 'mod-category';
      select.setAttribute('aria-controls', list.id);
      select.add(new Option(t('Všechny mody', 'All mods'), ''));
      for (const category of categories) select.add(new Option(local(category.name), category.id));
      select.value = selected;
      select.addEventListener('change', () => {
        selected = select.value;
        categoryFilters.set(game.id, selected);
        showMods(selected);
      });
      filters.append(label, select);
      panel.append(filters);
    }
    panel.append(list, empty);
    showMods(selected);
    gameView.replaceChildren(panel);
  }

  function render(moveFocus = false) {
    root.lang = language;
    staticText.forEach(([el, cs, en]) => { el.textContent = t(cs, en); });
    staticLabels.forEach(([el, cs, en]) => { el.setAttribute('aria-label', t(cs, en)); });
    languageButtons.forEach(el => el.setAttribute('aria-pressed', String(el.dataset.language === language)));
    syncTheme();
    if (!data) return;
    renderNotice();
    const games = data.games.filter(game => game.visible);
    const current = games.find(game => '#' + game.id === location.hash);
    home.hidden = Boolean(current);
    gameView.hidden = !current;
    if (current) {
      renderGame(current);
      document.title = local(current.name) + ' — Denk172 Mods';
    } else {
      gameView.replaceChildren();
      const intro = document.querySelector('#home-intro');
      intro.textContent = local(data.settings.intro);
      intro.hidden = !intro.textContent;
      document.querySelector('#home-heading').textContent = local(data.settings.heading);
      renderAnnouncements(document.querySelector('#announcements'), '');
      renderGameCards(games);
      document.title = 'Denk172 Mods';
    }
    if (moveFocus) {
      (current ? gameView : home).querySelector('h1').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function syncTheme() {
    const dark = root.dataset.theme === 'dark';
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.setAttribute('aria-label', t('Tmavý vzhled', 'Dark mode'));
    themeButton.title = dark ? t('Přepnout na světlý vzhled', 'Switch to light mode') : t('Přepnout na tmavý vzhled', 'Switch to dark mode');
    document.querySelector('meta[name="theme-color"]').content = dark ? '#1c1d1b' : '#f8f7f4';
  }

  function openGallery(images, index, opener) {
    gallery = { images, index, opener };
    showImage(index);
    viewer.showModal();
  }

  function showImage(index) {
    gallery.index = (index + gallery.images.length) % gallery.images.length;
    const image = gallery.images[gallery.index];
    setImage(viewerImage, image);
    viewerCaption.textContent = local(image.caption);
    viewerCounter.textContent = (gallery.index + 1) + ' / ' + gallery.images.length;
    previousButton.hidden = nextButton.hidden = gallery.images.length < 2;
    viewer.classList.remove('is-zoomed');
    zoomButton.setAttribute('aria-pressed', 'false');
    zoomButton.textContent = '+';
    viewerStage.scrollTo(0, 0);
  }

  themeButton.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('mods-theme', root.dataset.theme); } catch {}
    syncTheme();
  });
  languageButtons.forEach(option => option.addEventListener('click', () => {
    language = option.dataset.language;
    try { localStorage.setItem('mods-language', language); } catch {}
    render();
  }));
  viewer.querySelector('.viewer-close').addEventListener('click', () => viewer.close());
  previousButton.addEventListener('click', () => showImage(gallery.index - 1));
  nextButton.addEventListener('click', () => showImage(gallery.index + 1));
  zoomButton.addEventListener('click', () => {
    const zoomed = viewer.classList.toggle('is-zoomed');
    zoomButton.setAttribute('aria-pressed', String(zoomed));
    zoomButton.textContent = zoomed ? '−' : '+';
    viewerStage.scrollTo(0, 0);
  });
  viewer.addEventListener('keydown', event => {
    if (viewer.classList.contains('is-zoomed') || gallery.images.length < 2) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showImage(gallery.index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  viewer.addEventListener('click', event => {
    if (event.target !== viewer) return;
    const box = viewer.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) viewer.close();
  });
  viewer.addEventListener('close', () => {
    viewerImage.onerror = null;
    viewerImage.removeAttribute('src');
    if (gallery?.opener.isConnected && !gallery.opener.closest('[hidden]')) gallery.opener.focus({ preventScroll: true });
    gallery = null;
  });
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    content.focus();
  });
  window.addEventListener('hashchange', () => {
    if (viewer.open) viewer.close();
    render(true);
  });

  function setCatalog(next) {
    const snapshot = JSON.stringify(next);
    if (snapshot === serializedData) return;
    data = next;
    serializedData = snapshot;
    document.querySelector('#catalog-error').hidden = true;
    render();
  }

  async function refreshCatalog() {
    if (location.protocol === 'file:' || document.hidden || viewer.open || refreshing) return;
    refreshing = true;
    try {
      const urls = [new URL(format.PATH, document.baseURI)];
      if (data?.publication) urls.unshift(format.rawUrl(data.publication, format.PATH));
      for (const url of urls) {
        const external = url.origin !== location.origin;
        if (external) url.searchParams.set('v', String(Math.floor(Date.now() / 30_000)));
        try {
          const response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(4500) });
          if (!response.ok) continue;
          const next = format.decode(await response.text());
          if (external && JSON.stringify(next.publication) !== JSON.stringify(data.publication)) continue;
          if (data?.updatedAt && (!next.updatedAt || Date.parse(next.updatedAt) < Date.parse(data.updatedAt))) continue;
          if (!viewer.open) setCatalog(next);
          break;
        } catch {
          // Keep displaying the last valid catalog if a source is temporarily unavailable.
        }
      }
    } finally {
      refreshing = false;
    }
  }

  languageSwitch.hidden = themeButton.hidden = false;
  render();
  try {
    setCatalog(format.validate(globalThis.DENK172_DATA));
  } catch {
    document.querySelector('#catalog-error').hidden = false;
  }
  refreshCatalog();
  window.setInterval(refreshCatalog, 30_000);
  document.addEventListener('visibilitychange', refreshCatalog);
})();
