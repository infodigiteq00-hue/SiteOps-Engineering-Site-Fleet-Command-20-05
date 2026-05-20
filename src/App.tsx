import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SuperAdminRoute } from "@/components/SuperAdminRoute";
import { TenantGate } from "@/components/TenantGate";
import { AppShell } from "@/components/AppShell";
import Dashboard from "./pages/Dashboard.tsx";
import Sites from "./pages/Sites.tsx";
import SiteDetail from "./pages/SiteDetail.tsx";
import Machinery from "./pages/Machinery.tsx";
import MachineryOverview from "./pages/MachineryOverview.tsx";
import Requests from "./pages/Requests.tsx";
import NewRequest from "./pages/NewRequest.tsx";
import NewSite from "./pages/NewSite.tsx";
import Ledger from "./pages/Ledger.tsx";
import Team from "./pages/Team.tsx";
import PlatformAdmin from "./pages/PlatformAdmin.tsx";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";

const queryClient = new QueryClient();

const App = () => (
  <AuthProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              element={
                <ProtectedRoute>
                  <TenantGate />
                </ProtectedRoute>
              }
            >
              <Route element={<AppShell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/sites" element={<Sites />} />
                <Route path="/sites/new" element={<NewSite />} />
                <Route path="/sites/:id" element={<SiteDetail />} />
                <Route path="/machinery" element={<Machinery />} />
                <Route path="/machinery-overview" element={<MachineryOverview />} />
                <Route path="/requests" element={<Requests />} />
                <Route path="/requests/new" element={<NewRequest />} />
                <Route path="/ledger" element={<Ledger />} />
                <Route path="/team" element={<Team />} />
                <Route
                  path="/platform"
                  element={
                    <SuperAdminRoute>
                      <PlatformAdmin />
                    </SuperAdminRoute>
                  }
                />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AuthProvider>
);

export default App;
