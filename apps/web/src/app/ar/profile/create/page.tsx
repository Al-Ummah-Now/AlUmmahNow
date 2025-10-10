"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Profile } from '@/interfaces';
import { updateProfile } from "@/lib/clients/profiles";
import { useAuth } from '@/components/AuthProvider/authContext';

const ProfileCreatePage = () => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Initialize default profile for creation
    if (auth?.user) {
      setProfile({
        id: auth.user.id,
        email: auth.user.email,
        firstName: '',
        lastName: '',
        displayName: '',
        avatarUrl: '/avatar.png',
        coverUrl: undefined
      });
    }
  }, [auth]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !auth?.user) return;

    setLoading(true);
    setError(null);

    const formData = new FormData(event.target as HTMLFormElement);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const displayName = formData.get('displayName') as string;

    // Validation
    if (!firstName.trim()) {
      setError('الاسم الأول مطلوب');
      setLoading(false);
      return;
    }

    const newProfile = {
      ...profile,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      displayName: displayName.trim() || `${firstName.trim()} ${lastName.trim()}`.trim(),
    };

    try {
      await updateProfile(newProfile, setProfile);
      // Redirect to home page after successful profile creation
      router.push('/ar/');
    } catch (error) {
      console.error('Profile creation failed:', error);
      setError('فشل في إنشاء الملف الشخصي. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  if (!auth?.user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <p className="text-gray-600">يرجى تسجيل الدخول لإنشاء ملفك الشخصي.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 py-8" dir="rtl">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">إنشاء ملفك الشخصي</h1>
            <p className="text-gray-600">مرحباً بك في الأمة الآن! دعنا ننشئ ملفك الشخصي للبدء.</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-gray-700 font-medium mb-2">
                عنوان البريد الإلكتروني
              </label>
              <input
                type="email"
                value={auth.user?.email || ''}
                disabled
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-600"
              />
              <p className="text-sm text-gray-500 mt-1">لا يمكن تغيير عنوان بريدك الإلكتروني</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 font-medium mb-2">
                  الاسم الأول <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="firstName"
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="اسمك الأول"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-2">
                  الاسم الأخير
                </label>
                <input
                  type="text"
                  name="lastName"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="اسمك الأخير"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-700 font-medium mb-2">
                الاسم المعروض
              </label>
              <input
                type="text"
                name="displayName"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="كيف سيراك الآخرون (اختياري)"
              />
              <p className="text-sm text-gray-500 mt-1">إذا تُرك فارغاً، سنستخدم اسمك الأول والأخير</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="font-medium text-blue-900 mb-2">إشعار الخصوصية</h3>
              <p className="text-sm text-blue-800">
                ستُستخدم معلومات ملفك الشخصي لتخصيص تجربتك على الأمة الآن. 
                يمكنك تحديث معلومات ملفك الشخصي في أي وقت في إعدادات الملف الشخصي.
              </p>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-md font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'إنشاء الملف الشخصي...' : 'إنشاء الملف الشخصي'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfileCreatePage;