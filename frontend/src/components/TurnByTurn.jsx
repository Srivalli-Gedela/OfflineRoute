import React from 'react';
import {
  CornerUpRight,
  CornerUpLeft,
  ArrowUp,
  MapPin,
  Compass,
  ArrowUpRight,
  ArrowUpLeft,
  Milestone
} from 'lucide-react';

export default function TurnByTurn({ steps = [] }) {
  if (!steps || steps.length === 0) return null;

  const renderModifierIcon = (modifier) => {
    switch (modifier) {
      case 'turn-right':
      case 'sharp-right':
        return <CornerUpRight className="w-4 h-4 text-emerald-400" />;
      case 'slight-right':
        return <ArrowUpRight className="w-4 h-4 text-emerald-300" />;
      case 'turn-left':
      case 'sharp-left':
        return <CornerUpLeft className="w-4 h-4 text-cyan-400" />;
      case 'slight-left':
        return <ArrowUpLeft className="w-4 h-4 text-cyan-300" />;
      case 'arrive':
        return <MapPin className="w-4 h-4 text-rose-400" />;
      case 'depart':
      case 'straight':
      default:
        return <ArrowUp className="w-4 h-4 text-blue-400" />;
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col gap-3">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Milestone className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Turn-by-Turn Directions</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">{steps.length} steps</span>
      </div>

      <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
        {steps.map((step, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 transition-colors"
          >
            <div className="p-2 rounded-lg bg-slate-900 border border-slate-700 shrink-0 mt-0.5">
              {renderModifierIcon(step.modifier)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-100 leading-snug">
                {step.instruction}
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-1">
                <span>{step.street}</span>
                {step.distance_m > 0 && (
                  <>
                    <span>•</span>
                    <span className="font-mono text-slate-300">{step.distance_m}m</span>
                  </>
                )}
              </div>
            </div>

            <div className="text-[10px] text-slate-500 font-mono shrink-0">
              #{step.step_index}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
