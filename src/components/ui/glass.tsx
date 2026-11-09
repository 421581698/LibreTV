'use client';

import React, { forwardRef } from 'react';

type DivProps = React.HTMLAttributes<HTMLDivElement>;
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const GlassPanel = forwardRef<HTMLDivElement, DivProps>(function GlassPanel(
  { className = '', ...props }, ref,
) {
  return <div ref={ref} className={`glass-panel ${className}`.trim()} {...props} />;
});

export const GlassButton = forwardRef<HTMLButtonElement, ButtonProps>(function GlassButton(
  { className = '', type = 'button', ...props }, ref,
) {
  return <button ref={ref} type={type} className={`glass-button ${className}`.trim()} {...props} />;
});

export const GlassToolbar = forwardRef<HTMLDivElement, DivProps>(function GlassToolbar(
  { className = '', ...props }, ref,
) {
  return <div ref={ref} role="toolbar" className={`glass-toolbar ${className}`.trim()} {...props} />;
});

export function GlassPopover({ className = '', ...props }: DivProps) {
  return <div className={`glass-popover ${className}`.trim()} {...props} />;
}

export function GlassDialog({ className = '', ...props }: DivProps) {
  return <div role="dialog" aria-modal="true" className={`glass-dialog ${className}`.trim()} {...props} />;
}
