import { storeManager } from '../main/store/store'
import {
  configuredManagementSecretFile,
  persistManagementSecret,
  validateManagementSecret,
} from './managementSecretFile'

export interface ManagementSecretRotationInput {
  newSecret: string
  confirmSecret: string
}

export interface ManagementSecretRotationDependencies {
  currentSecret: () => string
  persist: (secret: string) => void
  updateConfig: (secret: string) => void
}

export function rotateManagementSecret(
  input: ManagementSecretRotationInput,
  dependencies: ManagementSecretRotationDependencies,
): { changed: true } {
  const newSecret = validateManagementSecret(input.newSecret)
  if (input.confirmSecret !== newSecret) {
    throw new Error('Management Secret confirmation does not match.')
  }

  const previousSecret = dependencies.currentSecret()
  if (newSecret === previousSecret) {
    throw new Error('New Management Secret must differ from the current value.')
  }

  dependencies.persist(newSecret)
  try {
    dependencies.updateConfig(newSecret)
  } catch (error) {
    dependencies.persist(previousSecret)
    throw error
  }

  return { changed: true }
}

export function rotateConfiguredManagementSecret(
  input: ManagementSecretRotationInput,
): { changed: true } {
  const currentConfig = storeManager.getConfig()
  const filePath = configuredManagementSecretFile()

  return rotateManagementSecret(input, {
    currentSecret: () => currentConfig.managementApi.managementApiSecret,
    persist: (secret) => {
      if (filePath) persistManagementSecret(filePath, secret)
    },
    updateConfig: (secret) => {
      storeManager.updateConfig({
        managementApi: {
          ...currentConfig.managementApi,
          managementApiSecret: secret,
        },
      })
    },
  })
}
