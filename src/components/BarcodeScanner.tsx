import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library'
import type { IScannerControls } from '@zxing/browser'

// Retail products use EAN-13/EAN-8 (most of the world) or UPC-A/UPC-E (US) — restricting
// to these (rather than every format ZXing supports, including 2D codes like QR/Aztec)
// keeps each decode attempt faster and avoids false-positive matches against unrelated
// codes that might be in frame (e.g. a QR code on the same package).
const PRODUCT_BARCODE_FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]

export function BarcodeScanner({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected
  const [error, setError] = useState<string | null>(null)

  // Mount-once: the camera/decoder should start exactly once for the component's
  // lifetime, not restart on every parent re-render (onDetectedRef sidesteps that).
  useEffect(() => {
    let cancelled = false
    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, PRODUCT_BARCODE_FORMATS)
    const reader = new BrowserMultiFormatReader(hints)

    reader
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current ?? undefined, (result, err) => {
        if (cancelled) return
        if (result) {
          controlsRef.current?.stop()
          onDetectedRef.current(result.getText())
        } else if (err && !(err instanceof NotFoundException)) {
          // NotFoundException fires on every frame with no barcode in view — expected
          // and noisy, not a real error. Anything else (camera/permission failures)
          // is worth surfacing.
          setError(err.message)
        }
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop()
        } else {
          controlsRef.current = controls
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not start the camera.')
      })

    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black safe-top safe-bottom">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-lg font-bold text-white">Scan barcode</h2>
        <button onClick={onClose} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-white">
          Close ✕
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        <video ref={videoRef} className="max-h-full max-w-full rounded-2xl" muted playsInline />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-2xl border-2 border-teal-400" />
      </div>
      <p className="px-6 pb-6 text-center text-sm text-white/70">
        {error ? error : 'Point the camera at a barcode — it scans automatically.'}
      </p>
    </div>
  )
}
