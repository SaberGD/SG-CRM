
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="sgui-panel-backdrop"
          />

          {/* Side panel (same dialog look as the accounting system) */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            className={`sgui-side-panel ${width}`}
          >
            <div className="sgui-side-panel-head">
              <div>
                {icon && <span className="sgui-side-panel-icon">{icon}</span>}
                <h2>{title}</h2>
              </div>
              <button type="button" onClick={onClose} className="sgui-icon-button" aria-label="إغلاق">
                <X size={20} />
              </button>
            </div>
            <div className="sgui-side-panel-body custom-scrollbar">
              <div className="max-w-3xl mx-auto">
                {children}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default FloatingPanel;
