// Prints the CHANGELOG.md section for one version (the GitHub release body).
// Usage: node scripts/release-notes.mjs v1.0.11   (or 1.0.11)
// Exits 1 with an empty body when the section is missing so the release
// workflow fails loudly instead of publishing without notes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = String(process.argv[2] || '').replace(/^v/, '');
const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md'), 'utf8');

// mirrors the in-app parser (app.js releaseNotesFor): "## <version>" up to the next "## "
const re = new RegExp('^## ' + version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))', 'm');
const m = md.match(re);
if (!m) { console.error('CHANGELOG.md has no "## ' + version + '" section'); process.exit(1); }
process.stdout.write(m[1].trim() + '\n');
