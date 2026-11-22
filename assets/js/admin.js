(() => {
  'use strict';
  const format = globalThis.ModsCatalog;
  const $ = id => document.getElementById(id);
  const form = $('record-form');
  const fields = $('record-fields');
  const copy = (cs, en) => ({ cs, en });
  const translations = new WeakMap();
  const languagePicker = $('admin-language');
  const languageButtons = languagePicker.querySelectorAll('[data-language]');
  const loginContext = $('admin-context');
  const loginHint = copy(loginContext.dataset.cs, loginContext.textContent);
  let language = 'en';

  const sectionNames = {
    mods: { title: copy('Mody', 'Mods'), add: copy('Přidat mód', 'Add mod') },
    games: { title: copy('Hry', 'Games'), add: copy('Přidat hru', 'Add game') },
    categories: { title: copy('Kategorie', 'Categories'), add: copy('Přidat kategorii', 'Add category') },
    announcements: { title: copy('Oznámení', 'Announcements'), add: copy('Přidat oznámení', 'Add announcement') },
  };
  const state = {
    client: null, head: '', base: '', catalog: null, uploads: new Map(),
    section: 'mods', id: null, formDirty: false, busy: false, mediaReaders: [],
  };
  const blankPair = () => ({ cs: '', en: '' });
  const local = value => typeof value === 'string' ? value : value[language];

  function displayCopy(node, value, attribute) {
    if (attribute) node.setAttribute(attribute, local(value));
    else node.textContent = local(value);
  }

  function setCopy(node, value, attribute = '') {
    let bindings = translations.get(node);
    if (typeof value === 'string') {
      bindings?.delete(attribute);
    } else {
      if (!bindings) {
        bindings = new Map();
        translations.set(node, bindings);
        node.setAttribute('data-translated', '');
      }
      bindings.set(attribute, value);
    }
    displayCopy(node, value, attribute);
  }

  function setLanguage(next) {
    language = next === 'cs' ? 'cs' : 'en';
    document.documentElement.lang = language;
    for (const node of document.querySelectorAll('[data-translated]')) {
      for (const [attribute, value] of translations.get(node)) displayCopy(node, value, attribute);
    }
    for (const button of languageButtons) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  }

  function setupLanguages() {
    for (const [source, attribute] of [['data-cs', ''], ['data-cs-label', 'aria-label'], ['data-cs-placeholder', 'placeholder']]) {
      for (const node of document.querySelectorAll('[' + source + ']')) {
        setCopy(node, copy(node.getAttribute(source), attribute ? node.getAttribute(attribute) : node.textContent), attribute);
      }
    }
    let savedLanguage;
    try { savedLanguage = localStorage.getItem('mods-language'); } catch {}
    setLanguage(savedLanguage);
    for (const button of languageButtons) button.addEventListener('click', () => {
      setLanguage(button.dataset.language);
      try { localStorage.setItem('mods-language', language); } catch {}
    });
    languagePicker.hidden = false;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) setCopy(node, text);
    return node;
  }

  function action(text, callback, className = '') {
    const button = el('button', 'admin-button ' + className, text);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  function message(node, text = '', error = false) {
    setCopy(node, text);
    node.hidden = !text;
    node.toggleAttribute('data-error', error);
  }

  function errorText(error) {
    if (error.name === 'TimeoutError') return copy('GitHub se neozval včas. Zkus to znovu.', 'GitHub took too long to respond. Try again.');
    if (error instanceof TypeError) return copy('Připojení ke GitHubu se nezdařilo. Zkus to znovu.', 'Could not connect to GitHub. Try again.');
    const redact = (value, replacement) => String(value).replace(/github_pat_[a-zA-Z0-9_]+/g, replacement).slice(0, 500);
    const cs = error.messages?.cs ?? error.message ?? error;
    const en = error.messages?.en ?? error.message ?? error;
    return copy(redact(cs, '[klíč]'), redact(en, '[token]'));
  }

  function input(parent, name, label, initial = '', options = {}) {
    const wrapper = el('label', 'admin-field');
    wrapper.append(el('span', null, label));
    const control = el(options.choices ? 'select' : options.lines ? 'textarea' : 'input');
    if (!options.choices && !options.lines) control.type = options.type || 'text';
    control.name = name;
    if (options.choices) {
      for (const [value, text] of options.choices) {
        const option = new Option('', value);
        setCopy(option, text);
        control.add(option);
      }
    }
    if (options.lines) control.rows = options.lines;
    if (options.max) control.maxLength = options.max;
    if (options.required) control.required = true;
    if (options.placeholder) setCopy(control, options.placeholder, 'placeholder');
    if (options.accept) control.accept = options.accept;
    if (control.type !== 'file') control.value = initial;
    wrapper.append(control);
    if (options.help) wrapper.append(el('small', null, options.help));
    parent.append(wrapper);
    return control;
  }

  function pairFields(parent, name, label, value, options) {
    const group = el('div', 'admin-pair');
    group.append(el('span', 'admin-label', label));
    const columns = el('div', 'admin-columns');
    const controls = {};
    for (const [lang, language] of [['cs', 'Čeština'], ['en', 'English']]) {
      controls[lang] = input(columns, name + '-' + lang, language, value[lang], options);
      controls[lang].lang = lang;
      setCopy(controls[lang], copy(label.cs + ' – ' + language, label.en + ' – ' + language), 'aria-label');
    }
    group.append(columns);
    parent.append(group);
    return () => ({ cs: controls.cs.value.trim(), en: controls.en.value.trim() });
  }

  function checkbox(parent, name, label, checked, value = '') {
    const wrapper = el('label', 'admin-check');
    const control = el('input');
    control.type = 'checkbox';
    control.name = name;
    control.checked = checked;
    control.value = value;
    wrapper.append(control, el('span', null, label));
    parent.append(wrapper);
    return control;
  }

  const control = name => form.elements.namedItem(name);
  const value = name => control(name).value.trim();
  const pairValue = name => ({ cs: value(name + '-cs'), en: value(name + '-en') });
  const title = record => record?.title ?? record?.name ?? '';
  const records = () => state.catalog[state.section];
  const active = () => state.section === 'settings' ? null : records().find(record => record.id === state.id);
  const loading = () => state.busy || !state.client;
  const hasStagedChanges = () => state.catalog && JSON.stringify(state.catalog) !== state.base;

  function updateControls(text, error = false) {
    $('editor-nav').inert = state.busy;
    $('editor-grid').inert = state.busy;
    $('disconnect').disabled = state.busy;
    $('reload-catalog').disabled = loading();
    $('publish').disabled = loading() || (!state.formDirty && !hasStagedChanges());
    $('editor-panel').classList.toggle('admin-busy', state.busy);
    const status = text ?? (state.formDirty
      ? copy('Rozpracované úpravy v otevřené položce.', 'Unsaved edits in the open item.')
      : hasStagedChanges() ? copy('Změny čekají na zveřejnění.', 'Changes are ready to publish.') : copy('Bez změn.', 'No changes.'));
    message($('publish-status'), status, error);
  }

  function markEdited() {
    state.formDirty = true;
    updateControls();
  }

  function allowedToLeaveForm() {
    return !state.formDirty || window.confirm(local(copy('Zahodit úpravy v této rozepsané položce?', 'Discard edits to this item?')));
  }

  function renderList() {
    const sidebar = $('admin-sidebar');
    const isSettings = state.section === 'settings';
    sidebar.hidden = isSettings;
    $('editor-grid').classList.toggle('settings-grid', isSettings);
    for (const button of $('editor-nav').querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.section === state.section));
    }
    if (isSettings) return;
    setCopy($('list-title'), sectionNames[state.section].title);
    setCopy($('add-record'), sectionNames[state.section].add);
    const list = $('record-list');
    list.replaceChildren();
    for (const record of records()) {
      const button = el('button', 'record-pick');
      button.type = 'button';
      button.append(el('span', null, title(record)));
      if (record.id === state.id) button.setAttribute('aria-current', 'true');
      const game = state.catalog.games.find(game => game.id === record.gameId);
      const meta = [game?.name, record.visible ? null : copy('Skryté na webu', 'Hidden on site')].filter(Boolean);
      if (meta.length) button.append(el('small', null, copy(meta.map(label => label.cs).join(' · '), meta.map(label => label.en).join(' · '))));
      button.addEventListener('click', () => select(state.section, record.id));
      const row = el('li');
      row.append(button);
      list.append(row);
    }
    if (!records().length) list.append(el('li', 'empty-copy', copy('Zatím tu nejsou žádné položky.', 'No items yet.')));
  }

  function select(section, id = null, focus = true) {
    if (loading() || !allowedToLeaveForm()) return;
    state.section = section;
    state.id = id ?? (section === 'settings' ? '' : state.catalog[section][0]?.id || '');
    renderEditor(focus);
  }

  function gameChoices(optional) {
    const first = optional ? copy('Úvodní stránka', 'Home page') : copy('Vyber hru', 'Select a game');
    return [['', first], ...state.catalog.games.map(game => [game.id, game.name])];
  }

  function newRecord(section) {
    if (section === 'mods') return {
      gameId: state.catalog.games[0]?.id || '', title: blankPair(), description: blankPair(), note: blankPair(),
      status: 'wip', version: '', platform: '', url: '', categoryIds: [], images: [], visible: true,
    };
    if (section === 'games') return { name: blankPair(), caption: blankPair(), description: blankPair(), cover: null, visible: true };
    if (section === 'categories') return { name: blankPair(), visible: true };
    return { title: blankPair(), message: blankPair(), gameId: '', url: '', visible: true };
  }

  function mediaFields(parent, records, isGame) {
    const group = el('fieldset', 'admin-group');
    const gameImage = copy('Obrázek hry', 'Game image');
    group.append(el('legend', null, isGame ? gameImage : copy('Náhled a screenshoty', 'Cover and screenshots')));
    const description = isGame
      ? copy('Vyber JPG, PNG nebo WebP, případně vlož adresu existujícího obrázku.', 'Choose a JPG, PNG or WebP file, or enter an existing image URL.')
      : copy('První obrázek je hlavní náhled. Další se zobrazí v galerii.', 'The first image is the cover. Additional images appear in the gallery.');
    group.append(el('p', 'field-hint', description));
    const list = el('div');
    const add = action(isGame ? copy('Přidat obrázek hry', 'Add game image') : copy('Přidat obrázek', 'Add image'), () => {
      appendImage();
      markEdited();
    });
    let nextId = 0;
    const readers = new Map();
    state.mediaReaders = () => [...list.children].map(row => readers.get(row)());
    function positions() {
      [...list.children].forEach((row, index, rows) => {
        const label = index === 0 ? copy('Hlavní náhled', 'Cover image') : copy('Obrázek ' + (index + 1), 'Image ' + (index + 1));
        setCopy(row.querySelector('strong'), isGame ? gameImage : label);
        row.querySelector('[data-up]').disabled = index === 0;
        row.querySelector('[data-down]').disabled = index === rows.length - 1;
      });
      add.hidden = list.childElementCount >= (isGame ? 1 : 12);
    }
    function appendImage(image = { src: '', caption: blankPair(), fit: 'contain' }) {
      const row = el('div', 'media-editor');
      const header = el('div', 'media-editor-header');
      const tools = el('div', 'admin-inline');
      const up = action(copy('Výš', 'Move up'), () => {
        if (row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        positions();
        markEdited();
      });
      const down = action(copy('Níže', 'Move down'), () => {
        if (row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        positions();
        markEdited();
      });
      up.setAttribute('data-up', '');
      down.setAttribute('data-down', '');
      up.hidden = down.hidden = isGame;
      tools.append(up, down, action(copy('Odebrat obrázek', 'Remove image'), () => {
        readers.delete(row);
        row.remove();
        positions();
        markEdited();
      }, 'quiet'));
      header.append(el('strong'), tools);
      row.append(header);
      const base = 'media-' + nextId++;
      const src = input(row, base + '-src', copy('HTTPS adresa nebo cesta v assets/images', 'HTTPS URL or path in assets/images'), image.src, { max: 2048 });
      const file = input(row, base + '-file', copy('Nahrát soubor (max. 5 MB)', 'Upload file (up to 5 MB)'), '', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
      file.addEventListener('change', () => { if (file.files[0]) src.value = ''; });
      src.addEventListener('input', () => { if (src.value && file.files[0]) file.value = ''; });
      const captions = pairFields(row, base + '-caption', copy('Popis obrázku', 'Image description'), image.caption, { max: 240 });
      const fit = input(row, base + '-fit', copy('Zobrazení náhledu', 'Image fit'), image.fit, {
        choices: [['contain', copy('Celý obrázek', 'Show full image')], ['cover', copy('Vyplnit rámeček', 'Fill frame')]],
      });
      readers.set(row, () => {
        const source = src.value.trim();
        const record = { src: source, caption: captions(), fit: fit.value };
        if (source === image.src && image.width && image.height) {
          record.width = image.width;
          record.height = image.height;
        }
        return { record, file: file.files[0] };
      });
      list.append(row);
      positions();
    }
    group.append(list, add);
    parent.append(group);
    records.forEach(appendImage);
  }

  function renderMod(record) {
    const columns = el('div', 'admin-columns');
    input(columns, 'game', copy('Hra', 'Game'), record.gameId, { choices: gameChoices(false), required: true });
    input(columns, 'status', copy('Stav', 'Status'), record.status, {
      choices: Object.entries(format.STATUS),
    });
    fields.append(columns);
    pairFields(fields, 'title', copy('Název módu', 'Mod title'), record.title, { max: 140, required: true });
    pairFields(fields, 'description', copy('Popis módu', 'Mod description'), record.description, { max: 2500, lines: 4, required: true });
    pairFields(fields, 'note', copy('Poznámka nebo požadavky (volitelné)', 'Notes or requirements (optional)'), record.note, { max: 1200, lines: 2 });
    const links = el('div', 'admin-columns');
    input(links, 'version', copy('Verze (volitelné)', 'Version (optional)'), record.version, { max: 60, placeholder: '1.0.0' });
    input(links, 'platform', copy('Text odkazu (volitelné)', 'Link label (optional)'), record.platform, { max: 80, placeholder: 'Nexus Mods' });
    fields.append(links);
    input(fields, 'url', copy('Odkaz na mód (volitelné)', 'Mod link (optional)'), record.url, { type: 'url', max: 2048, placeholder: 'https://' });
    const group = el('fieldset', 'admin-group');
    group.append(el('legend', null, sectionNames.categories.title));
    const choices = el('div', 'category-choices');
    for (const category of state.catalog.categories) {
      checkbox(choices, 'category', category.name, record.categoryIds.includes(category.id), category.id);
    }
    if (!choices.childElementCount) choices.append(el('p', 'field-hint', copy('Kategorie můžeš vytvořit v záložce Kategorie.', 'Add categories in the Categories tab.')));
    group.append(choices);
    fields.append(group);
    mediaFields(fields, record.images, false);
  }

  function renderGame(record) {
    pairFields(fields, 'name', copy('Název hry', 'Game name'), record.name, { max: 120, required: true });
    pairFields(fields, 'caption', copy('Podtitul dlaždice (volitelné)', 'Game tile subtitle (optional)'), record.caption, { max: 120 });
    pairFields(fields, 'description', copy('Popis hry (volitelné)', 'Game description (optional)'), record.description, { max: 600, lines: 3 });
    mediaFields(fields, record.cover ? [record.cover] : [], true);
  }

  function renderAnnouncement(record) {
    input(fields, 'game', copy('Kde se má oznámení zobrazit', 'Where to show the announcement'), record.gameId, { choices: gameChoices(true) });
    pairFields(fields, 'title', copy('Nadpis oznámení', 'Announcement title'), record.title, { max: 120, required: true });
    pairFields(fields, 'message', copy('Text oznámení', 'Announcement text'), record.message, { max: 2500, lines: 5, required: true });
    input(fields, 'url', copy('Odkaz (volitelné)', 'Link (optional)'), record.url, { type: 'url', max: 2048, placeholder: 'https://' });
  }

  function renderSettings() {
    const settings = state.catalog.settings;
    pairFields(fields, 'heading', copy('Nadpis úvodní stránky', 'Home page heading'), settings.heading, { max: 100, required: true });
    pairFields(fields, 'intro', copy('Úvodní text (volitelné)', 'Introduction (optional)'), settings.intro, { max: 300, lines: 2 });
    const group = el('fieldset', 'admin-group');
    group.append(el('legend', null, copy('Žluté upozornění', 'Yellow notice')));
    checkbox(group, 'wip-visible', copy('Zobrazit upozornění nahoře na webu', 'Show the notice at the top of the site'), settings.wip.visible);
    fields.append(group);
    pairFields(fields, 'wip-title', copy('Nadpis upozornění', 'Notice title'), settings.wip.title, { max: 100, required: true });
    pairFields(fields, 'wip-message', copy('Text upozornění', 'Notice text'), settings.wip.message, { max: 400, lines: 3, required: true });
  }

  function renderEditor(focus = false) {
    state.formDirty = false;
    state.mediaReaders = () => [];
    renderList();
    fields.replaceChildren();
    message($('form-message'));
    const isSettings = state.section === 'settings';
    const record = active();
    const header = $('record-title');
    setCopy(header, isSettings ? copy('Nastavení webu', 'Site settings') : record ? title(record) : sectionNames[state.section].add);
    $('record-actions').hidden = false;
    if (isSettings) {
      renderSettings();
    } else {
      const item = record || newRecord(state.section);
      if (state.section === 'mods') renderMod(item);
      if (state.section === 'games') renderGame(item);
      if (state.section === 'categories') pairFields(fields, 'name', copy('Název kategorie', 'Category name'), item.name, { max: 80, required: true });
      if (state.section === 'announcements') renderAnnouncement(item);
      const visibility = el('fieldset', 'admin-group');
      visibility.append(el('legend', null, copy('Viditelnost', 'Visibility')));
      checkbox(visibility, 'visible', copy('Zobrazit na webu', 'Show on site'), item.visible);
      visibility.append(el('p', 'field-hint', copy('Skrytá položka zmizí z webu. V souborech veřejného repozitáře zůstává čitelná.', 'Hidden items are still readable in the files of a public repository.')));
      fields.append(visibility);
      if (record) {
        const management = el('div', 'admin-inline record-management');
        const order = el('div', 'admin-inline');
        const siblings = state.section === 'mods' ? records().filter(item => item.gameId === record.gameId) : records();
        const index = siblings.findIndex(item => item.id === state.id);
        const up = action(copy('Posunout výš', 'Move up'), () => moveRecord(-1), 'quiet');
        const down = action(copy('Posunout níž', 'Move down'), () => moveRecord(1), 'quiet');
        up.disabled = index <= 0;
        down.disabled = index >= siblings.length - 1;
        order.append(up, down);
        management.append(order, action(copy('Odstranit položku', 'Remove item'), removeRecord, 'danger'));
        fields.append(management);
      }
    }
    updateControls();
    if (focus) header.focus();
  }

  function moveRecord(direction) {
    if (state.formDirty) {
      message($('form-message'), copy('Nejdřív ulož nebo zruš právě rozepsané úpravy.', 'Save or cancel the current edits first.'), true);
      return;
    }
    const items = records();
    const index = items.findIndex(item => item.id === state.id);
    const record = items[index];
    let other = index + direction;
    while (state.section === 'mods' && items[other] && items[other].gameId !== record.gameId) other += direction;
    if (!items[other]) return;
    [items[index], items[other]] = [items[other], items[index]];
    renderEditor();
  }

  function removeRecord() {
    if (!allowedToLeaveForm()) return;
    const record = active();
    if (state.section === 'games' && [...state.catalog.mods, ...state.catalog.announcements].some(item => item.gameId === record.id)) {
      message($('form-message'), copy('Nejdřív přesuň nebo odstraň mody a oznámení této hry. Hru můžeš mezitím skrýt.', 'Move or remove this game’s mods and announcements first. You can hide the game in the meantime.'), true);
      return;
    }
    const name = local(title(record));
    const question = copy('Přidat odstranění „' + name + '“ do změn?', 'Stage removal of “' + name + '”?');
    const warning = copy(' Přiřazení téhle kategorie se odebere i z modů.', ' This category will also be removed from its mods.');
    if (!window.confirm(local(question) + (state.section === 'categories' ? local(warning) : ''))) return;
    state.catalog[state.section] = records().filter(item => item.id !== record.id);
    if (state.section === 'categories') {
      for (const mod of state.catalog.mods) mod.categoryIds = mod.categoryIds.filter(id => id !== record.id);
    }
    pruneUploads();
    state.id = records()[0]?.id || '';
    renderEditor(true);
  }

  function newId(name) {
    const slug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').slice(0, 65).replace(/^-+|-+$/g, '') || 'polozka';
    const reserved = new Set(['content', 'hry', 'games', 'announcements', ...records().map(item => item.id)]);
    let id = slug;
    for (let suffix = 2; reserved.has(id); suffix++) id = slug + '-' + suffix;
    return id;
  }

  async function uploadImage(file, id) {
    if (file.size > format.IMAGE_BYTES) throw new format.LocalizedError('Soubor „' + file.name + '“ je větší než 5 MB.', '“' + file.name + '” is larger than 5 MB.');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    let extension = '';
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) extension = 'jpg';
    if (String.fromCharCode(...header.slice(0, 8)) === '\x89PNG\r\n\x1a\n') extension = 'png';
    if (String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP') extension = 'webp';
    if (!extension) throw new format.LocalizedError('Soubor „' + file.name + '“ musí být JPG, PNG nebo WebP.', '“' + file.name + '” must be a JPG, PNG or WebP file.');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new format.LocalizedError('Obrázek „' + file.name + '“ se nepodařilo otevřít.', 'Could not open the image “' + file.name + '”.');
    }
    const { width, height } = bitmap;
    bitmap.close();
    const path = 'assets/images/uploads/' + state.section + '/' + id + '/' + crypto.randomUUID() + '.' + extension;
    return { src: path, width, height };
  }

  async function readMedia(id, uploads) {
    const images = [];
    for (const { record, file } of state.mediaReaders()) {
      if (!file && !record.src && !record.caption.cs && !record.caption.en) continue;
      if (!record.caption.cs || !record.caption.en) throw new format.LocalizedError('Doplň český i anglický popis obrázku.', 'Enter both Czech and English image descriptions.');
      if (file) {
        Object.assign(record, await uploadImage(file, id));
        uploads.set(record.src, file);
      }
      if (!format.imageSource(record.src)) throw new format.LocalizedError('U obrázku vyber soubor nebo zadej platnou adresu.', 'Choose an image file or enter a valid URL.');
      images.push(record);
    }
    return images;
  }

  function pruneUploads() {
    const used = new Set([
      ...state.catalog.mods.flatMap(mod => mod.images.map(image => image.src)),
      ...state.catalog.games.flatMap(game => game.cover ? [game.cover.src] : []),
    ]);
    for (const path of state.uploads.keys()) if (!used.has(path)) state.uploads.delete(path);
  }

  async function stage() {
    if (!form.reportValidity()) return false;
    const catalog = structuredClone(state.catalog);
    const uploads = new Map(state.uploads);
    let nextId = state.id;
    try {
      if (state.section === 'settings') {
        catalog.settings = {
          heading: pairValue('heading'), intro: pairValue('intro'),
          wip: { visible: control('wip-visible').checked, title: pairValue('wip-title'), message: pairValue('wip-message') },
        };
      } else {
        const nameKey = ['games', 'categories'].includes(state.section) ? 'name' : 'title';
        const name = pairValue(nameKey);
        nextId = active()?.id || newId(name.en);
        const record = { id: nextId, [nameKey]: name, visible: control('visible').checked };
        if (state.section === 'mods') Object.assign(record, {
          gameId: value('game'), description: pairValue('description'), note: pairValue('note'),
          status: value('status'), version: value('version'), platform: value('platform'), url: value('url'),
          categoryIds: [...form.querySelectorAll('input[name="category"]:checked')].map(item => item.value),
          images: await readMedia(nextId, uploads),
        });
        if (state.section === 'games') Object.assign(record, {
          caption: pairValue('caption'), description: pairValue('description'), cover: (await readMedia(nextId, uploads))[0] || null,
        });
        if (state.section === 'announcements') Object.assign(record, {
          gameId: value('game'), message: pairValue('message'), url: value('url'),
        });
        const items = catalog[state.section];
        const index = items.findIndex(item => item.id === nextId);
        if (index < 0) items.push(record);
        else items[index] = record;
      }
      format.encode(catalog);
    } catch (error) {
      message($('form-message'), errorText(error), true);
      return false;
    }
    state.catalog = catalog;
    state.uploads = uploads;
    state.id = nextId;
    pruneUploads();
    renderEditor();
    message($('form-message'), copy('Uloženo do změn.', 'Changes staged.'));
    return true;
  }

  function setLoaded(result) {
    state.head = result.head;
    state.catalog = result.catalog;
    state.base = JSON.stringify(state.catalog);
    state.uploads.clear();
    if (state.section !== 'settings' && !active()) state.id = records()[0]?.id || '';
    renderEditor();
  }

  const normalized = catalog => format.encode(catalog);
  function sameAsBase(catalog) {
    return normalized(catalog) === normalized(JSON.parse(state.base));
  }

  async function publish() {
    if (loading()) return;
    if (state.formDirty && !form.reportValidity()) return;
    state.busy = true;
    $('commit-link').hidden = true;
    updateControls(copy('Připravuju změny ke zveřejnění…', 'Preparing changes to publish…'));
    try {
      if (state.formDirty && !await stage()) return;
      if (!hasStagedChanges()) return;
      updateControls(copy('Ukládám katalog a obrázky na GitHub…', 'Saving the catalog and images to GitHub…'));
      const published = structuredClone(state.catalog);
      const previousTime = Date.parse(published.updatedAt) || 0;
      published.updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
      published.publication = state.client.publication;
      const latest = await state.client.read();
      if (latest.head !== state.head && !sameAsBase(latest.catalog)) {
        throw new format.LocalizedError(
          'Obsah na GitHubu se mezitím změnil. Tvoje úpravy zůstaly v editoru. Před dalším zveřejněním zkontroluj změnu v repozitáři.',
          'The catalog changed on GitHub while you were editing. Your edits are still here. Review the repository changes before publishing again.',
        );
      }
      let result;
      try {
        result = await state.client.publish(latest, published, state.uploads);
      } catch (error) {
        const checked = await state.client.read().catch(() => null);
        if (!checked || normalized(checked.catalog) !== normalized(published)) throw error;
        result = { head: checked.head, url: 'https://github.com/' + state.client.target.repo + '/commit/' + checked.head };
      }
      setLoaded({ head: result.head, catalog: published });
      const link = $('commit-link');
      link.href = result.url;
      link.hidden = false;
      state.busy = false;
      updateControls(copy('Změny jsou uložené na GitHubu. Návštěvníkům se načtou po aktualizaci obsahu.', 'Your changes are saved on GitHub. Visitors will see them when the site refreshes its content.'));
    } catch (error) {
      state.busy = false;
      updateControls(errorText(error), true);
    } finally {
      if (state.busy) {
        state.busy = false;
        updateControls();
      }
    }
  }

  function suggestedRepo() {
    const match = location.hostname.match(/^([a-z\d-]+)\.github\.io$/i);
    if (!match) return '';
    const first = location.pathname.split('/').filter(Boolean)[0];
    return match[1] + '/' + (first === 'admin.html' || !first ? location.hostname : first);
  }

  function setupDefaults() {
    $('repo').value = suggestedRepo();
    try {
      const prior = JSON.parse(localStorage.getItem('mods-admin-target'));
      if (format.repoName(prior?.repo) && (!$('repo').value || $('repo').value.toLowerCase() === prior.repo.toLowerCase())) {
        $('repo').value = prior.repo;
        $('branch').value = prior.branch;
        $('prefix').value = prior.prefix;
      }
    } catch {}
    if ($('repo').value) {
      const url = new URL($('token-guide').href);
      url.searchParams.set('target_name', $('repo').value.split('/')[0]);
      $('token-guide').href = url.href;
    }
  }

  async function login(event) {
    event.preventDefault();
    const repo = format.repoName($('repo').value);
    const branch = $('branch').value.trim();
    const prefix = $('prefix').value;
    const token = $('token').value.trim();
    $('token').value = '';
    $('connect').disabled = true;
    message($('login-message'), copy('Načítám katalog z GitHubu…', 'Loading the catalog from GitHub…'));
    try {
      const client = await globalThis.ModsGitHub.connect({ repo, branch, prefix, token });
      const result = await client.read();
      state.client = client;
      setLoaded(result);
      $('login-panel').hidden = true;
      $('editor-panel').hidden = $('disconnect').hidden = false;
      setCopy(loginContext, client.account + ' · ' + client.target.repo + ' · ' + client.target.branch);
      try { localStorage.setItem('mods-admin-target', JSON.stringify(client.target)); } catch {}
    } catch (error) {
      message($('login-message'), errorText(error), true);
    } finally {
      $('connect').disabled = false;
    }
  }

  async function reload() {
    if (loading()) return;
    const question = copy('Zahodit místní úpravy a načíst aktuální obsah z GitHubu?', 'Discard local edits and reload the catalog from GitHub?');
    if ((state.formDirty || hasStagedChanges()) && !window.confirm(local(question))) return;
    state.busy = true;
    updateControls(copy('Načítám aktuální katalog…', 'Reloading the catalog…'));
    try {
      setLoaded(await state.client.read());
      state.busy = false;
      $('commit-link').hidden = true;
      updateControls(copy('Katalog je načtený.', 'Catalog reloaded.'));
    } catch (error) {
      state.busy = false;
      updateControls(errorText(error), true);
    }
  }

  setupLanguages();
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (window.top !== window.self || !(location.protocol === 'https:' || (location.protocol === 'http:' && loopback))) {
    $('admin-unavailable').hidden = false;
    return;
  }
  $('login-panel').hidden = false;
  setupDefaults();
  $('login-form').addEventListener('submit', login);
  $('disconnect').addEventListener('click', () => {
    const question = copy('Odhlásit se a zahodit místní úpravy?', 'Sign out and discard local edits?');
    if ((state.formDirty || hasStagedChanges()) && !window.confirm(local(question))) return;
    state.client = null;
    state.catalog = null;
    state.uploads.clear();
    state.formDirty = false;
    state.section = 'mods';
    state.id = null;
    $('editor-panel').hidden = $('disconnect').hidden = true;
    $('login-panel').hidden = false;
    $('commit-link').hidden = true;
    setCopy(loginContext, loginHint);
    message($('login-message'));
    $('token').focus();
  });
  $('editor-nav').addEventListener('click', event => {
    const section = event.target.closest('[data-section]')?.dataset.section;
    if (section && section !== state.section) select(section);
  });
  $('add-record').addEventListener('click', () => select(state.section, ''));
  $('cancel-edit').addEventListener('click', () => {
    if (allowedToLeaveForm()) renderEditor();
  });
  $('publish').addEventListener('click', publish);
  $('reload-catalog').addEventListener('click', reload);
  form.addEventListener('input', markEdited);
  form.addEventListener('change', markEdited);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (loading()) return;
    state.busy = true;
    updateControls();
    try { await stage(); } finally {
      state.busy = false;
      updateControls();
    }
  });
  window.addEventListener('beforeunload', event => {
    if (state.formDirty || hasStagedChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
})();
