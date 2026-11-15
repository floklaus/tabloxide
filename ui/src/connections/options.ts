import type { Engine, Environment, TlsMode } from '../bindings'
import type { SecretKind } from './formModel'

type Option<T extends string> = { value: T; label: string }

export const ENGINE_OPTIONS: Option<Engine>[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'duckdb', label: 'DuckDB' },
]

export const ENVIRONMENT_OPTIONS: Option<Environment>[] = [
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
]

export const TLS_OPTIONS: Option<TlsMode>[] = [
  { value: 'disable', label: 'Disable (no encryption)' },
  {
    value: 'prefer',
    label: 'Prefer (encrypt if possible, do not verify the certificate)',
  },
  {
    value: 'require',
    label: 'Require (encrypt, do not verify the certificate)',
  },
  {
    value: 'verify-full',
    label: 'Verify full (encrypt and verify the certificate)',
  },
]

export const SECRET_OPTIONS: Option<SecretKind>[] = [
  { value: 'keychain', label: 'Credential store of the operating system' },
  { value: 'env-var', label: 'Environment variable' },
  { value: 'none', label: 'No password' },
]

export function environmentLabel(environment: Environment): string {
  return (
    ENVIRONMENT_OPTIONS.find((option) => option.value === environment)?.label ??
    environment
  )
}
