/**
 * The pay flow on /upgrade and Settings › Billing (wiki AUN-SUBS), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-captions.ts.
 * Placeholders: {price}, {rate}, {tier}, {date}, {provider}, {amount}.
 */

export interface BillingTranslations {
  /** Provider names as shown to users (ids from PAYMENT_PROVIDERS) */
  providers: Record<'paddle' | 'paygood' | 'fake' | 'manual', string>;
  pay: {
    lead: string;
    perMonth: string;
    perYear: string;
    periodLabel: string;
    monthly: string;
    yearly: string;
    currencyLabel: string;
    providerLabel: string;
    plusTax: string;
    plusTaxRate: string;
    taxIncluded: string;
    subscribe: string;
    subscribing: string;
    signInToSubscribe: string;
    subscribed: string;
    payNote: string;
    confirmingTitle: string;
    confirmingBody: string;
    successTitle: string;
    successBody: string;
    goToStudio: string;
    viewBilling: string;
    slowTitle: string;
    slowBody: string;
    canceledReturn: string;
  };
  errors: {
    alreadySubscribed: string;
    notForSale: string;
    providerDisabled: string;
    providerError: string;
    wrongState: string;
    failed: string;
    loadFailed: string;
    retry: string;
  };
  settings: {
    title: string;
    description: string;
    subscriptionsHeading: string;
    noSubscriptions: string;
    paymentsHeading: string;
    noPayments: string;
    status: Record<'pending' | 'active' | 'past_due' | 'canceled' | 'ended', string>;
    renewsOn: string;
    endsOn: string;
    endedOn: string;
    accessUntil: string;
    complimentary: string;
    via: string;
    pastDueNote: string;
    cancel: string;
    cancelTitle: string;
    cancelBody: string;
    cancelBodyNow: string;
    cancelConfirm: string;
    keep: string;
    cancelRequested: string;
    manage: string;
    opening: string;
    testMode: string;
    payment: { date: string; amount: string; status: string; receipt: string; open: string };
    paymentStatus: Record<'succeeded' | 'failed' | 'refunded' | 'partially_refunded', string>;
    refundedPart: string;
  };
}

export const BILLING_EN: BillingTranslations = {
  providers: { paddle: 'Paddle', paygood: 'PayGood', fake: 'Test provider', manual: 'Complimentary' },
  pay: {
    lead: 'Pick the tier that fits what you want to do on Al Ummah Now, and subscribe to it.',
    perMonth: '{price} / month',
    perYear: '{price} / year',
    periodLabel: 'Billing period',
    monthly: 'Monthly',
    yearly: 'Yearly',
    currencyLabel: 'Currency',
    providerLabel: 'Pay with',
    plusTax: 'plus tax',
    plusTaxRate: 'plus {rate}% tax',
    taxIncluded: 'tax included',
    subscribe: 'Subscribe to {tier}',
    subscribing: 'Opening checkout…',
    signInToSubscribe: 'Sign in to subscribe',
    subscribed: 'Your subscription',
    payNote: 'Renews automatically. Cancel any time in Settings › Billing; you keep the tier until the end of the paid period.',
    confirmingTitle: 'Confirming your payment…',
    confirmingBody: 'This usually takes a few seconds. You can stay on this page.',
    successTitle: 'You are now on {tier}',
    successBody: 'Your subscription is active and your tier is updated.',
    goToStudio: 'Go to Studio',
    viewBilling: 'View billing',
    slowTitle: 'Your payment is still processing',
    slowBody: 'Your tier will appear here shortly. You can check Settings › Billing, or reload this page in a minute.',
    canceledReturn: 'Checkout was closed. Nothing was charged.',
  },
  errors: {
    alreadySubscribed: 'You already subscribe to this tier. Manage it in Settings › Billing.',
    notForSale: 'This tier is not available for purchase right now.',
    providerDisabled: 'Payments are not available right now. Please try again later.',
    providerError: 'The payment provider did not respond. Please try again in a moment.',
    wrongState: 'This subscription can no longer be changed.',
    failed: 'Something went wrong. Please try again.',
    loadFailed: 'Your billing could not be loaded.',
    retry: 'Try again',
  },
  settings: {
    title: 'Billing',
    description: 'Your subscriptions and payment history',
    subscriptionsHeading: 'Subscriptions',
    noSubscriptions: 'You have no subscriptions.',
    paymentsHeading: 'Payment history',
    noPayments: 'No payments yet.',
    status: { pending: 'Starting', active: 'Active', past_due: 'Payment due', canceled: 'Canceled', ended: 'Ended' },
    renewsOn: 'Renews on {date}',
    endsOn: 'Ends on {date}',
    endedOn: 'Ended on {date}',
    accessUntil: 'Access until {date}',
    complimentary: 'Complimentary',
    via: 'via {provider}',
    pastDueNote: 'Your last payment did not go through. The payment provider will try again; update your payment method to keep your tier.',
    cancel: 'Cancel subscription',
    cancelTitle: 'Cancel your {tier} subscription?',
    cancelBody: 'You will not be charged again. You keep {tier} until {date}.',
    cancelBodyNow: 'You will not be charged again. You keep {tier} until the end of the paid period.',
    cancelConfirm: 'Cancel subscription',
    keep: 'Keep subscription',
    cancelRequested: 'Your subscription is being canceled. This page updates in a moment.',
    manage: 'Manage billing',
    opening: 'Opening…',
    testMode: 'Test',
    payment: { date: 'Date', amount: 'Amount', status: 'Status', receipt: 'Receipt', open: 'View receipt' },
    paymentStatus: { succeeded: 'Paid', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Partly refunded' },
    refundedPart: '{amount} refunded',
  },
};

export const BILLING_AR: BillingTranslations = {
  providers: { paddle: 'Paddle', paygood: 'PayGood', fake: 'جهة دفع تجريبية', manual: 'مجاني' },
  pay: {
    lead: 'اختر الفئة التي تناسب ما تريد فعله في الأمة الآن، واشترك فيها.',
    perMonth: '{price} / شهريًا',
    perYear: '{price} / سنويًا',
    periodLabel: 'فترة الفوترة',
    monthly: 'شهري',
    yearly: 'سنوي',
    currencyLabel: 'العملة',
    providerLabel: 'الدفع عبر',
    plusTax: 'غير شامل الضريبة',
    plusTaxRate: 'تُضاف ضريبة {rate}٪',
    taxIncluded: 'شامل الضريبة',
    subscribe: 'اشترك في {tier}',
    subscribing: 'جارٍ فتح صفحة الدفع…',
    signInToSubscribe: 'سجّل الدخول للاشتراك',
    subscribed: 'اشتراكك',
    payNote: 'يتجدد تلقائيًا. ألغِ في أي وقت من الإعدادات › الفوترة، وتحتفظ بالفئة حتى نهاية الفترة المدفوعة.',
    confirmingTitle: 'جارٍ تأكيد الدفع…',
    confirmingBody: 'يستغرق هذا عادة بضع ثوانٍ. يمكنك البقاء في هذه الصفحة.',
    successTitle: 'أصبحت فئتك الآن {tier}',
    successBody: 'اشتراكك فعّال وتم تحديث فئتك.',
    goToStudio: 'الانتقال إلى الاستوديو',
    viewBilling: 'عرض الفوترة',
    slowTitle: 'لا يزال الدفع قيد المعالجة',
    slowBody: 'ستظهر فئتك هنا قريبًا. يمكنك مراجعة الإعدادات › الفوترة، أو إعادة تحميل الصفحة بعد دقيقة.',
    canceledReturn: 'أُغلقت صفحة الدفع. لم يُخصم أي مبلغ.',
  },
  errors: {
    alreadySubscribed: 'أنت مشترك بالفعل في هذه الفئة. يمكنك إدارته من الإعدادات › الفوترة.',
    notForSale: 'هذه الفئة غير متاحة للشراء حاليًا.',
    providerDisabled: 'الدفع غير متاح حاليًا. يُرجى المحاولة لاحقًا.',
    providerError: 'لم تستجب جهة الدفع. يُرجى المحاولة بعد قليل.',
    wrongState: 'لم يعد بالإمكان تغيير هذا الاشتراك.',
    failed: 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
    loadFailed: 'تعذّر تحميل بيانات الفوترة.',
    retry: 'إعادة المحاولة',
  },
  settings: {
    title: 'الفوترة',
    description: 'اشتراكاتك وسجل المدفوعات',
    subscriptionsHeading: 'الاشتراكات',
    noSubscriptions: 'ليست لديك اشتراكات.',
    paymentsHeading: 'سجل المدفوعات',
    noPayments: 'لا توجد مدفوعات بعد.',
    status: { pending: 'قيد البدء', active: 'فعّال', past_due: 'دفعة مستحقة', canceled: 'ملغى', ended: 'منتهٍ' },
    renewsOn: 'يتجدد في {date}',
    endsOn: 'ينتهي في {date}',
    endedOn: 'انتهى في {date}',
    accessUntil: 'متاح حتى {date}',
    complimentary: 'مجاني',
    via: 'عبر {provider}',
    pastDueNote: 'لم تنجح آخر دفعة. ستعيد جهة الدفع المحاولة؛ حدّث وسيلة الدفع للاحتفاظ بفئتك.',
    cancel: 'إلغاء الاشتراك',
    cancelTitle: 'إلغاء اشتراكك في {tier}؟',
    cancelBody: 'لن يُخصم منك أي مبلغ بعد الآن. تحتفظ بفئة {tier} حتى {date}.',
    cancelBodyNow: 'لن يُخصم منك أي مبلغ بعد الآن. تحتفظ بفئة {tier} حتى نهاية الفترة المدفوعة.',
    cancelConfirm: 'إلغاء الاشتراك',
    keep: 'الإبقاء على الاشتراك',
    cancelRequested: 'جارٍ إلغاء اشتراكك. ستتحدث هذه الصفحة بعد لحظات.',
    manage: 'إدارة الفوترة',
    opening: 'جارٍ الفتح…',
    testMode: 'تجريبي',
    payment: { date: 'التاريخ', amount: 'المبلغ', status: 'الحالة', receipt: 'الإيصال', open: 'عرض الإيصال' },
    paymentStatus: { succeeded: 'مدفوع', failed: 'فشل', refunded: 'مسترد', partially_refunded: 'مسترد جزئيًا' },
    refundedPart: 'استُرد {amount}',
  },
};
