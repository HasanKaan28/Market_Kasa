import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

describe('TextField', () => {
  it('ties label, hint and error to the input', () => {
    render(<TextField label="Barkod" hint="Okuyucu ile okutun" error="Ürün bulunamadı" />);
    const input = screen.getByLabelText('Barkod');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Okuyucu ile okutun Ürün bulunamadı');
  });

  it('is not invalid without an error', () => {
    render(<TextField label="Ad" />);
    expect(screen.getByLabelText('Ad')).not.toHaveAttribute('aria-invalid');
  });

  it('passes its ref to the input', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} label="Barkod" />);
    expect(ref.current).toBe(screen.getByLabelText('Barkod'));
  });
});
