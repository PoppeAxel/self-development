import { createContext, useContext, useEffect, useRef, useState } from 'react'

// Edit mode: the ✎ square in every screen's hero turns it on, and only then do editable
// things show their ⋯ — so the normal screens look exactly as they did. A long-press opens
// the same sheet with edit mode off. `offerUndo` shows the 5-second "Undo" toast after a
// delete; the delete itself has already happened (archived), undo reverses it.
interface Edit {
  editing: boolean
  toggleEditing: () => void
  offerUndo: (message: string, undo: () => Promise<void> | void) => void
}

const EditContext = createContext<Edit>({ editing: false, toggleEditing: () => {}, offerUndo: () => {} })

export const useEdit = () => useContext(EditContext)

const UNDO_MS = 5000

export function EditProvider({ children }: { children: React.ReactNode }) {
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<{ message: string; undo: () => Promise<void> | void } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  function offerUndo(message: string, undo: () => Promise<void> | void) {
    window.clearTimeout(timer.current)
    setToast({ message, undo })
    timer.current = window.setTimeout(() => setToast(null), UNDO_MS)
  }

  async function runUndo() {
    if (!toast) return
    window.clearTimeout(timer.current)
    setToast(null)
    await toast.undo()
  }

  return (
    <EditContext value={{ editing, toggleEditing: () => setEditing((v) => !v), offerUndo }}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-5" style={{ bottom: 'calc(var(--tabbar-space) + 10px)' }}>
          <div className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-[18px] bg-ink px-4 py-3 text-sm text-white shadow-card">
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            <button onClick={runUndo} className="shrink-0 font-semibold text-[#a8cfc0]">
              Undo
            </button>
          </div>
        </div>
      )}
    </EditContext>
  )
}
