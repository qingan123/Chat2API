import assert from 'node:assert/strict'
import test from 'node:test'

async function loadModule() {
  return import('../../out-server/main/proxy/services/promptExtensionService.js')
}

const baseRequest = () => ({
  model: 'deepseek-v4-pro',
  messages: [{ role: 'user', content: 'hello' }],
})

const prompt = (overrides = {}) => ({
  id: 'prompt-1', name: 'Prompt', description: '', prompt: 'PROMPT CONTENT', type: 'general',
  isBuiltin: true, enabled: false, modelPattern: '*', mode: 'first', createdAt: 1, updatedAt: 1,
  ...overrides,
})

const skill = (overrides = {}) => ({
  id: 'skill-1', name: 'Skill', description: '', content: 'SKILL CONTENT', isBuiltin: true,
  enabled: false, modelPattern: 'deepseek-*', mode: 'first', createdAt: 1, updatedAt: 1,
  ...overrides,
})

test('disabled prompts and skills do not alter requests', async () => {
  const { applyPromptExtensions } = await loadModule()
  const request = baseRequest()
  const result = applyPromptExtensions(request, { model: request.model, prompts: [prompt()], skills: [skill()] })
  assert.deepEqual(result, request)
})

test('model patterns support wildcards and reject non-matches', async () => {
  const { modelPatternMatches } = await loadModule()
  assert.equal(modelPatternMatches('deepseek-*', 'deepseek-v4-pro'), true)
  assert.equal(modelPatternMatches('qwen-*', 'deepseek-v4-pro'), false)
  assert.equal(modelPatternMatches('*', 'anything'), true)
})

test('first mode injects only before an assistant turn exists', async () => {
  const { applyPromptExtensions } = await loadModule()
  const enabled = prompt({ enabled: true })
  const first = applyPromptExtensions(baseRequest(), { model: 'deepseek-v4-pro', prompts: [enabled], skills: [] })
  assert.equal(first.messages[0].role, 'system')
  assert.match(first.messages[0].content, /PROMPT CONTENT/)

  const continued = baseRequest()
  continued.messages.push({ role: 'assistant', content: 'prior answer' }, { role: 'user', content: 'again' })
  assert.deepEqual(applyPromptExtensions(continued, { model: continued.model, prompts: [enabled], skills: [] }), continued)
})

test('every mode injects on continued conversations and preserves client system messages', async () => {
  const { applyPromptExtensions } = await loadModule()
  const request = baseRequest()
  request.messages.unshift({ role: 'system', content: 'CLIENT SYSTEM' })
  request.messages.push({ role: 'assistant', content: 'prior answer' }, { role: 'user', content: 'again' })
  const result = applyPromptExtensions(request, {
    model: request.model,
    prompts: [prompt({ enabled: true, mode: 'every' })],
    skills: [skill({ enabled: true, mode: 'every' })],
  })
  assert.equal(result.messages[0].role, 'system')
  assert.match(result.messages[0].content, /PROMPT CONTENT/)
  assert.match(result.messages[0].content, /SKILL CONTENT/)
  assert.equal(result.messages[1].content, 'CLIENT SYSTEM')
})

test('skills are ordered after prompts inside the extension system message', async () => {
  const { applyPromptExtensions } = await loadModule()
  const result = applyPromptExtensions(baseRequest(), {
    model: 'deepseek-v4-pro',
    prompts: [prompt({ enabled: true })],
    skills: [skill({ enabled: true })],
  })
  const content = result.messages[0].content
  assert.ok(content.indexOf('PROMPT CONTENT') < content.indexOf('SKILL CONTENT'))
})
