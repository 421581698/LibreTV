'use client';

import { useMemo } from 'react';
import FridayOrb from '@/components/friday/FridayOrb';

export type FridayAssistantVisualState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'EXECUTING'
  | 'SPEAKING'
  | 'ERROR';

type FridayAssistantButtonProps = {
  state?: FridayAssistantVisualState;
  audioLevel?: number;
  theme?: 'light' | 'dark' | 'auto';
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * V4 compact entry point. It only presents state and forwards activation;
 * ASR/TTS/VAD and task lifecycle remain owned by the existing Friday controllers.
 */
export function FridayAssistantButton({
  state = 'IDLE',
  audioLevel = 0,
  theme = 'auto',
  onClick,
  label = '打开 Friday 语音助手',
  disabled = false,
  className = '',
}: FridayAssistantButtonProps) {
  const rendererState = useMemo(() => {
    if (state === 'EXECUTING') return 'THINKING';
    if (state === 'ERROR') return 'IDLE';
    return state;
  }, [state]);

  const statusLabel = state === 'LISTENING'
    ? '正在聆听'
    : state === 'THINKING'
      ? '正在思考'
      : state === 'EXECUTING'
        ? '正在执行'
        : state === 'SPEAKING'
          ? '正在回答'
          : state === 'ERROR'
            ? '需要处理'
            : '';

  return (
    <div className={['spatial-v4-friday-entry', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="spatial-v4-friday-button spatial-v4-focus"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={state === "LISTENING"}
        data-state={state.toLowerCase()}
      >
        <span className="spatial-v4-friday-renderer" aria-hidden="true">
          <FridayOrb
            state={rendererState}
            audioLevel={state === 'LISTENING' || state === 'SPEAKING' ? audioLevel : 0}
            theme={theme}
            interactive={false}
            showHud={false}
            dprCap={1.25}
            quality={0}
            className="spatial-v4-friday-canvas"
          />
        </span>
      </button>
      {statusLabel ? (
        <span className="spatial-v4-friday-status" role="status">
          {statusLabel}
        </span>
      ) : null}
      <style jsx>{`
        .spatial-v4-friday-entry {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .spatial-v4-friday-button {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          padding: 3px;
          border: 1px solid var(--spatial-separator, rgba(60,60,67,.14));
          border-radius: 50%;
          background: var(--spatial-surface, #fff);
          box-shadow: 0 1px 5px rgba(0,0,0,.06);
          cursor: pointer;
          transition: transform 180ms ease, box-shadow 180ms ease;
          -webkit-tap-highlight-color: transparent;
        }
        .spatial-v4-friday-button:hover:not(:disabled) {
          transform: scale(1.04);
          box-shadow: 0 3px 12px rgba(0,0,0,.10);
        }
        .spatial-v4-friday-button:active:not(:disabled) {
          transform: scale(.97);
        }
        .spatial-v4-friday-button:disabled {
          cursor: not-allowed;
          opacity: .55;
        }
        .spatial-v4-friday-button[data-state="executing"] {
          border-color: var(--spatial-accent, #c9963d);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--spatial-accent, #c9963d) 18%, transparent);
        }
        .spatial-v4-friday-button[data-state="error"] {
          border-color: var(--spatial-error, #c83c36);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--spatial-error, #c83c36) 16%, transparent);
        }
        .spatial-v4-friday-entry:has(.spatial-v4-friday-button[data-state="error"]) .spatial-v4-friday-status {
          color: var(--spatial-error, #c83c36);
        }
        .spatial-v4-friday-renderer {
          display: block;
          width: 36px;
          height: 36px;
          overflow: hidden;
        }
        .spatial-v4-friday-canvas {
          width: 36px !important;
          height: 36px !important;
        }
        .spatial-v4-friday-status {
          color: var(--spatial-text-secondary, #6e6e73);
          font-size: 12px;
          line-height: 1.35;
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: reduce) {
          .spatial-v4-friday-button { transition: none; }
        }
      `}</style>
    </div>
  );
}
