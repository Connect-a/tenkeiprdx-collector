export const PLATFORM_DIR = { web: 'Assets/WebGL', player: 'Assets/StandaloneWindows64' };

export const toRel = (sub) => String(sub).replace(/^Assets\/(WebGL|StandaloneWindows64)\//, '');
export const toPath = (dir, sub) => (sub ? dir + '/' + sub : null);
export const inDir = (path, dir) => !!path && String(path).indexOf(dir + '/') === 0;
export const stripDir = (path, dir) => (inDir(path, dir) ? String(path).slice(dir.length + 1) : path);
export const fileNameOf = (p) => String(p).split('/').pop();
export const bundleName = (p) =>
  fileNameOf(p)
    .replace(/\.(web|player)\.bundle$/i, '')
    .replace(/_[0-9a-f]{16,}\.bundle$/i, '')
    .replace(/\.bundle$/i, '');
export const relKey = (rel) => String(rel).replace(/_[0-9a-f]{16,}\.bundle$/i, '');
export const APP_DIR = 'WebGL/StreamingAssets/aa/WebGL/';
export const APP_REL = /^WebGL\/StreamingAssets\/aa\//;
export const APP_PREFIX = /^WebGL\/StreamingAssets\/aa\/WebGL\//;
export const assetUrlOn = (base, platform, rel) => (APP_REL.test(rel) ? `${base}/${rel}` : `${base}/${PLATFORM_DIR[platform]}/${rel}`);
