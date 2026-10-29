import { useId, type ComponentProps, type JSX } from 'react';

/** Every input attribute, `ref` included (React 19 passes it as a prop). */
export type TextFieldProps = ComponentProps<'input'> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: TextFieldProps): JSX.Element {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const inputClasses = [
    'min-h-11 rounded-control border bg-surface px-3 text-base text-text placeholder:text-muted',
    error ? 'border-danger' : 'border-line-strong',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={inputClasses}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
