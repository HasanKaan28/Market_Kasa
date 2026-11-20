import type { CSSProperties, JSX } from 'react';

export type ChoiceOption<T extends string | number> = { value: T; label: string };

export type ChoiceGroupProps<T extends string | number> = {
  legend: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Lets a long list of options wrap onto more rows, as chips as wide as their labels. */
  wrap?: boolean;
};

const CHIP =
  'flex min-h-11 cursor-pointer items-center justify-center rounded-chip border border-line-strong bg-surface px-4 text-center font-medium transition-colors has-checked:border-accent has-checked:bg-accent has-checked:text-white';
const SEGMENT =
  'flex min-h-11 cursor-pointer items-center justify-center rounded-[8px] px-3 text-center font-medium transition-colors has-checked:bg-accent has-checked:font-semibold has-checked:text-white';
const FOCUS =
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent';

/**
 * Radio buttons drawn as a segmented track of equal parts, or as chips when they wrap; the chosen
 * one is filled. The arrow keys move between them.
 */
export function ChoiceGroup<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  wrap = false,
}: ChoiceGroupProps<T>): JSX.Element {
  const columns: CSSProperties | undefined = wrap
    ? undefined
    : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` };
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
      <div
        className={
          wrap ? 'flex flex-wrap gap-2' : 'grid gap-1 rounded-control border border-line bg-bg p-1'
        }
        style={columns}
      >
        {options.map((option) => (
          <label key={String(option.value)} className={`${wrap ? CHIP : SEGMENT} ${FOCUS}`}>
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
