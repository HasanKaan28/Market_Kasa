import type { CSSProperties, JSX } from 'react';

export type ChoiceOption<T extends string | number> = { value: T; label: string };

export type ChoiceGroupProps<T extends string | number> = {
  legend: string;
  name: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Lets a long list of options wrap onto more rows, each as wide as its label. */
  wrap?: boolean;
};

/** Radio buttons drawn as a row of equal segments; the arrow keys move between them. */
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
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className={wrap ? 'flex flex-wrap gap-2' : 'grid gap-2'} style={columns}>
        {options.map((option) => (
          <label
            key={String(option.value)}
            className="flex min-h-11 cursor-pointer items-center justify-center rounded-control border border-line-strong px-3 text-center font-medium has-checked:border-accent has-checked:bg-accent has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
          >
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
