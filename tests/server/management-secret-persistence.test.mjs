import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

async function loadModule() {
  return import('../../out-server/server/managementSecretFile.js')
}

test('management secret file overrides a stale environment value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat2api-secret-'))
  const path = join(dir, 'management-secret.txt')
  await writeFile(path, 'file-secret\n', { mode: 0o600 })
  const { resolveManagementSecret } = await loadModule()

  const secret = await resolveManagementSecret({
    filePath: path,
    environmentSecret: 'stale-environment-secret',
  })

  assert.equal(secret, 'file-secret')
})

test('management secret file is initialized atomically from the environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat2api-secret-'))
  const path = join(dir, 'management-secret.txt')
  const { resolveManagementSecret } = await loadModule()

  const secret = await resolveManagementSecret({
    filePath: path,
    environmentSecret: 'initial-secret',
  })

  assert.equal(secret, 'initial-secret')
  assert.equal(await readFile(path, 'utf8'), 'initial-secret\n')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

test('updating a management secret persists the exact value with mode 600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chat2api-secret-'))
  const path = join(dir, 'management-secret.txt')
  await writeFile(path, 'old-secret\n', { mode: 0o600 })
  const { persistManagementSecret } = await loadModule()

  await persistManagementSecret(path, '584248')

  assert.equal(await readFile(path, 'utf8'), '584248\n')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

test('management secret validation rejects short, empty, or multiline values', async () => {
  const { validateManagementSecret } = await loadModule()

  for (const value of ['', '12345', 'line-one\nline-two', 'line-one\rline-two']) {
    assert.throws(() => validateManagementSecret(value))
  }
  assert.equal(validateManagementSecret('584248'), '584248')
})

test('without a file path the server preserves the native environment-only behavior', async () => {
  const { resolveManagementSecret } = await loadModule()

  assert.equal(await resolveManagementSecret({ environmentSecret: 'native-secret' }), 'native-secret')
  assert.equal(await resolveManagementSecret({ environmentSecret: undefined }), undefined)
})
