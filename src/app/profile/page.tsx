"use client";
import React, { useEffect } from 'react';
import { Profile } from '@/interfaces';
import { fetchProfile, updateProfile } from "@/lib/profiles";
import { useAuth } from '@/components/AuthProvider/authContext';

const ProfilePage = () => {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const auth = useAuth();

  useEffect(() => {
    if (!auth) return;
    fetchProfile(auth.user, setProfile);
  }, [auth]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // Handle form submission logic here
    const formData = new FormData(event.target as HTMLFormElement);
    const newProfile = {
      id: profile?.id,
      email: profile?.email,
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
    };
    updateProfile(auth.user, setProfile);
  };

  return (
    <div className="profile-page flex flex-col md:flex-row min-h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="sidebar w-full md:w-1/4 bg-white shadow-md p-4">
        <ul className="space-y-4">
          <li>
            <a href="#dashboard" className="text-blue-600 hover:underline">
              Dashboard
            </a>
          </li>
          <li>
            <a href="#edit-profile" className="text-blue-600 hover:underline">
              Edit Profile
            </a>
          </li>
          <li>
            <a href="#manage-content" className="text-blue-600 hover:underline">
              Manage Content
            </a>
          </li>
        </ul>
      </aside>

      {/* Main Content */}
      <main className="main-content flex-1 p-6">
        {/* Name Section */}
        <section id="name" className="section mb-8">
          <h1 className="text-3xl font-bold text-gray-800">{`Welcome ${profile?.firstName ?? ""} ${profile?.lastName ?? ""}!`}</h1>
          <p className="text-gray-600">Welcome to your profile page!</p>
        </section>

        {/* Dashboard Section */}
        <section id="dashboard" className="section mb-8">
          <h2 className="text-2xl font-semibold text-gray-800">Dashboard</h2>
          <p className="text-gray-600">Overview of your activities and statistics.</p>
          {/* ...add dashboard components here... */}
        </section>

        {/* Edit Profile Section */}
        <section id="edit-profile" className="section mb-8">
          <h2 className="text-2xl font-semibold text-gray-800">Edit Profile</h2>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-gray-700">Name:</span>
              <div className="flex space-x-2">
                <input
                  type="text"
                  name="name"
                  className="mt-1 block w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder={profile?.firstName ? profile.firstName : "Your first name"}
                />
                <input
                  type="text"
                  name="name"
                  className="mt-1 block w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder={profile?.lastName ? profile.lastName : "Your last name"}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-gray-700">Email:</span>
              <input
                type="email"
                name="email"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                value={profile?.email}
                readOnly
              />
            </label>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Save Changes
            </button>
          </form>
        </section>

        {/* Manage Content Section */}
        <section id="manage-content" className="section">
          <h2 className="text-2xl font-semibold text-gray-800">Manage Content</h2>
          <p className="text-gray-600">View and manage your uploaded content.</p>
          {/* ...add content management components here... */}
        </section>
      </main>
    </div>
  );
};

export default ProfilePage;
