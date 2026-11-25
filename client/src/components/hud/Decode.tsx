import { useEffect, useState } from "react";
import { useAnimate } from "./motion";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+<>/";

/**
 * Text that "decodes" from scrambled glyphs into its final value,
 * left to right, whenever `text` changes. Good for headings and tickers.
 */
export function Decode({ text, duration = 520, className }: { text: string; duration?: number; className?: string }) {
  const animate = useAnimate();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (!animate || !text) {
      setOut(text);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const settled = Math.floor(t * text.length);
      let s = text.slice(0, settled);
      for (let i = settled; i < text.length; i++) {
        s += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setOut(s);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setOut(text);
    };
    raf = requestAnimationFrame(tick);
    // rAF pauses in background tabs; never leave the text scrambled.
    const snap = setTimeout(() => {
      cancelAnimationFrame(raf);
      setOut(text);
    }, duration + 60);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(snap);
    };
  }, [text, animate, duration]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{out}</span>
    </span>
  );
}
