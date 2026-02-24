import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { scaffoldPlugin } from './plugin-create.js'

test('scaffoldPlugin creates provider project structure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'antseed-test-'))
  try {
    await scaffoldPlugin(dir, {
      name: 'test-provider',
      type: 'provider',
      displayName: 'Test Provider',
      description: 'A test provider plugin',
    })

    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8')) as { name: string }
    assert.equal(pkg.name, '@antseed/provider-test-provider')

    const tsconfig = await readFile(join(dir, 'tsconfig.json'), 'utf-8')
    assert.ok(tsconfig.includes('NodeNext'))

    const index = await readFile(join(dir, 'src', 'index.ts'), 'utf-8')
    assert.ok(index.includes("type: 'provider'"))
    assert.ok(index.includes('AntseedProviderPlugin'))

    const provider = await readFile(join(dir, 'src', 'provider.ts'), 'utf-8')
    assert.ok(provider.includes('createProvider'))

    const testFile = await readFile(join(dir, 'src', 'index.test.ts'), 'utf-8')
    assert.ok(testFile.includes("'provider'"))

    const readme = await readFile(join(dir, 'README.md'), 'utf-8')
    assert.ok(readme.includes('test-provider'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('scaffoldPlugin creates router project structure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'antseed-test-'))
  try {
    await scaffoldPlugin(dir, {
      name: 'test-router',
      type: 'router',
      displayName: 'Test Router',
      description: 'A test router plugin',
    })

    const index = await readFile(join(dir, 'src', 'index.ts'), 'utf-8')
    assert.ok(index.includes("type: 'router'"))
    assert.ok(index.includes('AntseedRouterPlugin'))

    const router = await readFile(join(dir, 'src', 'router.ts'), 'utf-8')
    assert.ok(router.includes('createRouter'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
