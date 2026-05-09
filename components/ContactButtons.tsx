
import React from 'react';
import { MessageCircle, PhoneCall } from 'lucide-react';

interface ContactButtonsProps {
  phone: string;
  className?: string;
  iconSize?: number;
}

const ContactButtons: React.FC<ContactButtonsProps> = ({ phone, className = '', iconSize = 16 }) => {
  if (!phone) return null;

  // تنظيف الرقم من أي مسافات أو رموز لروابط التواصل
  const cleanPhone = phone.replace(/\D/g, '');
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <a 
        href={`https://wa.me/${cleanPhone}`} 
        target="_blank" 
        rel="noreferrer"
        title="تواصل عبر واتساب" 
        className="p-2.5 bg-emerald-50 text-emerald-500 rounded-xl hover:scale-110 transition-all dark:bg-emerald-500/10 flex items-center justify-center hover:bg-emerald-500 hover:text-white dark:hover:bg-emerald-500"
        onClick={(e) => e.stopPropagation()}
      >
        <MessageCircle size={iconSize} />
      </a>
      <a 
        href={`tel:+${cleanPhone}`} 
        title="اتصال هاتفي" 
        className="p-2.5 bg-blue-50 text-blue-500 rounded-xl hover:scale-110 transition-all dark:bg-blue-500/10 flex items-center justify-center hover:bg-blue-500 hover:text-white dark:hover:bg-blue-500"
        onClick={(e) => e.stopPropagation()}
      >
        <PhoneCall size={iconSize} />
      </a>
    </div>
  );
};

export default ContactButtons;
