"use client";

// Ambient node network for the IDE's own canvas — adapted from the
// prototype's UnifiedCanvas (apps/prototype-ui/app/background/
// UnifiedCanvas.tsx): a mouse-reactive particle mesh with drifting code
// fragments rising off each node. Two changes from the prototype: the code
// fragments are generic now (see agenticSnippets.ts's header comment for
// why), and the palette is pulled down to a single hue — lib/design's
// machine channel (cyan) — rather than the prototype's four-colour mix,
// since this field is ambient system-activity texture, not a place that
// asks the reader to act. Adding amber here would blur the one signal that
// actually means "waiting on you" everywhere else in the product.
//
// Canvas-only, mount-time Math.random() — safe against hydration mismatch
// because nothing here renders before the client effect runs; there is no
// server-rendered markup that depends on these values.
import { useEffect, useRef } from "react";
import { signal } from "@/lib/design";
import { generateAmbientSnippet } from "./agenticSnippets";

interface FieldNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}

interface DriftText {
  x: number;
  y: number;
  text: string;
  speed: number;
  alpha: number;
  parentIndex: number;
  distanceLimit: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = Number.parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function AgenticField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [r, g, b] = hexToRgb(signal.machine);
    const rgb = `${r}, ${g}, ${b}`;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    let w = canvas.clientWidth || 1;
    let h = canvas.clientHeight || 1;

    const resize = () => {
      w = canvas.clientWidth || 1;
      h = canvas.clientHeight || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Tracked on window, not the canvas itself: the canvas stays
    // pointer-events:none (it's a backdrop under real interactive content),
    // so it would never receive its own mouse events directly.
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouseRef.current.x = -1000;
      mouseRef.current.y = -1000;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);

    const nodeCount = w < 500 ? 22 : 42;
    const nodes: FieldNode[] = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      radius: Math.random() * 1.4 + 0.8,
      alpha: Math.random() * 0.35 + 0.25,
    }));

    const driftCount = Math.min(8, nodeCount);
    const drifts: DriftText[] = Array.from({ length: driftCount }, (_, i) => {
      const parentIndex = i % nodeCount;
      const parent = nodes[parentIndex] as FieldNode;
      return {
        x: parent.x,
        y: parent.y,
        text: generateAmbientSnippet(),
        speed: Math.random() * 0.22 + 0.14,
        alpha: Math.random() * 0.28 + 0.18,
        parentIndex,
        distanceLimit: Math.random() * 70 + 40,
      };
    });

    let animId: number;

    const render = () => {
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as FieldNode;
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;

        const dx = mouseRef.current.x - node.x;
        const dy = mouseRef.current.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          const force = (100 - dist) / 100;
          node.x -= (dx / dist) * force * 1.6;
          node.y -= (dy / dist) * force * 1.6;
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb}, ${node.alpha})`;
        ctx.fill();

        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j] as FieldNode;
          const ndx = other.x - node.x;
          const ndy = other.y - node.y;
          const nDist = Math.sqrt(ndx * ndx + ndy * ndy);
          if (nDist < 90) {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `rgba(${rgb}, ${(1 - nDist / 90) * 0.12})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      ctx.font = '10px "JetBrains Mono", monospace';
      for (const dr of drifts) {
        const parent = nodes[dr.parentIndex] as FieldNode;
        dr.y -= dr.speed;
        if (parent.y - dr.y > dr.distanceLimit) {
          dr.x = parent.x;
          dr.y = parent.y;
          dr.text = generateAmbientSnippet();
        }
        ctx.fillStyle = `rgba(${rgb}, ${dr.alpha})`;
        ctx.fillText(dr.text, dr.x + 8, dr.y);
      }

      animId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
