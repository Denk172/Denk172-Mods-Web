(() => {
  'use strict';
  const format = globalThis.ModsCatalog;
  const { LocalizedError } = format;
  const api = 'https://api.github.com';

  class GitHubError extends LocalizedError {
    constructor(status, cs, en) {
      super(cs, en);
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
    if (response.status === 401) throw new GitHubError(401, 'GitHub klíč je neplatný nebo mu vypršela platnost.', 'The GitHub token is invalid or has expired.');
    if (response.status === 403) throw new GitHubError(403, 'GitHub přístup odmítl. Zkontroluj, že klíč smí zapisovat do obsahu vybraného repozitáře.', 'GitHub denied access. Check that the token can write to the selected repository.');
    if (!response.ok) throw new GitHubError(response.status, result.message || 'GitHub vrátil chybu HTTP ' + response.status + '.', result.message || 'GitHub returned HTTP error ' + response.status + '.');
    if (result.errors?.length) {
      const messages = result.errors.map(item => item.message).join(' ');
      const conflict = /expected branch|expected.*(head|oid)|does not match|head.*expected/i.test(messages);
      throw new GitHubError(conflict ? 409 : 0, messages);
    }
    return result;
  }

  async function connect({ repo, branch, prefix, token }) {
    if (!format.repoName(repo)) throw new LocalizedError('Zadej repozitář ve formátu uživatel/repozitář.', 'Enter the repository as username/repository.');
    if (branch && !format.branchName(branch)) throw new LocalizedError('Zkontroluj název větve.', 'Check the branch name.');
    if (!['', 'docs'].includes(prefix)) throw new LocalizedError('Zkontroluj složku webu.', 'Check the GitHub Pages folder.');
    if (!/^github_pat_[a-zA-Z0-9_]{20,}$/.test(token)) throw new LocalizedError('Vlož fine-grained token vytvořený v nastavení GitHubu.', 'Enter a fine-grained token created in your GitHub settings.');
    const [identity, repository] = await Promise.all([
      call(token, '/user'),
      call(token, '/repos/' + repo),
    ]);
    if (!identity.login || !repository.full_name) throw new LocalizedError('GitHub nepotvrdil přihlášení.', 'GitHub could not confirm the sign-in.');
    if (repository.owner.type === 'User' && identity.login.toLowerCase() !== repository.owner.login.toLowerCase()) {
      throw new LocalizedError('Přihlas se účtem, který tento repozitář vlastní.', 'Sign in with the account that owns this repository.');
    }
    if (repository.permissions?.push === false) throw new LocalizedError('Tento účet nemá oprávnění zapisovat do repozitáře.', 'This account cannot write to the repository.');
    const target = { repo: repository.full_name, branch: branch || repository.default_branch, prefix };
    if (!format.branchName(target.branch)) throw new LocalizedError('Zkontroluj zdrojovou větev v GitHub Pages a zadej ji ručně.', 'Check the source branch in GitHub Pages settings and enter it here.');
    const publication = repository.private ? null : target;
    const catalogPath = format.filePath(prefix);
    const base = '/repos/' + target.repo;

    async function read() {
      let ref;
      try {
        ref = await call(token, base + '/git/ref/heads/' + target.branch);
      } catch (error) {
        if (error.status === 404) throw new GitHubError(404, 'Tato větev se v repozitáři nenašla. Zkontroluj nastavení GitHub Pages.', 'This branch does not exist in the repository. Check your GitHub Pages settings.');
        throw error;
      }
      const { node_id: branchId } = ref;
      const head = ref.object?.sha;
      if (ref.ref !== 'refs/heads/' + target.branch || ref.object?.type !== 'commit' || !head || !branchId) {
        throw new LocalizedError('GitHub neposlal potvrzení vybrané větve a její poslední změny.', 'GitHub could not confirm the selected branch and its latest commit.');
      }
      let source;
      try {
        source = await call(token, base + '/contents/' + catalogPath + '?ref=' + encodeURIComponent(head));
      } catch (error) {
        if (error.status === 404) throw new GitHubError(404, 'V této větvi a složce chybí katalog. Nahraj tam nový web ze ZIPu a připoj se znovu.', 'This branch and folder have no catalog. Upload the site files from the ZIP there and reconnect.');
        throw error;
      }
      if (source.type !== 'file' || source.encoding !== 'base64') throw new LocalizedError('GitHub neposlal čitelný soubor katalogu.', 'GitHub did not return a readable catalog file.');
      const bytes = Uint8Array.from(atob(source.content.replace(/\s/g, '')), character => character.charCodeAt(0));
      return { head, branchId, catalog: format.decode(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
    }

    async function publish({ head, branchId }, catalog, uploads) {
      if (!head || !branchId) throw new LocalizedError('Chybí údaje o větvi. Otevři aktuální verzi editoru.', 'Branch information is missing. Open the latest version of the editor.');
      const serialized = format.encode(catalog);
      const additions = [{
        path: catalogPath,
        contents: encodeBytes(new TextEncoder().encode(serialized)),
      }];
      let totalBytes = 0;
      for (const [path, file] of uploads) {
        if (!path.startsWith('assets/images/uploads/') || format.imageSource(path) !== path) throw new LocalizedError('Neplatná cesta nahrávaného obrázku.', 'Invalid path for an uploaded image.');
        totalBytes += file.size;
        if (file.size > format.IMAGE_BYTES || totalBytes > format.BATCH_BYTES) throw new LocalizedError('Při jednom zveřejnění můžeš nahrát nejvýš 10 MB obrázků.', 'You can upload up to 10 MB of images at a time.');
        additions.push({ path: format.filePath(prefix, path), contents: encodeBytes(new Uint8Array(await file.arrayBuffer())) });
      }
      const input = {
        branch: { id: branchId },
        expectedHeadOid: head,
        message: { headline: 'Update Denk172 Mods catalog' },
        fileChanges: { additions },
      };
      const result = await call(token, '/graphql', {
        query: 'mutation PublishCatalog($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
        variables: { input },
      });
      const oid = result.data?.createCommitOnBranch?.commit?.oid;
      if (!oid) throw new LocalizedError('GitHub nepotvrdil uložení. Než změny odešleš znovu, zkontroluj historii repozitáře.', 'GitHub did not confirm the save. Check the repository history before retrying.');
      return { head: oid, url: 'https://github.com/' + target.repo + '/commit/' + oid };
    }

    return { account: identity.login, target, publication, read, publish };
  }

  globalThis.ModsGitHub = { connect };
})();
