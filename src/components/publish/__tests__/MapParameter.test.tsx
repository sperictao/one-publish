import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MapParameter } from '../MapParameter';

describe('MapParameter', () => {
  const definition = {
    type: 'map' as const,
    flag: '',
    prefix: '-p:',
    description: 'MSBuild properties',
  };

  it('renders empty message when no entries', () => {
    render(
      <MapParameter
        definition={definition}
        value={{}}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('No entries added')).toBeInTheDocument();
  });

  it('renders inputs for each entry', () => {
    render(
      <MapParameter
        definition={definition}
        value={{ key1: 'value1', key2: 'value2' }}
        onChange={vi.fn()}
      />
    );

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4); // 2 keys + 2 values
  });

  it('adds new entry when Add button is clicked', () => {
    const handleChange = vi.fn();
    render(
      <MapParameter
        definition={definition}
        value={{}}
        onChange={handleChange}
      />
    );

    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    expect(handleChange).toHaveBeenCalledWith(expect.objectContaining({
      key_0: expect.any(String),
    }));
  });

  it('removes entry when X button is clicked', () => {
    const handleChange = vi.fn();
    render(
      <MapParameter
        definition={definition}
        value={{ key1: 'value1', key2: 'value2' }}
        onChange={handleChange}
      />
    );

    const removeButtons = screen.getAllByRole('button').filter(
      (btn) => btn.querySelector('svg')
    );
    fireEvent.click(removeButtons[0]);

    const updatedValue = handleChange.mock.calls[0][0];
    expect(updatedValue).not.toHaveProperty('key1');
    expect(updatedValue).toHaveProperty('key2', 'value2');
  });

  it('updates key when input changes', () => {
    const handleChange = vi.fn();
    render(
      <MapParameter
        definition={definition}
        value={{ oldKey: 'value1' }}
        onChange={handleChange}
      />
    );

    const keyInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(keyInput, { target: { value: 'newKey' } });

    const updatedValue = handleChange.mock.calls[0][0];
    expect(updatedValue).toHaveProperty('newKey', 'value1');
    expect(updatedValue).not.toHaveProperty('oldKey');
  });

  it('updates value when input changes', () => {
    const handleChange = vi.fn();
    render(
      <MapParameter
        definition={definition}
        value={{ key1: 'oldValue' }}
        onChange={handleChange}
      />
    );

    const valueInput = screen.getAllByRole('textbox')[1];
    fireEvent.change(valueInput, { target: { value: 'newValue' } });

    expect(handleChange).toHaveBeenCalledWith({
      key1: 'newValue',
    });
  });
});
