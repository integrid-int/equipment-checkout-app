/**
 * BarcodeScanner — uses @zxing/browser for camera-based barcode scanning.
 * Works on iOS Safari (iPhone/iPad) as well as Chrome/Android.
 *
 * Props:
 *  onResult(text) — called once per successful decode
 *  onClose()      — called when the user dismisses the scanner
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";

interface Props {
  onResult: (text: string) => void;
  onClose: () => void;
  title?: string;
  helperText?: string;
}

export default function BarcodeScanner({
  onResult,
  onClose,
  title = "Scan Barcode",
  helperText = "Point at any barcode or QR code",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>();
  const lastResultRef = useRef<string>("");
  const streamRef = useRef<MediaStream | null>(null);

  // Request camera permission explicitly — required on iOS Safari
  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    // getUserMedia triggers the iOS permission prompt; enumerateDevices alone does not
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        // Stop the temporary stream — we'll start a new one via zxing
        stream.getTracks().forEach((t) => t.stop());

        // Now that permission is granted, enumerate devices
        return BrowserMultiFormatReader.listVideoInputDevices();
      })
      .then((devices) => {
        setCameras(devices);
        const back = devices.find(
          (d) =>
            d.label.toLowerCase().includes("back") ||
            d.label.toLowerCase().includes("rear") ||
            d.label.toLowerCase().includes("environment")
        );
        setSelectedCameraId(back?.deviceId ?? devices[0]?.deviceId);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          setError("Camera permission was denied. Please allow camera access in your browser settings.");
        } else if (err instanceof DOMException && err.name === "NotFoundError") {
          setError("No camera found on this device.");
        } else {
          setError(`Camera access failed: ${err.message}`);
        }
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (readerRef.current as any)?.reset?.();
    };
  }, []);

  const onResultStable = useCallback(onResult, [onResult]);

  useEffect(() => {
    if (!selectedCameraId || !videoRef.current) return;

    const reader = readerRef.current;
    if (!reader) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reader as any)?.reset?.();

    reader
      .decodeFromVideoDevice(selectedCameraId, videoRef.current, (result, err) => {
        if (result) {
          const text = result.getText();
          if (text !== lastResultRef.current) {
            lastResultRef.current = text;
            if ("vibrate" in navigator) navigator.vibrate(100);
            onResultStable(text);
          }
        } else if (err && !(err instanceof NotFoundException)) {
          console.warn("Scan error:", err);
        }
      })
      .then(() => {
        // Capture the active stream so we can stop it on cleanup
        if (videoRef.current?.srcObject instanceof MediaStream) {
          streamRef.current = videoRef.current.srcObject;
        }
      })
      .catch((err: Error) => setError(`Camera error: ${err.message}`));

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (reader as any)?.reset?.();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [selectedCameraId, onResultStable]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-safe-top py-3 bg-black/80">
        <h2 className="text-white text-lg font-semibold">{title}</h2>
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
            <span className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-brand-300 rounded-tl-lg" />
            <span className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-brand-300 rounded-tr-lg" />
            <span className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-brand-300 rounded-bl-lg" />
            <span className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-brand-300 rounded-br-lg" />
            {/* Scan line animation */}
            <div className="absolute inset-x-2 top-0 h-0.5 bg-brand-300 animate-scan-line" />
          </div>
          <p className="absolute bottom-24 text-white/80 text-sm text-center px-8">
            {helperText}
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
                  ? "bg-brand-500 text-white"
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
