import { Component, type ErrorInfo, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Sylloop encountered an unrecoverable UI error", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <BrandMark />
        <h1>Sylloop</h1>
        <p>The interface could not be loaded. Please restart the application.</p>
        <button type="button" onClick={() => window.location.reload()}>Restart</button>
      </main>
    );
  }
}
