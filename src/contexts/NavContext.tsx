import { createContext, useContext } from 'react'
import type { Tab } from '../components/TabBar'

// The top icon row (Calendar / Settings / Refresh) moved inside each screen's hero block,
// so every page needs to be able to switch tabs. Rather than thread `onChange` through
// seven page components that otherwise take no props, the shell publishes it here and
// `Screen` reads it.
export const NavContext = createContext<{ tab: Tab; setTab: (tab: Tab) => void }>({
  tab: 'today',
  setTab: () => {},
})

export function useNav() {
  return useContext(NavContext)
}
