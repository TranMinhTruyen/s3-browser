import { Input, Slider, SliderProps } from '@mantine/core';
import { ReactNode } from 'react';
import classes from '@/components/inputs/SliderInput.module.css';

type SliderInputProps = Omit<SliderProps, 'label'> & {
  /** Nhãn trường nằm trên thanh trượt (tooltip của nút trượt luôn tắt; dùng `thumbLabel` cho trình đọc màn hình). */
  label?: ReactNode;
};

/** Lớp bọc mỏng quanh `Slider` của Mantine: nhãn trường như các input khác, không hiện nhãn nổi trên nút trượt. */
function SliderInput({ label, classNames, thumbLabel, ...props }: SliderInputProps) {
  // Chỉ gộp dạng object; nơi gọi không dùng dạng hàm của `classNames`.
  const extra = typeof classNames === 'object' ? classNames : undefined;
  const slider = (
    <Slider
      {...props}
      // Nút trượt là phần tử role="slider": đặt tên theo nhãn trường trừ khi nơi gọi đã truyền tên riêng.
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
