/**
 * Tests for SearchFilters component
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchFilters } from '@/components/search/SearchFilters/index';
import { SearchFilters as SearchFiltersType } from '@/lib/api/types';

describe('SearchFilters', () => {
  const mockFilters: SearchFiltersType = {
    category: '',
    duration: 'all',
    sortBy: 'relevance',
  };

  const mockOnFiltersChange = jest.fn();
  const mockOnApplyFilters = jest.fn();
  const mockOnClearFilters = jest.fn();
  const mockOnToggle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render filter toggle button', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={false}
        onToggle={mockOnToggle}
      />
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('should call onToggle when filter button is clicked', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={false}
        onToggle={mockOnToggle}
      />
    );

    const filterButton = screen.getByText('Filters');
    fireEvent.click(filterButton);

    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('should show active indicator when filters are applied', () => {
    const activeFilters: SearchFiltersType = {
      category: 'islamic-lectures',
      duration: 'short',
      sortBy: 'date',
    };

    render(
      <SearchFilters
        filters={activeFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={false}
        onToggle={mockOnToggle}
      />
    );

    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should not show active indicator when no filters are applied', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={false}
        onToggle={mockOnToggle}
      />
    );

    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('should show filter panel when isOpen is true', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    // Filter panel should be visible with category options
    expect(screen.getByText('All Categories')).toBeInTheDocument();
  });

  it('should hide filter panel when isOpen is false', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={false}
        onToggle={mockOnToggle}
      />
    );

    // Filter panel should not show category options
    expect(screen.queryByText('All Categories')).not.toBeInTheDocument();
  });

  it('should call onFiltersChange when filter is updated', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    // Find all select elements
    const selects = screen.getAllByRole('combobox');
    const categorySelect = selects[0]; // First select is category
    fireEvent.change(categorySelect, { target: { value: 'islamic-lectures' } });

    expect(mockOnFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'islamic-lectures',
      })
    );
  });

  it('should call onApplyFilters when apply button is clicked', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    const applyButton = screen.getByText('Apply Filters');
    fireEvent.click(applyButton);

    expect(mockOnApplyFilters).toHaveBeenCalledTimes(1);
  });

  it('should call onClearFilters when clear button is clicked', () => {
    render(
      <SearchFilters
        filters={mockFilters}
        onFiltersChange={mockOnFiltersChange}
        onApplyFilters={mockOnApplyFilters}
        onClearFilters={mockOnClearFilters}
        isOpen={true}
        onToggle={mockOnToggle}
      />
    );

    const clearButton = screen.getByText('Clear');
    fireEvent.click(clearButton);

    expect(mockOnClearFilters).toHaveBeenCalledTimes(1);
  });
});
