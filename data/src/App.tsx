import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext.tsx';
import { ProtectedRoute } from './components/ProtectedRoute.tsx';
import Login from './pages/Login.tsx';
import DataEntry from './pages/DataEntry.tsx';
import AdminPanel from './pages/AdminPanel.tsx';
import Header from './components/Header.tsx';

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-gray-50 flex flex-col">
          <Header />
          <main className="flex-1 container mx-auto px-4 py-8">
            <Routes>
              <Route path="/login" element={<Login />} />

              <Route element={<ProtectedRoute allowedRoles={['admin', 'data-entry']} />}>
                <Route path="/" element={<DataEntry />} />
              </Route>

              <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                <Route path="/admin" element={<AdminPanel />} />
              </Route>

              {/* Catch all */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
