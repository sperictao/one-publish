import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArrayParameter } from '../ArrayParameter';
import { __setTranslationsCacheForTest } from '@/hooks/useI18n';

describe('ArrayParameter', () => {
  const definition = {
    type: 'array' as const,
    flag: '--features',
    description: 'List of features',
  };

  beforeEach(() => {
    __setTranslationsCacheForTest({
      zh: {
        common: {
          add: '添加',
          arrayItemPlaceholder: '第 {{index}} 项',
          removeArrayItem: '移除第 {{index}} 项',
        },
      },
    });
    localStorage.setItem('app-language', 'zh');
  });

  it('renders empty array message when no items', () => {
    render(
      <ArrayParameter
        definition={definition}
        value={[]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('No items added')).toBeInTheDocument();
  });

  it('renders input for each item', () => {
    render(
      <ArrayParameter
        definition={definition}
        value={['feature1', 'feature2']}
        onChange={vi.fn()}
      />
    );

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toHaveValue('feature1');
    expect(inputs[1]).toHaveValue('feature2');
  });

  it('adds new item when Add button is clicked', () => {
    const handleChange = vi.fn();
    render(
      <ArrayParameter
        definition={definition}
        value={[]}
        onChange={handleChange}
      />
    );

    const addButton = screen.getByRole('button', { name: /添加/ });
    fireEvent.click(addButton);

    expect(handleChange).toHaveBeenCalledWith(['']);
  });

  it('removes item when X button is clicked', () => {
    const handleChange = vi.fn();
    render(
      <ArrayParameter
        definition={definition}
        value={['item1', 'item2']}
        onChange={handleChange}
      />
    );

    const removeButtons = screen.getAllByRole('button', { name: /移除第/ });
    fireEvent.click(removeButtons[0]);

    expect(handleChange).toHaveBeenCalledWith(['item2']);
  });

  it('updates item value when input changes', () => {
    const handleChange = vi.fn();
    render(
      <ArrayParameter
        definition={definition}
        value={['feature1']}
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'updated-feature' } });

    expect(handleChange).toHaveBeenCalledWith(['updated-feature']);
  });

  it('renders read-only items without add or remove actions', () => {
    render(
      <ArrayParameter
        definition={definition}
        value={['feature1']}
        onChange={vi.fn()}
        readOnly
      />
    );

    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /添加/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /移除第/ })).not.toBeInTheDocument();
  });
});
