import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MotionProvider from '@/components/providers/MotionProvider';
import { motionConfigProps } from '@/test/_helpers/mockMotion';

vi.mock('motion/react', async () => (await import('@/test/_helpers/mockMotion')).motionMock);

describe('MotionProvider', () => {
  beforeEach(() => {
    motionConfigProps.length = 0;
  });

  it('renders its children', () => {
    render(
      <MotionProvider>
        <span>child</span>
      </MotionProvider>
    );
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  it('respects the user reduced-motion preference', () => {
    render(
      <MotionProvider>
        <span>child</span>
      </MotionProvider>
    );
    expect(motionConfigProps.at(-1)).toMatchObject({ reducedMotion: 'user' });
  });
});
