import { TRICKS } from "../config/sensorConfig";
import type { TrickLabel } from "../types/sensorTypes";

type ResultCardProps = {
  label: TrickLabel;
  onReset: () => void;
};

export function ResultCard({ label, onReset }: ResultCardProps) {
  const trick = TRICKS.find((item) => item.id === label);

  if (!trick) {
    return (
      <div className="result-wrap">
        <div className="unknown-mark">✕</div>
        <div className="result-title">Unknown</div>
        <div className="result-subtitle">Didn’t lock one in.</div>
        <button className="ghost-button" onClick={onReset}>
          Try another
        </button>
      </div>
    );
  }

  return (
    <div className="result-wrap">
      <div className="result-title">{trick.label}</div>
      <div className="result-subtitle">{trick.celebration}</div>
    </div>
  );
}