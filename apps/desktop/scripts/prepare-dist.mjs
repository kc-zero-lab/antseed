/**
 * Replace pnpm workspace symlinks in node_modules with real copies
 * so electron-builder can pack them into the asar archive.
 *
 * pnpm links workspace packages as symlinks pointing outside the app
 * directory, which causes electron-builder's asar packer to fail with
 * "must be under <appDir>" errors.
 */

import { readdirSync, lstatSync, readlinkSync, rmSync, cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const nmDir = path.join(appDir, 'node_modules');

function isWorkspaceSymlink(entry) {
  const full = path.join(nmDir, entry);
  try {
    if (!lstatSync(full).isSymbolicLink()) return false;
    const target = readlinkSync(full);
    // Workspace symlinks are relative and point outside node_modules
    return !target.includes('node_modules');
  } catch {
    return false;
  }
}

const entries = readdirSync(nmDir);
for (const entry of entries) {
  if (!isWorkspaceSymlink(entry)) continue;

  const linkPath = path.join(nmDir, entry);
  const realPath = path.resolve(nmDir, readlinkSync(linkPath));

  console.log(`[prepare-dist] Replacing symlink: ${entry} -> ${realPath}`);
  rmSync(linkPath, { recursive: true });
  cpSync(realPath, linkPath, { recursive: true });

  // The copied package may itself have a node_modules with workspace symlinks
  // to the pnpm store — remove those since electron-builder will resolve
  // production deps from the app's own node_modules.
  const innerNm = path.join(linkPath, 'node_modules');
  if (existsSync(innerNm)) {
    rmSync(innerNm, { recursive: true });
  }
}

console.log('[prepare-dist] Done.');
