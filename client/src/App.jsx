import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import ProspectDetail from './pages/ProspectDetail.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Outreach Pipeline</div>
        <nav>
          <NavLink to="/" end>
            Pipeline
          </NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/prospects/:id" element={<ProspectDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
