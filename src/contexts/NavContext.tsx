import { createContext, useContext } from 'react'
import type { Tab } from '../components/TabBar'

// The top icon row (Calendar / Settings / Refresh) moved inside each screen's hero block,
// so every page needs to be able to switch tabs. Rather than thread `onChange` through
// seven page components that otherwise take no props, the shell publishes it here and
// `Screen` reads it.
//
// `openGoalDetail` is here for the same reason: the goal detail screen is reachable from
// both Goals and Today, and the app has no router, so the shell owns which goal is open
// and anyone can push one. Passing null returns to the Goals list.
export const NavContext = createContext<{
  tab: Tab
  setTab: (tab: Tab) => void
  goalDetailId: string | null
  openGoalDetail: (goalId: string | null) => void
}>({
  tab: 'today',
  setTab: () => {},
  goalDetailId: null,
  openGoalDetail: () => {},
})

export function useNav() {
  return useContext(NavContext)
}
