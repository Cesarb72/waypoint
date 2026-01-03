export type CtaVariant = 'primary' | 'chip' | 'danger';

const baseClasses =
  'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

const variantClasses: Record<CtaVariant, string> = {
  chip:
    'border border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800 hover:border-slate-600 active:bg-slate-800/80 focus-visible:outline-slate-500',
  primary:
    'border border-sky-500 bg-sky-600 text-slate-50 hover:bg-sky-500 active:bg-sky-700 focus-visible:outline-sky-500',
  danger:
    'border border-rose-500 bg-rose-600 text-slate-50 hover:bg-rose-500 active:bg-rose-700 focus-visible:outline-rose-500',
};

export function ctaClass(variant: CtaVariant = 'chip'): string {
  return `${baseClasses} ${variantClasses[variant]}`;
}
