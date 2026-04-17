import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  toggleLanguage: () => void;
  t: (key: string) => string;
  isRTL: boolean;
}

const translations: Record<string, Record<Language, string>> = {
  // Auth - Login
  enterPhone: { en: 'Enter your phone number', ar: 'أدخل رقم هاتفك' },
  sendCodeSubtitle: { en: "We'll send you a verification code", ar: 'سنرسل لك رمز التحقق' },
  sendCode: { en: 'Send Code', ar: 'إرسال الرمز' },
  disclaimer: { en: 'By continuing you agree to our Terms of Service', ar: 'بالمتابعة، أنت توافق على شروط الخدمة' },
  phonePlaceholder: { en: '7X XXX XXXX', ar: '7X XXX XXXX' },

  // Auth - Verify
  enterCode: { en: 'Enter the code', ar: 'أدخل الرمز' },
  sentTo: { en: 'Sent to', ar: 'أُرسل إلى' },
  verify: { en: 'Verify', ar: 'تحقق' },
  resendCode: { en: 'Resend code', ar: 'إعادة إرسال الرمز' },
  resendIn: { en: 'Resend code in', ar: 'إعادة الإرسال خلال' },
  seconds: { en: 's', ar: 'ث' },
  back: { en: '← Back', ar: 'رجوع →' },

  // Home
  whereTo: { en: 'Where to?', ar: 'إلى أين؟' },
  setPickup: { en: 'Set pickup location', ar: 'حدد موقع الانطلاق' },
  tapMapDest: { en: 'Tap map to set destination', ar: 'اضغط على الخريطة لتحديد الوجهة' },
  estimatedFare: { en: 'Estimated fare', ar: 'الأجرة التقديرية' },
  cashPayment: { en: 'Cash payment', ar: 'دفع نقدي' },
  requestWasel: { en: 'Request Wasel', ar: 'اطلب وصل' },
  currentLocation: { en: 'Current Location', ar: 'الموقع الحالي' },
  signOut: { en: 'Sign out', ar: 'تسجيل الخروج' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },

  // Trip status
  findingDrivers: { en: 'Finding drivers...', ar: 'جاري البحث عن سائقين...' },
  contactingDriver: { en: 'Contacting driver...', ar: 'جاري التواصل مع السائق...' },
  driverAccepted: { en: 'Driver accepted!', ar: 'قبل السائق الرحلة!' },
  driverOnWay: { en: 'Driver on the way', ar: 'السائق في الطريق' },
  driverArrived: { en: 'Driver has arrived', ar: 'وصل السائق' },
  tripInProgress: { en: 'Trip in progress', ar: 'الرحلة جارية' },
  tripComplete: { en: 'Trip complete! 🎉', ar: '!اكتملت الرحلة 🎉' },

  // Explore
  exploreAmman: { en: 'Explore Amman', ar: 'استكشف عمّان' },
  all: { en: 'All', ar: 'الكل' },
  restaurants: { en: 'Restaurants', ar: 'مطاعم' },
  cafes: { en: 'Cafes', ar: 'مقاهي' },
  landmarks: { en: 'Landmarks', ar: 'معالم' },
  shopping: { en: 'Shopping', ar: 'تسوق' },
  noPlaces: { en: 'No places found', ar: 'لا توجد أماكن' },
  loading: { en: 'Loading...', ar: 'جاري التحميل...' },
  errorLoad: { en: 'Could not load places. Pull to retry.', ar: 'تعذر تحميل الأماكن. اسحب للمحاولة مرة أخرى.' },

  // Waitlist - Rider
  beFirstToRide: { en: 'Be the first to ride', ar: 'كن أول من يركب' },
  fullName: { en: 'Full Name', ar: 'الاسم الكامل' },
  phoneNumber: { en: 'Phone Number', ar: 'رقم الهاتف' },
  cityOptional: { en: 'City (optional)', ar: 'المدينة (اختياري)' },
  joinWaitlist: { en: 'Join the Waitlist', ar: 'انضم لقائمة الانتظار' },
  waitlistDisclaimer: { en: "We'll notify you when Wasel launches in your city.\nNo spam, ever.", ar: 'سنخطرك عند إطلاق وصل في مدينتك.\nلا رسائل مزعجة أبدًا.' },
  taglineRider: { en: 'The ride-hailing app built for Jordan', ar: 'تطبيق التنقل المصمم للأردن' },
  missingInfo: { en: 'Missing info', ar: 'معلومات ناقصة' },
  enterNamePhone: { en: 'Please enter your name and phone number.', ar: 'يرجى إدخال اسمك ورقم هاتفك.' },
  error: { en: 'Error', ar: 'خطأ' },
  somethingWrong: { en: 'Something went wrong', ar: 'حدث خطأ ما' },

  // Waitlist - Driver
  joinAsDriver: { en: 'Join as a driver', ar: 'انضم كسائق' },
  joinAsDriverBtn: { en: 'Join as Driver', ar: 'انضم كسائق' },
  vehicleType: { en: 'Vehicle Type (optional)', ar: 'نوع المركبة (اختياري)' },
  taglineDriver: { en: 'Drive with Wasel — earn more, pay less', ar: 'اقد مع وصل — اكسب أكثر، ادفع أقل' },
  driverDisclaimer: { en: "We'll contact you when onboarding opens in your city.\nNo spam, ever.", ar: 'سنتواصل معك عند فتح التسجيل في مدينتك.\nلا رسائل مزعجة أبدًا.' },
  noCommission: { en: 'No commission', ar: 'بدون عمولة' },
  flatSubscription: { en: 'Flat subscription', ar: 'اشتراك ثابت' },
  keepEarnings: { en: 'You keep earnings', ar: 'أرباحك لك' },

  // Driver Dashboard
  online: { en: '🟢 Online', ar: '🟢 متصل' },
  offline: { en: '⚫ Offline', ar: '⚫ غير متصل' },
  acceptingTrips: { en: 'Accepting trips', ar: 'قبول الرحلات' },
  goOnlineMsg: { en: 'Go online to receive trips', ar: 'اتصل لاستقبال الرحلات' },
  waitingForTrips: { en: 'Waiting for trips...', ar: 'في انتظار الرحلات...' },
  tripActive: { en: 'Trip in progress', ar: 'رحلة جارية' },
  newTripRequest: { en: 'New trip request', ar: 'طلب رحلة جديد' },
  estimatedFareLabel: { en: 'Estimated fare', ar: 'الأجرة التقديرية' },
  decline: { en: 'Decline', ar: 'رفض' },
  accept: { en: 'Accept', ar: 'قبول' },
  iArrived: { en: "I've arrived", ar: 'لقد وصلت' },
  startTrip: { en: 'Start trip', ar: 'ابدأ الرحلة' },
  completeTrip: { en: 'Complete trip', ar: 'أنهِ الرحلة' },
  driverApproval: { en: 'Driver accounts are subject to approval', ar: 'حسابات السائقين خاضعة للموافقة' },

  // General
  earlyMember: { en: 'Early Member', ar: 'عضو مبكر' },
  setPickupDropoff: { en: 'Set pickup and dropoff', ar: 'حدد نقطة الانطلاق والوجهة' },
  tapMapDest2: { en: 'Tap the map to set your destination.', ar: 'اضغط على الخريطة لتحديد وجهتك.' },

  // Driver Tabs & Profile
  dashboard: { en: 'Dashboard', ar: 'لوحة القيادة' },
  profile: { en: 'Profile', ar: 'الملف الشخصي' },
  driverProfile: { en: 'Driver Profile', ar: 'ملف السائق' },
  driverSince: { en: 'Driver since', ar: 'سائق منذ' },
  subscriptionTier: { en: 'Subscription Tier', ar: 'مستوى الاشتراك' },
  silver: { en: 'Silver', ar: 'فضي' },
  gold: { en: 'Gold', ar: 'ذهبي' },
  platinum: { en: 'Platinum', ar: 'بلاتيني' },
  dispatchPriorityNote: {
    en: 'Your tier determines your dispatch priority in the BMP algorithm',
    ar: 'يحدد مستواك الأولوية في خوارزمية التوزيع',
  },
  vehicle: { en: 'Vehicle', ar: 'المركبة' },
  vehiclePlate: { en: 'Plate', ar: 'اللوحة' },
  language: { en: 'Language', ar: 'اللغة' },
  aboutWaselDriver: { en: 'About Wasel Driver', ar: 'عن وصل سائق' },
  version: { en: 'Version', ar: 'الإصدار' },
  signOutConfirm: { en: 'Sign out?', ar: 'تسجيل الخروج؟' },
  signOutMessage: { en: 'Are you sure you want to sign out?', ar: 'هل أنت متأكد؟' },
  signOutConfirmBtn: { en: 'Sign Out', ar: 'تسجيل الخروج' },
  earlyMemberTitle: { en: 'Early Member', ar: 'عضو مبكر' },
  waitlistPosition: { en: 'Waitlist position', ar: 'موقع في قائمة الانتظار' },
  earlyMemberNote: {
    en: 'You joined before Wasel launched — exclusive benefits coming soon',
    ar: 'انضممت قبل إطلاق وصل — مزايا حصرية قادمة قريباً',
  },

  // Business model
  modelHeadline: { en: 'Drive with Wasel. Keep every fare.', ar: 'اقد مع وصل. احتفظ بكل أجرة.' },
  modelSubtitle: {
    en: 'Traditional platforms take 20–30% of every ride. Wasel charges a flat monthly subscription — after that, every fare you earn is entirely yours.',
    ar: 'تأخذ المنصات التقليدية 20–30٪ من كل رحلة. وصل يفرض اشتراكاً شهرياً ثابتاً — بعد ذلك، كل أجرة تكسبها هي لك تماماً.',
  },
  perMonth: { en: '/mo', ar: '/شهر' },
  tierSilverDesc: { en: 'Standard dispatch priority', ar: 'أولوية توزيع عادية' },
  tierGoldDesc: { en: 'Higher dispatch score · More trips offered first', ar: 'درجة توزيع أعلى · المزيد من الرحلات أولاً' },
  tierPlatinumDesc: { en: 'Maximum priority · First in every dispatch queue', ar: 'أولوية قصوى · الأول في كل قائمة توزيع' },
  tierStartNote: { en: 'All drivers start on Silver. Move up as you build your track record.', ar: 'جميع السائقين يبدأون بالفضي. ارتقِ مع بناء سجلك.' },
  chooseTier: { en: 'Choose your tier at onboarding', ar: 'اختر مستواك عند التسجيل' },

  // Profile tier pricing
  monthlyFee: { en: 'Monthly fee', ar: 'الرسوم الشهرية' },
  keepsFare: { en: 'You keep 100% of every fare', ar: 'تحتفظ بـ 100٪ من كل أجرة' },
  dispatchWeight: { en: 'Dispatch weight', ar: 'وزن التوزيع' },
  upgradePrompt: { en: 'Upgrade your tier', ar: 'ارفع مستواك' },
  upgradeDesc: {
    en: 'Higher tier = more trips offered to you first. The subscription pays for itself with extra volume.',
    ar: 'مستوى أعلى = المزيد من الرحلات تُعرض عليك أولاً. يدفع الاشتراك لنفسه من خلال الحجم الإضافي.',
  },
  upgradeTo: { en: 'Upgrade to', ar: 'الترقية إلى' },
  forPerMonth: { en: 'for', ar: 'مقابل' },

  // Dashboard reinforcement
  fareIsYours: { en: 'Every fare goes directly to you', ar: 'كل أجرة تذهب مباشرة إليك' },
  todayEarnings: { en: 'Today', ar: 'اليوم' },
  todayTrips: { en: 'Trips', ar: 'الرحلات' },
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  toggleLanguage: () => {},
  t: (key: string) => key,
  isRTL: false,
});

const STORAGE_KEY = '@wasel_language';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'ar' || stored === 'en') {
        setLanguage(stored);
      }
    }).catch(() => {});
  }, []);

  function toggleLanguage() {
    const next: Language = language === 'en' ? 'ar' : 'en';
    const nextRTL = next === 'ar';

    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    setLanguage(next);

    if (I18nManager.isRTL !== nextRTL) {
      I18nManager.forceRTL(nextRTL);
      Alert.alert(
        next === 'ar' ? 'مطلوب إعادة تشغيل' : 'Restart Required',
        next === 'ar'
          ? 'يرجى إعادة تشغيل التطبيق لتطبيق اللغة العربية'
          : 'Please restart the app to apply the language change.',
      );
    }
  }

  function t(key: string): string {
    const entry = translations[key];
    if (!entry) return key;
    return entry[language] ?? entry['en'] ?? key;
  }

  return (
    <LanguageContext.Provider value={{ language, toggleLanguage, t, isRTL: language === 'ar' }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
