(() => {
  'use strict';

  const PATH = 'assets/data/catalog.js';
  const PREFIX = 'globalThis.DENK172_DATA = ';
  const MAX_BYTES = 750_000;
  const IMAGE_BYTES = 5 * 1024 * 1024;
  const BATCH_BYTES = 10 * 1024 * 1024;
  const STATUS = {
    released: { cs: 'Vydáno', en: 'Released' },
    wip: { cs: 'Rozpracované', en: 'In development' },
    unlisted: { cs: 'Nevydáno', en: 'Unreleased' },
    'no-link': { cs: 'Zatím bez odkazu', en: 'No link yet' },
  };

  class LocalizedError extends Error {
    constructor(cs, en = cs) {
      super(cs);
      this.messages = { cs, en };
    }
  }

  const fail = (cs, en) => { throw new LocalizedError(cs, en); };
  const label = (cs, en) => ({ cs, en });
  const fieldLabel = (section, cs, en) => label(section.cs + ' · ' + cs, section.en + ' · ' + en);
  const failFor = (section, cs, en) => {
    const message = fieldLabel(section, cs, en);
    fail(message.cs, message.en);
  };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
  const key = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
  const localizations = { cs: 'Čeština', en: 'English' };

  function bilingual(value, field, max, required = true) {
    if (!object(value) || !text(value.cs, 0, max) || !text(value.en, 0, max)) failFor(field, 'neplatný text.', 'invalid text.');
    if (required || value.cs.trim() || value.en.trim()) {
      for (const [lang, name] of Object.entries(localizations)) {
        if (!value[lang].trim()) failFor(field, 'doplň text pro ' + name + '.', 'enter the ' + (lang === 'cs' ? 'Czech' : 'English') + ' text.');
      }
    }
  }

  function webUrl(value) {
    if (!text(value, 1, 2048) || !/^https:\/\//i.test(value)) return '';
    try {
      const url = new URL(value);
      return url.hostname && !url.username && !url.password ? url.href : '';
    } catch {
      return '';
    }
  }

  function imageSource(value) {
    if (typeof value === 'string' &&
        /^assets\/images\/(?:[a-z\d][a-z\d._-]*\/)*[a-z\d][a-z\d._-]*\.(?:jpe?g|png|webp|gif|avif)$/i.test(value)) return value;
    return webUrl(value);
  }

  function repoName(value) {
    if (typeof value !== 'string') return '';
    const match = value.trim().match(/^(?:https:\/\/github\.com\/)?([a-z\d][a-z\d-]{0,38})\/([a-z\d_.-]{1,100})\/?$/i);
    if (!match) return '';
    const name = match[2].replace(/\.git$/i, '');
    return name && name !== '.' && name !== '..' ? match[1] + '/' + name : '';
  }

  function branchName(value) {
    return typeof value === 'string' && value.length <= 180 &&
      /^(?:[\w\d][\w.\d-]*\/)*[\w\d][\w.\d-]*$/.test(value) &&
      !value.includes('..') && !value.split('/').some(part => part.endsWith('.') || part.endsWith('.lock'));
  }

  function filePath(prefix, relativePath = PATH) {
    return prefix === 'docs' ? 'docs/' + relativePath : relativePath;
  }

  function checkImages(images, section, max) {
    if (!Array.isArray(images) || images.length > max) failFor(section, 'může mít nejvýš ' + max + ' obrázků.', 'use at most ' + max + ' image(s).');
    for (const image of images) {
      if (!object(image) || !imageSource(image.src)) failFor(section, 'obrázek vyžaduje HTTPS adresu nebo soubor ze složky assets/images.', 'use an HTTPS image URL or a file in assets/images.');
      if (!['cover', 'contain'].includes(image.fit)) failFor(section, 'neplatné zarovnání obrázku.', 'invalid image fit.');
      if (image.width !== undefined && (!Number.isInteger(image.width) || image.width < 1 || image.width > 20_000)) failFor(section, 'neplatná šířka obrázku.', 'invalid image width.');
      if (image.height !== undefined && (!Number.isInteger(image.height) || image.height < 1 || image.height > 20_000)) failFor(section, 'neplatná výška obrázku.', 'invalid image height.');
      bilingual(image.caption, fieldLabel(section, 'popisek obrázku', 'image description'), 240);
    }
  }

  function checkCollection(records, type) {
    if (!Array.isArray(records)) fail('V katalogu chybí ' + type.cs + '.', 'The catalog is missing ' + type.en + '.');
    const ids = new Set();
    for (const record of records) {
      if (!object(record) || !key(record.id) || ids.has(record.id) || typeof record.visible !== 'boolean') fail('Neplatná, duplicitní nebo neúplná položka v části ' + type.cs + '.', 'Invalid, duplicate or incomplete entry in ' + type.en + '.');
      ids.add(record.id);
    }
    return ids;
  }

  function validate(data) {
    if (!object(data) || data.format !== 'denk172-catalog/1') fail('Tento soubor nemá formát katalogu Denk172 Mods.', 'This file is not a Denk172 Mods catalog.');
    if (data.updatedAt !== null && !Number.isFinite(Date.parse(data.updatedAt))) fail('Neplatné datum aktualizace.', 'Invalid catalog update date.');
    const publication = data.publication;
    if (publication !== null && (!object(publication) || repoName(publication.repo) !== publication.repo ||
        !branchName(publication.branch) || !['', 'docs'].includes(publication.prefix))) fail('Neplatné nastavení zveřejnění.', 'Invalid publishing settings.');
    if (!object(data.settings) || !object(data.settings.wip) || typeof data.settings.wip.visible !== 'boolean') fail('Neplatné nastavení webu.', 'Invalid site settings.');
    bilingual(data.settings.heading, label('Nadpis úvodní stránky', 'Home page heading'), 100);
    bilingual(data.settings.intro, label('Úvodní text', 'Introduction'), 300, false);
    bilingual(data.settings.wip.title, label('Nadpis upozornění', 'Notice title'), 100);
    bilingual(data.settings.wip.message, label('Text upozornění', 'Notice text'), 400);
    const gameIds = checkCollection(data.games, label('hry', 'games'));
    const categoryIds = checkCollection(data.categories, label('kategorie', 'categories'));
    checkCollection(data.mods, label('mody', 'mods'));
    checkCollection(data.announcements, label('oznámení', 'announcements'));
    for (const game of data.games) {
      if (['content', 'hry', 'games', 'announcements'].includes(game.id)) fail('ID hry „' + game.id + '“ je vyhrazené.', 'The game ID “' + game.id + '” is reserved.');
      const gameLabel = label('Hra „' + game.id + '“', 'Game “' + game.id + '”');
      bilingual(game.name, fieldLabel(gameLabel, 'název', 'name'), 120);
      bilingual(game.caption, fieldLabel(gameLabel, 'podtitul', 'subtitle'), 120, false);
      bilingual(game.description, fieldLabel(gameLabel, 'popis', 'description'), 600, false);
      if (game.cover !== null) checkImages([game.cover], gameLabel, 1);
    }
    for (const category of data.categories) bilingual(category.name, label('Kategorie „' + category.id + '“', 'Category “' + category.id + '”'), 80);
    for (const mod of data.mods) {
      const modLabel = label('Mód „' + mod.id + '“', 'Mod “' + mod.id + '”');
      if (!gameIds.has(mod.gameId)) failFor(modLabel, 'vyber existující hru.', 'select an existing game.');
      if (!Array.isArray(mod.categoryIds) || !mod.categoryIds.every(id => categoryIds.has(id))) failFor(modLabel, 'neplatný výběr kategorií.', 'invalid categories.');
      if (!Object.hasOwn(STATUS, mod.status)) failFor(modLabel, 'neplatný stav.', 'invalid status.');
      if (!text(mod.version, 0, 60) || !text(mod.platform, 0, 80)) failFor(modLabel, 'neplatná verze nebo označení odkazu.', 'invalid version or link label.');
      if (typeof mod.url !== 'string' || (mod.url && !webUrl(mod.url))) failFor(modLabel, 'odkaz musí začínat https://.', 'the link must start with https://.');
      bilingual(mod.title, fieldLabel(modLabel, 'název', 'title'), 140);
      bilingual(mod.description, fieldLabel(modLabel, 'popis', 'description'), 2500);
      bilingual(mod.note, fieldLabel(modLabel, 'poznámka', 'note'), 1200, false);
      checkImages(mod.images, modLabel, 12);
    }
    for (const item of data.announcements) {
      const announcement = label('Oznámení „' + item.id + '“', 'Announcement “' + item.id + '”');
      if (item.gameId !== '' && !gameIds.has(item.gameId)) failFor(announcement, 'neplatná hra.', 'invalid game.');
      bilingual(item.title, fieldLabel(announcement, 'nadpis', 'title'), 120);
      bilingual(item.message, fieldLabel(announcement, 'text', 'text'), 2500);
      if (typeof item.url !== 'string' || (item.url && !webUrl(item.url))) failFor(announcement, 'odkaz musí začínat https://.', 'the link must start with https://.');
    }
    return data;
  }

  function encode(data) {
    validate(data);
    const source = PREFIX + JSON.stringify(data, null, 2) + ';\n';
    if (new TextEncoder().encode(source).length > MAX_BYTES) fail('Katalog je příliš velký. Zkrať některé popisy.', 'The catalog is too large. Shorten some descriptions.');
    return source;
  }

  function decode(source) {
    if (typeof source !== 'string' || source.length > MAX_BYTES) fail('Soubor katalogu je příliš velký.', 'The catalog file is too large.');
    const content = source.trim();
    if (!content.startsWith(PREFIX) || !content.endsWith(';')) fail('Katalog nemá očekávaný formát.', 'The catalog has an unexpected format.');
    let data;
    try { data = JSON.parse(content.slice(PREFIX.length, -1)); } catch {
      fail('Soubor katalogu obsahuje neplatná data.', 'The catalog file contains invalid data.');
    }
    return validate(data);
  }

  function rawUrl(publication, relativePath) {
    const branch = publication.branch.split('/').map(encodeURIComponent).join('/');
    return new URL('https://raw.githubusercontent.com/' + publication.repo + '/refs/heads/' + branch + '/' + filePath(publication.prefix, relativePath));
  }

  globalThis.ModsCatalog = { PATH, STATUS, IMAGE_BYTES, BATCH_BYTES, LocalizedError, validate, encode, decode, webUrl, imageSource, repoName, branchName, filePath, rawUrl };
})();
