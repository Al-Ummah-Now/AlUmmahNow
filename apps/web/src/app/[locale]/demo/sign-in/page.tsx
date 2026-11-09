// Prototype only: the sign-in design in the active theme. The real page is served by the QA auth Worker.
import graphics from '@/theme/demo-graphics.json';

const THEME = (process.env.NEXT_PUBLIC_ACTIVE_THEME ?? 'lantern') as keyof typeof graphics;
const COPY = {
  en: { title: 'Sign in to Al Ummah Now', email: 'Email', password: 'Password', action: 'Continue', note: 'Design preview. This form does not sign you in.' },
  ar: { title: 'سجّل الدخول إلى الأمة الآن', email: 'البريد الإلكتروني', password: 'كلمة المرور', action: 'متابعة', note: 'معاينة للتصميم. لا يسجّل هذا النموذج دخولك.' },
};

export default async function DemoSignIn({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const c = locale === 'ar' ? COPY.ar : COPY.en;
  return (
    <main data-signin="" className="flex flex-1 items-center justify-center p-4">
      <div style={{ width: '100%', maxWidth: 400, background: 'var(--fanous-c-form-section-bg)', borderRadius: 'var(--fanous-radius-xl)', overflow: 'hidden', boxShadow: 'var(--fanous-elevation-high)' }}>
        <div className="demo-gfx" data-t={THEME} aria-hidden="true" dangerouslySetInnerHTML={{ __html: graphics[THEME] }} />
        <form className="grid gap-4 p-6">
          <h1 className="text-center text-xl font-semibold">{c.title}</h1>
          <label className="grid gap-1 text-sm font-medium">{c.email}<input type="email" dir="ltr" className="rounded-md border px-3" style={{ minHeight: 44 }} /></label>
          <label className="grid gap-1 text-sm font-medium">{c.password}<input type="password" dir="ltr" className="rounded-md border px-3" style={{ minHeight: 44 }} /></label>
          <button type="button" className="bg-blue-600 font-semibold" style={{ minHeight: 44 }}>{c.action}</button>
          <p className="text-center text-sm" style={{ color: 'var(--fanous-c-form-help)' }}>{c.note}</p>
        </form>
      </div>
    </main>
  );
}
