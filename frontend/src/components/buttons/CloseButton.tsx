import { X } from 'lucide-react';
import { tintedColor } from '@/common/theme/tintedColor';
import ActionIcon from '@/components/buttons/ActionIcon';
import classes from '@/components/buttons/CloseButton.module.css';

type CloseButtonProps = Omit<React.ComponentProps<typeof ActionIcon>, 'children' | 'type'>;

/** Red "X" action icon (hover: solid red) shared by window controls, modals, drawers and panels. Default size `md`. */
function CloseButton({ className, size = 'md', ...props }: CloseButtonProps) {
  return (
    <ActionIcon
      size={size}
      {...tintedColor('red', 'ai')}
      {...props}
      type="button"
      className={className ? `${classes.closeButton} ${className}` : classes.closeButton}
    >
      <X size="1rem" />
    </ActionIcon>
  );
}

export default CloseButton;
