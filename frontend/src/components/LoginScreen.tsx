import { useState } from 'react';

interface Props {
  onLogin: (user: any) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isAdmin = email === "admin@constructvision.com" && password === "admin123";

    onLogin({
      id: isAdmin ? "admin" : Date.now().toString(),
      email,
      name: isAdmin ? "Administrator" : email.split('@')[0],
      isAdmin
    });
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 p-10 rounded-2xl w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-8 text-cyan-400">ConstructVision 3D</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-3 bg-gray-800 rounded-lg" required />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-3 bg-gray-800 rounded-lg" required />
          <button type="submit" className="w-full py-4 bg-cyan-600 rounded-lg font-semibold">Login</button>
        </form>
        <p className="text-center mt-4 text-xs text-gray-500">Admin: admin@constructvision.com / admin123</p>
      </div>
    </div>
  );
}