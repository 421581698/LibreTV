'use client';

import React, { forwardRef } from 'react';
import {
  GlassBar as FridayGlassBar,
  GlassControl as FridayGlassControl,
  GlassPanel as FridayGlassPanel,
} from '@/components/ui/friday-glass';

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Backward-compatible public API for existing LibreTV surfaces.
 * Every legacy primitive now delegates to the canonical Friday material role.
 */
export const GlassPanel = forwardRef<HTMLDivElement, DivProps>(function GlassPanel(
  { className = '', ...props }, ref,
) {
  return (
    <FridayGlassPanel
      ref={ref as React.Ref<HTMLElement>}
      className={`glass-panel ${className}`.trim()}
      {...props}
    />
  );
});

export const GlassButton = forwardRef<HTMLButtonElement, ButtonProps>(function GlassButton(
  { className = '', type = 'button', children, ...props }, ref,
) {
  return (
    <FridayGlassControl className={`glass-button liquid-glass-button-wrap friday-glass--interactive ${className}`.trim()}>
      <button
        ref={ref}
        type={type}
        className="liquid-glass-button-content"
        {...props}
      >
        {children}
      </button>
    </FridayGlassControl>
  );
});

export const GlassToolbar = forwardRef<HTMLDivElement, DivProps>(function GlassToolbar(
  { className = '', ...props }, ref,
) {
  return (
    <FridayGlassBar
      ref={ref as React.Ref<HTMLElement>}
      role="toolbar"
      className={`glass-toolbar ${className}`.trim()}
      {...props}
    />
  );
});

export function GlassPopover({ className = '', ...props }: DivProps) {
  return (
    <FridayGlassPanel className={`glass-popover ${className}`.trim()} {...props} />
  );
}

export const GlassDialog = forwardRef<HTMLDivElement, DivProps>(function GlassDialog(
  { className = '', ...props }, ref,
) {
  return (
    <FridayGlassPanel
      ref={ref as React.Ref<HTMLElement>}
      role="dialog"
      aria-modal="true"
      className={`glass-dialog ${className}`.trim()}
      {...props}
    />
  );
});
