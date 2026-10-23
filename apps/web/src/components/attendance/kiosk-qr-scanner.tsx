"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export function KioskQrScanner({ onDecoded, onClose }: {
  onDecoded: (payload: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (stopped) return;
        timer = setInterval(() => {
          if (!context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          const width = Math.min(video.videoWidth, 480);
          const height = Math.round(width * video.videoHeight / video.videoWidth);
          if (!width || !height) return;
          canvas.width = width;
          canvas.height = height;
          context.drawImage(video, 0, 0, width, height);
          const frame = context.getImageData(0, 0, width, height);
          const found = jsQR(frame.data, width, height, { inversionAttempts: "dontInvert" });
          if (found?.data && !stopped) {
            stopped = true;
            if (timer) clearInterval(timer);
            stream?.getTracks().forEach((track) => track.stop());
            onDecoded(found.data);
          }
        }, 250);
      } catch {
        if (!stopped) setError("Camera unavailable. Use your family PIN or ask at the desk.");
      }
    }
    void start();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [onDecoded]);

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <h2 className="text-[20px] font-extrabold text-ink">Scan family attendance pass</h2>
      <p className="text-center text-[13px] text-muted">Hold the QR code inside the frame.</p>
      <video ref={videoRef} playsInline muted autoPlay className="aspect-square w-full rounded-2xl bg-ink object-cover" />
      {error && <p role="alert" className="text-center text-[13px] text-danger">{error}</p>}
      <button type="button" onClick={onClose} className="rounded-full border border-[#D6E1F0] bg-card px-7 py-3 text-[14px] font-bold text-ink">
        Use PIN instead
      </button>
    </div>
  );
}
