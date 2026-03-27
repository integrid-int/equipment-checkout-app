/**
 * BarcodeScanner — uses @zxing/browser for camera-based barcode scanning.
 * Works on iOS Safari (iPhone/iPad) as well as Chrome/Android.
 *
 * Props:
 *  onResult(text) — called once per successful decode
 *  onClose()      — called when the user dismisses the scanner
 */

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/browser";

interface Props {
  onResult: (text: string) => void;
  onClose: () => void;
}

export default function BarcodeScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>();
  const lastResultRef = useRef<string>("");

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    // Get available cameras; prefer rear camera on mobile
    BrowserMultiFormatReader.listVideoInputDevices()
      .then((devices) => {
        setCameras(devices);
        // Prefer back/environment camera
        const back = devices.find(
          (d) => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear")
        );
        setSelectedCameraId(back?.deviceId ?? devices[0]?.deviceId);
      })
      .catch((err) => setError(`Camera access denied: ${err.message}`));

    return () => {
      readerRef.current?.reset();
    };
  }, []);

  useEffect(() => {
    if (!selectedCameraId || !videoRef.current) return;

    const reader = readerRef.current;
    if (!reader) return;

    reader.reset();

    reader
      .decodeFromVideoDevice(selectedCameraId, videoRef.current, (result, err) => {
        if (result) {
          const text = result.getText();
          // Debounce: don't fire the same code twice in a row
          if (text !== lastResultRef.current) {
            lastResultRef.current = text;
            // Brief vibration feedback on mobile
            if ("vibrate" in navigator) navigator.vibrate(100);
            onResult(text);
          }
        } else if (err && !(err instanceof NotFoundException)) {
          console.warn("Scan error:", err);
        }
      })
      .catch((err: Error) => setError(`Camera error: ${err.message}`));
  }, [selectedCameraId, onResult]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top py-3 bg-black/80">
        <h2 className="text-white text-lg font-semibold">Scan Barcode</h2>
        <button
          onClick={onClose}
          className="text-white bg-white/20 rounded-full w-9 h-9 flex items-center justify-center text-xl"
          aria-label="Close scanner"
        >
          ✕
        </button>
      </div>

      {/* Camera feed */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {/* Scan frame overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-48 border-2 border-white/80 rounded-xl relative">
            {/* Corner accents */}
            <span className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-blue-400 rounded-tl-lg" />
            <span className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-blue-400 rounded-tr-lg" />
            <span className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-blue-400 rounded-bl-lg" />
            <span className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-blue-400 rounded-br-lg" />
            {/* Scan line animation */}
            <div className="absolute inset-x-2 top-0 h-0.5 bg-blue-400 animate-scan-line" />
          </div>
          <p className="absolute bottom-24 text-white/80 text-sm text-center px-8">
            Point at any barcode or QR code
          </p>
        </div>

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="bg-white rounded-2xl p-6 mx-6 text-center">
              <p className="text-red-600 font-medium mb-3">{error}</p>
              <p className="text-gray-500 text-sm mb-4">
                Allow camera access in your browser settings and try again.
              </p>
              <button onClick={onClose} className="btn-primary">
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Camera switcher (only shown if multiple cameras) */}
      {cameras.length > 1 && (
        <div className="bg-black/80 px-4 pb-safe-bottom py-3 flex gap-2 overflow-x-auto">
          {cameras.map((cam) => (
            <button
              key={cam.deviceId}
              onClick={() => setSelectedCameraId(cam.deviceId)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium ${
                selectedCameraId === cam.deviceId
                  ? "bg-blue-500 text-white"
                  : "bg-white/20 text-white"
              }`}
            >
              {cam.label || `Camera ${cameras.indexOf(cam) + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
