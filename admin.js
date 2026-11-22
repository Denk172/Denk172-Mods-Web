(() => {
  'use strict';
  const format = globalThis.ModsCatalog;
  const $ = id => document.getElementById(id);
  const form = $('record-form');
  const fields = $('record-fields');
  const sectionNames = {
    mods: { title: 'Mody', add: 'Přidat mód' },
    games: { title: 'Hry', add: 'Přidat hru' },
    categories: { title: 'Kategorie', add: 'Přidat kategorii' },
    announcements: { title: 'Oznámení', add: 'Přidat oznámení' },
    settings: { title: 'Nastavení' },
  };
  const state = {
    client: null, head: '', base: '', catalog: null, uploads: new Map(),
    section: 'mods', id: null, formDirty: false, busy: false, mediaReaders: [],
  };
  const blankPair = () => ({ cs: '', en: '' });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function action(text, callback, className = '') {
    const button = el('button', 'admin-button ' + className, text);
    button.type = 'button';
    button.addEventListener('click', callback);
    return button;
  }

  function message(node, text = '', error = false) {
    node.textContent = text;
    node.hidden = !text;
    node.toggleAttribute('data-error', error);
  }

  function errorText(error) {
    if (error.name === 'TimeoutError') return 'GitHub se neozval včas. Úpravy v editoru zůstaly.';
    if (error instanceof TypeError) return 'Připojení ke GitHubu se nezdařilo. Zkus to znovu.';
    return String(error.message || error).replace(/github_pat_[a-zA-Z0-9_]+/g, '[klíč]').slice(0, 500);
  }

  function input(parent, name, label, initial = '', options = {}) {
    const wrapper = el('label', 'admin-field');
    wrapper.append(el('span', null, label));
    const control = el(options.choices ? 'select' : options.lines ? 'textarea' : 'input');
    if (!options.choices && !options.lines) control.type = options.type || 'text';
    control.name = name;
    if (options.choices) {
      for (const [value, text] of options.choices) control.add(new Option(text, value));
    }
    if (options.lines) control.rows = options.lines;
    if (options.max) control.maxLength = options.max;
    if (options.required) control.required = true;
    if (options.placeholder) control.placeholder = options.placeholder;
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
      controls[lang].setAttribute('aria-label', label + ' – ' + language);
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
    wrapper.append(control, document.createTextNode(label));
    parent.append(wrapper);
    return control;
  }

  const control = name => form.elements.namedItem(name);
  const value = name => control(name).value.trim();
  const pairValue = name => ({ cs: value(name + '-cs'), en: value(name + '-en') });
  const title = record => record?.title?.cs || record?.name?.cs || '';
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
    const status = text ?? (state.formDirty ? 'Rozpracované úpravy v otevřené položce.' : hasStagedChanges() ? 'Změny čekají na zveřejnění.' : 'Bez změn.');
    message($('publish-status'), status, error);
  }

  function markEdited() {
    state.formDirty = true;
    updateControls();
  }

  function allowedToLeaveForm() {
    return !state.formDirty || window.confirm('Zahodit úpravy v této rozepsané položce?');
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
    $('list-title').textContent = sectionNames[state.section].title;
    $('add-record').textContent = sectionNames[state.section].add;
    const list = $('record-list');
    list.replaceChildren();
    for (const record of records()) {
      const button = el('button', 'record-pick');
      button.type = 'button';
      button.append(el('span', null, title(record)));
      if (record.id === state.id) button.setAttribute('aria-current', 'true');
      const game = state.catalog.games.find(game => game.id === record.gameId);
      const meta = [game?.name.cs, record.visible ? '' : 'Skryté na webu'].filter(Boolean);
      if (meta.length) button.append(el('small', null, meta.join(' · ')));
      button.addEventListener('click', () => select(state.section, record.id));
      const row = el('li');
      row.append(button);
      list.append(row);
    }
    if (!records().length) list.append(el('li', 'empty-copy', 'Zatím tu nejsou žádné položky.'));
  }

  function select(section, id = null, focus = true) {
    if (loading() || !allowedToLeaveForm()) return;
    state.section = section;
    state.id = id ?? (section === 'settings' ? '' : state.catalog[section][0]?.id || '');
    renderEditor(focus);
  }

  function gameChoices(optional) {
    const first = optional ? ['', 'Úvodní stránka'] : ['', 'Vyber hru'];
    return [first, ...state.catalog.games.map(game => [game.id, game.name.cs])];
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
    group.append(el('legend', null, isGame ? 'Obrázek hry' : 'Náhled a screenshoty'));
    const description = isGame
      ? 'Vyber JPG, PNG nebo WebP, případně vlož adresu existujícího obrázku.'
      : 'První obrázek je hlavní náhled. Další se zobrazí v galerii.';
    group.append(el('p', 'field-hint', description));
    const list = el('div');
    const add = action(isGame ? 'Přidat obrázek hry' : 'Přidat obrázek', () => {
      appendImage();
      markEdited();
    });
    let nextId = 0;
    const readers = new Map();
    state.mediaReaders = () => [...list.children].map(row => readers.get(row)());
    function positions() {
      [...list.children].forEach((row, index, rows) => {
        row.querySelector('strong').textContent = isGame ? 'Obrázek hry' : index === 0 ? 'Hlavní náhled' : 'Obrázek ' + (index + 1);
        row.querySelector('[data-up]').disabled = index === 0;
        row.querySelector('[data-down]').disabled = index === rows.length - 1;
      });
      add.hidden = list.childElementCount >= (isGame ? 1 : 12);
    }
    function appendImage(image = { src: '', caption: blankPair(), fit: 'contain' }) {
      const row = el('div', 'media-editor');
      const header = el('div', 'media-editor-header');
      const tools = el('div', 'admin-inline');
      const up = action('Výš', () => {
        if (row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
        positions();
        markEdited();
      });
      const down = action('Níže', () => {
        if (row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
        positions();
        markEdited();
      });
      up.setAttribute('data-up', '');
      down.setAttribute('data-down', '');
      up.hidden = down.hidden = isGame;
      tools.append(up, down, action('Odebrat obrázek', () => {
        readers.delete(row);
        row.remove();
        positions();
        markEdited();
      }, 'quiet'));
      header.append(el('strong'), tools);
      row.append(header);
      const base = 'media-' + nextId++;
      const src = input(row, base + '-src', 'HTTPS adresa nebo cesta v assets/images', image.src, { max: 2048 });
      const file = input(row, base + '-file', 'Nahrát soubor (max. 5 MB)', '', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
      file.addEventListener('change', () => { if (file.files[0]) src.value = ''; });
      src.addEventListener('input', () => { if (src.value && file.files[0]) file.value = ''; });
      const captions = pairFields(row, base + '-caption', 'Popis obrázku', image.caption, { max: 240 });
      const fit = input(row, base + '-fit', 'Zobrazení náhledu', image.fit, {
        choices: [['contain', 'Celý obrázek'], ['cover', 'Vyplnit rámeček']],
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
    input(columns, 'game', 'Hra', record.gameId, { choices: gameChoices(false), required: true });
    input(columns, 'status', 'Stav', record.status, {
      choices: Object.entries(format.STATUS).map(([id, names]) => [id, names.cs]),
    });
    fields.append(columns);
    pairFields(fields, 'title', 'Název módu', record.title, { max: 140, required: true });
    pairFields(fields, 'description', 'Popis módu', record.description, { max: 2500, lines: 4, required: true });
    pairFields(fields, 'note', 'Poznámka nebo požadavky (volitelné)', record.note, { max: 1200, lines: 2 });
    const links = el('div', 'admin-columns');
    input(links, 'version', 'Verze (volitelné)', record.version, { max: 60, placeholder: '1.0.0' });
    input(links, 'platform', 'Text odkazu (volitelné)', record.platform, { max: 80, placeholder: 'Nexus Mods' });
    fields.append(links);
    input(fields, 'url', 'Odkaz na mód (volitelné)', record.url, { type: 'url', max: 2048, placeholder: 'https://' });
    const group = el('fieldset', 'admin-group');
    group.append(el('legend', null, 'Kategorie'));
    const choices = el('div', 'category-choices');
    for (const category of state.catalog.categories) {
      checkbox(choices, 'category', category.name.cs, record.categoryIds.includes(category.id), category.id);
    }
    if (!choices.childElementCount) choices.append(el('p', 'field-hint', 'Kategorie můžeš vytvořit v záložce Kategorie.'));
    group.append(choices);
    fields.append(group);
    mediaFields(fields, record.images, false);
  }

  function renderGame(record) {
    pairFields(fields, 'name', 'Název hry', record.name, { max: 120, required: true });
    pairFields(fields, 'caption', 'Podtitul dlaždice (volitelné)', record.caption, { max: 120 });
    pairFields(fields, 'description', 'Popis hry (volitelné)', record.description, { max: 600, lines: 3 });
    mediaFields(fields, record.cover ? [record.cover] : [], true);
  }

  function renderAnnouncement(record) {
    input(fields, 'game', 'Kde se má oznámení zobrazit', record.gameId, { choices: gameChoices(true) });
    pairFields(fields, 'title', 'Nadpis oznámení', record.title, { max: 120, required: true });
    pairFields(fields, 'message', 'Text oznámení', record.message, { max: 2500, lines: 5, required: true });
    input(fields, 'url', 'Odkaz (volitelné)', record.url, { type: 'url', max: 2048, placeholder: 'https://' });
  }

  function renderSettings() {
    const settings = state.catalog.settings;
    pairFields(fields, 'heading', 'Nadpis úvodní stránky', settings.heading, { max: 100, required: true });
    pairFields(fields, 'intro', 'Úvodní text (volitelné)', settings.intro, { max: 300, lines: 2 });
    const group = el('fieldset', 'admin-group');
    group.append(el('legend', null, 'Žluté upozornění'));
    checkbox(group, 'wip-visible', 'Zobrazit upozornění nahoře na webu', settings.wip.visible);
    fields.append(group);
    pairFields(fields, 'wip-title', 'Nadpis upozornění', settings.wip.title, { max: 100, required: true });
    pairFields(fields, 'wip-message', 'Text upozornění', settings.wip.message, { max: 400, lines: 3, required: true });
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
    header.textContent = isSettings ? 'Nastavení webu' : record ? title(record) : sectionNames[state.section].add;
    $('record-actions').hidden = false;
    if (isSettings) {
      renderSettings();
    } else {
      const item = record || newRecord(state.section);
      if (state.section === 'mods') renderMod(item);
      if (state.section === 'games') renderGame(item);
      if (state.section === 'categories') pairFields(fields, 'name', 'Název kategorie', item.name, { max: 80, required: true });
      if (state.section === 'announcements') renderAnnouncement(item);
      const visibility = el('fieldset', 'admin-group');
      visibility.append(el('legend', null, 'Viditelnost'));
      checkbox(visibility, 'visible', 'Zobrazit na webu', item.visible);
      visibility.append(el('p', 'field-hint', 'Skrytá položka zmizí z webu. V souborech veřejného repozitáře zůstává čitelná.'));
      fields.append(visibility);
      if (record) {
        const management = el('div', 'admin-inline record-management');
        const order = el('div', 'admin-inline');
        const siblings = state.section === 'mods' ? records().filter(item => item.gameId === record.gameId) : records();
        const index = siblings.findIndex(item => item.id === state.id);
        const up = action('Posunout výš', () => moveRecord(-1), 'quiet');
        const down = action('Posunout níž', () => moveRecord(1), 'quiet');
        up.disabled = index <= 0;
        down.disabled = index >= siblings.length - 1;
        order.append(up, down);
        management.append(order, action('Odstranit položku', removeRecord, 'danger'));
        fields.append(management);
      }
    }
    updateControls();
    if (focus) header.focus();
  }

  function moveRecord(direction) {
    if (state.formDirty) {
      message($('form-message'), 'Nejdřív ulož nebo zruš právě rozepsané úpravy.', true);
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
      message($('form-message'), 'Nejdřív přesuň nebo odstraň mody a oznámení této hry. Hru můžeš mezitím skrýt.', true);
      return;
    }
    const warning = state.section === 'categories' ? ' Přiřazení téhle kategorie se odebere i z modů.' : '';
    if (!window.confirm('Přidat odstranění „' + title(record) + '“ do změn?' + warning)) return;
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
    if (file.size > format.IMAGE_BYTES) throw new Error('Soubor „' + file.name + '“ je větší než 5 MB.');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    let extension = '';
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) extension = 'jpg';
    if (String.fromCharCode(...header.slice(0, 8)) === '\x89PNG\r\n\x1a\n') extension = 'png';
    if (String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP') extension = 'webp';
    if (!extension) throw new Error('Soubor „' + file.name + '“ musí být JPG, PNG nebo WebP.');
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('Obrázek „' + file.name + '“ se nepodařilo otevřít.');
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
      if (!record.caption.cs || !record.caption.en) throw new Error('Doplň český i anglický popis obrázku.');
      if (file) {
        Object.assign(record, await uploadImage(file, id));
        uploads.set(record.src, file);
      }
      if (!format.imageSource(record.src)) throw new Error('U obrázku vyber soubor nebo zadej platnou adresu.');
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
    message($('form-message'), 'Uloženo do změn.');
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
    updateControls('Připravuju změny ke zveřejnění…');
    try {
      if (state.formDirty && !await stage()) return;
      if (!hasStagedChanges()) return;
      updateControls('Ukládám katalog a obrázky na GitHub…');
      const published = structuredClone(state.catalog);
      const previousTime = Date.parse(published.updatedAt) || 0;
      published.updatedAt = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
      published.publication = state.client.publication;
      const latest = await state.client.read();
      if (latest.head !== state.head && !sameAsBase(latest.catalog)) {
        throw new Error('Obsah na GitHubu se mezitím změnil. Tvoje úpravy zůstaly v editoru. Před dalším zveřejněním zkontroluj změnu v repozitáři.');
      }
      let result;
      try {
        result = await state.client.publish(latest.head, published, state.uploads);
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
      updateControls('Změny jsou uložené na GitHubu. Návštěvníkům se načtou po aktualizaci obsahu.');
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
    message($('login-message'), 'Načítám katalog z GitHubu…');
    try {
      const client = await globalThis.ModsGitHub.connect({ repo, branch, prefix, token });
      const result = await client.read();
      state.client = client;
      setLoaded(result);
      $('login-panel').hidden = true;
      $('editor-panel').hidden = $('disconnect').hidden = false;
      $('admin-context').textContent = client.account + ' · ' + client.target.repo + ' · ' + client.target.branch;
      try { localStorage.setItem('mods-admin-target', JSON.stringify(client.target)); } catch {}
    } catch (error) {
      message($('login-message'), errorText(error), true);
    } finally {
      $('connect').disabled = false;
    }
  }

  async function reload() {
    if (loading()) return;
    if ((state.formDirty || hasStagedChanges()) && !window.confirm('Zahodit místní úpravy a načíst aktuální obsah z GitHubu?')) return;
    state.busy = true;
    updateControls('Načítám aktuální katalog…');
    try {
      setLoaded(await state.client.read());
      state.busy = false;
      $('commit-link').hidden = true;
      updateControls('Katalog je načtený.');
    } catch (error) {
      state.busy = false;
      updateControls(errorText(error), true);
    }
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (window.top !== window.self || !(location.protocol === 'https:' || (location.protocol === 'http:' && local))) {
    $('admin-unavailable').hidden = false;
    return;
  }
  $('login-panel').hidden = false;
  setupDefaults();
  $('login-form').addEventListener('submit', login);
  $('disconnect').addEventListener('click', () => {
    if ((state.formDirty || hasStagedChanges()) && !window.confirm('Odhlásit se a zahodit místní úpravy?')) return;
    state.client = null;
    state.catalog = null;
    state.uploads.clear();
    state.formDirty = false;
    state.section = 'mods';
    state.id = null;
    $('editor-panel').hidden = $('disconnect').hidden = true;
    $('login-panel').hidden = false;
    $('commit-link').hidden = true;
    $('admin-context').textContent = 'Připoj repozitář, ze kterého GitHub Pages zobrazuje tvůj web.';
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
