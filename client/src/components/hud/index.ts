/**
 * Ghost HUD primitives, shared by every panel.
 *
 *   Panel        square HUD panel with corner ticks, uppercase title, scan-line entrance
 *   Diamond      small rotated-square glyph; GhostMark = teal/amber/magenta brand mark
 *   CountUp      animated number (counts up on mount, tweens + flashes on change)
 *   Sparkline    SVG line that draws itself in, glowing live tip
 *   RangeBar     red→teal track with spring-animated markers
 *   Segmented    segmented control with sliding highlight
 *   Delta        ▲/▼ signed change, teal/crimson
 *   Decode       scramble→decode text effect
 *   motion       MotionProvider + useAnimate() / useAmbient() (full | reduced | off)
 *
 * CSS utilities (index.css): .hud-panel .hud-title .hud-label .hud-tag .hud-chip
 * .hud-btn .hud-divider .text-up/.text-down/.text-amber/.text-hit/.text-dim
 * .glow-teal/.glow-red/.glow-amber/.glow-hit .box-glow-* .live-dot[data-tone]
 * .cursor-block .flash-up/.flash-down .font-read (Inter, for long-form text)
 * Tailwind colors: up, down, amber, hit, magenta, violet, dim (e.g. bg-up/20, border-amber/40)
 */
export { Panel, Diamond, GhostMark } from "./Panel";
export { CountUp, fmtNum } from "./CountUp";
export { Sparkline } from "./Sparkline";
export { RangeBar, type RangeMarker } from "./RangeBar";
export { Segmented } from "./Segmented";
export { Delta } from "./Delta";
export { Decode } from "./Decode";
export { MotionProvider, useMotionMode, useAnimate, useAmbient, type MotionMode } from "./motion";
