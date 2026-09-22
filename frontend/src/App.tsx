import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { AppShell } from './layout/AppShell';
import { MyDayPage } from './pages/MyDayPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerDetailPage } from './pages/CustomerDetailPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { CalculationPage } from './pages/CalculationPage';
import { MasterDataPage } from './pages/MasterDataPage';
import { TeamPage } from './pages/TeamPage';
import { SettingsPage } from './pages/SettingsPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<MyDayPage />} />
        <Route path="projekte" element={<ProjectsPage />} />
        <Route path="projekte/:projectId" element={<ProjectDetailPage />} />
        <Route path="kunden" element={<CustomersPage />} />
        <Route path="kunden/:customerId" element={<CustomerDetailPage />} />
        <Route path="kalkulation" element={<CalculationPage />} />
        <Route path="stammdaten" element={<MasterDataPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="einstellungen" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
