import { useEffect } from 'react'
import { CredentialDialog } from './git/CredentialDialog'
import { AppShell } from './shell/AppShell'
import { UpdateNotice } from './updates/UpdateNotice'
import { WelcomeScreen } from './workspace/WelcomeScreen'
import { useWorkspaceStore } from './workspace/workspaceStore'

export default function App() {
  const hasWorkspace = useWorkspaceStore((state) => state.workspace !== null)
  const isLoading = useWorkspaceStore((state) => state.isLoading)
  const init = useWorkspaceStore((state) => state.init)

  useEffect(() => {
    void init()
  }, [init])

  if (isLoading) return null
  return (
    <>
      {hasWorkspace ? <AppShell /> : <WelcomeScreen />}
      <CredentialDialog />
      <UpdateNotice />
    </>
  )
}
