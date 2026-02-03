import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BooleanParameter } from '../BooleanParameter';

describe('BooleanParameter', () => {
  const definition = {
    type: 'boolean' as const,
    flag: '--release',
    description: 'Build in release mode',
  };

  it('renders switch with correct initial state', () => {
    render(
      <BooleanParameter
        definition={definition}
        value={true}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByLabelText('--release')).toBeInTheDocument();
  });

  it('calls onChange when switch is toggled', () => {
    const handleChange = vi.fn();
    render(
      <BooleanParameter
        definition={definition}
        value={false}
        onChange={handleChange}
      />
    );

    const switchElement = screen.getByRole('switch');
    fireEvent.click(switchElement);

    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('displays description as tooltip', () => {
    render(
      <BooleanParameter
        definition={definition}
        value={true}
        onChange={vi.fn()}
      />
    );

    const helpIcon = screen.getByLabelText('Help');
    expect(helpIcon).toBeInTheDocument();
  });
});
