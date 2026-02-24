import type { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { createInterface } from 'node:readline/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { installPlugin, removePlugin, listInstalledPlugins, getPluginsDir } from '../../plugins/manager.js'
import { TRUSTED_PLUGINS } from '../../plugins/registry.js'
import {
  addInstance,
  removeInstance,
  getInstance,
  getInstances,
  updateInstanceConfig,
  loadPluginModule,
} from '@antseed/node'
import type { ConfigField, AntseedPlugin } from '@antseed/node'
import { registerPluginCreateCommand } from './plugin-create.js'

const CONFIG_PATH = join(homedir(), '.antseed', 'config.json')

function generateInstanceId(pluginName: string): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${pluginName}-${suffix}`
}

function getConfigSchema(plugin: AntseedPlugin): ConfigField[] {
  return plugin.configSchema ?? plugin.configKeys ?? []
}

function maskSecret(value: string): string {
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

async function promptForFields(
  rl: ReturnType<typeof createInterface>,
  schema: ConfigField[],
  existingConfig?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config: Record<string, unknown> = {}
  for (const field of schema) {
    const defaultVal = existingConfig?.[field.key] ?? field.default
    const defaultHint = field.type === 'secret' && typeof defaultVal === 'string' && defaultVal
      ? ` [${maskSecret(defaultVal)}]`
      : defaultVal !== undefined
        ? ` [${String(defaultVal)}]`
        : ''
    const requiredHint = field.required ? ' (required)' : ''
    const desc = field.description ? ` — ${field.description}` : ''
    const prompt = `  ${field.label}${requiredHint}${desc}${defaultHint}: `

    let answer: string
    if (field.type === 'secret') {
      process.stdout.write(prompt)
      const stdin = process.stdin
      const wasRaw = stdin.isRaw
      if (stdin.isTTY) stdin.setRawMode(true)
      let secret = ''
      answer = await new Promise<string>((resolve) => {
        const onData = (chunk: Buffer) => {
          const ch = chunk.toString()
          if (ch === '\n' || ch === '\r') {
            stdin.removeListener('data', onData)
            if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw)
            process.stdout.write('\n')
            resolve(secret)
          } else if (ch === '\u007f' || ch === '\b') {
            secret = secret.slice(0, -1)
          } else if (ch === '\u0003') {
            stdin.removeListener('data', onData)
            if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw)
            process.exit(0)
          } else {
            secret += ch
          }
        }
        stdin.on('data', onData)
      })
    } else {
      answer = await rl.question(prompt)
    }

    const trimmed = answer.trim()
    if (trimmed) {
      if (field.type === 'number') {
        config[field.key] = Number(trimmed)
      } else if (field.type === 'boolean') {
        config[field.key] = trimmed === 'true' || trimmed === 'yes' || trimmed === '1'
      } else {
        config[field.key] = trimmed
      }
    } else if (defaultVal !== undefined) {
      config[field.key] = defaultVal
    } else if (field.required) {
      console.log(chalk.red(`    ${field.label} is required.`))
      // Re-prompt by recursing on just this field
      const retry = await promptForFields(rl, [field], existingConfig)
      config[field.key] = retry[field.key]!
    }
  }
  return config
}

export function registerPluginCommand(program: Command): void {
  const pluginCmd = program
    .command('plugin')
    .description('Manage antseed plugins')

  // Task 1: plugin add with interactive config
  pluginCmd
    .command('add <package>')
    .description('Install a plugin from npm and configure an instance')
    .action(async (packageName: string) => {
      const spinner = ora(`Installing ${packageName}...`).start()
      try {
        await installPlugin(packageName)
        spinner.succeed(chalk.green(`Installed ${packageName}`))
      } catch (err) {
        spinner.fail(chalk.red(`Failed to install ${packageName}: ${(err as Error).message}`))
        process.exit(1)
      }

      // Load plugin module to read configSchema
      let plugin: AntseedPlugin
      try {
        plugin = await loadPluginModule(packageName, getPluginsDir())
      } catch (err) {
        console.log(chalk.yellow(`\nInstalled but could not load plugin module: ${(err as Error).message}`))
        return
      }

      const schema = getConfigSchema(plugin)
      if (schema.length === 0) {
        console.log(chalk.dim('\nPlugin has no configuration fields.'))
        const instanceId = generateInstanceId(plugin.name)
        await addInstance(CONFIG_PATH, {
          id: instanceId,
          package: packageName,
          type: plugin.type,
          config: {},
          enabled: true,
          createdAt: new Date().toISOString(),
        }, schema)
        console.log(chalk.green(`\nCreated instance: ${instanceId}`))
        return
      }

      console.log(chalk.bold(`\nConfigure ${plugin.displayName}:\n`))
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        const config = await promptForFields(rl, schema)
        const instanceId = generateInstanceId(plugin.name)
        await addInstance(CONFIG_PATH, {
          id: instanceId,
          package: packageName,
          type: plugin.type,
          config,
          enabled: true,
          createdAt: new Date().toISOString(),
        }, schema)
        console.log(chalk.green(`\nCreated instance: ${instanceId}`))
      } finally {
        rl.close()
      }
    })

  // Task 2: plugin config command
  pluginCmd
    .command('config <id>')
    .description('Update configuration for a plugin instance')
    .action(async (instanceId: string) => {
      const instance = await getInstance(CONFIG_PATH, instanceId)
      if (!instance) {
        console.log(chalk.red(`Instance "${instanceId}" not found.`))
        process.exit(1)
      }

      let plugin: AntseedPlugin
      try {
        plugin = await loadPluginModule(instance.package, getPluginsDir())
      } catch (err) {
        console.log(chalk.red(`Could not load plugin: ${(err as Error).message}`))
        process.exit(1)
        return // unreachable but satisfies TS
      }

      const schema = getConfigSchema(plugin)
      if (schema.length === 0) {
        console.log(chalk.dim('Plugin has no configuration fields.'))
        return
      }

      console.log(chalk.bold(`\nConfigure ${plugin.displayName} (${instanceId}):\n`))

      // Show current values
      for (const field of schema) {
        const current = instance.config[field.key]
        if (current !== undefined) {
          const display = field.type === 'secret' ? maskSecret(String(current)) : String(current)
          console.log(chalk.dim(`  Current ${field.label}: ${display}`))
        }
      }
      console.log('')

      const rl = createInterface({ input: process.stdin, output: process.stdout })
      try {
        const newConfig = await promptForFields(rl, schema, instance.config)
        await updateInstanceConfig(CONFIG_PATH, instanceId, newConfig, schema)
        console.log(chalk.green(`\nUpdated instance: ${instanceId}`))
      } finally {
        rl.close()
      }
    })

  // Task 5: plugin remove with instance handling
  pluginCmd
    .command('remove <name>')
    .description('Remove a plugin instance or uninstall a package')
    .action(async (name: string) => {
      // Check if name matches an instance ID
      const instance = await getInstance(CONFIG_PATH, name)
      if (instance) {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        try {
          const confirm = await rl.question(`Remove instance "${name}"? (y/N): `)
          if (confirm.trim().toLowerCase() !== 'y') {
            console.log(chalk.dim('Cancelled.'))
            return
          }
          await removeInstance(CONFIG_PATH, name)
          console.log(chalk.green(`Removed instance: ${name}`))

          const uninstall = await rl.question(`Also uninstall npm package "${instance.package}"? (y/N): `)
          if (uninstall.trim().toLowerCase() === 'y') {
            const spinner = ora(`Removing ${instance.package}...`).start()
            try {
              await removePlugin(instance.package)
              spinner.succeed(chalk.green(`Uninstalled ${instance.package}`))
            } catch (err) {
              spinner.fail(chalk.red(`Failed to uninstall: ${(err as Error).message}`))
            }
          }
        } finally {
          rl.close()
        }
        return
      }

      // Fall through: treat as npm package name
      const spinner = ora(`Removing ${name}...`).start()
      try {
        await removePlugin(name)
        spinner.succeed(chalk.green(`Removed ${name}`))
      } catch (err) {
        spinner.fail(chalk.red(`Failed to remove ${name}: ${(err as Error).message}`))
        process.exit(1)
      }
    })

  // Task 4: plugin list with instances
  pluginCmd
    .command('list')
    .description('List installed plugins and configured instances')
    .action(async () => {
      const installed = await listInstalledPlugins()
      const trusted = new Set(TRUSTED_PLUGINS.map((p) => p.package))

      if (installed.length === 0) {
        console.log(chalk.dim('No plugins installed. Run: antseed init'))
      } else {
        console.log(chalk.bold('\nInstalled plugins:\n'))
        for (const plugin of installed) {
          const isTrusted = trusted.has(plugin.package)
          const badge = isTrusted ? chalk.green(' [trusted]') : ''
          console.log(`  ${chalk.cyan(plugin.package)} ${chalk.dim(plugin.version)}${badge}`)
        }
        console.log('')
      }

      // Show configured instances
      const instances = await getInstances(CONFIG_PATH)
      if (instances.length > 0) {
        console.log(chalk.bold('Configured instances:\n'))
        for (const inst of instances) {
          const status = inst.enabled === false ? chalk.red(' [disabled]') : chalk.green(' [enabled]')
          console.log(`  ${chalk.cyan(inst.id)} ${chalk.dim(inst.package)}${status}`)
        }
        console.log('')
      }
    })

  // Register plugin create subcommand (Task 3)
  registerPluginCreateCommand(pluginCmd)
}
