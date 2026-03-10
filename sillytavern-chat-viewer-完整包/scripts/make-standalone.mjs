import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const targetDir = 'E:\\酒馆查看';

const distIndexPath = path.join(distDir, 'index.html');
const assetsDir = path.join(distDir, 'assets');

if (!fs.existsSync(distIndexPath)) {
  throw new Error(`Missing dist/index.html at ${distIndexPath}`);
}

const assetFiles = fs
  .readdirSync(assetsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name);

if (assetFiles.length === 0) {
  throw new Error(`No JS bundle found in ${assetsDir}`);
}

const bundleName = assetFiles[0];
const bundlePath = path.join(assetsDir, bundleName);
const bundleCode = fs.readFileSync(bundlePath, 'utf8');
const distHtml = fs.readFileSync(distIndexPath, 'utf8');

const standaloneHtml = distHtml.replace(
  /<script type="module" crossorigin src="\.\/assets\/[^"]+"><\/script>/,
  `<script>\n${bundleCode}\n</script>`,
);

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(path.join(targetDir, 'index.html'), standaloneHtml, 'utf8');
