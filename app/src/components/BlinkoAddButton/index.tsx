import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { Icon } from '@/components/Common/Iconify/icons';
import { observer } from 'mobx-react-lite';
import { ShowEditBlinkoModel } from '../BlinkoRightClickMenu';
import { FocusEditorFixMobile } from "@/components/Common/Editor/editorUtils";
import { eventBus } from '@/lib/event';

export const BlinkoAddButton = observer(() => {
  const ICON_SIZE = {
    ACTION: 16,    // Icon size for action buttons
    CENTER: 26,    // Icon size for center button
    RECORD: 22     // CUSTOM-JOURNAL: icon size for the always-visible voice record button
  };
  const BUTTON_SIZE = {
    ACTION: 35,    // Size for action buttons
    CENTER: 50,    // Size for center button
    RECORD: 44     // CUSTOM-JOURNAL: size for the always-visible voice record button
  };
  const [isDragging, setIsDragging] = useState(false);
  const [isLongPressing, setIsLongPressing] = useState(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  const handleWriteAction = () => {
    ShowEditBlinkoModel('2xl', 'create')
    FocusEditorFixMobile()
  };

  const handleAudioRecording = () => {
    ShowEditBlinkoModel('2xl', 'create');
    setTimeout(() => {
      eventBus.emit('editor:startAudioRecording');
    }, 300);
  };

  const handleMouseDown = () => {
    longPressTimer.current = setTimeout(() => {
      setIsLongPressing(true);
      handleAudioRecording();
      // Reset immediately after triggering recording
      setTimeout(() => setIsLongPressing(false), 100);
    }, 800);
  };

  const handleMouseUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (!isLongPressing) {
      handleWriteAction();
    }

    // Always reset immediately on release
    setIsLongPressing(false);
  };

  const handleMouseLeave = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // Always reset immediately when leaving
    setIsLongPressing(false);
  };

  return (<>
    {/*
      CUSTOM-JOURNAL: always-visible voice record button.
      The original recording entry point (long-press on the "+" button below) requires
      an undiscoverable 800ms hold gesture with no visible hint that it exists - see
      docs/workstreams/03-voice-capture.md for the full assessment. The plugin API's
      addToolBarIcon only renders inside the note editor's toolbar (not on this landing
      screen), so it can't add a real landing-page action here - a small, isolated
      core patch was the only way to reach this surface. This button is a second,
      always-visible, single-tap affordance so a first-time user can record without
      being told the long-press exists. The long-press shortcut on the "+" button is
      left in place unchanged, for muscle memory / no regression.
    */}
    <motion.button
      type="button"
      aria-label="Record a voice entry"
      title="Record a voice entry"
      onClick={handleAudioRecording}
      whileTap={{ scale: 0.85 }}
      whileHover={{ scale: 1.05, boxShadow: '0 0 16px 4px rgba(255, 107, 107, 0.7)' }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
      className="flex items-center justify-center text-white rounded-full cursor-pointer"
      style={{
        width: BUTTON_SIZE.RECORD,
        height: BUTTON_SIZE.RECORD,
        position: 'fixed',
        right: 40 + (BUTTON_SIZE.CENTER - BUTTON_SIZE.RECORD) / 2,
        bottom: 110 + BUTTON_SIZE.CENTER + 16,
        zIndex: 50,
        background: '#FF6B6B',
        border: 'none',
        boxShadow: '0 0 10px 2px rgba(255, 107, 107, 0.5)'
      }}
    >
      <Icon icon="solar:microphone-3-bold" width={ICON_SIZE.RECORD} height={ICON_SIZE.RECORD} />
    </motion.button>
    <div style={{
      width: BUTTON_SIZE.CENTER,
      height: BUTTON_SIZE.CENTER,
      position: 'fixed',
      right: 40,
      bottom: 110,
      zIndex: 50
    }}>
    <motion.div
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
      animate={{
        scale: isDragging ? 1.1 : isLongPressing ? 1.1 : 1,
        backgroundColor: isLongPressing ? "#FF6B6B" : "#FFCC00",
      }}
      whileTap={{
        scale: 0.85,
        boxShadow: '0 0 15px 4px rgba(255, 204, 0, 0.8)'
      }}
      whileHover={{
        scale: 1.05,
        boxShadow: '0 0 20px 4px rgba(255, 204, 0, 0.7)'
      }}
      transition={{
        duration: 0.3,
        scale: {
          type: "spring",
          stiffness: 400,
          damping: 15
        },
        backgroundColor: {
          duration: 0.2
        }
      }}
      className="absolute inset-0 flex items-center justify-center text-black rounded-full cursor-pointer"
      style={{
        boxShadow: isLongPressing
          ? '0 0 20px 6px rgba(255, 107, 107, 0.6)'
          : '0 0 10px 2px rgba(255, 204, 0, 0.5)'
      }}
    >
      <motion.div
        animate={{
          scale: isLongPressing ? 1.2 : 1
        }}
        transition={{
          type: "spring",
          stiffness: 300,
          damping: 20
        }}
      >
        <Icon
          icon={isLongPressing ? "hugeicons:voice-id" : "material-symbols:add"}
          width={ICON_SIZE.CENTER}
          height={ICON_SIZE.CENTER}
        />
      </motion.div>
    </motion.div>
    </div>
  </>
  );
});