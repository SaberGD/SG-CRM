import React, { Component } from 'react';

interface Props {
  name: string;
  children: React.ReactNode;
  /** Render nothing on error (for overlays) instead of an inline notice. */
  silent?: boolean;
}

interface State { error: Error | null; stack: string }

// Isolates render crashes so one broken widget can't spin the whole app in an error loop.
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const stack = (info.componentStack || '').trim().split('\n').slice(0, 4).join(' ← ');
    this.setState({ stack });
    console.error(`[ErrorBoundary:${this.props.name}]`, error, stack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className="p-6 m-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-center space-y-3">
        <p className="font-black text-rose-600 text-sm">حصلت مشكلة في عرض الصفحة دي</p>
        <p dir="ltr" className="text-[10px] font-mono text-rose-500/80 break-all">
          {this.props.name}: {this.state.error.message} {this.state.stack}
        </p>
        <button onClick={() => this.setState({ error: null, stack: '' })} className="sg-btn sg-btn-primary text-xs">إعادة المحاولة</button>
      </div>
    );
  }
}

export default ErrorBoundary;
