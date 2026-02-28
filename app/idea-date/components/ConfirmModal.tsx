'use client';

type ConfirmModalProps = {
  open: boolean;
  bullets: string[];
  onClose: () => void;
  onConfirmAnyway: () => void;
  onRefine: () => void;
};

export default function ConfirmModal(props: ConfirmModalProps) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
        <div className="text-sm font-semibold text-white">Before You Confirm</div>
        <p className="mt-1 text-sm text-gray-300">We found a few flow risks:</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-300">
          {props.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={props.onConfirmAnyway}
            className="flex-1 rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950"
          >
            Confirm Anyway
          </button>
          <button
            type="button"
            onClick={props.onRefine}
            className="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-gray-100"
          >
            Refine
          </button>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="mt-2 w-full rounded-md px-3 py-2 text-sm text-gray-400"
        >
          Close
        </button>
      </div>
    </div>
  );
}
