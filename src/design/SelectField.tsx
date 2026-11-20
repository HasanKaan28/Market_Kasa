import { ChevronDown } from 'lucide-react';
import { useId, type ComponentProps, type JSX } from 'react';

export type SelectFieldProps = ComponentProps<'select'> & {
  label: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
};

/** A labelled native select, drawn like TextField, with its own chevron. */
export function SelectField({
  label,
  hint,
  options,
  id,
  className,
  ...rest
}: SelectFieldProps): JSX.Element {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const selectClasses = [
    'min-h-touch w-full appearance-none rounded-control border border-line-strong bg-surface py-2 pr-10 pl-3.5 text-base text-text',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-semibold text-text">
        {label}
      </label>
      <div className="relative">
        <select id={selectId} aria-describedby={hintId} className={selectClasses} {...rest}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={18}
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-text-2"
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-meta text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
