
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import React from 'react';

interface FloatingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  width?: string;
}

const FloatingPanel: React.FC<FloatingPanelProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  icon,
  width = 'max-w-2xl'
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - lighter and more subtle */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] z-[100]"
          />
          
          {/* Panel - Floating from the right, not centered */}
          <motion.div
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className={`fixed top-4 right-4 bottom-4 w-[calc(100%-2rem)] ${width} bg-white dark:bg-slate-900 shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] rounded-3xl border border-slate-100 dark:border-slate-800 z-[101] flex flex-col overflow-hidden`}
          >
            {/* Header */}
            <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0">
               <div className="flex items-center gap-4">
                  {icon && (
                    <div className="p-3 bg-primary-500/10 text-primary-500 rounded-xl">
                      {icon}
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase">{title}</h2>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase mt-0.5">Saber Group CRM</p>
                  </div>
               </div>
               <button 
                onClick={onClose} 
                className="sg-icon-btn hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 group"
               >
                  <X size={24} className="group-hover:text-slate-900 dark:group-hover:text-white transition-colors" />
               </button>
            </div>

            {/* Content Container - Independent Scroll */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 sm:p-6 custom-scrollbar">
              <div className="max-w-3xl mx-auto">
                {children}
              </div>
            </div>

            {/* Footer shadow fade for scroll indicator */}
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-slate-900 to-transparent pointer-events-none opacity-50" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default FloatingPanel;
