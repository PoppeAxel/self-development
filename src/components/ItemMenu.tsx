import { useRef } from 'react'

// The one edit pattern for anything editable in place: a ⋯ on the item (edit mode only) or
// a long-press opens ItemSheet — the item's own fields on top, then Duplicate / ↑ / ↓ /
// Delete underneath. Each item type supplies the fields and the handlers; the sheet, the
// gestures and the layout live here once.

const LONG_PRESS_MS = 500

/**
 * Long-press handlers for an element that also has a normal tap. The click that follows a
 * long-press is swallowed so it doesn't also select the item.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined)
  const fired = useRef(false)
  const cancel = () => window.clearTimeout(timer.current)
  return {
    onPointerDown: () => {
      fired.current = false
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.stopPropagation()
        e.preventDefault()
        fired.current = false
      }
    },
  }
}

/** The small ⋯ shown on an item in edit mode. */
export function EditDots({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={`Edit ${label}`}
      className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-track px-1 text-[11px] font-bold leading-none text-ink-3"
    >
      ⋯
    </button>
  )
}

// z-[75]: opened from inside other sheets (Today's task form is z-50, the goal form too), and
// must stay below ConfirmDialog (z-[80]) and the undo toast (z-[90]).
export function ItemSheet({
  title,
  onClose,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
  children,
}: {
  title: string
  onClose: () => void
  onDuplicate?: () => void
  /** Omit at the top / bottom of the list. */
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete?: () => void
  children: React.ReactNode
}) {
  const action = 'flex-1 rounded-[14px] bg-track px-2 py-2.5 text-xs font-semibold text-ink-2 disabled:opacity-40'
  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="safe-bottom max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold text-ink">{title}</p>
          <button type="button" onClick={onClose} className="rounded-full bg-track px-3 py-1.5 text-sm font-medium text-ink-2">
            Close
          </button>
        </div>
        {children}
        {/* No actions when creating a new item — only its fields. */}
        {(onDuplicate || onDelete) && (
        <div className="mt-4 flex gap-2 border-t border-line pt-4">
          {onDuplicate && (
            <button type="button" onClick={onDuplicate} className={action}>
              Duplicate
            </button>
          )}
          <button type="button" onClick={onMoveUp} disabled={!onMoveUp} aria-label="Move up" className={action}>
            ↑
          </button>
          <button type="button" onClick={onMoveDown} disabled={!onMoveDown} aria-label="Move down" className={action}>
            ↓
          </button>
          {onDelete && (
            <button type="button" onClick={onDelete} className={`${action} text-cat-rose-ink`}>
              Delete
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
