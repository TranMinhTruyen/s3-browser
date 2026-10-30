import { Text } from '@mantine/core';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/_helpers/renderWithProviders';

describe('renderWithProviders', () => {
  it('renders children inside the providers', () => {
    renderWithProviders(<Text>hello</Text>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
