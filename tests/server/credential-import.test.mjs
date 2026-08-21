import assert from 'node:assert/strict'
import test from 'node:test'

async function parser() {
  return import('../../out-server/shared/credentialImport.js')
}

test('credential parser extracts Kimi fields from a complete Cookie header', async () => {
  const { parseCredentialText } = await parser()
  const result = parseCredentialText('kimi', 'Cookie: unrelated=x; kimi-auth=jwt-value; device_id=device-1; session_id=session-1; traffic_id=traffic-1')
  assert.deepEqual(result.credentials, { token: 'jwt-value', deviceId: 'device-1', sessionId: 'session-1', trafficId: 'traffic-1' })
})

test('credential parser extracts GLM refresh token from Local Storage JSON', async () => {
  const { parseCredentialText } = await parser()
  const result = parseCredentialText('glm', JSON.stringify({ chatglm_refresh_token: 'refresh-value', other: 'ignored' }))
  assert.deepEqual(result.credentials, { refresh_token: 'refresh-value' })
})

test('credential parser understands exported browser cookie JSON', async () => {
  const { parseCredentialText } = await parser()
  const result = parseCredentialText('perplexity', JSON.stringify([{ name: '__Secure-next-auth.session-token', value: 'session-value' }, { name: 'other', value: 'x' }]))
  assert.deepEqual(result.credentials, { sessionToken: 'session-value' })
})

test('credential parser extracts Mimo required fields and does not return unrelated secrets', async () => {
  const { parseCredentialText } = await parser()
  const result = parseCredentialText('mimo', 'serviceToken=service; userId=user; xiaomichatbot_ph=ph; password=must-not-return')
  assert.deepEqual(result.credentials, { service_token: 'service', user_id: 'user', ph_token: 'ph' })
})

test('credential parser returns no fields for unrelated text', async () => {
  const { parseCredentialText } = await parser()
  assert.deepEqual(parseCredentialText('glm', 'Cookie: unrelated=value').credentials, {})
})
