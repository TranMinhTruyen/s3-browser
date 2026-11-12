import { Input, Slider, SliderProps } from '@mantine/core';
import { ReactNode } from 'react';

type SliderInputProps = Omit<SliderProps, 'label'> & {
  /** Field label above the slider (the thumb tooltip label is always off; use `thumbLabel` for screen readers). */
  label?: ReactNode;
};

/** Thin wrapper over Mantine `Slider`: field label like other inputs, no floating label on the thumb. */
function SliderInput({ label, ...props }: SliderInputProps) {
  const slider = <Slider {...props} label={null} />;
  return label ? <Input.Wrapper label={label}>{slider}</Input.Wrapper> : slider;
}
export default SliderInput;
