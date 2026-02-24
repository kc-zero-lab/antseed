import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const execFileAsync = promisify(execFile)

export const PLUGINS_DIR = join(homedir(), '.antseed', 'plugins')

function resolvePluginsDir(): string {
  if (existsSync(PLUGINS_DIR)) return PLUGINS_DIR
  return PLUGINS_DIR
}

export function getPluginsDir(): string {
  return resolvePluginsDir()
}

export interface InstalledPlugin {
  name: string
  package: string
  version: string
}

async function ensurePluginsDir(): Promise<void> {
  const pluginsDir = resolvePluginsDir()
  const pluginsPackageJson = join(pluginsDir, 'package.json')
  await mkdir(pluginsDir, { recursive: true })
  try {
    await access(pluginsPackageJson, constants.R_OK)
  } catch {
    await writeFile(
      pluginsPackageJson,
      JSON.stringify({ name: 'antseed-plugins', version: '1.0.0', private: true, dependencies: {} }, null, 2),
      'utf-8'
    )
  }
}

export async function installPlugin(packageName: string): Promise<void> {
  await ensurePluginsDir()
  await execFileAsync('npm', ['install', '--ignore-scripts', packageName], { cwd: getPluginsDir() })
}

export async function removePlugin(packageName: string): Promise<void> {
  await ensurePluginsDir()
  await execFileAsync('npm', ['uninstall', packageName], { cwd: getPluginsDir() })
}

export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  await ensurePluginsDir()
  try {
    const raw = await readFile(join(getPluginsDir(), 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> }
    const deps = pkg.dependencies ?? {}
    return Object.entries(deps).map(([pkgName, version]) => ({
      name: pkgName,
      package: pkgName,
      version: version,
    }))
  } catch {
    return []
  }
}
