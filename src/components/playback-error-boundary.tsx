'use client';
import { Component, type ReactNode, type ErrorInfo } from 'react';

export class PlaybackErrorBoundary extends Component<{ children: ReactNode; label: string; optional?: boolean; fallback?: (retry: () => void) => ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[LibreTV] playback component failed:', this.props.label, error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(() => this.setState({ failed: false }));
    return <div role="alert" className="p-4 text-center text-sm text-muted">
      {this.props.optional ? '视频诊断暂不可用，普通播放不受影响。' : '播放器初始化失败，请重试或切换片源。'}
      <button type="button" className="ml-3 underline" onClick={() => this.setState({ failed: false })}>重试</button>
    </div>;
  }
}
