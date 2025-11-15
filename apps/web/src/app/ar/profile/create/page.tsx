"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Profile } from '@/interfaces';
import { createProfile } from "@/lib/api/profiles";
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

    // Validation
    if (!firstName.trim()) {
      setError('الاسم الأول مطلوب');
      setLoading(false);
      return;
    }

    try {
      await createProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        email: profile.email,
      });
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
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">يرجى تسجيل الدخول لإنشاء ملفك الشخصي.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 py-8" dir="rtl">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">إنشاء ملفك الشخصي</h1>
            <p className="text-gray-600 dark:text-gray-400">مرحباً بك في الأمة الآن! دعنا ننشئ ملفك الشخصي للبدء.</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                عنوان البريد الإلكتروني
              </label>
              <input
                type="email"
                value={auth.user?.email || ''}
                disabled
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">لا يمكن تغيير عنوان بريدك الإلكتروني</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                  الاسم الأول <span className="text-red-500 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  name="firstName"
                  required
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="اسمك الأول"
                />
              </div>

              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                  الاسم الأخير
                </label>
                <input
                  type="text"
                  name="lastName"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="اسمك الأخير"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                الاسم المعروض
              </label>
              <input
                type="text"
                name="displayName"
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                placeholder="كيف سيراك الآخرون (اختياري)"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">إذا تُرك فارغاً، سنستخدم اسمك الأول والأخير</p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md p-4">
              <h3 className="font-medium text-blue-900 dark:text-blue-300 mb-2">إشعار الخصوصية</h3>
              <p className="text-sm text-blue-800 dark:text-blue-400">
                ستُستخدم معلومات ملفك الشخصي لتخصيص تجربتك على الأمة الآن.
                يمكنك تحديث معلومات ملفك الشخصي في أي وقت في إعدادات الملف الشخصي.
              </p>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 dark:bg-blue-500 text-white py-3 px-6 rounded-md font-medium hover:bg-blue-700 dark:hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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