import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  Alert, I18nManager, Modal, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Language = 'en' | 'ar';

interface LanguageContextType {
  language: Language;
  /** Opens the language-selection modal. */
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
  back: { en: 'Back', ar: 'رجوع' },

  // Home
  whereTo: { en: 'Where to?', ar: 'إلى أين؟' },
  setPickup: { en: 'Set pickup location', ar: 'حدد موقع الانطلاق' },
  tapMapDest: { en: 'Search destination...', ar: 'ابحث عن الوجهة...' },
  estimatedFare: { en: 'Estimated fare', ar: 'الأجرة التقديرية' },
  cashPayment: { en: 'Cash payment', ar: 'دفع نقدي' },
  requestWasel: { en: 'Request Wasel', ar: 'اطلب واصل' },
  currentLocation: { en: 'Current Location', ar: 'الموقع الحالي' },
  signOut: { en: 'Sign out', ar: 'تسجيل الخروج' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },

  // Trip status
  findingDrivers: { en: 'Finding drivers...', ar: 'جاري البحث عن سائقين...' },
  contactingDriver: { en: 'Contacting driver...', ar: 'جاري التواصل مع السائق...' },
  driverAccepted: { en: 'Driver accepted', ar: 'قبل السائق الرحلة' },
  driverOnWay: { en: 'Driver on the way', ar: 'السائق في الطريق' },
  driverArrived: { en: 'Driver has arrived', ar: 'وصل السائق' },
  tripInProgress: { en: 'Trip in progress', ar: 'الرحلة جارية' },
  tripComplete: { en: 'Trip complete', ar: 'اكتملت الرحلة' },

  // Explore
  exploreAmman: { en: 'Explore', ar: 'استكشف' },
  exploreSubtitle: { en: 'Discover the best of the city', ar: 'اكتشف أفضل ما في المدينة' },
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
  waitlistDisclaimer: { en: "We'll notify you when Wasel launches in your city.\nNo spam, ever.", ar: 'سنخطرك عند إطلاق واصل في مدينتك.\nلا رسائل مزعجة أبدًا.' },
  taglineRider: { en: 'The ride-hailing app built for Jordan', ar: 'تطبيق التنقل المصمم للأردن' },
  missingInfo: { en: 'Missing info', ar: 'معلومات ناقصة' },
  enterNamePhone: { en: 'Please enter your name and phone number.', ar: 'يرجى إدخال اسمك ورقم هاتفك.' },
  error: { en: 'Error', ar: 'خطأ' },
  somethingWrong: { en: 'Something went wrong', ar: 'حدث خطأ ما' },
  otpSendFailed: { en: 'Failed to send OTP. Please try again.', ar: 'فشل إرسال رمز التحقق. يرجى المحاولة مرة أخرى.' },

  // Waitlist - Driver
  joinAsDriver: { en: 'Join as a driver', ar: 'انضم كسائق' },
  joinAsDriverBtn: { en: 'Join as Driver', ar: 'انضم كسائق' },
  vehicleType: { en: 'Vehicle Type (optional)', ar: 'نوع المركبة (اختياري)' },
  taglineDriver: { en: 'Drive with Wasel — earn more, pay less', ar: 'اقد مع واصل — اكسب أكثر، ادفع أقل' },
  driverDisclaimer: { en: "We'll contact you when onboarding opens in your city.\nNo spam, ever.", ar: 'سنتواصل معك عند فتح التسجيل في مدينتك.\nلا رسائل مزعجة أبدًا.' },
  noCommission: { en: 'No commission', ar: 'بدون عمولة' },
  flatSubscription: { en: 'Flat subscription', ar: 'اشتراك ثابت' },
  keepEarnings: { en: 'You keep earnings', ar: 'أرباحك لك' },

  // Driver Dashboard
  online: { en: 'Online', ar: 'متصل' },
  offline: { en: 'Offline', ar: 'غير متصل' },
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
  tapMapDest2: { en: 'Search for a destination above.', ar: 'ابحث عن وجهتك أعلاه.' },

  // Profile / Settings
  profile: { en: 'Profile', ar: 'الملف الشخصي' },
  settings: { en: 'Settings', ar: 'الإعدادات' },
  displayName: { en: 'Display name', ar: 'الاسم المعروض' },
  savedPlaces: { en: 'Saved places', ar: 'الأماكن المحفوظة' },
  paymentMethods: { en: 'Payment methods', ar: 'طرق الدفع' },
  notifications: { en: 'Notifications', ar: 'الإشعارات' },
  helpSupport: { en: 'Help & support', ar: 'المساعدة والدعم' },
  faq: { en: 'FAQ', ar: 'الأسئلة الشائعة' },
  contactSupport: { en: 'Contact support', ar: 'تواصل مع الدعم' },
  safetyTitle: { en: 'Safety', ar: 'السلامة' },
  emergencyContact: { en: 'Emergency contact', ar: 'جهة اتصال الطوارئ' },
  privacyPolicy: { en: 'Privacy policy', ar: 'سياسة الخصوصية' },
  termsOfService: { en: 'Terms of service', ar: 'شروط الخدمة' },
  comingSoon: { en: 'Coming soon', ar: 'قريباً' },
  notSet: { en: 'Not set', ar: 'غير محدد' },
  memberSince: { en: 'Member since', ar: 'عضو منذ' },
  earlyMemberTitle: { en: 'Early Member', ar: 'عضو مبكر' },
  waitlistPosition: { en: 'Waitlist position', ar: 'موقع في قائمة الانتظار' },
  earlyMemberNote: {
    en: 'You joined before Wasel launched — exclusive benefits coming soon',
    ar: 'انضممت قبل إطلاق واصل — مزايا حصرية قادمة قريباً',
  },
  language: { en: 'Language', ar: 'اللغة' },
  english: { en: 'English', ar: 'الإنجليزية' },
  arabic: { en: 'Arabic', ar: 'العربية' },
  aboutWasel: { en: 'About Wasel', ar: 'عن واصل' },
  version: { en: 'Version', ar: 'الإصدار' },
  signOutConfirm: { en: 'Sign out?', ar: 'تسجيل الخروج؟' },
  signOutMessage: {
    en: 'Are you sure you want to sign out?',
    ar: 'هل أنت متأكد أنك تريد تسجيل الخروج؟',
  },
  signOutConfirmBtn: { en: 'Sign Out', ar: 'تسجيل الخروج' },

  // Trip History
  tripHistory: { en: 'Trip history', ar: 'سجل الرحلات' },
  noTripsYet: { en: 'No trips yet', ar: 'لا رحلات بعد' },
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
  const [selectorVisible, setSelectorVisible] = useState(false);

  useEffect(() => {
    // Guards against setState-after-unmount if the provider is torn down
    // before AsyncStorage resolves (e.g. during a logout/navigation race).
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (!mounted) return;
      if (stored === 'ar' || stored === 'en') {
        setLanguage(stored);
        // Re-apply RTL direction on every launch so the layout engine is
        // always in sync with the stored preference. Without this, switching
        // to Arabic and restarting can leave I18nManager.isRTL in a stale
        // state, causing layout engine corruption and a native crash.
        const needsRTL = stored === 'ar';
        if (I18nManager.isRTL !== needsRTL) {
          I18nManager.forceRTL(needsRTL);
        }
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Opens the modal instead of auto-toggling
  function toggleLanguage() {
    setSelectorVisible(true);
  }

  function handleSelect(lang: Language) {
    setSelectorVisible(false);
    if (lang === language) return;

    AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
    setLanguage(lang);

    const nextRTL = lang === 'ar';
    if (I18nManager.isRTL !== nextRTL) {
      I18nManager.forceRTL(nextRTL);
      // The new RTL direction takes full effect on the NEXT launch — React Native's
      // layout engine is already running and cannot be hot-switched mid-session.
      // forceRTL persists the value to native storage so the next launch picks it
      // up correctly (our startup useEffect above also re-applies it as a safety net).
      Alert.alert(
        lang === 'ar' ? 'مطلوب إعادة تشغيل' : 'Restart Required',
        lang === 'ar'
          ? 'يرجى إغلاق التطبيق وإعادة فتحه لتطبيق اللغة العربية'
          : 'Please close and reopen the app to apply the language change.',
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

      {/* Language selector modal — shown by toggleLanguage() */}
      <Modal
        visible={selectorVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectorVisible(false)}
      >
        <View style={ls.overlay}>
          <View style={ls.card}>
            <Text style={ls.title}>
              {language === 'ar' ? 'اختر اللغة' : 'Select Language'}
            </Text>

            <TouchableOpacity
              style={[ls.option, language === 'en' && ls.optionActive]}
              onPress={() => handleSelect('en')}
            >
              <Text style={[ls.optionText, language === 'en' && ls.optionTextActive]}>
                English
              </Text>
              {language === 'en' && <View style={ls.checkDot} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[ls.option, language === 'ar' && ls.optionActive]}
              onPress={() => handleSelect('ar')}
            >
              <Text style={[ls.optionText, language === 'ar' && ls.optionTextActive]}>
                العربية
              </Text>
              {language === 'ar' && <View style={ls.checkDot} />}
            </TouchableOpacity>

            <TouchableOpacity style={ls.cancelRow} onPress={() => setSelectorVisible(false)}>
              <Text style={ls.cancelText}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);

const ls = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 24,
    width: 280,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  title: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 20,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  optionActive: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: '#F5A623',
  },
  optionText: {
    color: '#AAA',
    fontWeight: '600',
    fontSize: 16,
  },
  optionTextActive: {
    color: '#F5A623',
  },
  checkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F5A623',
  },
  cancelRow: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelText: {
    color: '#555',
    fontSize: 15,
  },
});
