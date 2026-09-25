import { Navigate, Route, Routes } from 'react-router-dom';
import { lazyPage } from './lazy-pages';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { AppShell } from './layout/AppShell';
import { MyDayPage } from './pages/MyDayPage';
import { SitePage, SiteProjectPage } from './pages/site/SitePage';

// Seiten, die erst beim Aufruf geladen werden (kleinerer Start, siehe lazy-pages.ts).
// Mein Tag und Baustelle bleiben im Hauptpaket: die ersten Seiten auf dem Handy.
const CustomersPage = lazyPage(() => import('./pages/CustomersPage'), 'CustomersPage');
const CustomerDetailPage = lazyPage(() => import('./pages/CustomerDetailPage'), 'CustomerDetailPage');
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'), 'ProjectsPage');
const PlanBoardPage = lazyPage(() => import('./pages/PlanBoardPage'), 'PlanBoardPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const EquipmentPage = lazyPage(() => import('./pages/equipment/EquipmentPage'), 'EquipmentPage');
const EquipmentDetailPage = lazyPage(
  () => import('./pages/equipment/EquipmentDetailPage'),
  'EquipmentDetailPage',
);
const ContractsPage = lazyPage(() => import('./pages/contracts/ContractsPage'), 'ContractsPage');
const OfflinePlansPage = lazyPage(() => import('./pages/OfflinePlansPage'), 'OfflinePlansPage');
const PlanEditorPage = lazyPage(() => import('./pages/plans/PlanEditorPage'), 'PlanEditorPage');
const ProjectDetailPage = lazyPage(() => import('./pages/ProjectDetailPage'), 'ProjectDetailPage');
const CalculationPage = lazyPage(() => import('./pages/CalculationPage'), 'CalculationPage');
const MasterDataPage = lazyPage(() => import('./pages/MasterDataPage'), 'MasterDataPage');
const TeamPage = lazyPage(() => import('./pages/TeamPage'), 'TeamPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const OpenItemsPage = lazyPage(() => import('./pages/OpenItemsPage'), 'OpenItemsPage');
const BankPage = lazyPage(() => import('./pages/BankPage'), 'BankPage');
const FinancePage = lazyPage(() => import('./pages/FinancePage'), 'FinancePage');

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Lädt …</p>;
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
        <Route path="projekte/:projectId/plaene/:planId" element={<PlanEditorPage />} />
        <Route path="offline" element={<OfflinePlansPage />} />
        <Route path="vertraege" element={<ContractsPage />} />
        <Route path="plantafel" element={<PlanBoardPage />} />
        <Route path="kalender" element={<CalendarPage />} />
        <Route path="geraete" element={<EquipmentPage />} />
        <Route path="geraete/:id" element={<EquipmentDetailPage />} />
        <Route path="baustelle" element={<SitePage />} />
        <Route path="baustelle/:projectId" element={<SiteProjectPage />} />
        <Route path="kunden" element={<CustomersPage />} />
        <Route path="kunden/:customerId" element={<CustomerDetailPage />} />
        <Route path="kalkulation" element={<CalculationPage />} />
        <Route path="stammdaten" element={<MasterDataPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="offene-posten" element={<OpenItemsPage />} />
        <Route path="bankabgleich" element={<BankPage />} />
        <Route path="finanzen" element={<FinancePage />} />
        <Route path="einstellungen" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
