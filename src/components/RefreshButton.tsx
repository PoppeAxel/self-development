import { useState } from 'react'

export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [spinning, setSpinning] = useState(false)

  async function handleClick() {
    setSpinning(true)
    try {
      await onRefresh()
    } finally {
      setSpinning(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={spinning}
      aria-label="Refresh"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-100 bg-white text-gray-500 shadow-sm disabled:opacity-60"
    >
      <span className={`inline-block text-lg ${spinning ? 'animate-spin' : ''}`}>↻</span>
    </button>
  )
}
