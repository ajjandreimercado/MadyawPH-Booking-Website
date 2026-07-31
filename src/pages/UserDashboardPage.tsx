import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Heart, User, Star, ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/ui/ToastProvider';
import UpgradedMyBookingsPage from './MyBookingsPage';

type DashboardTab = 'bookings' | 'favorites' | 'profile' | 'reviews';

const TABS: { key: DashboardTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'bookings', label: 'My Bookings', icon: BookOpen },
  { key: 'favorites', label: 'Saved Properties', icon: Heart },
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'reviews', label: 'My Reviews', icon: Star },
];

function ProfileTab() {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  const handleLogout = async () => {
    await logout();
    showToast({ title: 'Signed out successfully', type: 'success' });
    navigate('/');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-5 mb-6">
        <div className="w-20 h-20 rounded-full bg-brand-primary/10 flex items-center justify-center">
          {user?.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full object-cover" />
          ) : (
            <span className="text-3xl font-serif font-bold text-brand-primary">{user?.name?.[0]?.toUpperCase()}</span>
          )}
        </div>
        <div>
          <h2 className="text-2xl font-serif font-bold text-brand-dark">{user?.name}</h2>
          <p className="text-sm font-bold text-brand-dark/60">{user?.email}</p>
          <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${user?.role === 'partner' ? 'bg-brand-warning/10 text-brand-warning' : user?.role === 'admin' || user?.role === 'staff' || user?.role === 'super_admin' ? 'bg-brand-success/10 text-brand-success' : 'bg-brand-primary/10 text-brand-primary'}`}>
            {user?.role ?? 'guest'}
          </span>
        </div>
      </div>

      <div className="bg-brand-background rounded-2xl p-6 space-y-4">
        <h3 className="font-serif font-bold text-lg text-brand-dark">Personal Information</h3>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-2">Display Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className="input-field" />
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-brand-dark/50 block mb-2">Email Address</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" readOnly />
        </div>
        <p className="text-xs font-bold text-brand-dark/40">Email address cannot be changed here.</p>
        <button type="button" className="btn-primary text-sm" onClick={() => showToast({ title: 'Profile updated', type: 'success' })}>
          Save Changes
        </button>
      </div>

      <div className="bg-brand-background rounded-2xl p-6">
        <h3 className="font-serif font-bold text-lg text-brand-dark mb-4">Payment Methods</h3>
        <p className="text-sm font-bold text-brand-dark/60">Payment methods will be saved after your first transaction.</p>
      </div>

      <div className="border border-brand-danger/20 rounded-2xl p-6">
        <h3 className="font-serif font-bold text-lg text-brand-danger mb-2">Account Actions</h3>
        <button type="button" onClick={handleLogout} className="flex items-center gap-2 text-sm font-bold text-brand-danger hover:text-brand-danger/80 transition-colors">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
  );
}

function FavoritesTab() {
  return (
    <div className="py-16 text-center">
      <Heart className="w-16 h-16 text-brand-primary/20 mx-auto mb-4" />
      <h3 className="text-xl font-serif font-bold text-brand-dark mb-2">No saved properties yet</h3>
      <p className="text-brand-dark/60 font-bold mb-6">Tap the heart icon on any property to save it here.</p>
      <Link to="/search" className="btn-primary inline-flex items-center gap-2">
        Explore Properties <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

function MyReviewsTab() {
  return (
    <div className="py-16 text-center">
      <Star className="w-16 h-16 text-brand-primary/20 mx-auto mb-4" />
      <h3 className="text-xl font-serif font-bold text-brand-dark mb-2">No reviews yet</h3>
      <p className="text-brand-dark/60 font-bold mb-6">After completing a stay, leave a review from your Bookings tab.</p>
      <Link to="/search" className="btn-primary inline-flex items-center gap-2">
        Book a Stay <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

export default function UserDashboardPage() {
  const params = useParams<{ tab?: DashboardTab }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<DashboardTab>(
    (params.tab as DashboardTab) ?? 'bookings'
  );

  return (
    <div className="min-h-screen bg-brand-background pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-serif font-bold text-brand-dark">My Account</h1>
          <p className="text-brand-dark/60 font-bold mt-1">Manage your bookings, saved stays, and profile</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8">
          {/* Sidebar */}
          <aside>
            <div className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm overflow-hidden">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setActiveTab(tab.key); navigate(`/dashboard/${tab.key}`, { replace: true }); }}
                  className={`w-full flex items-center gap-3 px-5 py-4 text-sm font-bold border-b border-brand-primary/8 last:border-0 text-left transition-colors ${activeTab === tab.key ? 'bg-brand-primary/8 text-brand-primary' : 'text-brand-dark hover:bg-brand-background'}`}
                >
                  <tab.icon className={`w-4 h-4 ${activeTab === tab.key ? 'text-brand-primary' : 'text-brand-dark/40'}`} />
                  {tab.label}
                  {activeTab === tab.key && <ChevronRight className="w-4 h-4 ml-auto text-brand-primary" />}
                </button>
              ))}
            </div>
          </aside>

          {/* Content */}
          <main className="bg-brand-cream rounded-2xl border border-brand-primary/10 shadow-sm p-6">
            {activeTab === 'bookings' && <UpgradedMyBookingsPage />}
            {activeTab === 'favorites' && <FavoritesTab />}
            {activeTab === 'profile' && <ProfileTab />}
            {activeTab === 'reviews' && <MyReviewsTab />}
          </main>
        </div>
      </div>
    </div>
  );
}
