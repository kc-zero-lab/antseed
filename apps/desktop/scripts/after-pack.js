// Re-sign the app bundle with ad-hoc signature after electron-builder packs it.
// Without this, macOS rejects the app as "damaged" because Electron's linker
// signature is incomplete (missing sealed resources).

import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`[after-pack] Ad-hoc signing: ${appPath}`);

  execFileSync('codesign', [
    '--deep',
    '--force',
    '--sign',
    '-',
    appPath,
  ], { stdio: 'inherit' });

  console.log('[after-pack] Ad-hoc signing complete');
}
