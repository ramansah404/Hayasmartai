import { useMemo } from "react";
import { motion } from "motion/react";

type VisualizerState = "idle" | "listening" | "processing" | "speaking";

interface VisualizerProps {
  state: VisualizerState;
}

// ── Static theme map ─────────────────────────────────────────────────────────
// Was: getTheme() called on every render producing a new object each time.
// Now: a constant lookup — zero allocations per render.
const THEMES: Record<VisualizerState, { color: string; glow: string; border: string }> = {
  listening:  { color: "rgba(139, 92, 246, 1)",  glow: "shadow-violet-500/20", border: "border-violet-400" },
  processing: { color: "rgba(56, 189, 248, 1)",  glow: "shadow-sky-400/20",    border: "border-sky-400"    },
  speaking:   { color: "rgba(236, 72, 153, 1)",  glow: "shadow-pink-500/20",   border: "border-pink-400"   },
  idle:       { color: "rgba(6, 182, 212, 0.8)", glow: "shadow-cyan-500/15",   border: "border-cyan-500/50"},
};

export default function Visualizer({ state }: VisualizerProps) {
  const theme = THEMES[state];

  // ── Pulse animation ──────────────────────────────────────────────────────
  // Was: getPulseAnimation() called TWICE per render, each time creating a new
  // object, with repeat: 2 so animation stops dead after ~3 seconds.
  // Now: memoised on `state`, loops forever with repeat: Infinity.
  const pulseAnimation = useMemo(() => {
    if (state === "speaking") {
      return {
        scale:   [1, 1.05, 0.98, 1.02, 1] as number[],
        opacity: [0.8, 1, 0.8, 1, 0.8] as number[],
        transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" as const },
      };
    }
    if (state === "listening") {
      return {
        scale:   [1, 1.02, 1] as number[],
        opacity: [0.7, 1, 0.7] as number[],
        transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" as const },
      };
    }
    if (state === "processing") {
      return {
        scale:   [0.98, 1.02, 0.98] as number[],
        opacity: [0.6, 0.9, 0.6] as number[],
        transition: { duration: 1.5, repeat: Infinity, ease: "linear" as const },
      };
    }
    // idle — slow, gentle breath
    return {
      scale:   [1, 1.01, 1] as number[],
      opacity: [0.4, 0.6, 0.4] as number[],
      transition: { duration: 3, repeat: Infinity, ease: "easeInOut" as const },
    };
  }, [state]);

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">

      {/* Ambient Glow — motion.div for the pulse, plain div overhead avoided for rings */}
      <motion.div
        animate={pulseAnimation}
        className={`absolute w-[60%] h-[60%] rounded-full blur-[80px] ${theme.glow}`}
        style={{ backgroundColor: theme.color, opacity: 0.15 }}
      />

      {/* Ring 3: Scanner Ring — plain div (was motion.div with empty animate={}) */}
      <div
        className={`absolute w-[70%] h-[70%] rounded-full border-[1px] ${theme.border} border-t-transparent border-b-transparent opacity-40 transition-colors duration-700`}
      />

      {/* Ring 4: Inner Dashed — plain div */}
      <div
        className={`absolute w-[55%] h-[55%] rounded-full border-[2px] border-dashed ${theme.border} opacity-50 transition-colors duration-700`}
      />

      {/* Ring 5: Core HUD Ring — plain div */}
      <div
        className={`absolute w-[40%] h-[40%] rounded-full border-[4px] border-dotted ${theme.border} opacity-70 transition-colors duration-700`}
      />

      {/* Core Circle — motion.div for the pulse effect */}
      <motion.div
        animate={pulseAnimation}
        className={`absolute w-[25%] h-[25%] rounded-full border-[1px] ${theme.border} bg-black/40 backdrop-blur-md flex items-center justify-center shadow-[inset_0_0_30px_rgba(0,0,0,0.5)] transition-colors duration-700`}
        style={{ boxShadow: `0 0 40px ${theme.color}, inset 0 0 30px ${theme.color}` }}
      >
        {/* Center Text */}
        <div
          className="font-bold tracking-[0.3em] text-xl md:text-3xl lg:text-4xl text-white"
          style={{ textShadow: `0 0 15px ${theme.color}, 0 0 30px ${theme.color}` }}
        >
          HAYA
        </div>
      </motion.div>
    </div>
  );
}
