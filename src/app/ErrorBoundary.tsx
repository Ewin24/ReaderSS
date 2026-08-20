import { Component, type ComponentChildren } from "preact";

export interface ErrorBoundaryProps {
  children?: ComponentChildren;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Top-level render-error containment. Preact does not automatically protect
 * against a render-time throw: an uncaught error anywhere in the component
 * tree unmounts the whole app with no recovery path. For an offline-first
 * reader, one malformed entry among thousands must not cost the user access
 * to all of them.
 *
 * This boundary catches such errors, shows a visible message naming what
 * happened, and stops the crash from propagating - it does not attempt any
 * automatic recovery or retry; that is left for future work to build on.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("ReaderSS: a component crashed while rendering.", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div class="app-error" role="alert">
          <h1>Something went wrong</h1>
          <p>
            A part of the app failed to render. Your saved articles are still
            on this device; reloading the page may fix this.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
