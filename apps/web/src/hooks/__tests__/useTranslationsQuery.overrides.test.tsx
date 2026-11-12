/**
 * #982: the web shows its own (repo) text for every key the translation store
 * did not mark as admin-edited, even when the stored copy is stale.
 */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AR_TRANSLATIONS } from "@/lib/i18n/translations/ar";
import { useTranslationsQuery } from "../useTranslationsQuery";
import type { AppTranslations } from "@/lib/i18n/types";

const mockGetTranslations = jest.fn();
jest.mock("@/lib/api/i18n", () => ({
  getTranslations: (...args: unknown[]) => mockGetTranslations(...args),
}));

function stale(): AppTranslations {
  const t: AppTranslations = JSON.parse(JSON.stringify(AR_TRANSLATIONS));
  t.a11y.goToHomePage = "الصفحة الرئيسية للأمة الآن";
  t.common.save = "احفظ الآن";
  return t;
}

async function load() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTranslationsQuery("ar"), { wrapper });
  await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
  return result.current.data as AppTranslations;
}

describe("useTranslationsQuery with a translation store override list", () => {
  it("uses the repo text for unedited keys and the store for edited ones", async () => {
    mockGetTranslations.mockResolvedValue({ version: "1.0.82", locale: "ar", updatedAt: "x", translations: stale(), overrides: ["common.save"] });
    const t = await load();
    expect(t.a11y.goToHomePage).toBe(AR_TRANSLATIONS.a11y.goToHomePage);
    expect(t.common.save).toBe("احفظ الآن");
  });

  it("merges a store without an override list whole (pre-#982 behaviour)", async () => {
    mockGetTranslations.mockResolvedValue({ version: "1.0.81", locale: "ar", updatedAt: "x", translations: stale() });
    const t = await load();
    expect(t.a11y.goToHomePage).toBe("الصفحة الرئيسية للأمة الآن");
  });
});
