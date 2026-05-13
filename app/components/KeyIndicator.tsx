"use client";

interface Props {
  onChangeKey: () => void;
}

export default function KeyIndicator({ onChangeKey }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-green-500 font-medium">key set ✓</span>
      <button
        onClick={onChangeKey}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline"
      >
        change
      </button>
    </div>
  );
}
