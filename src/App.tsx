import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { Login } from './components/Login'
import { TabBar, type Tab } from './components/TabBar'
import { Today } from './pages/Today'
import { Calendar } from './pages/Calendar'
import { Goals } from './pages/Goals'
import { Journal } from './pages/Journal'
import { Food } from './pages/Food'
import { Finance } from './pages/Finance'
import { Settings } from './pages/Settings'

function Shell() {
  // Strava redirects back here with ?code=... after connecting — land on Settings so the
  // "Connected" confirmation is immediately visible.
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).has('code') ? 'settings' : 'today',
  )

  return (
    <div className="flex h-full flex-col">
      <div className="safe-top" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'today' && <Today />}
        {tab === 'calendar' && <Calendar />}
        {tab === 'goals' && <Goals />}
        {tab === 'journal' && <Journal />}
        {tab === 'food' && <Food />}
        {tab === 'finance' && <Finance />}
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
