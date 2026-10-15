#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile, rm, lstat, rmdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function assetFiles(directory, prefix = 'assets') {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) throw new Error(`Unsafe asset entry: ${prefix}/${entry.name}`);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await assetFiles(resolve(directory, entry.name), name));
    else if (entry.isFile() && /\.(?:webp|png|jpe?g|gif|svg|avif|json|bin|glb|gltf|css|js|mjs|woff2?)$/i.test(entry.name)) result.push(name);
    else throw new Error(`Unreviewed asset type: ${name}`);
  }
  return result;
}
export async function sourceFiles(source) {
  if (!(await lstat(source)).isDirectory()) throw new Error('site must be a regular directory');
  if (!(await lstat(resolve(source, 'index.html'))).isFile()) throw new Error('site/index.html must be a regular file');
  if (!(await lstat(resolve(source, 'assets'))).isDirectory()) throw new Error('site/assets must be a regular directory');
  return ['index.html', ...await assetFiles(resolve(source, 'assets'))].sort();
}
// Cooperative exclusion only: repository ancestry and source/output paths must
// remain under trusted exclusive control. This is not a sandbox against writers
// that bypass/remove the lock or rename ancestors while an operation is running.
export async function withBuildLock(repository, action) {
  const checkout = await realpath(repository);
  const lock = resolve(checkout, '.landing-build.lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Landing build writer busy: .landing-build.lock exists; serialize builds and tree mutations. Never remove an active lock.');
    throw error;
  }
  try { return await action(); }
  finally { await rmdir(lock); }
}

export async function buildSite(options = {}) {
  const repository = options.repository ?? root;
  return withBuildLock(repository, () => buildExclusive({ ...options, repository }));
}

async function buildExclusive({ repository, output = resolve(repository, 'dist/site') }) {
  output = resolve(output);
  const source = resolve(repository, 'site');
  // Under the cooperative writer contract, only an artifact below dist is eligible for cleanup.
  const dist = resolve(repository, 'dist');
  const allowed = relative(dist, output);
  if (!allowed || allowed === '..' || allowed.startsWith(`..${sep}`) || isAbsolute(allowed)) throw new Error('Build output must be a directory below repository/dist');
  // Lexical containment alone does not prevent dist/nested from redirecting
  // recursive cleanup through a symlink. Check every component before mutation,
  // including the output itself, and preserve files rather than replacing them.
  // These path checks are not atomic with cleanup/writes; exclusion is required.
  let directory = dist;
  for (const component of ['', ...allowed.split(sep)]) {
    if (component) directory = resolve(directory, component);
    try {
      if (!(await lstat(directory)).isDirectory()) throw new Error('Each build output path component must be a regular directory, not a file or symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      break; // All descendants of a missing directory are also absent.
    }
  }
  const files = await sourceFiles(source);
  const entries = {};
  await rm(output, { recursive: true, force: true });
  for (const name of files) {
    const bytes = await readFile(resolve(source, name));
    await mkdir(dirname(resolve(output, name)), { recursive: true });
    await writeFile(resolve(output, name), bytes);
    entries[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  // No timestamp or checkout-specific path: identical source yields identical bytes.
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ schema: 'ticketstub.landing-artifact/1', files: entries }, null, 2) + '\n');
  return { output, files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) { console.error('Usage: node scripts/build.mjs'); process.exitCode = 2; }
  else buildSite().then(({output,files}) => console.log(`Built ${files.length} source files in ${relative(root,output)}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
