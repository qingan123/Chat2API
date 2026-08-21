import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const MIN_SECRET_LENGTH = 6
const MAX_SECRET_BYTES = 16 * 1024

export interface ResolveManagementSecretOptions {
  filePath?: string
  environmentSecret?: string
}

export function validateManagementSecret(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('Management Secret must be a string.')
  }
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error('Management Secret cannot contain line breaks.')
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`Management Secret must be at least ${MIN_SECRET_LENGTH} characters.`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
    throw new Error('Management Secret is too large.')
  }
  return value
}

function readSecretFile(path: string): string {
  const raw = readFileSync(path)
  if (raw.byteLength > MAX_SECRET_BYTES + 2) {
    throw new Error('Management Secret file is too large.')
  }
  const text = raw.toString('utf8').replace(/\r?\n$/, '')
  return validateManagementSecret(text)
}

export function persistManagementSecret(path: string, value: string): void {
  const secret = validateManagementSecret(value)
  const parent = dirname(path)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(temporaryPath, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(temporaryPath, 0o600)
    renameSync(temporaryPath, path)
    chmodSync(path, 0o600)
  } catch (error) {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    } catch {
      // Preserve the original error.
    }
    throw error
  }
}

export function resolveManagementSecret({
  filePath,
  environmentSecret,
}: ResolveManagementSecretOptions): string | undefined {
  if (!filePath) {
    return environmentSecret ? validateManagementSecret(environmentSecret) : undefined
  }

  if (existsSync(filePath)) {
    return readSecretFile(filePath)
  }

  if (!environmentSecret) {
    return undefined
  }

  const secret = validateManagementSecret(environmentSecret)
  persistManagementSecret(filePath, secret)
  return secret
}

export function configuredManagementSecretFile(): string | undefined {
  const value = process.env.CHAT2API_MANAGEMENT_SECRET_FILE?.trim()
  return value || undefined
}
