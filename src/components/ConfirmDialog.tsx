export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Remove',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onCancel}>
      <div className="w-full max-w-xs rounded-3xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <p className="font-semibold text-gray-900">{title}</p>
        {message && <p className="mt-1 text-sm text-gray-500">{message}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-2xl bg-gray-100 px-4 py-2.5 font-medium text-gray-600">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className="flex-1 rounded-2xl bg-rose-600 px-4 py-2.5 font-semibold text-white">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
