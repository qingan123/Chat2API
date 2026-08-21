import { useState } from 'react'
import { CheckCircle2, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { parseCredentialText } from '@shared/credentialImport'

interface CredentialImportPanelProps {
  providerId: string
  onApply: (credentials: Record<string, string>) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function CredentialImportPanel({ providerId, onApply, t }: CredentialImportPanelProps) {
  const [rawText, setRawText] = useState('')
  const [recognizedFields, setRecognizedFields] = useState<string[]>([])
  const [error, setError] = useState('')

  const apply = () => {
    const result = parseCredentialText(providerId, rawText)
    if (result.recognizedFields.length === 0) {
      setRecognizedFields([])
      setError(t('providers.credentialImportNoMatch'))
      return
    }
    onApply(result.credentials)
    setRecognizedFields(result.recognizedFields)
    setError('')
    setRawText('')
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div>
        <Label htmlFor={`credential-import-${providerId}`}>{t('providers.credentialImportTitle')}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{t('providers.credentialImportDesc')}</p>
      </div>
      <Textarea
        id={`credential-import-${providerId}`}
        value={rawText}
        onChange={event => { setRawText(event.target.value); setError(''); setRecognizedFields([]) }}
        placeholder={t('providers.credentialImportPlaceholder')}
        className="min-h-[130px] break-all font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={apply} disabled={!rawText.trim()}>
        <ScanSearch className="mr-2 h-4 w-4" />
        {t('providers.credentialImportApply')}
      </Button>
      {recognizedFields.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-green-50 p-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
          <span>{t('providers.credentialImportSuccess', { fields: recognizedFields.join(', ') })}</span>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
}
