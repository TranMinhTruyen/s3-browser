import { Input, Slider, SliderProps } from '@mantine/core';
import { ReactNode } from 'react';
import classes from '@/components/inputs/SliderInput.module.css';

type SliderInputProps = Omit<SliderProps, 'label'> & {
  /** Field label above the slider (the thumb tooltip label is always off; use `thumbLabel` for screen readers). */
  label?: ReactNode;
};

/** Thin wrapper over Mantine `Slider`: field label like other inputs, no floating label on the thumb. */
function SliderInput({ label, classNames, thumbLabel, ...props }: SliderInputProps) {
  // Only the object form is merged; the function form of `classNames` is not used by callers.
  const extra = typeof classNames === 'object' ? classNames : undefined;
  const slider = (
    <Slider
      {...props}
      // The thumb is the role="slider" element: name it after the field label unless the caller gave one.
      thumbLabel={thumbLabel ?? (typeof label === 'string' ? label : undefined)}
      classNames={{
        ...extra,
        markWrapper: [classes.markWrapper, extra?.markWrapper].filter(Boolean).join(' '),
        markLabel: [classes.markLabel, extra?.markLabel].filter(Boolean).join(' '),
      }}
      label={null}
    />
  );
  return label ? <Input.Wrapper label={label}>{slider}</Input.Wrapper> : slider;
}
export default SliderInput;
