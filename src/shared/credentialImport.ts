export type CredentialImportResult = {
  credentials: Record<string, string>
  recognizedFields: string[]
}

export const CREDENTIAL_IMPORT_PROVIDER_IDS = [
  'deepseek',
  'glm',
  'kimi',
  'mimo',
  'minimax',
  'perplexity',
  'qwen',
  'qwen-ai',
  'zai',
] as const

export function supportsCredentialImport(providerId: string | undefined): boolean {
  return Boolean(providerId && CREDENTIAL_IMPORT_PROVIDER_IDS.includes(providerId as typeof CREDENTIAL_IMPORT_PROVIDER_IDS[number]))
}

export function normalizeProviderCredentials(
  providerId: string | undefined,
  credentials: Record<string, string>,
): Record<string, string> {
  if (!providerId) return credentials

  if (providerId === 'qwen-ai') {
    return {
      token: credentials.token || credentials.access_token || credentials.accessToken || '',
      ...(credentials.cookies ? { cookies: credentials.cookies } : {}),
      ...(credentials.email ? { email: credentials.email } : {}),
      ...(credentials.password ? { password: credentials.password } : {}),
      ...(credentials.baxiaUidToken ? { baxiaUidToken: credentials.baxiaUidToken } : {}),
      ...(credentials.baxiaUa ? { baxiaUa: credentials.baxiaUa } : {}),
      ...(credentials.baxiaVersion ? { baxiaVersion: credentials.baxiaVersion } : {}),
      ...(credentials.x5secdata ? { x5secdata: credentials.x5secdata } : {}),
      ...(credentials.x5sectag ? { x5sectag: credentials.x5sectag } : {}),
    }
  }

  if (providerId === 'kimi') {
    const refreshToken = credentials.refreshToken || credentials.refresh_token || ''
    const token = credentials.accessToken
      || credentials.access_token
      || credentials.token
      || credentials.kimiAuth
      || credentials['kimi-auth']
      || refreshToken
      || ''
    const deviceId = credentials.deviceId || credentials.device_id || credentials.webId || credentials.web_id || ''
    const sessionId = credentials.sessionId || credentials.session_id || credentials.ssid || ''
    const trafficId = credentials.trafficId
      || credentials.traffic_id
      || credentials.mshUserId
      || credentials.msh_user_id
      || credentials.userId
      || credentials.user_id
      || ''
    return {
      token,
      ...(refreshToken ? { refreshToken } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(trafficId ? { trafficId } : {}),
    }
  }

  const aliases: Record<string, [string, string[]][]> = {
    glm: [['refresh_token', ['refresh_token', 'refreshToken', 'chatglm_refresh_token']]],
    deepseek: [['token', ['token', 'userToken', 'authorization']]],
    qwen: [['ticket', ['ticket', 'tongyi_sso_ticket']]],
    zai: [['ticket', ['ticket', 'tongyi_sso_ticket', 'token', 'authorization']]],
    perplexity: [['sessionToken', ['sessionToken', '__Secure-next-auth.session-token', 'next-auth.session-token']]],
    mimo: [
      ['service_token', ['service_token', 'serviceToken']],
      ['user_id', ['user_id', 'userId']],
      ['ph_token', ['ph_token', 'xiaomichatbot_ph']],
    ],
    minimax: [
      ['token', ['token', 'access_token', 'authorization']],
      ['realUserID', ['realUserID', 'real_user_id', 'user_id']],
    ],
  }

  const result: Record<string, string> = {}
  for (const [target, sources] of aliases[providerId] || []) {
    const value = sources.map(source => credentials[source]).find(Boolean)
    if (!value) continue
    let normalized = value.replace(/^Bearer\s+/i, '')
    if (providerId === 'deepseek' && normalized.startsWith('{') && normalized.endsWith('}')) {
      try {
        const parsed = JSON.parse(normalized)
        if (typeof parsed.value === 'string') normalized = parsed.value
      } catch { /* keep the copied token */ }
    }
    result[target] = normalized
  }
  return Object.keys(result).length > 0 ? result : credentials
}

function flatten(value: unknown, output: Record<string, string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && 'name' in item && 'value' in item) {
        const entry = item as { name?: unknown; value?: unknown }
        if (typeof entry.name === 'string' && entry.value != null) output[entry.name] = String(entry.value)
      } else flatten(item, output)
    }
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item == null) continue
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') output[key] = String(item)
    else flatten(item, output)
  }
}

function parseLoosePairs(input: string, output: Record<string, string>): void {
  const normalized = input.replace(/^cookie\s*:/gim, '').replace(/^authorization\s*:\s*bearer\s+/gim, 'authorization=')
  for (const part of normalized.split(/[;\n\r]+/)) {
    const match = part.trim().match(/^([^:=\t]+)\s*[:=\t]\s*(.+)$/)
    if (!match) continue
    const key = match[1].trim().replace(/^['"]|['"]$/g, '')
    const value = match[2].trim().replace(/^['"]|['"]$/g, '')
    if (key && value) output[key] = value
  }
}

function first(values: Record<string, string>, ...keys: string[]): string {
  const lower = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = values[key] || lower.get(key.toLowerCase())
    if (value) return value
  }
  return ''
}

export function parseCredentialText(providerId: string, input: string): CredentialImportResult {
  const values: Record<string, string> = {}
  const trimmed = input.trim()
  if (!trimmed) return { credentials: {}, recognizedFields: [] }

  try { flatten(JSON.parse(trimmed), values) } catch { /* accept copied headers/cookies */ }
  parseLoosePairs(trimmed, values)

  const credentials: Record<string, string> = {}
  if (providerId === 'glm') {
    const token = first(values, 'chatglm_refresh_token', 'refresh_token', 'refreshToken')
    if (token) credentials.refresh_token = token
  } else if (providerId === 'kimi') {
    const refreshToken = first(values, 'refresh_token', 'refreshToken')
    const token = first(values, 'kimi-auth', 'kimiAuth', 'access_token', 'accessToken', 'token', 'authorization') || refreshToken
    if (token) credentials.token = token.replace(/^Bearer\s+/i, '')
    if (refreshToken) credentials.refreshToken = refreshToken
    const deviceId = first(values, 'device_id', 'deviceId', 'web_id', 'webId')
    const sessionId = first(values, 'session_id', 'sessionId', 'ssid')
    const trafficId = first(values, 'traffic_id', 'trafficId', 'msh_user_id', 'mshUserId', 'user_id', 'userId')
    if (deviceId) credentials.deviceId = deviceId
    if (sessionId) credentials.sessionId = sessionId
    if (trafficId) credentials.trafficId = trafficId
  } else if (providerId === 'perplexity') {
    const token = first(values, '__Secure-next-auth.session-token', 'next-auth.session-token', 'sessionToken')
    if (token) credentials.sessionToken = token
  } else if (providerId === 'qwen') {
    const ticket = first(values, 'tongyi_sso_ticket', 'ticket')
    if (ticket) credentials.ticket = ticket
  } else if (providerId === 'qwen-ai') {
    const token = first(values, 'token', 'access_token', 'accessToken', 'authorization')
    if (token) credentials.token = token.replace(/^Bearer\s+/i, '')
    const cookies = first(values, 'cookies', 'cookie')
    if (cookies) credentials.cookies = cookies
    else if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && /=/.test(trimmed)) {
      credentials.cookies = trimmed.replace(/^cookie\s*:/i, '').trim()
    }
  } else if (providerId === 'mimo') {
    const serviceToken = first(values, 'service_token', 'serviceToken')
    const userId = first(values, 'user_id', 'userId')
    const phToken = first(values, 'ph_token', 'xiaomichatbot_ph')
    if (serviceToken) credentials.service_token = serviceToken
    if (userId) credentials.user_id = userId
    if (phToken) credentials.ph_token = phToken
  } else if (providerId === 'deepseek') {
    const token = first(values, 'userToken', 'token', 'authorization')
    if (token) credentials.token = token.replace(/^Bearer\s+/i, '')
  } else if (providerId === 'minimax') {
    const token = first(values, 'token', 'access_token', 'authorization')
    const userId = first(values, 'realUserID', 'real_user_id', 'user_id')
    if (token) credentials.token = token.replace(/^Bearer\s+/i, '')
    if (userId) credentials.realUserID = userId
  } else if (providerId === 'zai') {
    const ticket = first(values, 'tongyi_sso_ticket', 'ticket', 'token', 'authorization')
    if (ticket) credentials.ticket = ticket.replace(/^Bearer\s+/i, '')
  }

  return { credentials, recognizedFields: Object.keys(credentials) }
}
