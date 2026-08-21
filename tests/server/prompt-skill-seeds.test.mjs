import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function loadSeeds() {
  return import('../../out-server/main/data/builtin-prompt-extensions.js')
}

const expectedSkillHashes = {
  '01-deepseek-document-based-jailbreak.md': '53d44c5ba71740b6c51e12261438d8e6a356b6913afb1de76794381ce2b56251',
  '02-deepseek-eni-lime-apr.md': '6267e3c9b6c4f71a3da90c403930d8b8ae58e1ee7efc4505b85415d395892de7',
  '03-deepseek-eni-lite-coder.md': 'accc52d4bbbeb06408d0120c61a29c34157d592d1460bf2ebb353dd651777288',
  '04-deepseek-eni-lite-writer.md': 'e6baff6880f81731708f45beddeb15d4483246ee724926cddd2935e5b072fd7c',
  '05-deepseek-eni-flash-thought-jailbreak.md': '19b0372f50619e6ad8049b51793357d012f07b7825f4cf38257ba8725990f82b',
  '06-deepseek-primary-method-jailbreak.md': '824f69fa64ed300f611e9130ad7bfebdd44183ee5890c99a37678cdb2b5fa1e0',
  '07-deepseek-untrammeled-method-jailbreak.md': '318249a6c1c8a89c37de4e93c968eec55b6b28dd011aca79c7e99652711ef978',
}

test('BaiduChat built-in prompt and all seven skills are shipped disabled', async () => {
  const { BUILTIN_SYSTEM_PROMPTS, BUILTIN_SKILLS } = await loadSeeds()
  assert.equal(BUILTIN_SYSTEM_PROMPTS.length, 1)
  assert.equal(BUILTIN_SKILLS.length, 7)
  assert.ok(BUILTIN_SYSTEM_PROMPTS.every(item => item.enabled === false && item.isBuiltin === true))
  assert.ok(BUILTIN_SKILLS.every(item => item.enabled === false && item.isBuiltin === true))
  assert.ok(BUILTIN_SKILLS.every(item => item.modelPattern === 'deepseek-*' && item.mode === 'first'))
})

test('bundled DeepSeek skill bodies preserve the audited BaiduChat hashes', async () => {
  const { BUILTIN_SKILLS } = await loadSeeds()
  for (const [file, expectedHash] of Object.entries(expectedSkillHashes)) {
    const body = await readFile(`src/main/data/skill-seeds/deepseek/${file}`, 'utf8')
    assert.equal(createHash('sha256').update(body).digest('hex'), expectedHash)
    const seeded = BUILTIN_SKILLS.find(item => item.sourceFile === file)
    assert.ok(seeded, `missing seed for ${file}`)
    assert.equal(seeded.content, body)
  }
})

test('built-in sources retain fixed provenance metadata', async () => {
  const { BUILTIN_SKILLS } = await loadSeeds()
  assert.ok(BUILTIN_SKILLS.every(item => item.sourceUrl.includes('Goochbeater/Spiritual-Spell-Red-Teaming')))
  assert.ok(BUILTIN_SKILLS.every(item => item.sourceCommit === '2d25712f5065a07be7dd96b3f12ff9b3a74e78e4'))
})
