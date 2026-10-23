import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionCatalog } from '../src/extensions/catalog.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const extensions = path.join(root, 'src/extensions');
const normalize = (value) => value.replaceAll('\\', '/');

export function validateCatalog(catalog) {
  if (!Array.isArray(catalog)) throw Error('Invalid extension catalog.');
  const ids = new Set();
  for (const item of catalog) {
    if (
      !item ||
      !/^[a-zA-Z0-9:_-]{1,100}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      typeof item.description !== 'string' ||
      typeof item.defaultEnabled !== 'boolean' ||
      !Array.isArray(item.modes) ||
      !item.modes.length ||
      item.modes.some((mode) => !['tv', 'desktop'].includes(mode)) ||
      !item.modules ||
      typeof item.modules !== 'object' ||
      Array.isArray(item.modules) ||
      !Object.keys(item.modules).length
    )
      throw Error('Invalid extension declaration.');
    ids.add(item.id);
    for (const [layer, module] of Object.entries(item.modules)) {
      if (
        !['main', 'page', 'hooks'].includes(layer) ||
        typeof module !== 'string' ||
        (!module.startsWith('./') && !module.startsWith('../'))
      )
        throw Error('Invalid extension module.');
      const relative = path.relative(root, path.resolve(extensions, module));
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw Error('Extension module is outside the repository.');
    }
  }
}
function layerSource(catalog, layer) {
  const imports = [],
    entries = [];
  for (const item of catalog) {
    if (!item.modules[layer]) continue;
    const alias = 'start' + entries.length;
    imports.push(
      'import { start as ' +
        alias +
        ' } from ' +
        JSON.stringify(
          normalize(path.resolve(extensions, item.modules[layer])),
        ) +
        ';',
    );
    entries.push(JSON.stringify(item.id) + ': ' + alias);
  }
  return (
    imports.join('\n') + '\nexport const starts = {' + entries.join(',') + '};'
  );
}
export async function buildHookEntry(
  catalog = extensionCatalog,
  onModule = () => {},
) {
  validateCatalog(catalog);
  const entry = normalize(path.join(extensions, 'hooks/entry.ts'));
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'hook-closure',
        enforce: 'pre',
        resolveId(id) {
          if (id === entry) return id;
          if (!id.startsWith('.') && !path.isAbsolute(id))
            throw Error('External hook dependency is forbidden: ' + id);
        },
        load(id) {
          if (id === entry)
            return (
              layerSource(catalog, 'hooks') +
              '\nimport { createHookRuntime } from ' +
              JSON.stringify(
                normalize(path.join(extensions, 'hooks/runtime.ts')),
              ) +
              '; export const start = initial => createHookRuntime(initial,starts);'
            );
        },
        moduleParsed(info) {
          if (!info.id.startsWith('\0')) onModule(info.id);
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry, name: 'TubevraHooks', formats: ['iife'] },
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'UNRESOLVED_IMPORT')
            throw Error(warning.message);
          warn(warning);
        },
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (item) => item.output,
  );
  if (
    output.length !== 1 ||
    output[0].type !== 'chunk' ||
    output[0].imports.length ||
    output[0].dynamicImports.length
  )
    throw Error('Hooks must produce one self-contained bundle.');
  return (
    'export function hookEntry(initial) {\n' +
    output[0].code +
    '\nreturn TubevraHooks.start(initial);\n}'
  );
}
export function extensionBuildPlugin(catalog = extensionCatalog) {
  validateCatalog(catalog);
  return {
    name: 'tubevra-extensions',
    enforce: 'pre',
    async load(id) {
      const file = normalize(id);
      if (file === normalize(path.join(extensions, 'catalog.ts')))
        return (
          'export const extensionCatalog = ' + JSON.stringify(catalog) + ';'
        );
      if (file === normalize(path.join(extensions, 'hooks/entry.ts')))
        return buildHookEntry(catalog, (dependency) =>
          this.addWatchFile(dependency),
        );
      for (const layer of ['main', 'page'])
        if (
          file ===
          normalize(path.join(extensions, layer + '/implementations.ts'))
        )
          return layerSource(catalog, layer);
    },
  };
}
