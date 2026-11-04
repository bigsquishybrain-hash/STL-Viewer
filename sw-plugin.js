// Tiny Vite plugin that emits a service worker precaching every built file,
// so the installed app works with no network at all. The cache name includes
// a hash of the file list, so each new build gets a fresh cache.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const template = readFileSync(fileURLToPath(new URL('./src/sw-template.js', import.meta.url)), 'utf8');

export default function serviceWorker() {
  let publicFiles = [];
  return {
    name: 'stl-viewer-sw',
    apply: 'build',
    enforce: 'post',
    async buildStart() {
      const { readdirSync, statSync } = await import('node:fs');
      const { join, relative } = await import('node:path');
      const root = fileURLToPath(new URL('./public', import.meta.url));
      const walk = (dir) =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [relative(root, p).split('\\').join('/')];
        });
      try {
        publicFiles = walk(root);
      } catch {
        publicFiles = [];
      }
    },
    generateBundle(_opts, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`), ...publicFiles.map((f) => `./${f}`)].filter(
        (f) => !f.endsWith('.map')
      );
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const chunk = bundle[name];
        hash.update(name);
        hash.update(chunk.type === 'chunk' ? chunk.code : chunk.source);
      }
      for (const f of publicFiles.sort()) hash.update(f);
      const version = hash.digest('hex').slice(0, 12);
      const source = template.replace("'__VERSION__'", JSON.stringify(version)).replace('= __FILES__;', `= ${JSON.stringify(files, null, 2)};`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
