import React from "react";

/**
 * Belt-and-suspenders error boundary — catches any remaining "Objects are
 * not valid as a React child" style crashes so the whole app doesn't
 * white-screen from a single mis-rendered value. Also captures unexpected
 * component errors and logs them to the console for debugging.
 */
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught an error:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || String(this.state.error);
      return (
        <div
          data-testid="app-error-boundary"
          className="min-h-screen bg-black text-white flex items-center justify-center p-8"
        >
          <div className="max-w-lg w-full border border-[#FF3333]/40 bg-[#FF3333]/5 p-6 font-mono">
            <div className="label-mono text-[#FF6666] mb-2">// UNEXPECTED ERROR</div>
            <h1 className="font-display text-2xl tracking-tighter mb-3">Something broke.</h1>
            <p className="text-xs text-neutral-400 leading-relaxed mb-4">
              The app hit an unexpected error. This screen kept the rest of the app
              from crashing. Click below to retry the last screen.
            </p>
            <details className="text-[10px] text-neutral-500 mb-4">
              <summary className="cursor-pointer hover:text-neutral-300">Show details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{msg}</pre>
            </details>
            <button
              data-testid="app-error-reload"
              onClick={this.reset}
              className="label-mono bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold px-4 py-2"
            >
              Try again
            </button>
            <button
              data-testid="app-error-hard-reload"
              onClick={() => window.location.reload()}
              className="ml-2 label-mono px-4 py-2 border border-white/20 text-neutral-300 hover:bg-white/5"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
