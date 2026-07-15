import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback — defaults to a styled error card. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React class-based error boundary.
 * Wraps async sections to prevent a single component failure from crashing
 * the entire app. Logs the error and renders a user-friendly fallback.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production you would send this to Sentry / Datadog / etc.
    console.error('[ErrorBoundary] Caught an unhandled error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          aria-live="assertive"
          className="min-h-[200px] flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-2xl text-center"
        >
          <p className="text-xs font-bold uppercase tracking-widest text-red-500 mb-2">
            Something went wrong
          </p>
          <h2 className="text-xl font-serif font-bold text-red-800 mb-3">
            An unexpected error occurred
          </h2>
          <p className="text-sm text-red-700 mb-6 max-w-md">
            {this.state.error?.message ?? 'Please try refreshing the page.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="px-6 py-2 bg-red-600 text-white text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-red-700 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
