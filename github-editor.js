(() => {
  'use strict';
  const format = globalThis.ModsCatalog;
  const api = 'https://api.github.com';

  class GitHubError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  function encodeBytes(bytes) {
    let binary = '';
    for (let position = 0; position < bytes.length; position += 8192) {
      binary += String.fromCharCode(...bytes.subarray(position, position + 8192));
    }
    return btoa(binary);
  }

  async function call(token, endpoint, payload) {
    const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token };
    const options = {
      headers, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(30_000),
    };
    if (payload) {
      options.method = 'POST';
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(api + endpoint, options);
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) throw new GitHubError('GitHub klíč je neplatný nebo mu vypršela platnost.', 401);
    if (response.status === 403) throw new GitHubError('GitHub přístup odmítl. Zkontroluj, že klíč smí zapisovat do obsahu vybraného repozitáře.', 403);
    if (!response.ok) throw new GitHubError(result.message || 'GitHub vrátil chybu HTTP ' + response.status + '.', response.status);
    if (result.errors?.length) {
      const messages = result.errors.map(item => item.message).join(' ');
      throw new GitHubError(messages, /expected branch|expected.*(head|oid)|does not match|head.*expected/i.test(messages) ? 409 : 0);
    }
    return result;
  }

  async function connect({ repo, branch, prefix, token }) {
    if (!format.repoName(repo)) throw new Error('Zadej repozitář ve formátu uživatel/repozitář.');
    if (branch && !format.branchName(branch)) throw new Error('Zkontroluj název větve.');
    if (!['', 'docs'].includes(prefix)) throw new Error('Zkontroluj složku webu.');
    if (!/^github_pat_[a-zA-Z0-9_]{20,}$/.test(token)) throw new Error('Vlož fine-grained token vytvořený v nastavení GitHubu.');
    const [identity, repository] = await Promise.all([
      call(token, '/user'),
      call(token, '/repos/' + repo),
    ]);
    if (!identity.login || !repository.full_name) throw new Error('GitHub nepotvrdil přihlášení.');
    if (repository.owner.type === 'User' && identity.login.toLowerCase() !== repository.owner.login.toLowerCase()) {
      throw new Error('Přihlas se účtem, který tento repozitář vlastní.');
    }
    if (repository.permissions?.push === false) throw new Error('Tento účet nemá oprávnění zapisovat do repozitáře.');
    const target = { repo: repository.full_name, branch: branch || repository.default_branch, prefix };
    if (!format.branchName(target.branch)) throw new Error('Zkontroluj zdrojovou větev v GitHub Pages a zadej ji ručně.');
    const publication = repository.private ? null : target;
    const catalogPath = format.filePath(prefix);
    const base = '/repos/' + target.repo;

    async function read() {
      let head;
      try {
        const ref = await call(token, base + '/branches/' + encodeURIComponent(target.branch));
        head = ref.commit.sha;
      } catch (error) {
        if (error.status === 404) throw new GitHubError('Tato větev se v repozitáři nenašla. Zkontroluj nastavení GitHub Pages.', 404);
        throw error;
      }
      let source;
      try {
        source = await call(token, base + '/contents/' + catalogPath + '?ref=' + encodeURIComponent(head));
      } catch (error) {
        if (error.status === 404) throw new GitHubError('V této větvi a složce chybí katalog. Nahraj tam nový web ze ZIPu a připoj se znovu.', 404);
        throw error;
      }
      if (source.type !== 'file' || source.encoding !== 'base64') throw new Error('GitHub neposlal čitelný soubor katalogu.');
      const bytes = Uint8Array.from(atob(source.content.replace(/\s/g, '')), character => character.charCodeAt(0));
      return { head, catalog: format.decode(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
    }

    async function publish(head, catalog, uploads) {
      const serialized = format.encode(catalog);
      const additions = [{
        path: catalogPath,
        contents: encodeBytes(new TextEncoder().encode(serialized)),
      }];
      let totalBytes = 0;
      for (const [path, file] of uploads) {
        if (!path.startsWith('assets/images/uploads/') || format.imageSource(path) !== path) throw new Error('Neplatná cesta nahrávaného obrázku.');
        totalBytes += file.size;
        if (file.size > format.IMAGE_BYTES || totalBytes > format.BATCH_BYTES) throw new Error('Při jednom zveřejnění můžeš nahrát nejvýš 10 MB obrázků.');
        additions.push({ path: format.filePath(prefix, path), contents: encodeBytes(new Uint8Array(await file.arrayBuffer())) });
      }
      const input = {
        branch: { repositoryNameWithOwner: target.repo, branchName: target.branch },
        expectedHeadOid: head,
        message: { headline: 'Update Denk172 Mods catalog' },
        fileChanges: { additions },
      };
      const result = await call(token, '/graphql', {
        query: 'mutation PublishCatalog($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
        variables: { input },
      });
      const oid = result.data?.createCommitOnBranch?.commit?.oid;
      if (!oid) throw new Error('GitHub nepotvrdil uložení. Než změny odešleš znovu, zkontroluj historii repozitáře.');
      return { head: oid, url: 'https://github.com/' + target.repo + '/commit/' + oid };
    }

    return { account: identity.login, target, publication, read, publish };
  }

  globalThis.ModsGitHub = { connect };
})();
