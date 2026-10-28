import { readFile, writeFile } from 'node:fs/promises';

// Packager 20.3.0 parses SemVer suffixes as numeric Windows version components.
// Strip them only for binary fields; retain the original version strings.
const entry = import.meta.resolve('@electron/packager');
const { version } = JSON.parse(
  await readFile(new URL('../package.json', entry), 'utf8'),
);

if (version !== '20.3.0') {
  throw new Error(
    `[patch-packager] Expected @electron/packager 20.3.0, found ${version}. Review or remove the Windows SemVer patch before upgrading.`,
  );
}

const target = new URL('./resedit.js', entry);
const source = await readFile(target, 'utf8');
const original = "    const parts = str.split('.');";
// Accept the previously applied local fix as well as a clean npm install.
const previous = "    const parts = str.split('-')[0].split('.');";
const patched = "    const parts = str.split(/[+-]/, 1)[0].split('.');";
const matches = [original, previous, patched].filter((part) =>
  source.includes(part),
);

if (matches.length !== 1 || source.split(matches[0]).length !== 2) {
  throw new Error(
    '[patch-packager] Unexpected resedit.js parser. Review the Windows SemVer patch; no files were changed.',
  );
}

if (matches[0] === patched) {
  console.log('[patch-packager] Windows SemVer patch already applied.');
} else {
  await writeFile(target, source.replace(matches[0], patched));
  console.log('[patch-packager] Applied Windows SemVer patch.');
}
