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

  const fail = message => { throw new Error(message); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max;
  const key = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80;
  const localizations = { cs: 'Čeština', en: 'English' };

  function bilingual(value, label, max, required = true) {
    if (!object(value) || !text(value.cs, 0, max) || !text(value.en, 0, max)) fail(label + ' má neplatný text.');
    if (required || value.cs.trim() || value.en.trim()) {
      for (const [lang, name] of Object.entries(localizations)) {
        if (!value[lang].trim()) fail(label + ' · doplň text pro ' + name + '.');
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

  function checkImages(images, label, max) {
    if (!Array.isArray(images) || images.length > max) fail(label + ' · může mít nejvýš ' + max + ' obrázků.');
    for (const image of images) {
      if (!object(image) || !imageSource(image.src)) fail(label + ' · obrázek vyžaduje HTTPS adresu nebo soubor ze složky assets/images.');
      if (!['cover', 'contain'].includes(image.fit)) fail(label + ' · neplatné zarovnání obrázku.');
      if (image.width !== undefined && (!Number.isInteger(image.width) || image.width < 1 || image.width > 20_000)) fail(label + ' · neplatná šířka obrázku.');
      if (image.height !== undefined && (!Number.isInteger(image.height) || image.height < 1 || image.height > 20_000)) fail(label + ' · neplatná výška obrázku.');
      bilingual(image.caption, label + ' · popisek obrázku', 240);
    }
  }

  function checkCollection(records, type) {
    if (!Array.isArray(records)) fail('V katalogu chybí ' + type + '.');
    const ids = new Set();
    for (const record of records) {
      if (!object(record) || !key(record.id) || ids.has(record.id) || typeof record.visible !== 'boolean') fail('Neplatné nebo opakované ID v části ' + type + '.');
      ids.add(record.id);
    }
    return ids;
  }

  function validate(data) {
    if (!object(data) || data.format !== 'denk172-catalog/1') fail('Tento soubor nemá formát katalogu Denk172 Mods.');
    if (data.updatedAt !== null && !Number.isFinite(Date.parse(data.updatedAt))) fail('Neplatné datum aktualizace.');
    const publication = data.publication;
    if (publication !== null && (!object(publication) || repoName(publication.repo) !== publication.repo ||
        !branchName(publication.branch) || !['', 'docs'].includes(publication.prefix))) fail('Neplatné nastavení zveřejnění.');
    if (!object(data.settings) || !object(data.settings.wip) || typeof data.settings.wip.visible !== 'boolean') fail('Neplatné nastavení webu.');
    bilingual(data.settings.heading, 'Nadpis úvodní stránky', 100);
    bilingual(data.settings.intro, 'Úvodní text', 300, false);
    bilingual(data.settings.wip.title, 'Nadpis upozornění', 100);
    bilingual(data.settings.wip.message, 'Text upozornění', 400);
    const gameIds = checkCollection(data.games, 'hry');
    const categoryIds = checkCollection(data.categories, 'kategorie');
    checkCollection(data.mods, 'mody');
    checkCollection(data.announcements, 'oznámení');
    for (const game of data.games) {
      if (['content', 'hry', 'games', 'announcements'].includes(game.id)) fail('ID hry „' + game.id + '“ je vyhrazené.');
      const label = 'Hra „' + game.id + '“';
      bilingual(game.name, label + ' · název', 120);
      bilingual(game.caption, label + ' · podtitul', 120, false);
      bilingual(game.description, label + ' · popis', 600, false);
      if (game.cover !== null) checkImages([game.cover], label, 1);
    }
    for (const category of data.categories) bilingual(category.name, 'Kategorie „' + category.id + '“', 80);
    for (const mod of data.mods) {
      const label = 'Mód „' + mod.id + '“';
      if (!gameIds.has(mod.gameId)) fail(label + ' · vyber existující hru.');
      if (!Array.isArray(mod.categoryIds) || !mod.categoryIds.every(id => categoryIds.has(id))) fail(label + ' · neplatný výběr kategorií.');
      if (!Object.hasOwn(STATUS, mod.status)) fail(label + ' · neplatný stav.');
      if (!text(mod.version, 0, 60) || !text(mod.platform, 0, 80)) fail(label + ' · neplatná verze nebo označení odkazu.');
      if (typeof mod.url !== 'string' || (mod.url && !webUrl(mod.url))) fail(label + ' · odkaz musí začínat https://.');
      bilingual(mod.title, label + ' · název', 140);
      bilingual(mod.description, label + ' · popis', 2500);
      bilingual(mod.note, label + ' · poznámka', 1200, false);
      checkImages(mod.images, label, 12);
    }
    for (const item of data.announcements) {
      const label = 'Oznámení „' + item.id + '“';
      if (item.gameId !== '' && !gameIds.has(item.gameId)) fail(label + ' · neplatná hra.');
      bilingual(item.title, label + ' · nadpis', 120);
      bilingual(item.message, label + ' · text', 2500);
      if (typeof item.url !== 'string' || (item.url && !webUrl(item.url))) fail(label + ' · odkaz musí začínat https://.');
    }
    return data;
  }

  function encode(data) {
    validate(data);
    const source = PREFIX + JSON.stringify(data, null, 2) + ';\n';
    if (new TextEncoder().encode(source).length > MAX_BYTES) fail('Katalog je příliš velký. Zkrať některé popisy.');
    return source;
  }

  function decode(source) {
    if (typeof source !== 'string' || source.length > MAX_BYTES) fail('Soubor katalogu je příliš velký.');
    const content = source.trim();
    if (!content.startsWith(PREFIX) || !content.endsWith(';')) fail('Katalog nemá očekávaný formát.');
    return validate(JSON.parse(content.slice(PREFIX.length, -1)));
  }

  function rawUrl(publication, relativePath) {
    const branch = publication.branch.split('/').map(encodeURIComponent).join('/');
    return new URL('https://raw.githubusercontent.com/' + publication.repo + '/refs/heads/' + branch + '/' + filePath(publication.prefix, relativePath));
  }

  globalThis.ModsCatalog = { PATH, STATUS, IMAGE_BYTES, BATCH_BYTES, validate, encode, decode, webUrl, imageSource, repoName, branchName, filePath, rawUrl };
})();
