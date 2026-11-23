"use client";

import { useEffect, useRef } from "react";

export function HorizontalShelf({
  children,
  className = "gap-4 pb-2",
  wrap = false,
}: {
  children: React.ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);
  const momentumRafRef = useRef<number | null>(null);

  const stopMomentum = () => {
    if (momentumRafRef.current !== null) {
      cancelAnimationFrame(momentumRafRef.current);
      momentumRafRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      stopMomentum();
    };
  }, []);

  if (wrap) {
    return <div className="flex flex-wrap items-center gap-2 pb-1">{children}</div>;
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select")) return;
    const el = scrollerRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;

    stopMomentum();
    el.style.scrollBehavior = "auto";

    const startX = e.clientX;
    const startScrollLeft = el.scrollLeft;
    let latestX = startX;
    let dragRafId: number | null = null;
    let moved = false;
    const prevUserSelect = document.body.style.userSelect;
    const samples: Array<{ x: number; t: number }> = [{ x: startX, t: performance.now() }];

    const flushDragScroll = () => {
      dragRafId = null;
      el.scrollLeft = startScrollLeft - (latestX - startX);
    };

    const onMouseMove = (ev: MouseEvent) => {
      latestX = ev.clientX;
      const now = performance.now();
      samples.push({ x: latestX, t: now });
      while (samples.length > 2 && now - samples[0].t > 90) {
        samples.shift();
      }

      if (!moved && Math.abs(latestX - startX) > 4) {
        moved = true;
        document.body.style.userSelect = "none";
      }
      if (moved && dragRafId === null) {
        dragRafId = requestAnimationFrame(flushDragScroll);
      }
    };

    const cleanup = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (dragRafId !== null) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      document.body.style.userSelect = prevUserSelect;
      cleanupDragRef.current = null;
    };

    const onMouseUp = () => {
      if (moved) {
        flushDragScroll();
      }
      cleanup();
      if (!moved) return;

      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 60);

      const now = performance.now();
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.t - first.t;
      if (now - last.t < 75 && dt > 5) {
        let vx = (last.x - first.x) / dt;
        // Clamp extreme spikes while keeping fast flicks lively
        vx = Math.max(-4.5, Math.min(4.5, vx));
        if (Math.abs(vx) > 0.08) {
          let prevTime = now;
          const stepMomentum = (frameNow: number) => {
            const frameDt = Math.min(48, Math.max(1, frameNow - prevTime));
            prevTime = frameNow;
            const maxScroll = el.scrollWidth - el.clientWidth;
            const next = el.scrollLeft - vx * frameDt;
            el.scrollLeft = next;
            vx *= Math.pow(0.945, frameDt / 16.667);
            if (Math.abs(vx) < 0.015 || el.scrollLeft <= 0 || el.scrollLeft >= maxScroll) {
              momentumRafRef.current = null;
              return;
            }
            momentumRafRef.current = requestAnimationFrame(stepMomentum);
          };
          momentumRafRef.current = requestAnimationFrame(stepMomentum);
        }
      }
    };

    cleanupDragRef.current?.();
    cleanupDragRef.current = cleanup;
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      ref={scrollerRef}
      onMouseDown={handleMouseDown}
      onWheel={stopMomentum}
      onTouchStart={stopMomentum}
      onDragStart={(e) => e.preventDefault()}
      onClickCapture={(e) => {
        if (suppressClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClickRef.current = false;
        }
      }}
      className={`no-scrollbar flex select-none overflow-x-auto overscroll-x-contain md:cursor-grab md:active:cursor-grabbing ${className}`}
    >
      {children}
    </div>
  );
}
