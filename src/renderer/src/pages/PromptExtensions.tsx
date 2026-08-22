import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Plus, RotateCcw, Save, Trash2, WandSparkles } from 'lucide-react'
import type { SkillExtension, SystemPrompt } from '@/types/electron'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'

type EditorKind = 'prompt' | 'skill'
type EditorState = {
  id?: string
  kind: EditorKind
  name: string
  description: string
  content: string
  enabled: boolean
  modelPattern: string
  mode: 'first' | 'every'
  isBuiltin: boolean
}

const emptyEditor = (kind: EditorKind): EditorState => ({
  kind,
  name: '',
  description: '',
  content: '',
  enabled: false,
  modelPattern: kind === 'skill' ? 'deepseek-*' : '*',
  mode: 'first',
  isBuiltin: false,
})

export function PromptExtensions() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [prompts, setPrompts] = useState<SystemPrompt[]>([])
  const [skills, setSkills] = useState<SkillExtension[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextPrompts, nextSkills] = await Promise.all([
        window.electronAPI.prompts.getAll(),
        window.electronAPI.skills.getAll(),
      ])
      setPrompts(nextPrompts)
      setSkills(nextSkills)
    } catch (error) {
      toast({ title: t('common.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [t, toast])

  useEffect(() => { void load() }, [load])

  const editPrompt = (item: SystemPrompt) => setEditor({
    id: item.id, kind: 'prompt', name: item.name, description: item.description,
    content: item.prompt, enabled: item.enabled === true, modelPattern: item.modelPattern || '*',
    mode: item.mode || 'first', isBuiltin: item.isBuiltin,
  })
  const editSkill = (item: SkillExtension) => setEditor({
    id: item.id, kind: 'skill', name: item.name, description: item.description,
    content: item.content, enabled: item.enabled, modelPattern: item.modelPattern,
    mode: item.mode, isBuiltin: item.isBuiltin,
  })

  const save = async () => {
    if (!editor || !editor.name.trim() || !editor.content.trim() || !editor.modelPattern.trim()) return
    setSaving(true)
    try {
      if (editor.kind === 'prompt') {
        const payload = {
          name: editor.name.trim(), description: editor.description.trim(), prompt: editor.content,
          type: 'general' as const, isBuiltin: editor.isBuiltin, enabled: editor.enabled,
          modelPattern: editor.modelPattern.trim(), mode: editor.mode,
        }
        if (editor.id) await window.electronAPI.prompts.update(editor.id, payload)
        else await window.electronAPI.prompts.add(payload)
      } else {
        const payload = {
          name: editor.name.trim(), description: editor.description.trim(), content: editor.content,
          isBuiltin: editor.isBuiltin, enabled: editor.enabled,
          modelPattern: editor.modelPattern.trim(), mode: editor.mode,
        }
        if (editor.id) await window.electronAPI.skills.update(editor.id, payload)
        else await window.electronAPI.skills.add(payload)
      }
      setEditor(null)
      await load()
      toast({ title: t('common.success'), description: t('promptExtensions.saved') })
    } catch (error) {
      toast({ title: t('common.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const togglePrompt = async (item: SystemPrompt, enabled: boolean) => {
    await window.electronAPI.prompts.update(item.id, { enabled }); await load()
  }
  const toggleSkill = async (item: SkillExtension, enabled: boolean) => {
    await window.electronAPI.skills.update(item.id, { enabled }); await load()
  }
  const remove = async (kind: EditorKind, id: string) => {
    if (!window.confirm(t('promptExtensions.deleteConfirm'))) return
    if (kind === 'prompt') await window.electronAPI.prompts.delete(id)
    else await window.electronAPI.skills.delete(id)
    await load()
  }
  const reset = async (kind: EditorKind, id: string) => {
    if (kind === 'prompt') await window.electronAPI.prompts.resetBuiltin(id)
    else await window.electronAPI.skills.resetBuiltin(id)
    await load()
  }

  const promptCard = (item: SystemPrompt) => (
    <Card key={item.id} className="overflow-hidden">
      <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{item.name}</CardTitle><CardDescription>{item.description}</CardDescription></div><Switch checked={item.enabled === true} onCheckedChange={value => void togglePrompt(item, value)} /></div></CardHeader>
      <CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{item.modelPattern || '*'}</span><span>·</span><span>{item.mode === 'every' ? t('promptExtensions.every') : t('promptExtensions.first')}</span><span>·</span><span>{item.isBuiltin ? t('promptExtensions.builtin') : t('promptExtensions.custom')}</span></div><p className="line-clamp-3 whitespace-pre-wrap text-sm">{item.prompt}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => editPrompt(item)}>{t('common.edit')}</Button>{item.isBuiltin ? <Button variant="ghost" size="sm" onClick={() => void reset('prompt', item.id)}><RotateCcw className="mr-1 h-4 w-4" />{t('promptExtensions.reset')}</Button> : <Button variant="destructive" size="sm" onClick={() => void remove('prompt', item.id)}><Trash2 className="mr-1 h-4 w-4" />{t('common.delete')}</Button>}</div></CardContent>
    </Card>
  )
  const skillCard = (item: SkillExtension) => (
    <Card key={item.id} className="overflow-hidden">
      <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{item.name}</CardTitle><CardDescription>{item.description}</CardDescription></div><Switch checked={item.enabled} onCheckedChange={value => void toggleSkill(item, value)} /></div></CardHeader>
      <CardContent className="space-y-3"><div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{item.modelPattern}</span><span>·</span><span>{item.mode === 'every' ? t('promptExtensions.every') : t('promptExtensions.first')}</span><span>·</span><span>{item.isBuiltin ? t('promptExtensions.builtin') : t('promptExtensions.custom')}</span></div><p className="line-clamp-3 whitespace-pre-wrap text-sm">{item.content}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => editSkill(item)}>{t('common.edit')}</Button>{item.isBuiltin ? <Button variant="ghost" size="sm" onClick={() => void reset('skill', item.id)}><RotateCcw className="mr-1 h-4 w-4" />{t('promptExtensions.reset')}</Button> : <Button variant="destructive" size="sm" onClick={() => void remove('skill', item.id)}><Trash2 className="mr-1 h-4 w-4" />{t('common.delete')}</Button>}</div></CardContent>
    </Card>
  )

  return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold tracking-tight">{t('promptExtensions.title')}</h2><p className="text-muted-foreground">{t('promptExtensions.description')}</p></div>
    <Tabs defaultValue="prompts"><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="prompts"><BookOpen className="mr-2 h-4 w-4" />{t('promptExtensions.prompts')}</TabsTrigger><TabsTrigger value="skills"><WandSparkles className="mr-2 h-4 w-4" />{t('promptExtensions.skills')}</TabsTrigger></TabsList>
      <TabsContent value="prompts" className="space-y-4"><Button onClick={() => setEditor(emptyEditor('prompt'))}><Plus className="mr-2 h-4 w-4" />{t('promptExtensions.addPrompt')}</Button><div className="grid gap-4 lg:grid-cols-2">{loading ? t('common.loading') : prompts.map(promptCard)}</div></TabsContent>
      <TabsContent value="skills" className="space-y-4"><Button onClick={() => setEditor(emptyEditor('skill'))}><Plus className="mr-2 h-4 w-4" />{t('promptExtensions.addSkill')}</Button><div className="grid gap-4 lg:grid-cols-2">{loading ? t('common.loading') : skills.map(skillCard)}</div></TabsContent>
    </Tabs>
    {editor && <Card><CardHeader><CardTitle>{editor.id ? t('common.edit') : t('common.add')}</CardTitle></CardHeader><CardContent className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>{t('promptExtensions.name')}</Label><Input value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></div><div className="space-y-2"><Label>{t('promptExtensions.modelPattern')}</Label><Input value={editor.modelPattern} onChange={e => setEditor({ ...editor, modelPattern: e.target.value })} /></div></div><div className="space-y-2"><Label>{t('promptExtensions.descriptionLabel')}</Label><Input value={editor.description} onChange={e => setEditor({ ...editor, description: e.target.value })} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>{t('promptExtensions.mode')}</Label><select className="h-10 w-full rounded-md border bg-background px-3" value={editor.mode} onChange={e => setEditor({ ...editor, mode: e.target.value as 'first' | 'every' })}><option value="first">{t('promptExtensions.first')}</option><option value="every">{t('promptExtensions.every')}</option></select></div><label className="flex min-h-10 items-center gap-2 pt-6"><Switch checked={editor.enabled} onCheckedChange={enabled => setEditor({ ...editor, enabled })} />{t('common.enabled')}</label></div><div className="space-y-2"><Label>{t('promptExtensions.content')}</Label><Textarea className="min-h-[280px] font-mono text-sm" value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} /></div><div className="flex gap-2"><Button onClick={() => void save()} disabled={saving}><Save className="mr-2 h-4 w-4" />{t('common.save')}</Button><Button variant="outline" onClick={() => setEditor(null)}>{t('common.cancel')}</Button></div></CardContent></Card>}
  </div>
}
