import { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import MainApp from './components/MainApp';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem('cv_current_user');
    if (saved) {
      setCurrentUser(JSON.parse(saved));
      setIsLoggedIn(true);
    }
  }, []);

  const handleLogin = (user: any) => {
    localStorage.setItem('cv_current_user', JSON.stringify(user));
    setCurrentUser(user);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('cv_current_user');
    setCurrentUser(null);
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <MainApp user={currentUser} onLogout={handleLogout} />;
}

export default App;