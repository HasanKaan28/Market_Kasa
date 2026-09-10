import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations } from '../i18n/translations';
import { db } from '../db/db';

const LanguageContext = createContext();

export const SUPPORTED_LANGUAGES = [
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' }
];

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    return localStorage.getItem('app_language') || 'tr';
  });

  useEffect(() => {
    // Also sync from db.settings if available
    async function loadSavedLang() {
      try {
        const setting = await db.settings.get('app_language');
        if (setting?.value && setting.value !== language) {
          setLanguageState(setting.value);
          localStorage.setItem('app_language', setting.value);
        }
      } catch (err) {
        console.warn('Lang load error:', err);
      }
    }
    loadSavedLang();
  }, []);

  const setLanguage = async (newLang) => {
    if (!translations[newLang]) return;
    setLanguageState(newLang);
    localStorage.setItem('app_language', newLang);
    try {
      await db.settings.put({ key: 'app_language', value: newLang });
    } catch (err) {
      console.warn('Lang save error:', err);
    }
  };

  const t = (key, fallback = '') => {
    const langDict = translations[language] || translations['tr'];
    if (langDict && langDict[key] !== undefined) {
      return langDict[key];
    }
    // Fallback to Turkish dictionary or default text
    return translations['tr']?.[key] || fallback || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, supportedLanguages: SUPPORTED_LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
