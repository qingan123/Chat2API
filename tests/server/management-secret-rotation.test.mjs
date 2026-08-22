import assert from 'node:assert/strict'
import test from 'node:test'

async function loadModule() {
  return import('../../out-server/server/managementSecretService.js')
}

test('management secret rotation validates confirmation and rejects unchanged values', async () => {
  const { rotateManagementSecret } = await loadModule()
  const deps = {
    currentSecret: () => 'old-secret',
    persist: () => {},
    updateConfig: () => {},
  }

  assert.throws(() => rotateManagementSecret({ newSecret: 'new-secret', confirmSecret: 'different' }, deps))
  assert.throws(() => rotateManagementSecret({ newSecret: 'old-secret', confirmSecret: 'old-secret' }, deps))
})

test('management secret rotation persists before updating config', async () => {
  const { rotateManagementSecret } = await loadModule()
  const calls = []

  const result = rotateManagementSecret({ newSecret: '584248', confirmSecret: '584248' }, {
    currentSecret: () => 'old-secret',
    persist: value => calls.push(['persist', value]),
    updateConfig: value => calls.push(['update', value]),
  })

  assert.deepEqual(calls, [['persist', '584248'], ['update', '584248']])
  assert.deepEqual(result, { changed: true })
})

test('management secret rotation rolls the file back when config update fails', async () => {
  const { rotateManagementSecret } = await loadModule()
  const calls = []

  assert.throws(() => rotateManagementSecret({ newSecret: '584248', confirmSecret: '584248' }, {
    currentSecret: () => 'old-secret',
    persist: value => calls.push(value),
    updateConfig: () => { throw new Error('store failed') },
  }), /store failed/)

  assert.deepEqual(calls, ['584248', 'old-secret'])
})
