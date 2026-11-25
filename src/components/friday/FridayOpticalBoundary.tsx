'use client';

import { Component, type ReactNode } from 'react';

export class FridayOpticalBoundary extends Component<{
  children: ReactNode;
  onFailure: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
