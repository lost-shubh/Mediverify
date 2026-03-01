import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Something went wrong.' }
  }

  componentDidCatch(error, info) {
    console.error('UI crash', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto mt-10 flex w-full max-w-3xl flex-col gap-4 rounded-3xl border border-rose-400/40 bg-rose-500/10 p-6 text-slate-100">
          <h2 className="text-xl font-semibold">MedVerify recovered from a UI crash.</h2>
          <p className="text-sm text-rose-100">{this.state.message}</p>
          <button
            onClick={this.handleReset}
            className="w-fit rounded-full bg-rose-400/80 px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
