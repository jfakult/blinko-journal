import { Icon } from '@/components/Common/Iconify/icons';
import { SendIcon } from '../../../Icons';
import { EditorStore } from '../../editorStore';
import { observer } from 'mobx-react-lite';

interface Props {
  store: EditorStore;
  isSendLoading?: boolean;
}

export const SendButton = observer(({ store, isSendLoading }: Props) => {
  // CUSTOM-JOURNAL: store.canSend already blocks an empty send functionally
  // (handleSend no-ops if !canSend, covering the keyboard-shortcut path
  // too) -- this makes the button visually reflect that instead of looking
  // clickable and silently doing nothing when tapped on an empty entry.
  const isDisabled = isSendLoading || !store.canSend
  return (
    <div
      onClick={
        (e) => {
          if(isDisabled) return
          store.handleSend()
        }
      }
      onTouchEnd={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if(isDisabled) return
        store.handleSend()
      }}
    >
      <div
        className={`w-[60px] group ml-2 bg-primary text-foreground flex items-center justify-center rounded-[11px] h-[32px] !transition-opacity ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {(store.files?.some(i => i.uploadPromise?.loading?.value) || isSendLoading) ? (
          <Icon icon="eos-icons:three-dots-loading" width="24" height="24" className='text-[#F5A524]'/>
        ) : (
          <SendIcon className='primary-foreground !text-primary-foreground group-hover:rotate-[-35deg] !transition-all' />
        )}
      </div>
    </div>
  );
})