import { useId, type ComponentProps, type JSX } from 'react';

export type SelectFieldProps = ComponentProps<'select'> & {
  label: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
};

/** A labelled native select, drawn like TextField. */
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
    'min-h-11 rounded-control border border-line-strong bg-surface px-3 text-base text-text',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-text">
        {label}
      </label>
      <select id={selectId} aria-describedby={hintId} className={selectClasses} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
