import type { SkillExtension, SystemPrompt } from '../../../shared/types'
import type { ChatCompletionRequest, ChatMessage } from '../types'

type PromptExtensionOptions = {
  model: string
  prompts: SystemPrompt[]
  skills: SkillExtension[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function modelPatternMatches(pattern: string, model: string): boolean {
  const normalizedPattern = (pattern || '*').trim().toLowerCase()
  const normalizedModel = (model || '').trim().toLowerCase()
  const expression = `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`
  return new RegExp(expression).test(normalizedModel)
}

function isFirstTurn(messages: ChatMessage[]): boolean {
  return !messages.some(message => message.role === 'assistant' || message.role === 'tool')
}

function extensionApplies(
  extension: { enabled?: boolean; modelPattern?: string; mode?: 'first' | 'every' },
  model: string,
  firstTurn: boolean,
): boolean {
  if (extension.enabled !== true) return false
  if (!modelPatternMatches(extension.modelPattern || '*', model)) return false
  return extension.mode === 'every' || firstTurn
}

function buildExtensionMessage(
  prompts: SystemPrompt[],
  skills: SkillExtension[],
  model: string,
  firstTurn: boolean,
): ChatMessage | null {
  const sections: string[] = []

  for (const prompt of prompts) {
    if (!extensionApplies(prompt, model, firstTurn) || !prompt.prompt.trim()) continue
    sections.push(`[System Prompt: ${prompt.name}]\n${prompt.prompt.trim()}`)
  }

  for (const skill of skills) {
    if (!extensionApplies(skill, model, firstTurn) || !skill.content.trim()) continue
    sections.push(`[Skill: ${skill.name}]\n${skill.content.trim()}`)
  }

  if (sections.length === 0) return null
  return { role: 'system', content: sections.join('\n\n') }
}

export function applyPromptExtensions(
  request: ChatCompletionRequest,
  options: PromptExtensionOptions,
): ChatCompletionRequest {
  const messages = Array.isArray(request.messages) ? request.messages : []
  const extensionMessage = buildExtensionMessage(
    options.prompts,
    options.skills,
    options.model,
    isFirstTurn(messages),
  )
  if (!extensionMessage) return request

  return {
    ...request,
    messages: [extensionMessage, ...messages],
  }
}
