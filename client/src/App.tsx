import './App.css'
import { AppShell } from './components/layout/AppShell'
import { ToastContainer } from './components/ui/ToastContainer'
import { ConfirmDialog } from './components/ui/ConfirmDialog'
import { AuthBoundary } from './components/auth/AuthBoundary'

function App() {
  return (
    <AuthBoundary>
      <AppShell />
      <ToastContainer />
      <ConfirmDialog />
    </AuthBoundary>
  )
}

export default App
