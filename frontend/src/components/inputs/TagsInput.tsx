import { TagsInput as MTagsInput, type TagsInputProps } from '@mantine/core';
import { useFieldError } from '@/common/hooks/useFieldError';

/** Mantine `TagsInput` that translates `error` through `useFieldError`. */
function TagsInput(props: TagsInputProps) {
  const { size = 'sm', error, label, ...rest } = props;
  const formatError = useFieldError();

  return <MTagsInput size={size} label={label} error={formatError(error, label)} {...rest} />;
}

export default TagsInput;
