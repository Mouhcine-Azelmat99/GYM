import {Languages} from 'lucide-react';
import {useTranslation} from 'react-i18next';

export default function LanguageSwitcher({className=''}) {
  const {t,i18n}=useTranslation();
  return <label className={`language-switcher ${className}`}>
    <Languages size={17} aria-hidden="true"/>
    <span className="sr-only">{t('Language')}</span>
    <select aria-label={t('Language')} value={i18n.resolvedLanguage} onChange={event=>i18n.changeLanguage(event.target.value)}>
      <option value="en" lang="en">English</option>
      <option value="ar" lang="ar">العربية</option>
    </select>
  </label>;
}
