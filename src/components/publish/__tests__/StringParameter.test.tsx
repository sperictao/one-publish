import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StringParameter } from '../StringParameter';

describe('StringParameter', () => {
  const definition = {
    type: 'string' as const,
    flag: '--target',
    description: 'Target triple',
  };

  it('renders input with correct value', () => {
    render(
      <StringParameter
        definition={definition}
        value="x86_64-apple-darwin"
        onChange={vi.fn()}
      />
    );

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('x86_64-apple-darwin');
  });

  it('calls onChange when input changes', () => {
    const handleChange = vi.fn();
    render(
      <StringParameter
        definition={definition}
        value=""
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test-value' } });

    expect(handleChange).toHaveBeenCalledWith('test-value');
  });

  it('displays description as tooltip', () => {
    render(
      <StringParameter
        definition={definition}
        value=""
        onChange={vi.fn()}
      />
    );

    const helpIcon = screen.getByLabelText('Help');
    expect(helpIcon).toBeInTheDocument();
  });
});
