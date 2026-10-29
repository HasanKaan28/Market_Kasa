import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the main landmark', () => {
    render(<App />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it("shows the sync runner's state in the shell", async () => {
    render(<App />);
    expect(await screen.findByText('Çevrimdışı')).toBeInTheDocument();
  });
});
