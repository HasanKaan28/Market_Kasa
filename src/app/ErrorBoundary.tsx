import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/design';

type ErrorBoundaryProps = {
  children: ReactNode;
  onReset(): void;
  /** What the way out does; the register's wording when left out. */
  message?: string;
  resetLabel?: string;
};

type ErrorBoundaryState = { failed: boolean };

/** A render error must not leave a blank register: say so and offer a way back. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <main
        role="alert"
        className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <h1 className="text-xl font-semibold">Bir hata oluştu</h1>
        <p className="text-text-2">
          {this.props.message ??
            'Kaydedilen satışlar güvende. Sepeti temizleyip kasayı yeniden başlatabilirsiniz.'}
        </p>
        <Button variant="primary" size="lg" onClick={this.props.onReset}>
          {this.props.resetLabel ?? 'Sepeti temizle ve yeniden başlat'}
        </Button>
      </main>
    );
  }
}
