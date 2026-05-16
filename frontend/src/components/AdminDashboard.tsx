import { useState, useEffect } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export default function AdminDashboard({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allProjects, setAllProjects] = useState<any[]>([]);

  useEffect(() => {
    // Load all users and projects from localStorage (demo)
    const users: User[] = [];
    const projects: any[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('projects_')) {
        const userProjects = JSON.parse(localStorage.getItem(key) || '[]');
        projects.push(...userProjects);
      }
    }

    setAllProjects(projects);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-10">
          <h1 className="text-4xl font-bold">Admin Dashboard</h1>
          <button onClick={onLogout} className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg">
            Logout Admin
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-gray-900 p-6 rounded-xl">
            <h2 className="text-2xl mb-6">All Projects ({allProjects.length})</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {allProjects.map((p, index) => (
                <div key={index} className="bg-gray-800 p-4 rounded-lg">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-gray-400">Created: {new Date(p.createdAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 p-6 rounded-xl">
            <h2 className="text-2xl mb-6">System Info</h2>
            <div className="space-y-4 text-sm">
              <p><strong>Current Admin:</strong> {user.name} ({user.email})</p>
              <p><strong>Total Projects:</strong> {allProjects.length}</p>
              <p><strong>Users Registered:</strong> Multiple (LocalStorage Demo)</p>
              <p><strong>Server Status:</strong> Running</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}