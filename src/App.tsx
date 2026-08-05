import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Login } from './components/Login'
import { TabBar, type Tab } from './components/TabBar'
import { Today } from './pages/Today'
import { Goals } from './pages/Goals'
import { Journal } from './pages/Journal'
import { Settings } from './pages/Settings'

function Shell() {
  const [tab, setTab] = useState<Tab>('today')

  return (
    <div className="flex min-h-full flex-col">
      <div className="safe-top" />
      <div className="flex-1 overflow-y-auto">
        {tab === 'today' && <Today />}
        {tab === 'goals' && <Goals />}
        {tab === 'journal' && <Journal />}
        {tab === 'settings' && <Settings />}
      </div>
      <TabBar active={tab} onChange={setTab} />
    </div>
  )
}

function Root() {
  const { session, loading } = useAuth()

  if (loading) {
    return <div className="flex min-h-full items-center justify-center text-gray-400">Loading…</div>
  }

  return session ? <Shell /> : <Login />
}

function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}

export default App
